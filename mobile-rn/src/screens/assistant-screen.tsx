// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Image,
  ActivityIndicator,
  PanResponder,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { mascotSource, normalizeMascotKind } from "@/settings/mascots";

import { AgentRunError, runAgent } from "@/agent/runtime";
import { undoLastWrite, undoLabel, type WritePreview } from "@/agent/write-review";
import {
  attachmentContextBlock,
  MAX_ATTACHMENTS_PER_MESSAGE,
  pickTextAttachment,
  saveAttachmentAsNote,
  type TextAttachment,
} from "@/agent/attachments";
import {
  computeContextUsage,
  CONTEXT_WINDOW_KEY,
  DEFAULT_CONTEXT_WINDOW_TOKENS,
  formatUsagePercent,
  normalizeContextWindow,
} from "@/agent/context-usage";
import { editorFontFamily, readChatPrefs } from "@/settings/editor-prefs";
import { AgentQuestionSheet, AgentTraceView, ReasoningRow } from "@/components/agent-run-view";
import { appendCrashLog } from "@/lib/crash-log";
import { MessageActionBar } from "@/components/message-action-bar";
import { AdaptiveScroll, Button, EmptyState, ErrorNotice, Field, Header, Screen, SheetBackdrop } from "@/components/ui";
import {
  addMessage,
  createChatSession,
  deleteChatSession,
  getChatMessageCounts,
  ensureScratchProject,
  listProjects,
  deleteMessagesFrom,
  getProject,
  getProviderApiKey,
  getSetting,
  listChatSessions,
  listMessages,
  listModels,
  listProviders,
  replaceUserMessageBranch,
  setSetting,
  updateChatSession,
} from "@/data/repositories";
import {
  getActiveStyleProfile,
  listStyleProfiles,
  setActiveStyleProfile,
} from "@/data/style-repositories";
import type { RootTabParamList } from "@/navigation/types";
import { getAgentDefinitions } from "@/settings/config";
import { useAppStore } from "@/store/app-store";
import { colors, radius, shadow, spacing } from "@/theme";
import type {
  AgentClarificationRequest,
  AgentClarificationResponse,
  AgentRunTrace,
  ChatMessage,
  ChatSession,
  Model,
  ModelSelection,
  Project,
  Provider,
  StyleProfile,
} from "@/types";

/**
 * 工具授权。写入类工具先展示「改前 / 改后」，按一整组接受或驳回，
 * 而不是只看一段参数 JSON——借鉴 DeepWrite 的操作批次与 denova 的整组粒度。
 */
type WriteCardRequest = {
  name: string;
  target?: string;
  before?: string;
  after?: string;
  details?: string;
  resolve: (ok: boolean) => void;
};

/** 红绿行统计：after 有而 before 没有的行计新增，反之计删除。 */
function formatMessageTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return sameDay ? `${hh}:${mm}` : `${date.getMonth() + 1}月${date.getDate()}日 ${hh}:${mm}`;
}

function diffLineStats(before: string, after: string): { added: number; removed: number } {
  const beforeLines = before.split("\n");
  const afterLines = after.split("\n");
  const pool = new Map<string, number>();
  beforeLines.forEach((line) => pool.set(line, (pool.get(line) ?? 0) + 1));
  let added = 0;
  afterLines.forEach((line) => {
    const remain = pool.get(line) ?? 0;
    if (remain > 0) pool.set(line, remain - 1); else added += 1;
  });
  const pool2 = new Map<string, number>();
  afterLines.forEach((line) => pool2.set(line, (pool2.get(line) ?? 0) + 1));
  let removed = 0;
  beforeLines.forEach((line) => {
    const remain = pool2.get(line) ?? 0;
    if (remain > 0) pool2.set(line, remain - 1); else removed += 1;
  });
  return { added, removed };
}

let writeCardSink: ((req: WriteCardRequest) => void) | null = null;

function requestToolApproval(name: string, args: Record<string, unknown>, preview: WritePreview | null): Promise<boolean> {
  if (!preview) {
    const details = JSON.stringify(args, null, 2).slice(0, 1_200);
    return new Promise((resolve) => {
      if (writeCardSink) writeCardSink({ name, details, resolve });
      else {
        Alert.alert("确认工具调用", `${name}\n\n${details}`, [
          { text: "拒绝", style: "cancel", onPress: () => resolve(false) },
          { text: "允许一次", onPress: () => resolve(true) },
        ], { cancelable: false });
      }
    });
  }
  const before = preview.before.trim() || "（当前为空）";
  const after = preview.after.trim() || "（将清空）";
  return new Promise((resolve) => {
    if (writeCardSink) writeCardSink({ name, target: preview.target, before, after, resolve });
    else resolve(false);
  });
}

function activeSessionSettingKey(projectId: string): string {
  return `assistant.activeSession.${projectId}`;
}

function generatedSessionTitle(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 24) || "新对话";
}

function formatSessionTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

async function resolveSelection(
  modelId: string | null,
  models: Model[],
  providers: Provider[],
): Promise<ModelSelection | null> {
  if (!modelId) return null;
  const model = models.find((item) => item.id === modelId);
  if (!model) return null;
  const provider = providers.find((item) => item.id === model.providerId);
  if (!provider) return null;
  const apiKey = await getProviderApiKey(provider);
  if (!apiKey) throw new Error(`${provider.name} 没有可用的 API Key，请到设置页重新保存`);
  return { provider, model, apiKey };
}

type RetryRequest = {
  sessionId: string;
  userMessage: ChatMessage;
  history: ChatMessage[];
  sourceMessageId: string;
  modelId: string;
  agentId: string | null;
};

function humanizeAgentError(error: unknown): { message: string; detail: string } {
  const detail = error instanceof Error ? error.message : String(error);
  const normalized = detail.toLowerCase();
  if (/sslhandshake|ssl handshake|certificate|connection closed/.test(normalized)) {
    return { message: "网络连接异常（SSL 握手失败），请检查网络环境或供应商配置后重试", detail };
  }
  if (/timeout|timed out|aborterror|请求超时/.test(normalized)) {
    return { message: "模型请求超时，请检查网络或供应商配置后重试", detail };
  }
  if (/fetch failed|network request failed|unable to connect|cannot connect/.test(normalized)) {
    return { message: "网络连接异常，请检查网络、Base URL 和证书设置后重试", detail };
  }
  if (/\bhttp\s*400\b|\b400\s*:/.test(normalized)) {
    return { message: "供应商拒绝了本次请求（400），请检查模型工具调用兼容性后重试", detail };
  }
  if (/\bhttp\s*429\b|\b429\s*:/.test(normalized)) {
    return { message: "供应商暂时限流（429），请稍后重试或更换模型", detail };
  }
  return { message: detail, detail };
}

function retryRequestForMessage(
  message: ChatMessage,
  messages: ChatMessage[],
  session: ChatSession | null,
  selection: ModelSelection | null,
  agentId: string | null,
): RetryRequest | null {
  if (!session || message.role !== "assistant") return null;
  const messageIndex = messages.findIndex((item) => item.id === message.id);
  if (messageIndex < 0) return null;
  const context = message.metadata?.retryContext;
  const userIndex = context
    ? messages.findIndex((item) => item.id === context.userMessageId && item.role === "user")
    : messages.slice(0, messageIndex).map((item) => item.role).lastIndexOf("user");
  if (userIndex < 0 || userIndex >= messageIndex) return null;
  const userMessage = messages[userIndex];
  return {
    sessionId: session.id,
    userMessage,
    history: messages.slice(0, userIndex + 1),
    sourceMessageId: message.id,
    modelId: context?.modelId ?? session.modelId ?? selection?.model.id ?? "",
    agentId: context?.agentId ?? agentId,
  };
}

export function AssistantScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabParamList>>();
  const projectId = useAppStore((state) => state.currentProjectId);
  const setCurrentProject = useAppStore((state) => state.setCurrentProject);
  const [scratchProjectId, setScratchProjectId] = useState<string | null>(null);
  // 无作品模式：未选书时落到「未命名」，助手照常可用
  const effectiveProjectId = projectId ?? scratchProjectId;
  const refreshData = useAppStore((state) => state.refreshData);
  const revision = useAppStore((state) => state.dataRevision);
  const [project, setProject] = useState<Project | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  /** 聊天列表为 inverted（业界标准：GiftedChat 等）——offset 0 恒为最新消息，
   *  打开 / 切换 / 发送天然落在最新，无需任何滚动代码。 */
  const reversedMessages = useMemo(() => [...messages].reverse(), [messages]);
  const [models, setModels] = useState<Model[]>([]);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [defaultModelId, setDefaultModelId] = useState<string | null>(null);
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null);
  const [activeAgentName, setActiveAgentName] = useState("Build");
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);
  const [activeStyleProfile, setActiveStyleProfileState] = useState<StyleProfile | null>(null);
  const [selection, setSelection] = useState<ModelSelection | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [thinkingSeconds, setThinkingSeconds] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sessionPickerVisible, setSessionPickerVisible] = useState(false);
  const [headerMenuVisible, setHeaderMenuVisible] = useState(false);
  const [messageCounts, setMessageCounts] = useState<Record<string, number>>({});
  const [renaming, setRenaming] = useState<ChatSession | null>(null);
  const [mascotEnabled, setMascotEnabled] = useState(true);
  const [mascotKind, setMascotKind] = useState<string>("cat");
  const [mascotOffset, setMascotOffset] = useState({ x: 0, y: 0 });
  const [projectPickerVisible, setProjectPickerVisible] = useState(false);
  const [projectsForPicker, setProjectsForPicker] = useState<Project[]>([]);
  const [renameTitle, setRenameTitle] = useState("");
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [stylePickerVisible, setStylePickerVisible] = useState(false);
  const [updatingStyle, setUpdatingStyle] = useState(false);
  const [liveTrace, setLiveTrace] = useState<AgentRunTrace | null>(null);
  const [liveReasoning, setLiveReasoning] = useState("");
  // 最近一次被接受的 AI 写入（撤销入口），null 表示当前没有可撤销的改动
  const [undoTarget, setUndoTarget] = useState<string | null>(null);
  // 待随下一条消息发送的文本附件
  const [attachments, setAttachments] = useState<TextAttachment[]>([]);
  const [writeCard, setWriteCard] = useState<WriteCardRequest | null>(null);
  const [writeDiffExpanded, setWriteDiffExpanded] = useState(false);
  writeCardSink = (req) => { setWriteDiffExpanded(false); setWriteCard(req); };
  const [pendingQuestion, setPendingQuestion] = useState<AgentClarificationRequest | null>(null);
  const [retryRequest, setRetryRequest] = useState<RetryRequest | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const composerRef = useRef<TextInput>(null);
  const loadRequestRef = useRef(0);
  const sendRequestRef = useRef(0);
  const questionResolverRef = useRef<((response: AgentClarificationResponse) => void) | null>(null);
  const providerById = useMemo(() => new Map(providers.map((provider) => [provider.id, provider])), [providers]);

  const cancelPendingQuestion = useCallback(() => {
    const resolver = questionResolverRef.current;
    questionResolverRef.current = null;
    setPendingQuestion(null);
    resolver?.({ answers: [], cancelled: true });
  }, []);

  const load = useCallback(async (overrideId?: string) => {
    const requestId = loadRequestRef.current + 1;
    loadRequestRef.current = requestId;
    let activeProjectId = overrideId ?? projectId ?? scratchProjectId;
    if (!activeProjectId) {
      const scratch = await ensureScratchProject();
      activeProjectId = scratch.id;
      setScratchProjectId(scratch.id);
    }
    setLoading(true);
    setError(null);
    try {
      const [
        nextProject,
        storedSessions,
        preferredSessionId,
        activeModelId,
        nextModels,
        nextProviders,
        activeAgentId,
        agents,
        nextStyleProfiles,
        nextActiveStyleProfile,
      ] = await Promise.all([
        getProject(activeProjectId),
        listChatSessions(activeProjectId),
        getSetting(activeSessionSettingKey(activeProjectId)),
        getSetting("activeModelId"),
        listModels(),
        listProviders(),
        getSetting("agent.activeDefinitionId"),
        getAgentDefinitions(),
        listStyleProfiles(activeProjectId),
        getActiveStyleProfile(activeProjectId),
      ]);
      if (!nextProject) throw new Error("作品不存在");
      const activeAgent = agents.find((agent) => agent.id === activeAgentId && agent.enabled && agent.kind === "primary")
        ?? agents.find((agent) => agent.id === "builtin-agent--build" && agent.enabled)
        ?? agents.find((agent) => agent.enabled && agent.kind === "primary");
      const nextDefaultModelId = nextModels.find((model) => model.id === activeAgent?.modelId)?.id
        ?? nextModels.find((model) => model.id === activeModelId)?.id
        ?? null;
      if (activeModelId && !nextModels.some((model) => model.id === activeModelId)) {
        await setSetting("activeModelId", "");
      }
      let nextSessions = storedSessions;
      let nextSession = nextSessions.find((session) => session.id === preferredSessionId) ?? nextSessions[0] ?? null;
      if (!nextSession) {
        nextSession = await createChatSession(activeProjectId, nextDefaultModelId);
        nextSessions = [nextSession];
      }
      const selectedModelId = nextModels.some((model) => model.id === nextSession?.modelId)
        ? nextSession.modelId
        : nextDefaultModelId;
      if (nextSession.modelId !== selectedModelId) {
        nextSession = await updateChatSession({ id: nextSession.id, modelId: selectedModelId });
        nextSessions = nextSessions.map((session) => session.id === nextSession?.id ? nextSession as ChatSession : session);
      }
      const nextMessages = await listMessages(nextSession.id);
      let nextSelection: ModelSelection | null = null;
      let selectionError: string | null = null;
      try {
        nextSelection = await resolveSelection(selectedModelId, nextModels, nextProviders);
      } catch (resolveError) {
        selectionError = resolveError instanceof Error ? resolveError.message : String(resolveError);
      }
      await setSetting(activeSessionSettingKey(activeProjectId), nextSession.id);
      if (loadRequestRef.current !== requestId) return;
      setProject(nextProject);
      setSessions(nextSessions);
      setActiveSession(nextSession);
      setMessages(nextMessages);
            const lastFailed = [...nextMessages].reverse().find((message) => message.role === "assistant" && (message.metadata?.taskStatus === "failed" || message.metadata?.agentTrace?.status === "error"));
      setRetryRequest(lastFailed ? retryRequestForMessage(lastFailed, nextMessages, nextSession, nextSelection, activeAgent?.id ?? null) : null);
      setModels(nextModels);
      setProviders(nextProviders);
      setDefaultModelId(nextDefaultModelId);
      setActiveAgentId(activeAgent?.id ?? null);
      setActiveAgentName(activeAgent?.name ?? "Build");
      setStyleProfiles(nextStyleProfiles);
      setActiveStyleProfileState(nextActiveStyleProfile);
      setSelection(nextSelection);
      setError(selectionError);
    } catch (loadError) {
      if (loadRequestRef.current !== requestId) return;
      setActiveSession(null);
      setSelection(null);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      if (loadRequestRef.current === requestId) setLoading(false);
    }
  }, [cancelPendingQuestion, effectiveProjectId]);

  useEffect(() => {
    cancelPendingQuestion();
    setSending(false);
    setLiveTrace(null);
    return () => {
      sendRequestRef.current += 1;
      cancelPendingQuestion();
    };
  }, [cancelPendingQuestion, effectiveProjectId]);

  useEffect(() => {
    setInput("");
    setEditingMessageId(null);
  }, [activeSession?.id]);
  // 对话字体与字号跟随「设置 → 编辑器 → 对话时」，在页面获得焦点时读取，改完返回即生效。
  const [chatTextStyle, setChatTextStyle] = useState<{ fontSize: number; lineHeight: number; fontFamily?: string }>({
    fontSize: 16,
    lineHeight: 24,
  });
  // 上下文用量：窗口上限与保留条数来自设置，估算随消息变化实时更新
  const [contextWindow, setContextWindow] = useState(DEFAULT_CONTEXT_WINDOW_TOKENS);
  const [historyLimit, setHistoryLimit] = useState(30);
  const [contextSheetVisible, setContextSheetVisible] = useState(false);
  // 思考计时：请求进行中每秒 +1，给用户“正在思考”的实时感知
  useEffect(() => {
    if (!sending) {
      setThinkingSeconds(0);
      return;
    }
    const timer = setInterval(() => setThinkingSeconds((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [sending]);

  // 无作品模式：第一次真正开聊（聚焦输入或点建议）才创建「灵感速记」，不预创建空作品
  const ensureConversation = useCallback(async () => {
    if (effectiveProjectId || loading) return;
    const scratch = await ensureScratchProject();
    setScratchProjectId(scratch.id);
    const session = await createChatSession(scratch.id, selection?.model.id ?? defaultModelId);
    await setSetting(activeSessionSettingKey(scratch.id), session.id);
    setSessions((current) => [session, ...current]);
    setActiveSession(session);
    await load(scratch.id);
  }, [effectiveProjectId, loading, selection, defaultModelId, load]);

  const mascotOffsetRef = useRef({ x: 0, y: 0 });
  const mascotDragStartRef = useRef({ x: 0, y: 0 });
  const mascotPressAtRef = useRef(0);
  const mascotPan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        mascotDragStartRef.current = { ...mascotOffsetRef.current };
        mascotPressAtRef.current = Date.now();
      },
      onPanResponderMove: (_event, gesture) => {
        // 长按 350ms 后才进入拖动，避免误触页面滑动
        if (Date.now() - mascotPressAtRef.current < 350) return;
        const next = { x: mascotDragStartRef.current.x + gesture.dx, y: mascotDragStartRef.current.y + gesture.dy };
        mascotOffsetRef.current = next;
        setMascotOffset(next);
      },
      onPanResponderRelease: () => {
        void setSetting("assistant.mascotOffset", JSON.stringify(mascotOffsetRef.current)).catch(() => {});
      },
    }),
  ).current;

  useFocusEffect(useCallback(() => {
    void (async () => {
      const prefs = await readChatPrefs();
      setChatTextStyle({
        fontSize: prefs.fontSize,
        lineHeight: Math.round(prefs.fontSize * 1.5),
        fontFamily: editorFontFamily(prefs.fontFamily),
      });
      const [windowValue, limitValue] = await Promise.all([
        getSetting(CONTEXT_WINDOW_KEY),
        getSetting("context.historyLimit"),
      ]);
      let effectiveWindow = normalizeContextWindow(windowValue);
      let effectiveLimit = Math.max(1, Number(limitValue) || 30);
      const effectiveModelId = activeSession?.modelId ?? selection?.model?.id;
      if (effectiveModelId) {
        const overrideRaw = await getSetting(`context.override.${effectiveModelId}`).catch(() => null);
        if (overrideRaw) {
          try {
            const parsed = JSON.parse(overrideRaw) as { historyLimit?: number; windowTokens?: number };
            if (parsed?.historyLimit) effectiveLimit = parsed.historyLimit;
            if (parsed?.windowTokens) effectiveWindow = normalizeContextWindow(String(parsed.windowTokens));
          } catch {}
        }
      }
      setContextWindow(effectiveWindow);
      setHistoryLimit(effectiveLimit);
      setMascotEnabled((await getSetting("general.mascotEnabled")) !== "false");
      setMascotKind(normalizeMascotKind(await getSetting("general.mascot")));
      const mascotRaw = await getSetting("assistant.mascotOffset");
      if (mascotRaw) {
        try {
          const parsed = JSON.parse(mascotRaw) as { x?: number; y?: number };
          if (typeof parsed?.x === "number" && typeof parsed?.y === "number") {
            const next = { x: parsed.x, y: parsed.y };
            mascotOffsetRef.current = next;
            setMascotOffset(next);
          }
        } catch {}
      }
    })();
  }, []));
  useFocusEffect(useCallback(() => {
    void load();
    return () => {
      loadRequestRef.current += 1;
      cancelPendingQuestion();
    };
  }, [cancelPendingQuestion, load, revision]));

  const switchSession = async (session: ChatSession) => {
    if (!effectiveProjectId || sending) return;
    setError(null);
    try {
      if (session.projectId !== effectiveProjectId || !sessions.some((item) => item.id === session.id)) {
        throw new Error("对话不属于当前作品");
      }
      const effectiveModelId = models.some((model) => model.id === session.modelId) ? session.modelId : defaultModelId;
      const nextMessages = await listMessages(session.id);
      let nextSelection: ModelSelection | null = null;
      let selectionError: string | null = null;
      try {
        nextSelection = await resolveSelection(effectiveModelId, models, providers);
      } catch (resolveError) {
        selectionError = resolveError instanceof Error ? resolveError.message : String(resolveError);
      }
      await setSetting(activeSessionSettingKey(effectiveProjectId), session.id);
      setActiveSession(session);
      setMessages(nextMessages);
            const lastFailed = [...nextMessages].reverse().find((message) => message.role === "assistant" && (message.metadata?.taskStatus === "failed" || message.metadata?.agentTrace?.status === "error"));
      setRetryRequest(lastFailed ? retryRequestForMessage(lastFailed, nextMessages, session, nextSelection, activeAgentId) : null);
      setSelection(nextSelection);
      setError(selectionError);
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : String(switchError));
    }
  };

  // 消息条数：面板打开或会话增删时刷新（目录里要显示每条对话聊了多少）。
  useEffect(() => {
    if (!effectiveProjectId || !sessionPickerVisible) return;
    void getChatMessageCounts(effectiveProjectId).then(setMessageCounts).catch(() => setMessageCounts({}));
  }, [effectiveProjectId, sessionPickerVisible, sessions.length]);

  /** 新建对话前先确认：误触会立刻切走，且每次点都会新建。 */
  const confirmNewSession = () => {
    if (!effectiveProjectId || sending) return;
    Alert.alert("新建对话？", "当前对话不会被删除，之后可在管理对话里找回。", [
      { text: "取消", style: "cancel" },
      { text: "新建", onPress: () => void newSession() },
    ]);
  };

  /** 重命名对话：改完即时更新列表与当前会话标题。 */
  const saveRename = async () => {
    if (!renaming || !renameTitle.trim()) return;
    try {
      const updated = await updateChatSession({ id: renaming.id, title: renameTitle.trim() });
      setSessions((current) => current.map((session) => (session.id === updated.id ? updated : session)));
      if (activeSession?.id === updated.id) setActiveSession(updated);
      setRenaming(null);
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
    }
  };

  const newSession = async () => {
    if (!effectiveProjectId || sending) return;
    setError(null);
    try {
      const session = await createChatSession(effectiveProjectId, selection?.model.id ?? defaultModelId);
      await setSetting(activeSessionSettingKey(effectiveProjectId), session.id);
      setSessions((current) => [session, ...current]);
      setActiveSession(session);
      setMessages([]);
      setRetryRequest(null);
      setSessionPickerVisible(false);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : String(createError));
    }
  };

  const chooseModel = async (modelId: string | null) => {
    if (!activeSession || sending) return;
    setError(null);
    try {
      const nextSelection = await resolveSelection(modelId ?? defaultModelId, models, providers);
      const updated = await updateChatSession({ id: activeSession.id, modelId });
      setActiveSession(updated);
      setSessions((current) => current.map((session) => session.id === updated.id ? updated : session));
      setSelection(nextSelection);
      setModelPickerVisible(false);
    } catch (modelError) {
      setError(modelError instanceof Error ? modelError.message : String(modelError));
    }
  };

  const chooseStyle = async (profile: StyleProfile | null) => {
    if (!effectiveProjectId || sending || updatingStyle) return;
    setUpdatingStyle(true);
    setError(null);
    try {
      await setActiveStyleProfile(effectiveProjectId, profile?.id ?? null);
      setActiveStyleProfileState(profile);
      setStylePickerVisible(false);
    } catch (styleError) {
      setError(styleError instanceof Error ? styleError.message : String(styleError));
    } finally {
      setUpdatingStyle(false);
    }
  };

  const removeSession = async (session: ChatSession) => {
    if (!projectId || sending) return;
    try {
      if (session.projectId !== effectiveProjectId || !sessions.some((item) => item.id === session.id)) {
        throw new Error("对话不属于当前作品");
      }
      await deleteChatSession(session.id);
      const remaining = sessions.filter((item) => item.id !== session.id);
      setSessions(remaining);
      if (activeSession?.id !== session.id) return;
      const replacement = remaining[0] ?? await createChatSession(effectiveProjectId, selection?.model.id ?? defaultModelId);
      if (!remaining.length) setSessions([replacement]);
      await setSetting(activeSessionSettingKey(effectiveProjectId), replacement.id);
      const effectiveModelId = models.some((model) => model.id === replacement.modelId) ? replacement.modelId : defaultModelId;
      const nextMessages = await listMessages(replacement.id);
      setActiveSession(replacement);
      setMessages(nextMessages);
            setRetryRequest(null);
      try {
        setSelection(await resolveSelection(effectiveModelId, models, providers));
        setError(null);
      } catch (resolveError) {
        setSelection(null);
        setError(resolveError instanceof Error ? resolveError.message : String(resolveError));
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const confirmDeleteSession = (session: ChatSession) => {
    Alert.alert("删除对话", `确定删除“${session.title}”及其中的全部消息？`, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: () => void removeSession(session) },
    ]);
  };

  const beginEditMessage = (message: ChatMessage) => {
    if (sending || message.role !== "user") return;
    setError(null);
    setRetryRequest(null);
    setEditingMessageId(message.id);
    setInput(message.content);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const cancelMessageEdit = () => {
    setEditingMessageId(null);
    setInput("");
  };

  /** 选一个文本文件，由用户决定是这次发给助手，还是存进本作品的资料。 */
  const handlePickAttachment = async () => {
    let picked: TextAttachment | null = null;
    try {
      picked = await pickTextAttachment();
    } catch (pickError) {
      Alert.alert("无法读取文件", pickError instanceof Error ? pickError.message : String(pickError));
      return;
    }
    if (!picked) return;
    const attachment = picked;
    Alert.alert(
      attachment.name,
      `共 ${attachment.characters} 字${attachment.truncated ? "（内容较长，已截取前 10 万字）" : ""}\n\n「加入本次对话」：随下一条消息发给助手，不写入数据库。\n「存入资料」：写成本作品的笔记，之后助手可长期检索引用。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "存入资料",
          onPress: () => {
            void (async () => {
              if (!project) return;
              try {
                const title = await saveAttachmentAsNote(project.id, attachment);
                refreshData();
                Alert.alert("已存入资料", `「${title}」已写成本作品的笔记，助手可在需要时检索到。`);
              } catch (saveError) {
                Alert.alert("存入失败", saveError instanceof Error ? saveError.message : String(saveError));
              }
            })();
          },
        },
        {
          text: "加入本次对话",
          onPress: () => setAttachments((current) => (
            current.some((item) => item.name === attachment.name) || current.length >= MAX_ATTACHMENTS_PER_MESSAGE
              ? current
              : [...current, attachment]
          )),
        },
      ],
      { cancelable: true },
    );
  };

  /** 撤销最近一次被接受的 AI 写入，把对象还原为改动前的内容。 */
  const handleUndoWrite = () => {
    void (async () => {
      try {
        const label = await undoLastWrite();
        if (label) {
          setUndoTarget(null);
          refreshData();
          Alert.alert("已撤销", `「${label}」已还原为改动前的内容。`);
        } else {
          setUndoTarget(null);
        }
      } catch (error) {
        Alert.alert("撤销失败", error instanceof Error ? error.message : String(error));
      }
    })();
  };

  const askUser = useCallback((request: AgentClarificationRequest) => new Promise<AgentClarificationResponse>((resolve) => {
    questionResolverRef.current?.({ answers: [], cancelled: true });
    questionResolverRef.current = resolve;
    setPendingQuestion(request);
  }), []);

  const finishQuestion = (response: AgentClarificationResponse) => {
    const resolver = questionResolverRef.current;
    questionResolverRef.current = null;
    setPendingQuestion(null);
    resolver?.(response);
  };

  const send = async (retry: RetryRequest | null = null) => {
    const content = retry?.userMessage.content ?? input.trim();
    const editTarget = !retry && editingMessageId
      ? messages.find((message) => message.id === editingMessageId && message.role === "user") ?? null
      : null;
    if (!project || !activeSession || !content || sending) return;
    if (retry && (retry.sessionId !== activeSession.id || !messages.some((message) => message.id === retry.userMessage.id))) {
      setRetryRequest(null);
      setError("重试消息已不在当前对话中，请重新发送");
      return;
    }
    const sessionId = activeSession.id;
    const requestId = sendRequestRef.current + 1;
    sendRequestRef.current = requestId;
    const isCurrentRequest = () => sendRequestRef.current === requestId;
    setSending(true);
    setError(null);
    setInput("");
    setLiveTrace(null);
    setLiveReasoning("");
    let userMessage = retry?.userMessage ?? null;
    let nextHistory = retry?.history ?? [];
    let userMessageSaved = Boolean(userMessage);
    let workingSession = activeSession;
    let latestTrace: AgentRunTrace | null = null;
    let runSelection: ModelSelection | null = selection;
    try {
      // 当前选中的模型优先。失败消息里记录的 modelId 只作兜底，
      // 否则用户换了可用模型后点重试仍会打回那个出错的旧模型。
      runSelection = selection
        ?? (retry?.modelId ? await resolveSelection(retry.modelId, models, providers) : null);
      if (!runSelection) throw new Error("请先配置可用模型");
      if (retry?.sourceMessageId) {
        await deleteMessagesFrom(sessionId, retry.sourceMessageId);
        if (!isCurrentRequest()) return;
        setMessages((current) => {
          const sourceIndex = current.findIndex((message) => message.id === retry.sourceMessageId);
          return sourceIndex < 0 ? current : current.slice(0, sourceIndex);
        });
      }
      if (!retry) {
        let baseHistory = messages;
        if (editTarget) {
          const editIndex = messages.findIndex((message) => message.id === editTarget.id);
          if (editIndex < 0) throw new Error("要编辑的消息不存在");
          const replacement = await replaceUserMessageBranch(sessionId, editTarget.id, content);
          userMessage = replacement.message;
          userMessageSaved = true;
          baseHistory = messages.slice(0, editIndex);
          nextHistory = [...baseHistory, userMessage];
          workingSession = replacement.session;
          setEditingMessageId(null);
        } else {
          userMessage = await addMessage(sessionId, "user", content, attachments.length
            ? { attachments: attachments.map((item) => ({ name: item.name, characters: item.characters })) }
            : null);
          userMessageSaved = true;
          nextHistory = [...baseHistory, userMessage];
          workingSession = {
            ...workingSession,
            title: workingSession.title === "新对话" ? generatedSessionTitle(content) : workingSession.title,
            updatedAt: userMessage.createdAt,
          };
        }
        if (!isCurrentRequest()) return;
        setMessages(nextHistory);
        setActiveSession(workingSession);
        setSessions((current) => [workingSession, ...current.filter((session) => session.id !== workingSession.id)]);
      }
      if (!userMessage) throw new Error("消息准备失败，请重试");
      // 附件内容不写进消息正文（避免气泡里堆满原文），而是作为一条独立的资料消息随本次请求发给模型。
      const attachmentMessage = attachments.length
        ? {
            id: `${userMessage.id}-attachments`,
            projectId: userMessage.projectId,
            sessionId: userMessage.sessionId,
            role: "user" as const,
            content: attachmentContextBlock(attachments),
            metadata: null,
            createdAt: userMessage.createdAt,
          }
        : null;
      const runHistory = attachmentMessage ? [...nextHistory, attachmentMessage] : nextHistory;
      const requestStartedAt = Date.now();
      const response = await runAgent({
        project,
        selection: runSelection,
        history: runHistory,
        agentId: retry?.agentId ?? activeAgentId,
        approveTool: requestToolApproval,
        askUser,
        onDelta: (delta) => {
          if (delta.reasoning) setLiveReasoning((current) => current + delta.reasoning);
        },
        onTrace: (trace) => {
          // 实时时间线的数据源：把执行事件流同步到界面，否则只看得见计时。
          latestTrace = trace;
          setLiveTrace(trace);
        },
      });
      const processingSeconds = Math.max(1, Math.round((Date.now() - requestStartedAt) / 1000));
      const assistantMessage = await addMessage(sessionId, "assistant", response.content, {
        agentTrace: response.trace,
        ...(response.reasoning ? { reasoning: response.reasoning } : {}),
        processingSeconds,
        taskStatus: "completed",
        retryContext: { userMessageId: userMessage.id, modelId: runSelection.model.id, agentId: retry?.agentId ?? activeAgentId },
      });
      if (!isCurrentRequest()) return;
      setMessages((current) => {
        if (!retry) return [...current, assistantMessage];
        const sourceIndex = current.findIndex((message) => message.id === retry.sourceMessageId);
        return sourceIndex < 0 ? [...current, assistantMessage] : [...current.slice(0, sourceIndex), assistantMessage];
      });
      setRetryRequest(null);
      setLiveTrace(null);
      setUndoTarget(undoLabel());
      setAttachments([]);
    } catch (sendError) {
      const friendlyError = humanizeAgentError(sendError);
      // 失败必须留痕：此前这条路径只弹提示、不写诊断报告，复现时查不到任何记录。
      void appendCrashLog(
        "助手执行失败",
        friendlyError.detail ? `${friendlyError.message} —— ${friendlyError.detail}` : friendlyError.message,
      );
      if (isCurrentRequest()) setError(friendlyError.message);
      const failedTrace = sendError instanceof AgentRunError ? sendError.trace : latestTrace;
      const retryModelId = runSelection?.model.id ?? retry?.modelId ?? activeSession.modelId ?? "";
      if (userMessageSaved && userMessage) {
        try {
          const failedMessage = await addMessage(
            sessionId,
            "assistant",
            "任务未完成：" + friendlyError.message,
            {
              agentTrace: failedTrace ?? undefined,
              taskStatus: "failed",
              errorMessage: friendlyError.message,
              errorDetail: friendlyError.detail,
              retryContext: { userMessageId: userMessage.id, modelId: retryModelId, agentId: retry?.agentId ?? activeAgentId },
            },
          );
          if (isCurrentRequest()) {
            setMessages((current) => [...current, failedMessage]);
            setRetryRequest({ sessionId, userMessage, history: nextHistory, sourceMessageId: failedMessage.id, modelId: retryModelId, agentId: retry?.agentId ?? activeAgentId });
            refreshData();
          }
        } catch {
          if (isCurrentRequest()) setRetryRequest({ sessionId, userMessage, history: nextHistory, sourceMessageId: retry?.sourceMessageId ?? "", modelId: retryModelId, agentId: retry?.agentId ?? activeAgentId });
        }
      }
      // 失败时不回填输入框：原话已经在消息列表里，重发走那条消息下方的「重试」。
      if (isCurrentRequest()) setLiveTrace(null);
    } finally {
      if (isCurrentRequest()) setSending(false);
    }
  };
  const contextUsage = useMemo(
    () => computeContextUsage(messages, contextWindow, historyLimit),
    [contextWindow, historyLimit, messages],
  );

  if (loading) return <Screen><Header title="创作助手" /><View style={styles.loading}><ActivityIndicator color={colors.primary} /></View></Screen>;
  return (
    <Screen>
      <Header
        title="创作助手"
        action={
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel="切换作品"
              onPress={() => {
                void listProjects().then((list) => { setProjectsForPicker(list); setProjectPickerVisible(true); }).catch(() => {});
              }}
              style={styles.iconButton}
            >
              <Ionicons name="swap-horizontal-outline" size={22} color={colors.primary} />
            </Pressable>
            <Pressable accessibilityLabel="更多操作" onPress={() => setHeaderMenuVisible((value) => !value)} style={styles.iconButton}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.primary} />
            </Pressable>
          </View>
        }
      />
      {headerMenuVisible ? (
        <>
          <Pressable accessibilityLabel="关闭更多操作" onPress={() => setHeaderMenuVisible(false)} style={styles.headerMenuBackdrop} />
          <View style={styles.headerMenuCard}>
            <Pressable
              accessibilityLabel="管理对话"
              disabled={sending}
              onPress={() => { setHeaderMenuVisible(false); setSessionPickerVisible(true); }}
              style={({ pressed }) => [styles.headerMenuRow, pressed && styles.headerMenuRowPressed]}
            >
              <Ionicons name="chatbubbles-outline" size={20} color={colors.primary} />
              <Text style={styles.headerMenuText}>管理对话</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="上下文占用"
              onPress={() => { setHeaderMenuVisible(false); setContextSheetVisible(true); }}
              style={({ pressed }) => [styles.headerMenuRow, pressed && styles.headerMenuRowPressed]}
            >
              <Ionicons name="pie-chart-outline" size={20} color={colors.primary} />
              <Text style={styles.headerMenuText}>上下文占用</Text>
            </Pressable>
          </View>
        </>
      ) : null}
      <View style={styles.contextBar}>
        <View style={styles.projectContext}>
          <Ionicons name="book-outline" size={19} color={colors.primary} />
          <View style={styles.projectCopy}>
            <Text style={styles.projectTitle} numberOfLines={1}>{project?.title ?? "当前作品"}</Text>
            <Text style={styles.agentLabel} numberOfLines={1}>{activeAgentName} 主智能体</Text>
          </View>
        </View>
        <Pressable
          accessibilityLabel="切换助手模型"
          disabled={!models.length || sending}
          onPress={() => setModelPickerVisible(true)}
          style={styles.modelSelector}
        >
          <Ionicons name="hardware-chip-outline" size={17} color={selection ? colors.primary : colors.textMuted} />
          <Text style={[styles.modelSelectorText, !selection && styles.mutedText]} numberOfLines={1}>
            {selection?.model.name ?? "选择模型"}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        </Pressable>

      </View>
      <Pressable
        accessibilityRole="button"
        disabled={sending || updatingStyle}
        onPress={() => setStylePickerVisible(true)}
        style={styles.styleSelector}
      >
        {updatingStyle ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : (
          <Ionicons name="color-wand-outline" size={17} color={activeStyleProfile ? colors.primary : colors.textMuted} />
        )}
        <Text style={[styles.styleSelectorText, activeStyleProfile && styles.styleSelectorTextActive]} numberOfLines={1}>
          {activeStyleProfile ? `${activeStyleProfile.name} V${activeStyleProfile.version}` : "不使用创作文风"}
        </Text>
        <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
      </Pressable>
      <KeyboardAvoidingView style={styles.flex} behavior="height" automaticOffset>
        <FlatList
          style={styles.flex}
          data={reversedMessages}
          keyExtractor={(item) => item.id}
          inverted
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 120 }}
          contentContainerStyle={messages.length ? styles.messages : styles.emptyMessages}
          ListHeaderComponent={sending || liveTrace || writeCard || pendingQuestion ? (
            <View style={styles.liveTimeline}>
              {sending || liveTrace ? (
                <>
                  <View style={styles.liveHeader}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.liveHeaderText}>处理中 · 已处理 {thinkingSeconds}s</Text>
                  </View>
                  {liveTrace ? (
                    <AgentTraceView
                      trace={liveTrace}
                      defaultExpanded
                      inline
                      reasoning={liveReasoning.trim() ? { text: liveReasoning, live: true } : undefined}
                    />
                  ) : liveReasoning.trim() ? (
                    <ReasoningRow text={liveReasoning} live />
                  ) : null}
                </>
              ) : null}
              {writeCard ? (
                <View style={styles.writeCard}>
                  <View style={styles.writeCardHeader}>
                    <Text style={styles.writeCardTitle}>写入确认</Text>
                    <Text numberOfLines={1} style={styles.writeCardTarget}>{writeCard.target ?? writeCard.name}</Text>
                    <Text style={styles.writeBadge}>待确认</Text>
                  </View>
                  <AdaptiveScroll maxHeight={300} style={styles.writeCardScroll}>
                  {writeCard.before !== undefined && writeCard.after !== undefined ? (() => {
                    const stats = diffLineStats(writeCard.before, writeCard.after);
                    const afterLines = writeCard.after.split("\n").filter((line) => line.trim().length > 0);
                    const beforeLines = writeCard.before.split("\n").filter((line) => line.trim().length > 0);
                    return (
                      <>
                        <View style={styles.writeStats}>
                          <Text style={styles.writeStatAdd}>+{stats.added} 行</Text>
                          <Text style={styles.writeStatDel}>−{stats.removed} 行</Text>
                        </View>
                        {writeDiffExpanded ? (
                          <AdaptiveScroll maxHeight={260} style={styles.writeDiffScroll}>
                            <Text style={styles.writeDiffLabel}>写入前</Text>
                            {beforeLines.length === 0 ? (
                              <Text style={styles.writeDiffDel}>− （当前为空）</Text>
                            ) : beforeLines.slice(0, 120).map((line, idx) => (
                              <Text key={"b" + idx} style={styles.writeDiffDel} numberOfLines={2}>− {line}</Text>
                            ))}
                            <Text style={[styles.writeDiffLabel, styles.writeDiffLabelSpaced]}>写入后</Text>
                            {afterLines.slice(0, 120).map((line, idx) => (
                              <Text key={"a" + idx} style={styles.writeDiffAdd} numberOfLines={2}>+ {line}</Text>
                            ))}
                          </AdaptiveScroll>
                        ) : (
                          <View style={styles.writeDiff}>
                            <Text style={styles.writeDiffLabel}>写入前</Text>
                            {beforeLines.length === 0 ? (
                              <Text style={styles.writeDiffDel}>− （当前为空）</Text>
                            ) : beforeLines.slice(0, 2).map((line, idx) => (
                              <Text key={"b" + idx} style={styles.writeDiffDel} numberOfLines={1}>− {line}</Text>
                            ))}
                            <Text style={[styles.writeDiffLabel, styles.writeDiffLabelSpaced]}>写入后</Text>
                            {afterLines.slice(0, 3).map((line, idx) => (
                              <Text key={"a" + idx} style={styles.writeDiffAdd} numberOfLines={1}>+ {line}</Text>
                            ))}
                          </View>
                        )}
                        <Pressable accessibilityRole="button" onPress={() => setWriteDiffExpanded((value) => !value)} style={styles.writeDiffToggle}>
                          <Text style={styles.writeDiffToggleText}>{writeDiffExpanded ? "收起变更" : `展开全部 ${stats.added + stats.removed} 行变更`}</Text>
                          <Ionicons name={writeDiffExpanded ? "chevron-up" : "chevron-down"} size={15} color={colors.textMuted} />
                        </Pressable>
                      </>
                    );
                  })(                  ) : writeCard.details ? (
                    <Text style={styles.writeCardDetails}>{writeCard.details}</Text>
                  ) : null}
                  </AdaptiveScroll>
                  <View style={styles.writeCardActions}>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => { writeCard.resolve(false); setWriteCard(null); }}
                      style={styles.writeCardButtonSecondary}
                    >
                      <Text style={styles.writeCardButtonSecondaryText}>驳回</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => { writeCard.resolve(true); setWriteCard(null); }}
                      style={styles.writeCardButtonPrimary}
                    >
                      <Text style={styles.writeCardButtonPrimaryText}>接受</Text>
                    </Pressable>
                  </View>
                </View>
              ) : null}
              <AgentQuestionSheet
                request={pendingQuestion}
                onSubmit={(answers) => finishQuestion({ answers, cancelled: false })}
                onCancel={() => finishQuestion({ answers: [], cancelled: true })}
              />
            </View>
          ) : null}
          ListEmptyComponent={models.length ? (
            <View style={styles.welcomeBox}>
              <Text style={styles.welcomeTitle}>聊灵感、记想法</Text>
              <View style={styles.welcomeChipsRow}>
              {["记一个灵感", "梳理一下我的想法", "随便聊聊"].map((suggestion) => (
                <Pressable key={suggestion} style={styles.welcomeChip} onPress={() => { void ensureConversation().then(() => setInput(suggestion)); }}>
                  <Text style={styles.welcomeChipText}>{suggestion}</Text>
                </Pressable>
              ))}
              </View>
            </View>
          ) : (
            <EmptyState title="请先配置供应商并添加模型" action={<Button label="打开模型设置" onPress={() => navigation.navigate("Settings")} />} />
          )}
          renderItem={({ item }) => (
            <View>
            <View style={[styles.message, item.role === "user" ? styles.userMessage : styles.assistantMessage]}>
              {(() => {
                const messageRetry = retryRequestForMessage(item, messages, activeSession, selection, activeAgentId);
                const failed = item.role === "assistant" && (item.metadata?.taskStatus === "failed" || item.metadata?.agentTrace?.status === "error");
                return (
                  <>
              {item.role === "assistant" ? (
                <View style={styles.messageHeader}>
                  <Text style={styles.messageRole}>Storyloom</Text>
                </View>
              ) : null}
              {item.metadata?.agentTrace ? (
                <AgentTraceView
                  trace={item.metadata.agentTrace}
                  durationSeconds={item.metadata.processingSeconds}
                  inline
                  reasoning={item.metadata.reasoning ? { text: item.metadata.reasoning, seconds: item.metadata.processingSeconds } : undefined}
                />
              ) : failed ? (
                <View style={styles.failureCard}>
                  <Text style={styles.failureTitle}>执行失败</Text>
                  {messageRetry ? (
                    <Pressable accessibilityRole="button" disabled={sending} onPress={() => void send(messageRetry)} style={[styles.failureRetry, sending && styles.failureRetryDisabled]}>
                      <Ionicons name="refresh-outline" size={17} color={colors.danger} />
                      <Text style={styles.failureRetryText}>{sending ? "处理中" : "重试"}</Text>
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              {item.role === "user" && item.metadata?.attachments?.length ? (
                <View style={styles.attachmentRow}>
                  {item.metadata.attachments.map((entry) => (
                    <View key={entry.name} style={styles.attachmentChip}>
                      <Ionicons name="document-text-outline" size={14} color={colors.primary} />
                      <Text numberOfLines={1} style={styles.attachmentName}>{entry.name}</Text>
                      <Text style={styles.attachmentMeta}>{entry.characters} 字</Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <Text selectable style={[styles.messageText, chatTextStyle]}>{item.content}</Text>

              {item.role === "assistant" && messageRetry ? (
                <MessageActionBar content={item.content} onRetry={() => void send(messageRetry)} retryDisabled={sending} />
              ) : null}
                  </>
                );
              })()}
            </View>
            {item.role === "user" ? (
              <View style={styles.messageEditRowOutside}>
                <Text style={styles.messageTime}>{formatMessageTime(item.createdAt)}</Text>
                <Pressable accessibilityLabel="编辑这条消息" disabled={sending} onPress={() => beginEditMessage(item)} style={styles.messageEditButton}>
                  <Ionicons name="create-outline" size={15} color={colors.textMuted} />
                  <Text style={styles.messageEditText}>编辑</Text>
                </Pressable>
              </View>
            ) : null}
            </View>
          )}
        />
        {error ? <View style={styles.errorWrap}><ErrorNotice message={error} onRetry={retryRequest ? () => void send(retryRequest) : () => void load()} /></View> : null}
        {undoTarget && !sending ? (
          <View style={styles.undoBanner}>
            <Text numberOfLines={1} style={styles.undoText}>AI 已改动「{undoTarget}」</Text>
            <Pressable accessibilityLabel="撤销 AI 上次改动" onPress={handleUndoWrite} style={styles.undoButton}>
              <Text style={styles.undoButtonText}>撤销</Text>
            </Pressable>
          </View>
        ) : null}
        {selection && selection.model.supportsTools === false ? (
          <View style={styles.capabilityNotice}>
            <Ionicons name="alert-circle-outline" size={16} color={colors.danger} />
            <Text style={styles.capabilityNoticeText}>
              当前模型已标注为不支持工具调用，助手只能对话、无法读写作品内容。若该模型实际支持，可在模型设置中改回。
            </Text>
          </View>
        ) : null}
        {/* 吉祥物挂件：坐在输入框上沿，纯装饰不响应点击。可在设置里换/关（外观主题批）。 */}
        <View style={styles.composerWrap}>
          {mascotEnabled ? (
            <View
              style={[styles.mascot, { transform: [{ translateX: mascotOffset.x }, { translateY: mascotOffset.y }] }]}
              {...mascotPan.panHandlers}
            >
              <Image
                source={mascotSource(mascotKind)}
                style={[styles.mascotImage, { tintColor: colors.primary }]}
              />
            </View>
          ) : null}
          {attachments.length ? (
            <View style={styles.attachmentRow}>
              {attachments.map((item) => (
                <View key={item.name} style={styles.attachmentChip}>
                  <Ionicons name="document-text-outline" size={14} color={colors.primary} />
                  <Text numberOfLines={1} style={styles.attachmentName}>{item.name}</Text>
                  <Text style={styles.attachmentMeta}>{item.characters} 字</Text>
                  <Pressable accessibilityLabel={`移除附件 ${item.name}`} onPress={() => setAttachments((current) => current.filter((entry) => entry.name !== item.name))} style={styles.attachmentRemove}>
                    <Ionicons name="close" size={15} color={colors.textMuted} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}
          {editingMessageId ? (
            <View style={styles.editingBanner}>
              <View style={styles.editingCopy}>
                <Ionicons name="create-outline" size={17} color={colors.primary} />
                <Text style={styles.editingText}>正在编辑之前的发言</Text>
              </View>
              <Pressable accessibilityLabel="取消编辑" onPress={cancelMessageEdit} style={styles.iconButton}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </Pressable>
            </View>
          ) : null}
          <View style={styles.composer}>
            <Pressable
              accessibilityLabel={attachments.length ? `已添加附件 ${attachments.length} 份，继续添加` : "添加附件"}
              disabled={sending || attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
              onPress={() => void handlePickAttachment()}
              style={({ pressed }) => [styles.attachButton, (pressed || sending) && styles.sendDisabled]}
            >
              <Ionicons name="add" size={24} color={colors.primary} />
            </Pressable>
            <TextInput
              ref={composerRef}
              value={input}
              onChangeText={setInput}
              style={styles.composerInput}
              placeholder={editingMessageId ? "修改后重新发送" : "输入创作任务"}
              placeholderTextColor={colors.textMuted}
              editable={!sending}
              multiline
              maxLength={12000}
            />
            <Pressable
              accessibilityLabel={editingMessageId ? "重发编辑后的消息" : "发送"}
              disabled={!selection || !input.trim() || sending}
              onPress={() => void send(retryRequest && input.trim() === retryRequest.userMessage.content ? retryRequest : null)}
              style={({ pressed }) => [styles.sendButton, (pressed || !selection || !input.trim()) && styles.sendDisabled]}
            >
              {sending ? <ActivityIndicator color="#FFFFFF" size="small" /> : <Ionicons name="arrow-up" size={20} color="#FFFFFF" />}
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>

      <Modal visible={contextSheetVisible} transparent animationType="slide" onRequestClose={() => setContextSheetVisible(false)}>
        <SheetBackdrop onPress={() => setContextSheetVisible(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleWrap}>
                <Text style={styles.sheetTitle}>上下文占用</Text>
                <Text style={styles.sheetSubtitle}>按字符估算，供观察趋势，非精确计费</Text>
              </View>
              <Pressable accessibilityLabel="关闭上下文占用" onPress={() => setContextSheetVisible(false)} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <View style={styles.contextMeter}>
              <View style={[styles.contextMeterFill, {
                width: `${Math.min(100, Math.round(contextUsage.ratio * 100))}%`,
                backgroundColor: contextUsage.overflow ? colors.danger : colors.primary,
              }]} />
            </View>
            <Text style={styles.contextPercent}>{formatUsagePercent(contextUsage.ratio)}</Text>
            <View style={styles.sheetRow}>
              <Text style={styles.sheetRowLabel}>估算占用</Text>
              <Text style={styles.sheetRowValue}>{contextUsage.estimatedTokens.toLocaleString()} / {contextUsage.windowTokens.toLocaleString()} Token</Text>
            </View>
            <View style={styles.sheetRow}>
              <Text style={styles.sheetRowLabel}>参与对话的消息</Text>
              <Text style={styles.sheetRowValue}>{contextUsage.keptMessages} 条 · {contextUsage.characters.toLocaleString()} 字</Text>
            </View>
            <View style={styles.sheetRow}>
              <Text style={styles.sheetRowLabel}>会话消息总数</Text>
              <Text style={styles.sheetRowValue}>{contextUsage.messages} 条</Text>
            </View>
            {contextUsage.droppedMessages > 0 ? (
              <Text style={styles.contextNote}>
                超出「保留最近消息数」的 {contextUsage.droppedMessages} 条不会发送给模型；需要它们参与时，可在设置 → 上下文提高保留条数。
              </Text>
            ) : null}
            {contextUsage.overflow ? (
              <Text style={[styles.contextNote, styles.contextNoteWarning]}>
                已超出所填窗口上限。继续追加内容可能导致模型截断或报错，建议新建对话，或调高「模型上下文窗口」的数值。
              </Text>
            ) : null}
            <Text style={styles.contextNote}>
              估算含约 1500 Token 的固定开销（系统提示、技能说明与工具定义）。实际占用随模型分词器不同会有偏差。
            </Text>
          </View>
        </SheetBackdrop>
      </Modal>

      <Modal visible={projectPickerVisible} transparent animationType="slide" onRequestClose={() => setProjectPickerVisible(false)}>
        <SheetBackdrop onPress={() => setProjectPickerVisible(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>切换作品</Text>
              <Pressable accessibilityLabel="关闭作品列表" onPress={() => setProjectPickerVisible(false)} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <FlatList
              data={projectsForPicker}
              keyExtractor={(item) => item.id}
              style={styles.sheetList}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => {
                    setProjectPickerVisible(false);
                    if (item.id !== projectId) {
                      setCurrentProject(item.id);
                      void load(item.id);
                    }
                  }}
                  style={[styles.sheetRow, item.id === (project?.id ?? projectId) && styles.sheetRowActive]}
                >
                  <Ionicons name={item.id === (project?.id ?? projectId) ? "radio-button-on" : "radio-button-off"} size={20} color={item.id === (project?.id ?? projectId) ? colors.primary : colors.textMuted} />
                  <View style={styles.sheetRowText}>
                    <Text style={styles.sheetRowTitle} numberOfLines={1}>{item.title}</Text>
                    <Text style={styles.sheetRowMeta} numberOfLines={1}>{item.description || "暂无简介"}</Text>
                  </View>
                </Pressable>
              )}
            />
          </View>
        </SheetBackdrop>
      </Modal>

      <Modal visible={renaming !== null} transparent animationType="slide" onRequestClose={() => setRenaming(null)}>
        <SheetBackdrop onPress={() => setRenaming(null)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>重命名对话</Text>
              <Pressable accessibilityLabel="关闭重命名" onPress={() => setRenaming(null)} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <Field label="对话标题" value={renameTitle} onChangeText={setRenameTitle} autoFocus />
            <View style={styles.renameActions}>
              <Button label="取消" variant="secondary" onPress={() => setRenaming(null)} />
              <Button label="保存" onPress={() => void saveRename()} disabled={!renameTitle.trim()} />
            </View>
          </View>
        </SheetBackdrop>
      </Modal>

      <Modal visible={sessionPickerVisible} transparent animationType="slide" onRequestClose={() => setSessionPickerVisible(false)}>
        <SheetBackdrop onPress={() => setSessionPickerVisible(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleWrap}>
                <Text style={styles.sheetTitle} numberOfLines={1}>{project?.title ?? "当前作品"}</Text>
                <Text style={styles.sheetSubtitle}>{sessions.length} 个对话</Text>
              </View>
              <Pressable accessibilityLabel="关闭对话列表" onPress={() => setSessionPickerVisible(false)} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <Pressable accessibilityLabel="新建对话" onPress={confirmNewSession} style={styles.newSessionButton}>
              <Ionicons name="add" size={20} color="#FFFFFF" />
              <Text style={styles.newSessionButtonText}>新建对话</Text>
            </Pressable>
            <FlatList
              data={sessions}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.sheetList}
              renderItem={({ item }) => {
                const sessionModelId = item.modelId ?? defaultModelId;
                const sessionModel = models.find((model) => model.id === sessionModelId);
                const selected = item.id === activeSession?.id;
                return (
                  <Pressable onPress={() => void switchSession(item)} style={[styles.sheetRow, selected && styles.sheetRowActive]}>
                    <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? colors.primary : colors.textMuted} />
                    <View style={styles.sheetRowText}>
                      <Text style={styles.sheetRowTitle} numberOfLines={1}>{item.title}</Text>
                      <Text style={styles.sheetRowMeta} numberOfLines={1}>{sessionModel?.name ?? "未选择模型"} · {messageCounts[item.id] ?? 0} 条消息 · {formatSessionTime(item.updatedAt)}</Text>
                    </View>
                    <Pressable accessibilityLabel={`重命名对话 ${item.title}`} onPress={(event) => { event.stopPropagation(); setRenaming(item); setRenameTitle(item.title); }} style={styles.iconButton}>
                      <Ionicons name="pencil-outline" size={17} color={colors.textMuted} />
                    </Pressable>
                    <Pressable accessibilityLabel={`删除对话 ${item.title}`} onPress={(event) => { event.stopPropagation(); confirmDeleteSession(item); }} style={styles.iconButton}>
                      <Ionicons name="trash-outline" size={19} color={colors.danger} />
                    </Pressable>
                  </Pressable>
                );
              }}
            />
          </View>
        </SheetBackdrop>
      </Modal>

      <Modal visible={modelPickerVisible} transparent animationType="slide" onRequestClose={() => setModelPickerVisible(false)}>
        <SheetBackdrop onPress={() => setModelPickerVisible(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleWrap}>
                <Text style={styles.sheetTitle}>选择模型</Text>
                <Text style={styles.sheetSubtitle}>仅用于当前对话</Text>
              </View>
              <Pressable accessibilityLabel="关闭模型列表" onPress={() => setModelPickerVisible(false)} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <FlatList
              data={models}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.sheetList}
              ListHeaderComponent={
                <Pressable onPress={() => void chooseModel(null)} style={[styles.sheetRow, activeSession?.modelId === null && styles.sheetRowActive]}>
                  <Ionicons name={activeSession?.modelId === null ? "radio-button-on" : "radio-button-off"} size={20} color={activeSession?.modelId === null ? colors.primary : colors.textMuted} />
                  <View style={styles.sheetRowText}>
                    <Text style={styles.sheetRowTitle}>跟随主智能体或全局模型</Text>
                    <Text style={styles.sheetRowMeta}>{models.find((model) => model.id === defaultModelId)?.name ?? "尚未设置默认模型"}</Text>
                  </View>
                </Pressable>
              }
              renderItem={({ item }) => {
                const selected = activeSession?.modelId === item.id;
                const provider = providerById.get(item.providerId);
                return (
                  <Pressable onPress={() => void chooseModel(item.id)} style={[styles.sheetRow, selected && styles.sheetRowActive]}>
                    <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? colors.primary : colors.textMuted} />
                    <View style={styles.sheetRowText}>
                      <Text style={styles.sheetRowTitle} numberOfLines={1}>{item.name}</Text>
                      <Text style={styles.sheetRowMeta} numberOfLines={1}>{provider?.name ?? "未知供应商"} · {item.modelId}</Text>
                    </View>
                  </Pressable>
                );
              }}
            />
          </View>
        </SheetBackdrop>
      </Modal>
      <Modal visible={stylePickerVisible} transparent animationType="slide" onRequestClose={() => setStylePickerVisible(false)}>
        <SheetBackdrop onPress={() => setStylePickerVisible(false)}>
          <View style={styles.sheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetTitleWrap}>
                <Text style={styles.sheetTitle}>选择创作文风</Text>
                <Text style={styles.sheetSubtitle}>{project?.title ?? "当前作品"}</Text>
              </View>
              <Pressable accessibilityLabel="关闭文风列表" onPress={() => setStylePickerVisible(false)} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <FlatList
              data={styleProfiles}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.sheetList}
              ListHeaderComponent={(
                <Pressable onPress={() => void chooseStyle(null)} style={[styles.sheetRow, !activeStyleProfile && styles.sheetRowActive]}>
                  <Ionicons name={!activeStyleProfile ? "radio-button-on" : "radio-button-off"} size={20} color={!activeStyleProfile ? colors.primary : colors.textMuted} />
                  <View style={styles.sheetRowText}>
                    <Text style={styles.sheetRowTitle}>不使用文风</Text>
                    <Text style={styles.sheetRowMeta}>仅遵循作品设定和本轮要求</Text>
                  </View>
                </Pressable>
              )}
              renderItem={({ item }) => {
                const selected = item.id === activeStyleProfile?.id;
                return (
                  <Pressable onPress={() => void chooseStyle(item)} style={[styles.sheetRow, selected && styles.sheetRowActive]}>
                    <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? colors.primary : colors.textMuted} />
                    <View style={styles.sheetRowText}>
                      <Text style={styles.sheetRowTitle} numberOfLines={1}>{item.name} V{item.version}</Text>
                      <Text style={styles.sheetRowMeta}>{item.kind === "author" ? "当前作品作者文风" : "参考小说文风"}</Text>
                    </View>
                  </Pressable>
                );
              }}
            />
          </View>
        </SheetBackdrop>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerActions: { flexDirection: "row", alignItems: "center" },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  contextBar: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  projectContext: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  projectCopy: { flex: 1, minWidth: 0, gap: 2 },
  projectTitle: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "700" },
  agentLabel: { color: colors.textMuted, fontSize: 11 },
  modelSelector: {
    maxWidth: "48%",
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: spacing.xs,
  },
  modelSelectorText: { flexShrink: 1, color: colors.primary, fontSize: 13, fontWeight: "700" },
  mutedText: { color: colors.textMuted },
  styleSelector: {
    minHeight: 42,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  styleSelectorText: { flex: 1, minWidth: 0, color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  styleSelectorTextActive: { color: colors.primary },
  errorWrap: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  messages: { padding: spacing.lg, gap: spacing.md },
  liveTimeline: { marginTop: spacing.md, gap: spacing.sm },
  liveHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.xs },
  liveHeaderText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  emptyMessages: { flexGrow: 1 },
  message: { gap: spacing.md, paddingVertical: spacing.md },
  messageHeader: { minHeight: 28, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm },
  messageEditRowOutside: { alignSelf: "flex-end", flexDirection: "row", alignItems: "center", gap: 10, marginTop: 2, paddingRight: 2 },
  messageEditButton: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.xs },
  messageTime: { color: colors.textMuted, fontSize: 12 },
  messageEditText: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  userMessage: { alignSelf: "flex-end", maxWidth: "88%", paddingHorizontal: spacing.md, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  assistantMessage: {},
  messageRole: { color: colors.primary, fontSize: 12, fontWeight: "700" },
  messageText: { color: colors.text, fontSize: 16, lineHeight: 24 },
  failureCard: { alignSelf: "flex-start", flexShrink: 1, maxWidth: "88%", minHeight: 44, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: spacing.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, borderWidth: 1, borderColor: "#E4B4AE", borderRadius: radius.sm, backgroundColor: "#FFF4F2" },
  failureTitle: { color: colors.danger, fontSize: 13, fontWeight: "700" },
  failureRetry: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.danger, borderRadius: radius.sm },
  failureRetryDisabled: { opacity: 0.5 },
  failureRetryText: { color: colors.danger, fontSize: 12, fontWeight: "700" },
  composerWrap: { marginHorizontal: spacing.md, marginBottom: spacing.sm, gap: 6 },
  composer: { flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 6, paddingRight: 6, paddingVertical: 6, backgroundColor: colors.background, borderWidth: 1, borderColor: colors.border, borderRadius: 999, ...shadow.card },
  writeBadge: { marginLeft: "auto", color: colors.primary, fontSize: 11, fontWeight: "800", backgroundColor: "rgba(23,107,87,0.12)", borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, overflow: "hidden" },
  writeCard: {
    alignSelf: "flex-start",
    maxWidth: "88%",
    maxHeight: 420,
    overflow: "hidden",
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: "#EFF3F0",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  writeCardScroll: { maxHeight: 300 },
  writeCardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  writeCardTitle: { color: colors.text, fontSize: 14, fontWeight: "700" },
  writeCardTarget: { flexShrink: 1, minWidth: 0, color: colors.textMuted, fontSize: 12 },
  writeCardDetails: { marginTop: spacing.xs, color: colors.text, fontSize: 12, lineHeight: 18 },
  writeCardActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.sm },
  // 与提问卡的两个按钮同一套尺寸（34 / 13），比共享 Button 小一档。
  writeCardButtonSecondary: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.background,
  },
  writeCardButtonSecondaryText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  writeCardButtonPrimary: {
    minHeight: 34,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
    backgroundColor: colors.primary,
  },
  writeCardButtonPrimaryText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  writeStats: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: spacing.md, paddingVertical: spacing.xs },
  writeStatAdd: { color: "#1B7F4D", fontSize: 12, fontWeight: "800" },
  writeStatDel: { color: colors.danger, fontSize: 12, fontWeight: "800" },
  writeDiffScroll: { maxHeight: 260, marginTop: spacing.sm },
  writeDiffToggle: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, marginTop: spacing.xs, paddingVertical: spacing.sm + 2 },
  writeDiffToggleText: { color: colors.textMuted, fontSize: 13 },
  writeDiffToggleHint: { color: colors.textMuted, fontSize: 12, flexShrink: 1, textAlign: "right" },
  writeDiff: { marginTop: spacing.sm, gap: 4 },
  writeDiffLabel: { color: colors.textMuted, fontSize: 11, fontWeight: "700" },
  writeDiffLabelSpaced: { marginTop: spacing.xs },
  writeDiffAdd: { color: "#1B7F4D", fontSize: 12, lineHeight: 18 },
  writeDiffDel: { color: colors.danger, fontSize: 12, lineHeight: 18 },
  mascot: { position: "absolute", right: 14, top: -40, width: 40, height: 44 },
  mascotImage: { width: "100%", height: "100%", resizeMode: "contain" },
  welcomeBox: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm, paddingHorizontal: spacing.xl },
  welcomeChipsRow: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 8 },
  welcomeTitle: { color: colors.text, fontSize: 17, fontWeight: "700", marginBottom: spacing.xs },
  welcomeChip: { borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: colors.background },
  welcomeChipText: { color: colors.textMuted, fontSize: 11.5 },
  editingBanner: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  undoBanner: { minHeight: 36, flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.md, paddingVertical: spacing.xs, backgroundColor: "#E6F3EF", borderRadius: 8 },
  attachmentRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  attachmentChip: { flexDirection: "row", alignItems: "center", gap: 5, maxWidth: "100%", paddingHorizontal: 9, paddingVertical: 6, borderRadius: 8, backgroundColor: "#E6F3EF" },
  attachmentName: { color: colors.text, fontSize: 12, maxWidth: 150 },
  attachmentMeta: { color: colors.textMuted, fontSize: 11 },
  attachmentRemove: { padding: 2 },
  attachButton: { width: 38, height: 38, alignItems: "center", justifyContent: "center", borderRadius: 19 },
  undoText: { flex: 1, color: colors.text, fontSize: 13 },
  undoButton: { minWidth: 56, minHeight: 30, alignItems: "center", justifyContent: "center", borderRadius: 6, backgroundColor: colors.primary },
  undoButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "600" },
  editingCopy: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  editingText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  composerInput: { flex: 1, maxHeight: 130, minHeight: 40, paddingHorizontal: spacing.sm, paddingVertical: 10, color: colors.text, fontSize: 16 },
  sendButton: { width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center", backgroundColor: colors.primary },
  sendDisabled: { opacity: 0.48 },
  sheet: {
    maxHeight: "80%",
    paddingBottom: spacing.xl,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    backgroundColor: colors.background,
  },
  sheetHeader: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    paddingLeft: spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetTitleWrap: { flex: 1, minWidth: 0 },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  sheetSubtitle: { marginTop: 2, color: colors.textMuted, fontSize: 12 },
  sheetList: { paddingBottom: spacing.xl },
  sheetRow: {
    minHeight: 62,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  newSessionButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 11, marginHorizontal: spacing.lg, marginBottom: 10 },
  newSessionButtonText: { color: "#FFFFFF", fontSize: 13, fontWeight: "700" },
  renameActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
    sheetRowActive: { backgroundColor: colors.surfaceMuted },
  sheetRowText: { flex: 1, minWidth: 0 },
  sheetRowTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  sheetRowMeta: { marginTop: 3, color: colors.textMuted, fontSize: 12 },
  headerMenuBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9 },
  headerMenuCard: { position: "absolute", top: 100, right: 18, width: 176, backgroundColor: colors.background, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 4, zIndex: 10, elevation: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 10 },
  headerMenuRow: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
  headerMenuRowPressed: { backgroundColor: colors.surfaceMuted },
  headerMenuText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  contextMeter: { height: 8, marginHorizontal: spacing.lg, borderRadius: 4, overflow: "hidden", backgroundColor: colors.surfaceMuted },
  contextMeterFill: { height: 8, borderRadius: 4 },
  contextPercent: { marginTop: spacing.sm, marginHorizontal: spacing.lg, color: colors.text, fontSize: 26, fontWeight: "700" },
  sheetRowLabel: { color: colors.textMuted, fontSize: 13 },
  sheetRowValue: { color: colors.text, fontSize: 13, fontWeight: "600" },
  contextNote: { marginTop: spacing.sm, marginHorizontal: spacing.lg, color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  contextNoteWarning: { color: colors.danger },
  capabilityNotice: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginHorizontal: spacing.md, marginBottom: spacing.xs, padding: spacing.sm, borderRadius: 8, backgroundColor: "#FCEBEB" },
  capabilityNoticeText: { flex: 1, color: colors.danger, fontSize: 12, lineHeight: 18 },
});
