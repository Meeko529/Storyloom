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
import { isDestructiveTool, undoLastWrite, undoLabel, type WritePreview } from "@/agent/write-review";
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
import { AgentQuestionSheet, AgentTraceView } from "@/components/agent-run-view";
import { appendCrashLog } from "@/lib/crash-log";
import { throttle } from "@/lib/debounce";
import { MessageActionBar } from "@/components/message-action-bar";
import { SessionDrawer } from "@/components/session-drawer";
import { AdaptiveScroll, BottomSheet, Button, ConfirmDialog, EmptyState, ErrorNotice, Header, PromptDialog, Screen, TopSheet } from "@/components/ui";
import {
  addMessage,
  createChatSession,
  deleteChatSession,
  deleteProject,
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
  updateProjectInfo,
} from "@/data/repositories";
import {
  getActiveStyleProfile,
  listStyleProfiles,
  setActiveStyleProfile,
} from "@/data/style-repositories";
import type { RootTabParamList } from "@/navigation/types";
import { getAgentDefinitions, getWriteApproval, saveWriteApproval, type WriteApprovalMode } from "@/settings/config";
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
 * 工具授权。写入类工具先展示「改前 / 改后」，按一整组接受或驳回——
 * 逐行确认在长正文上不现实，整组粒度才看得清一次改动动了什么。
 */
type WriteCardRequest = {
  /** 本次请求的唯一标识：确认卡只认自己那一次请求的令牌，避免过期请求落盘。 */
  requestToken: number;
  name: string;
  target?: string;
  before?: string;
  after?: string;
  /** 只有一句动作说明、没有逐行正文可比时为真，界面据此不渲染差异。 */
  actionOnly?: boolean;
  details?: string;
  resolve: (ok: boolean) => void;
};

/**
 * 居中确认卡的内容。
 *
 * 除工具调用授权（那一处是阻塞式的，仍是系统弹窗）外，助手页的确认与告知统一走这张卡，
 * 尺寸与颜色与写作页那张一致。
 */
type ConfirmRequest = {
  title: string;
  message: string;
  /** 不传即纯告知，只剩一颗「知道了」。 */
  confirmLabel?: string;
  onConfirm?: () => void;
  danger?: boolean;
  extraLabel?: string;
  onExtra?: () => void;
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

/**
 * 请求一次写入确认。
 *
 * 🔴 弹卡接口此前是模块顶层的全局变量，多条消息并发时后者会覆盖前者，前一次请求
 * 的 resolve 永远悬空。改为由 `send` 通过参数传入当前请求自己的回调，并把
 * `requestToken` 带在卡上 —— 用户在确认期间切换对话或取消后，卡片上的令牌就与
 * 当前请求不符，两颗按钮会拒绝 resolve，不会把已经作废的改动写进作品。
 */
/** 写入审批方式的两档。说明行讲清这一档会怎么做，不带警示语气。 */
const APPROVAL_MODES: Array<{ id: WriteApprovalMode; label: string; hint: string }> = [
  { id: "ask", label: "请求批准", hint: "写入前展示改动内容，确认后写入文件。" },
  { id: "auto", label: "替我审批", hint: "跳过确认卡直接写入，写入后可撤销。" },
];

function requestToolApproval(
  emit: ((req: WriteCardRequest) => void) | null,
  requestToken: number,
  name: string,
  args: Record<string, unknown>,
  preview: WritePreview | null,
  mode: WriteApprovalMode,
): Promise<boolean> {
  // 替我审批：跳过的是"等你点这一下"，不是记录 —— 预览与撤销快照在本函数被调用
  // 之前就已备好，自动放行时同样入撤销栈。删除类例外：掉了的东西撤不回来。
  if (mode === "auto" && !isDestructiveTool(name)) return Promise.resolve(true);
  if (!preview) {
    const details = JSON.stringify(args, null, 2).slice(0, 1_200);
    return new Promise((resolve) => {
      if (emit) emit({ requestToken, name, details, resolve });
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
    if (emit) emit({
      requestToken,
      name,
      target: preview.target,
      before,
      after,
      ...(preview.actionOnly ? { actionOnly: true } : {}),
      resolve,
    });
    else resolve(false);
  });
}

function activeSessionSettingKey(projectId: string): string {
  return `assistant.activeSession.${projectId}`;
}

function generatedSessionTitle(content: string): string {
  return content.replace(/\s+/g, " ").trim().slice(0, 24) || "新对话";
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
  /** 作品与对话抽屉：全部作品与它们各自的对话都收在里面。 */
  const [drawerVisible, setDrawerVisible] = useState(false);
  const [drawerProjects, setDrawerProjects] = useState<Project[]>([]);
  const [drawerSessions, setDrawerSessions] = useState<Record<string, ChatSession[]>>({});
  /** 重命名目标：对话与作品共用同一个输入入口，标题与保存分支随 kind 走。 */
  const [renaming, setRenaming] = useState<
    { kind: "session"; session: ChatSession } | { kind: "project"; project: Project } | null
  >(null);
  /** 居中确认卡：新建与删除对话、删除作品、附件归处、完成与失败告知。 */
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [mascotEnabled, setMascotEnabled] = useState(true);
  const [mascotKind, setMascotKind] = useState<string>("cat");
  const [mascotOffset, setMascotOffset] = useState({ x: 0, y: 0 });
  const [renameTitle, setRenameTitle] = useState("");
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [stylePickerVisible, setStylePickerVisible] = useState(false);
  const [updatingStyle, setUpdatingStyle] = useState(false);
  const [liveTrace, setLiveTrace] = useState<AgentRunTrace | null>(null);
  /**
   * 实时轨迹按 150ms 节流刷进 state。
   *
   * 流式思考每到一个 token，runtime 就会发布一次轨迹；不节流就是每 token 整屏
   * 重渲染。节流后刷新频率与模型吐字速度解耦。
   */
  const flushLiveTrace = useMemo(() => throttle((trace: AgentRunTrace) => setLiveTrace(trace), 150), []);
  // 离开页面时丢弃挂起的那一次刷新，不给已卸载的组件发 setState。
  useEffect(() => () => flushLiveTrace.cancel(), [flushLiveTrace]);
  /**
   * 正在写出的正文。
   *
   * 与思考共用同一条 `segments`：正文增量由 runtime 追加进轨迹里的 content 段，
   * 界面只读这一处，不另开第二条流式通道。正文落定后由消息体承载，那一段在落库
   * 前就被移除，所以不会与气泡重复。
   */
  const streamingContent = useMemo(() => {
    const parts: string[] = [];
    for (const segment of liveTrace?.segments ?? []) {
      if (segment.kind === "content") parts.push(segment.text);
    }
    return parts.join("");
  }, [liveTrace]);
  // 最近一次被接受的 AI 写入（撤销入口），null 表示当前没有可撤销的改动
  const [undoTarget, setUndoTarget] = useState<string | null>(null);
  // 写入审批方式：过了工具权限那道门之后，是等你点一下，还是直接放行。默认等你点。
  const [writeApproval, setWriteApproval] = useState<WriteApprovalMode>("ask");
  // 输入框「+」上的菜单：null 关闭 / "root" 附件与权限 / "approval" 权限的两档。
  const [composerMenu, setComposerMenu] = useState<null | "root" | "approval">(null);
  // 待随下一条消息发送的文本附件
  const [attachments, setAttachments] = useState<TextAttachment[]>([]);
  const [writeCard, setWriteCard] = useState<WriteCardRequest | null>(null);
  const [writeDiffExpanded, setWriteDiffExpanded] = useState(false);
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
        approvalMode,
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
        getWriteApproval(),
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
      setWriteApproval(approvalMode);
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
  }, [cancelPendingQuestion, effectiveProjectId, flushLiveTrace]);

  useEffect(() => {
    cancelPendingQuestion();
    setSending(false);
    setLiveTrace(null);
    flushLiveTrace.cancel();
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
      // 切走的那条如果上一轮失败过，把「重试」按在新对话上重算一遍。
      const lastFailed = [...nextMessages].reverse().find((message) => message.role === "assistant"
        && (message.metadata?.taskStatus === "failed" || message.metadata?.agentTrace?.status === "error"));
      setRetryRequest(lastFailed ? retryRequestForMessage(lastFailed, nextMessages, session, nextSelection, activeAgentId) : null);
      setSelection(nextSelection);
      setError(selectionError);
      setDrawerVisible(false);
    } catch (switchError) {
      setError(switchError instanceof Error ? switchError.message : String(switchError));
    }
  };

  // 抽屉打开时把全部作品与它们各自的对话读一遍。写操作后会 refreshData，
  // revision 一变这里就重查，所以新建、改名、删除之后列表会跟上。
  useEffect(() => {
    if (!drawerVisible) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await listProjects();
        const sessionMap: Record<string, ChatSession[]> = {};
        await Promise.all(list.map(async (item) => {
          sessionMap[item.id] = await listChatSessions(item.id);
        }));
        if (cancelled) return;
        setDrawerProjects(list);
        setDrawerSessions(sessionMap);
      } catch {
        // 抽屉数据读失败不打断对话：沿用上一次读到的结果。
      }
    })();
    return () => { cancelled = true; };
  }, [drawerVisible, revision]);

  /**
   * 新建对话前先确认：误触会立刻切走，且每次点都会新建。
   * 带 target 时是抽屉里某部作品行的 ＋，新对话归那部作品。
   */
  const confirmNewSession = (target?: Project) => {
    if (sending) return;
    if (!target && !effectiveProjectId) return;
    setConfirmRequest({
      title: "新建对话？",
      message: "当前对话不会被删除，之后可在历史对话里找回。",
      confirmLabel: "新建",
      onConfirm: () => { void newSession(target); },
    });
  };

  /** 重命名对话或作品：改完即时更新抽屉列表与当前的会话 / 作品标题。 */
  const saveRename = async () => {
    if (!renaming || !renameTitle.trim()) return;
    const nextTitle = renameTitle.trim();
    try {
      if (renaming.kind === "project") {
        const target = renaming.project;
        await updateProjectInfo(target.id, nextTitle, target.description);
        setDrawerProjects((current) => current.map((item) => (item.id === target.id ? { ...item, title: nextTitle } : item)));
        if (project?.id === target.id) setProject({ ...project, title: nextTitle });
      } else {
        const updated = await updateChatSession({ id: renaming.session.id, title: nextTitle });
        setSessions((current) => current.map((session) => (session.id === updated.id ? updated : session)));
        if (activeSession?.id === updated.id) setActiveSession(updated);
      }
      setRenaming(null);
      refreshData();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : String(renameError));
    }
  };

  /** 新对话归到 target 那部作品；不带 target 时归当前作品。 */
  const newSession = async (target?: Project) => {
    const targetProjectId = target?.id ?? effectiveProjectId;
    if (!targetProjectId || sending) return;
    setError(null);
    try {
      const session = await createChatSession(targetProjectId, selection?.model.id ?? defaultModelId);
      await setSetting(activeSessionSettingKey(targetProjectId), session.id);
      if (targetProjectId === effectiveProjectId) {
        setSessions((current) => [session, ...current]);
        setActiveSession(session);
        setMessages([]);
        setRetryRequest(null);
      } else {
        // 给别的作品新建：切过去，加载时会按上面的设置把这条新对话选为当前。
        setCurrentProject(targetProjectId);
      }
      setDrawerVisible(false);
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
    if (sending) return;
    const targetProjectId = effectiveProjectId;
    if (!targetProjectId) return;
    try {
      await deleteChatSession(session.id);
      // 抽屉里那一行同时消失，不必等下一次全量重读。
      setDrawerSessions((current) => {
        const list = current[session.projectId];
        if (!list) return current;
        return { ...current, [session.projectId]: list.filter((item) => item.id !== session.id) };
      });
      // 删的是别的作品的对话：它不在当前列表里，当前对话不受影响。
      if (session.projectId !== targetProjectId) return;
      const remaining = sessions.filter((item) => item.id !== session.id);
      setSessions(remaining);
      if (activeSession?.id !== session.id) return;
      const replacement = remaining[0] ?? await createChatSession(targetProjectId, selection?.model.id ?? defaultModelId);
      if (!remaining.length) setSessions([replacement]);
      await setSetting(activeSessionSettingKey(targetProjectId), replacement.id);
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
    setConfirmRequest({
      title: "删除对话",
      message: `确定删除“${session.title}”及其中的全部消息？`,
      confirmLabel: "删除",
      danger: true,
      onConfirm: () => { void removeSession(session); },
    });
  };

  const removeProject = async (target: Project) => {
    if (sending) return;
    setError(null);
    try {
      await deleteProject(target.id);
      // 删掉的正是正打开的那部：回到"还没有选作品"的状态，助手下次使用时自建「未命名」。
      if (target.id === effectiveProjectId) setCurrentProject(null);
      refreshData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const confirmDeleteProject = (target: Project) => {
    setConfirmRequest({
      title: "删除作品",
      message: "确定删除《" + target.title + "》？这部作品的章节、笔记与全部对话会一并删除。",
      confirmLabel: "删除",
      danger: true,
      onConfirm: () => { setDrawerVisible(false); void removeProject(target); },
    });
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
      setConfirmRequest({
        title: "无法读取文件",
        message: pickError instanceof Error ? pickError.message : String(pickError),
      });
      return;
    }
    if (!picked) return;
    const attachment = picked;
    setConfirmRequest({
      title: attachment.name,
      message: `共 ${attachment.characters} 字${attachment.truncated ? "（内容较长，已截取前 10 万字）" : ""}\n\n「加入本次对话」：随下一条消息发给助手，不写入数据库。\n「存入资料」：写成本作品的笔记，之后助手可长期检索引用。`,
      confirmLabel: "存入资料",
      extraLabel: "加入本次对话",
      onConfirm: () => {
        void (async () => {
          if (!project) return;
          try {
            const title = await saveAttachmentAsNote(project.id, attachment);
            refreshData();
            setConfirmRequest({
              title: "已存入资料",
              message: `「${title}」已写成本作品的笔记，助手可在需要时检索到。`,
            });
          } catch (saveError) {
            setConfirmRequest({
              title: "存入失败",
              message: saveError instanceof Error ? saveError.message : String(saveError),
            });
          }
        })();
      },
      onExtra: () => setAttachments((current) => (
        current.some((item) => item.name === attachment.name) || current.length >= MAX_ATTACHMENTS_PER_MESSAGE
          ? current
          : [...current, attachment]
      )),
    });
  };

  /** 撤销最近一次被接受的 AI 写入，把对象还原为改动前的内容。 */
  const handleUndoWrite = () => {
    void (async () => {
      try {
        const label = await undoLastWrite();
        if (label) {
          setUndoTarget(null);
          refreshData();
          setConfirmRequest({ title: "已撤销", message: `「${label}」已还原为改动前的内容。` });
        } else {
          setUndoTarget(null);
        }
      } catch (error) {
        setConfirmRequest({
          title: "撤销失败",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  };

  /** 从「+」菜单里选附件：先收起菜单再走原来的选文件流程。 */
  const pickAttachment = () => {
    setComposerMenu(null);
    void handlePickAttachment();
  };

  /**
   * 切换写入审批方式。输入框菜单与设置页共用同一份持久化，改一处两处同时生效。
   *
   * 它只决定"过了权限那道门之后等不等你点"：工具被禁用的仍然不执行，删除类
   * 在任何一档下都等你点。
   */
  const changeWriteApproval = async (mode: WriteApprovalMode) => {
    setWriteApproval(mode);
    setComposerMenu(null);
    await saveWriteApproval(mode);
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
    // 本请求专属的弹卡回调：并发请求各自持有自己的 emit，不共用全局槽位。
    const emitWriteCard = (req: WriteCardRequest) => {
      if (req.requestToken !== requestId) {
        // 已作废的请求：直接回绝，不给界面展示的机会。
        req.resolve(false);
        return;
      }
      setWriteDiffExpanded(false);
      setWriteCard(req);
    };
    setSending(true);
    setError(null);
    setInput("");
    setLiveTrace(null);
    flushLiveTrace.cancel();
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
        approveTool: (name, args, preview) =>
          requestToolApproval(emitWriteCard, requestId, name, args, preview, writeApproval),
        askUser,
        onTrace: (trace) => {
          // 实时时间线唯一的数据源：思考增量与执行事件都在这同一份轨迹里，
          // 界面不再另存一份流式文本，也就不会出现同一段思考显示两遍。
          latestTrace = trace;
          flushLiveTrace(trace);
        },
      });
      const processingSeconds = Math.max(1, Math.round((Date.now() - requestStartedAt) / 1000));
      const assistantMessage = await addMessage(sessionId, "assistant", response.content, {
        agentTrace: response.trace,
        ...(response.reasoning ? { reasoning: response.reasoning } : {}),
        ...(response.reasoningSegments?.length ? { reasoningSegments: response.reasoningSegments } : {}),
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
      flushLiveTrace.cancel();
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
      if (isCurrentRequest()) {
        setLiveTrace(null);
        flushLiveTrace.cancel();
      }
    } finally {
      if (isCurrentRequest()) setSending(false);
    }
  };
  const contextUsage = useMemo(
    () => computeContextUsage(messages, contextWindow, historyLimit),
    [contextWindow, historyLimit, messages],
  );

  if (loading) return <Screen><Header title="助手" /><View style={styles.loading}><ActivityIndicator color={colors.primary} /></View></Screen>;
  return (
    <Screen>
      <Header
        leading={(
          <Pressable accessibilityLabel="作品与对话" onPress={() => setDrawerVisible(true)} style={styles.iconButton}>
            {/* 两条线，一长一短：与写作页左上角同一个入口画法，两页手势一致。 */}
            <View style={styles.menuGlyph}>
              <View style={[styles.menuGlyphBar, styles.menuGlyphBarLong]} />
              <View style={[styles.menuGlyphBar, styles.menuGlyphBarShort]} />
            </View>
          </Pressable>
        )}
        title="助手"
        action={(
          <Pressable accessibilityLabel="上下文占用" onPress={() => setContextSheetVisible(true)} style={styles.iconButton}>
            <Ionicons name="pie-chart-outline" size={20} color={colors.primary} />
          </Pressable>
        )}
      />
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
          // 倒置列表：offset 0 恒为最新，打开 / 切换 / 发送天然落在最新。
          // 不要再加 maintainVisibleContentPosition —— 它在每次内容尺寸变化时都会
          // 调整滚动偏移，而这条列表的内容尺寸变得很频繁（列表头里的实时思考随字
          // 增长、展开或收起执行轨迹也改高度），偏移被反复改写会把单元排到错误的
          // 位置上，表现为文字堆在一起或滑到一片空白。
          inverted
          contentContainerStyle={messages.length ? styles.messages : styles.emptyMessages}
          ListHeaderComponent={sending || liveTrace || writeCard || pendingQuestion ? (
            <View style={styles.liveTimeline}>
              {sending || liveTrace ? (
                <>
                  <View style={styles.liveHeader}>
                    <ActivityIndicator size="small" color={colors.primary} />
                    <Text style={styles.liveHeaderText}>处理中 · 已处理 {thinkingSeconds}s</Text>
                  </View>
                  {liveTrace ? <AgentTraceView trace={liveTrace} defaultExpanded inline /> : null}
                  {streamingContent ? (
                    <View style={styles.streamingBubble}>
                      <View style={styles.messageHeader}>
                        <Text style={styles.messageRole}>Storyloom</Text>
                      </View>
                      <Text selectable style={[styles.messageText, chatTextStyle]}>{streamingContent}</Text>
                    </View>
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
                  <AdaptiveScroll maxHeight={300} style={styles.writeCardScroll} claimGesture>
                  {writeCard.actionOnly ? (
                    <Text style={styles.writeCardDetails}>{writeCard.after}</Text>
                  ) : writeCard.before !== undefined && writeCard.after !== undefined ? (() => {
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
                          <AdaptiveScroll maxHeight={260} style={styles.writeDiffScroll} claimGesture>
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
                      onPress={() => {
                        if (writeCard.requestToken !== sendRequestRef.current) return;
                        writeCard.resolve(false);
                        setWriteCard(null);
                      }}
                      style={styles.writeCardButtonSecondary}
                    >
                      <Text style={styles.writeCardButtonSecondaryText}>驳回</Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        if (writeCard.requestToken !== sendRequestRef.current) return;
                        writeCard.resolve(true);
                        setWriteCard(null);
                      }}
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
                  reasoningSegments={item.metadata.reasoningSegments
                    ?? (item.metadata.reasoning ? [{ text: item.metadata.reasoning }] : undefined)}
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
        {composerMenu ? (
          <Pressable accessibilityLabel="关闭菜单" style={styles.composerMenuScrim} onPress={() => setComposerMenu(null)} />
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
          {composerMenu ? (
            <View style={styles.composerMenu}>
              {composerMenu === "root" ? (
                <>
                  <Pressable
                    accessibilityLabel="添加附件"
                    disabled={attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE}
                    onPress={pickAttachment}
                    style={({ pressed }) => [styles.composerMenuRow, pressed && styles.composerMenuRowPressed,
                      attachments.length >= MAX_ATTACHMENTS_PER_MESSAGE && styles.composerMenuRowDisabled]}
                  >
                    <Ionicons name="attach-outline" size={16} color={colors.textMuted} />
                    <Text style={styles.composerMenuText}>附件</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="写入权限"
                    onPress={() => setComposerMenu("approval")}
                    style={({ pressed }) => [styles.composerMenuRow, pressed && styles.composerMenuRowPressed]}
                  >
                    <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} />
                    <Text style={styles.composerMenuText}>权限</Text>
                    <Ionicons name="chevron-forward" size={14} color={colors.textMuted} />
                  </Pressable>
                </>
              ) : (
                <>
                  <Pressable accessibilityLabel="返回" onPress={() => setComposerMenu("root")} style={styles.composerMenuBack}>
                    <Ionicons name="chevron-back" size={13} color={colors.textMuted} />
                    <Text style={styles.composerMenuBackText}>权限</Text>
                  </Pressable>
                  <Text style={styles.composerMenuHint}>写入正文前的确认方式</Text>
                  {APPROVAL_MODES.map((mode) => (
                    <Pressable
                      key={mode.id}
                      accessibilityLabel={mode.label}
                      onPress={() => void changeWriteApproval(mode.id)}
                      style={[styles.approvalOption, writeApproval === mode.id && styles.approvalOptionActive]}
                    >
                      <View style={styles.approvalCopy}>
                        <Text style={[styles.approvalTitle, writeApproval === mode.id && styles.approvalTitleActive]}>
                          {mode.label}
                        </Text>
                        <Text style={styles.approvalHint}>{mode.hint}</Text>
                      </View>
                      {writeApproval === mode.id ? <Ionicons name="checkmark" size={15} color={colors.primary} /> : null}
                    </Pressable>
                  ))}
                </>
              )}
            </View>
          ) : null}
          <View style={styles.composer}>
            <Pressable
              accessibilityLabel="打开输入菜单"
              disabled={sending}
              onPress={() => setComposerMenu((current) => (current ? null : "root"))}
              style={({ pressed }) => [styles.attachButton, (pressed || sending) && styles.sendDisabled]}
            >
              <Ionicons name={composerMenu ? "close" : "add"} size={24} color={colors.primary} />
            </Pressable>
            <TextInput
              ref={composerRef}
              value={input}
              onChangeText={setInput}
              onFocus={() => setComposerMenu(null)}
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

      <Modal visible={contextSheetVisible} transparent animationType="fade" onRequestClose={() => setContextSheetVisible(false)}>
        <TopSheet
          title="上下文占用"
          subtitle="按字符估算，供观察趋势，非精确计费"
          onClose={() => setContextSheetVisible(false)}
        >
          <View style={styles.contextBody}>
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
        </TopSheet>
      </Modal>

      {/* 重命名作品与重命名对话共用同一张居中输入卡，与写作页是同一个组件、同一套数值。 */}
      <PromptDialog
        visible={renaming !== null}
        title={renaming?.kind === "project" ? "重命名作品" : "重命名对话"}
        label={renaming?.kind === "project" ? "作品名" : "对话标题"}
        value={renameTitle}
        onChangeText={setRenameTitle}
        onClose={() => setRenaming(null)}
        onConfirm={() => { void saveRename(); }}
        confirmLabel="保存"
        confirmDisabled={!renameTitle.trim()}
      />

      <BottomSheet
        visible={modelPickerVisible}
        title="选择模型"
        subtitle="仅用于当前对话"
        onClose={() => setModelPickerVisible(false)}
      >
          <FlatList
              style={styles.panelList}
              data={models}
              keyExtractor={(item) => item.id}
              contentContainerStyle={[styles.sheetList, styles.panelListBottom]}
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
        </BottomSheet>
      <BottomSheet
        visible={stylePickerVisible}
        title="选择创作文风"
        subtitle={project?.title ?? "当前作品"}
        onClose={() => setStylePickerVisible(false)}
      >
          <FlatList
              style={styles.panelList}
              data={styleProfiles}
              keyExtractor={(item) => item.id}
              contentContainerStyle={[styles.sheetList, styles.panelListBottom]}
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
        </BottomSheet>

      {/* 切换作品与历史对话都由抽屉承担：顶栏不再单开选择器与面板，点作品行即切换。 */}
      <SessionDrawer
        visible={drawerVisible}
        projects={drawerProjects}
        currentProjectId={effectiveProjectId ?? ""}
        sessionsByProject={drawerSessions}
        activeSessionId={activeSession?.id ?? null}
        onClose={() => setDrawerVisible(false)}
        onSelectProject={(target) => {
          if (target.id === effectiveProjectId) return;
          setCurrentProject(target.id);
        }}
        onSelectSession={(target, session) => {
          setDrawerVisible(false);
          if (target.id === effectiveProjectId) {
            void switchSession(session);
            return;
          }
          // 换到那部作品，并把它的当前对话指向这一条：加载时按这个设置选中。
          setCurrentProject(target.id);
          void setSetting(activeSessionSettingKey(target.id), session.id);
        }}
        onCreateSession={(target) => { confirmNewSession(target); }}
        onRenameProject={(target) => {
          // 与写作页一致：先把抽屉收掉再弹居中卡，避免两层浮层同时占屏。
          setDrawerVisible(false);
          setRenaming({ kind: "project", project: target });
          setRenameTitle(target.title);
        }}
        onDeleteProject={confirmDeleteProject}
        onRenameSession={(_target, session) => {
          setDrawerVisible(false);
          setRenaming({ kind: "session", session });
          setRenameTitle(session.title);
        }}
        onDeleteSession={(_target, session) => { confirmDeleteSession(session); }}
      />

      {/* 先把卡收掉再执行动作：动作里可能再弹一张（例如存入资料的结果）。 */}
      <ConfirmDialog
        visible={Boolean(confirmRequest)}
        title={confirmRequest?.title ?? ""}
        message={confirmRequest?.message ?? ""}
        confirmLabel={confirmRequest?.confirmLabel}
        danger={confirmRequest?.danger}
        extraLabel={confirmRequest?.extraLabel}
        onClose={() => setConfirmRequest(null)}
        onConfirm={() => {
          const request = confirmRequest;
          setConfirmRequest(null);
          request?.onConfirm?.();
        }}
        onExtra={() => {
          const request = confirmRequest;
          setConfirmRequest(null);
          request?.onExtra?.();
        }}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  // 顶栏入口：两条线，上长下短，与写作页左上角同一套画法。
  menuGlyph: { width: 20, gap: 5 },
  menuGlyphBar: { height: 2, borderRadius: 2, backgroundColor: colors.primary },
  menuGlyphBarLong: { width: 20 },
  menuGlyphBarShort: { width: 13 },
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
  // 流式正文：与落定后的消息气泡同一套排版，只是还没进消息列表。
  streamingBubble: { gap: spacing.xs, paddingVertical: spacing.xs },
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
  composerMenuScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: "rgba(20,21,19,0.05)" },
  composerMenu: {
    marginLeft: 6,
    marginBottom: spacing.xs,
    width: 236,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingVertical: spacing.xs,
    ...shadow.card,
  },
  composerMenuRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 40, paddingHorizontal: spacing.md },
  composerMenuRowPressed: { backgroundColor: colors.surfaceMuted },
  composerMenuRowDisabled: { opacity: 0.55 },
  composerMenuText: { flex: 1, color: colors.text, fontSize: 14 },
  composerMenuBack: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 26, paddingHorizontal: spacing.md },
  composerMenuBackText: { color: colors.textMuted, fontSize: 11 },
  composerMenuHint: { paddingHorizontal: spacing.md, paddingBottom: spacing.xs, color: colors.textMuted, fontSize: 11 },
  approvalOption: { flexDirection: "row", alignItems: "flex-start", gap: spacing.sm, marginHorizontal: spacing.xs, borderRadius: radius.sm, padding: spacing.sm },
  approvalOptionActive: { backgroundColor: colors.surfaceMuted },
  approvalCopy: { flex: 1 },
  approvalTitle: { color: colors.text, fontSize: 13 },
  approvalTitleActive: { color: colors.primary },
  approvalHint: { marginTop: 2, color: colors.textMuted, fontSize: 11, lineHeight: 16 },
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
  // 弹层里的列表：高度上限由面板给，超出在这里滚。
  panelList: { flexShrink: 1 },
  // 列表容器：行自带左右内边距，这里只补底部留白，不重复缩进。
  panelListBottom: { paddingBottom: spacing.xl },
  sheetRowActive: { backgroundColor: colors.surfaceMuted },
  sheetRowText: { flex: 1, minWidth: 0 },
  sheetRowTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  sheetRowMeta: { marginTop: 3, color: colors.textMuted, fontSize: 12 },
  contextMeter: { height: 8, marginHorizontal: spacing.lg, borderRadius: 4, overflow: "hidden", backgroundColor: colors.surfaceMuted },
  contextMeterFill: { height: 8, borderRadius: 4 },
  contextPercent: { marginTop: spacing.sm, marginHorizontal: spacing.lg, color: colors.text, fontSize: 26, fontWeight: "700" },
  sheetRowLabel: { color: colors.textMuted, fontSize: 13 },
  sheetRowValue: { color: colors.text, fontSize: 13, fontWeight: "600" },
  contextNote: { marginTop: spacing.sm, marginHorizontal: spacing.lg, color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  // 面板最后一条说明不贴下沿。
  contextBody: { paddingBottom: spacing.xl },
  contextNoteWarning: { color: colors.danger },
  capabilityNotice: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginHorizontal: spacing.md, marginBottom: spacing.xs, padding: spacing.sm, borderRadius: 8, backgroundColor: "#FCEBEB" },
  capabilityNoticeText: { flex: 1, color: colors.danger, fontSize: 12, lineHeight: 18 },
});
