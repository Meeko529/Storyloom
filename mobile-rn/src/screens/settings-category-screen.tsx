// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";

import { Button, ErrorNotice, Field, Header, Screen } from "@/components/ui";
import {
  getSetting,
  listModels,
  setSetting,
} from "@/data/repositories";
import { createId } from "@/lib/id";
import { useAppStore } from "@/store/app-store";
import {
  DEFAULT_INDEX_SETTINGS,
  getAgentDefinitions,
  getAgentRules,
  getAgentSkills,
  getIndexSettings,
  getToolPermissions,
  saveAgentDefinitions,
  saveAgentRules,
  saveAgentSkills,
  saveIndexSettings,
  saveToolPermissions,
  TOOL_CATALOG,
  type AgentDefinition,
  type AgentRule,
  type AgentSkill,
  type IndexSettings,
  type ToolPermissionMode,
} from "@/settings/config";
import {
  EDITOR_FONT_KEY,
  EDITOR_FONT_OPTIONS,
  EDITOR_FONT_SIZE_KEY,
  MAX_EDITOR_FONT_SIZE,
  MIN_EDITOR_FONT_SIZE,
  normalizeEditorFont,
  normalizeEditorFontSize,
  type EditorFontId,
} from "@/settings/editor-prefs";
import { clearProjectIndex, getProjectIndexStats, indexProject } from "@/search/indexer";
import { getLocalModelStatus, warmUpLocalModels } from "@/search/local-models";
import {
  ALL_OPTIONAL_RESOURCE_KINDS,
  getRuntimeResourceState,
  installOptionalResources,
  LOCAL_MODEL_INFO,
  type OptionalResourceKind,
  type RuntimeResourceState,
} from "@/settings/remote-resources";
import {
  checkOhStoryRelease,
  compareOhStoryVersions,
  getOhStoryUpdateState,
  installOhStoryRelease,
  rollbackOhStoryPackage,
  type OhStoryRelease,
  type OhStoryUpdateState,
} from "@/settings/oh-story-updater";
import {
  checkAppUpdate,
  getLastAppUpdateCheck,
  CURRENT_APP_VERSION,
  type AppUpdateInfo,
} from "@/settings/app-update";
import { downloadUpdateApk, installApkFile } from "@/settings/app-installer";
import { exportDiagnosticsReport } from "@/settings/diagnostics";
import { exportBackup, pickBackupFile, restoreBackup } from "@/settings/backup";
import {
  applyContentPack,
  exportContentPack,
  pickContentPack,
  previewContentPack,
} from "@/settings/content-pack";
import { colors, radius, spacing } from "@/theme";
import type { Model } from "@/types";

export type SettingsCategory =
  | "general"
  | "editor"
  | "connections"
  | "models"
  | "free-models"
  | "index"
  | "context"
  | "style"
  | "agent-tools"
  | "rules"
  | "skills"
  | "agents"
  | "advanced";

const TITLES: Record<Exclude<SettingsCategory, "models">, string> = {
  general: "通用",
  editor: "编辑器",
  connections: "连接",
  "free-models": "免费模型",
  index: "索引",
  context: "上下文",
  style: "作者文风",
  "agent-tools": "工具权限",
  rules: "规则",
  skills: "技能",
  agents: "智能体",
  advanced: "高级",
};

const EMPTY_OH_STORY_STATE: OhStoryUpdateState = { installed: null, previous: null, lastCheck: null };

const PERMISSION_MODES: Array<{ id: ToolPermissionMode; label: string }> = [
  { id: "allow", label: "允许" },
  { id: "ask", label: "每次询问" },
  { id: "deny", label: "禁止" },
];

type IndexNumberKey = "chunkSize" | "chunkOverlap" | "retrievalTopK" | "rerankTopK";
type IndexNumberDraft = Record<IndexNumberKey, string>;

function draftFromSettings(settings: IndexSettings): IndexNumberDraft {
  return {
    chunkSize: String(settings.chunkSize),
    chunkOverlap: String(settings.chunkOverlap),
    retrievalTopK: String(settings.retrievalTopK),
    rerankTopK: String(settings.rerankTopK),
  };
}

/**
 * 「可选内容」区块的展示信息。
 * 这些内容不随安装包分发，按需下载；不装不影响写作、对话与章节管理。
 */
const OPTIONAL_RESOURCE_DESCRIPTIONS: Array<{
  id: OptionalResourceKind;
  title: string;
  sizeMb: number;
  purpose: string;
}> = [
  {
    id: "lorn-style",
    title: "Lorn 原版文风 Skill",
    sizeMb: 1,
    purpose: "用于从导入的参考小说中蒸馏文风。该内容上游未声明开源许可，因此不随安装包分发，需手动下载。",
  },
  {
    id: "embedding",
    title: "本地嵌入模型（语义检索）",
    sizeMb: Math.round(LOCAL_MODEL_INFO.embedding.bytes / 1024 / 1024),
    purpose: "将文本转换为向量以支持语义检索，完全在本地运行，不联网。",
  },
  {
    id: "rerank",
    title: "本地重排模型（结果精排）",
    sizeMb: Math.round(LOCAL_MODEL_INFO.rerank.bytes / 1024 / 1024),
    purpose: "对语义检索结果进行精排以提升准确度，非必需项。",
  },
];

function SettingRow({ label, value, onPress, destructive = false }: {
  label: string;
  value?: string;
  onPress?: () => void;
  destructive?: boolean;
}) {
  return (
    <Pressable disabled={!onPress} onPress={onPress} style={styles.settingRow}>
      <Text style={[styles.settingLabel, destructive && styles.dangerText]}>{label}</Text>
      {value ? <Text numberOfLines={2} style={styles.settingValue}>{value}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} /> : null}
    </Pressable>
  );
}

function ToggleRow({ label, value, onChange }: { label: string; value: boolean; onChange: (value: boolean) => void }) {
  return (
    <View style={styles.settingRow}>
      <Text style={styles.settingLabel}>{label}</Text>
      <Switch value={value} onValueChange={onChange} trackColor={{ false: colors.border, true: colors.primary }} />
    </View>
  );
}

export function SettingsCategoryScreen({ category, onBack }: { category: Exclude<SettingsCategory, "models">; onBack: () => void }) {
  const projectId = useAppStore((state) => state.currentProjectId);
  const refreshData = useAppStore((state) => state.refreshData);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [indexSettings, setIndexSettings] = useState<IndexSettings>(DEFAULT_INDEX_SETTINGS);
  // 索引的 4 个数字框用「草稿字符串」承接：若直接绑数字，清空输入会立刻被兜底值覆盖，导致删不掉重输。
  const [indexDraft, setIndexDraft] = useState<IndexNumberDraft>(() => draftFromSettings(DEFAULT_INDEX_SETTINGS));
  const [indexNeedsRebuild, setIndexNeedsRebuild] = useState(false);
  const [rebuilding, setRebuilding] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [indexStats, setIndexStats] = useState({ sources: 0, chunks: 0 });
  const [indexProgress, setIndexProgress] = useState("");
  const [rules, setRules] = useState<AgentRule[]>([]);
  const [skills, setSkills] = useState<AgentSkill[]>([]);
  const [agents, setAgents] = useState<AgentDefinition[]>([]);
  const [availableModels, setAvailableModels] = useState<Model[]>([]);
  const [permissions, setPermissions] = useState<Record<string, ToolPermissionMode>>({});
  const [activeAgentId, setActiveAgentId] = useState("");
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editingSkillId, setEditingSkillId] = useState<string | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [ruleName, setRuleName] = useState("");
  const [ruleContent, setRuleContent] = useState("");
  const [skillName, setSkillName] = useState("");
  const [skillDescription, setSkillDescription] = useState("");
  const [skillInstructions, setSkillInstructions] = useState("");
  const [agentName, setAgentName] = useState("");
  const [agentDescription, setAgentDescription] = useState("");
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentModelId, setAgentModelId] = useState("");
  const [historyLimit, setHistoryLimit] = useState("30");
  const [compression, setCompression] = useState(false);
  const [autoSaveDelay, setAutoSaveDelay] = useState("1000");
  const [editorFontSize, setEditorFontSize] = useState("17");
  const [editorFontId, setEditorFontId] = useState<EditorFontId>("system");
  const [requestTimeout, setRequestTimeout] = useState("120000");
  const [ohStoryState, setOhStoryState] = useState<OhStoryUpdateState>(EMPTY_OH_STORY_STATE);
  const [ohStoryProgress, setOhStoryProgress] = useState("");
  const [ohStoryBusy, setOhStoryBusy] = useState(false);
  const [resourceState, setResourceState] = useState<RuntimeResourceState | null>(null);
  const [resourceProgress, setResourceProgress] = useState("");
  const [resourceBusy, setResourceBusy] = useState(false);
  const [appUpdate, setAppUpdate] = useState<AppUpdateInfo | null>(null);
  const [appUpdateBusy, setAppUpdateBusy] = useState(false);
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null);
  // 应用内更新：下载进度状态
  const [apkBusy, setApkBusy] = useState(false);
  const [apkProgress, setApkProgress] = useState("");
  // 诊断报告导出状态
  const [diagnosticsBusy, setDiagnosticsBusy] = useState(false);
  // 备份 / 恢复状态
  const [backupBusy, setBackupBusy] = useState(false);
  // 内容包导入 / 导出状态
  const [contentPackBusy, setContentPackBusy] = useState(false);

  const checkForAppUpdate = async () => {
    setAppUpdateBusy(true);
    setAppUpdateError(null);
    try {
      setAppUpdate(await checkAppUpdate());
    } catch (updateError) {
      setAppUpdateError(updateError instanceof Error ? updateError.message : String(updateError));
    } finally {
      setAppUpdateBusy(false);
    }
  };

  /**
   * 应用内更新：下载新版本 APK 后调起系统安装器。
   * 首次会要求授权「安装未知应用」——这是安卓的硬性要求，授权一次即可。
   */
  const downloadAndInstallUpdate = async () => {
    const apkUrl = appUpdate?.apkUrl;
    if (!apkUrl) {
      setAppUpdateError("这个版本没有附带安装包，请改用浏览器下载");
      return;
    }
    setApkBusy(true);
    setApkProgress("准备下载…");
    setAppUpdateError(null);
    try {
      const file = await downloadUpdateApk(apkUrl, ({ bytesWritten, totalBytes, source }) => {
        const mb = (bytesWritten / 1048576).toFixed(1);
        setApkProgress(totalBytes > 0
          ? `${source} · ${Math.round((bytesWritten / totalBytes) * 100)}%（${mb} MB）`
          : `${source} · 已下载 ${mb} MB`);
      });
      setApkProgress("下载完成，正在打开系统安装界面…");
      await installApkFile(file);
      setApkProgress("请在系统安装界面完成安装");
    } catch (installError) {
      setAppUpdateError(installError instanceof Error ? installError.message : String(installError));
      setApkProgress("");
    } finally {
      setApkBusy(false);
    }
  };

  /** 导出诊断报告并发起系统分享，便于反馈问题时附带运行环境信息。 */
  const exportDiagnostics = async () => {
    setDiagnosticsBusy(true);
    setAppUpdateError(null);
    try {
      await exportDiagnosticsReport();
    } catch (diagnosticsError) {
      setAppUpdateError(diagnosticsError instanceof Error ? diagnosticsError.message : String(diagnosticsError));
    } finally {
      setDiagnosticsBusy(false);
    }
  };

  /** 打包全部数据并调起系统分享，由用户选择保存位置。 */
  const runBackup = async () => {
    setBackupBusy(true);
    try {
      const summary = await exportBackup();
      Alert.alert(
        "备份完成",
        `共 ${summary.fileCount} 个文件，已调出系统分享。请选择保存位置（网盘、文件管理器，或发送到电脑）。`,
      );
    } catch (backupError) {
      Alert.alert("备份失败", backupError instanceof Error ? backupError.message : String(backupError));
    } finally {
      setBackupBusy(false);
    }
  };

  /** 给「添加智能体」表单填一份可直接改用的示例，降低上手门槛。 */
  const fillAgentExample = () => {
    setAgentName("短篇小说助手");
    setAgentDescription("适合单篇完结的短篇，节奏紧凑、结尾留白。");
    setAgentPrompt([
      "你是短篇小说写作助手。收到写作请求后按下面的顺序工作：",
      "1. 先确认题材、篇幅（3000 字以内）与结局走向；信息不足时用一次提问补齐。",
      "2. 输出结构：开场钩子 → 冲突升级 → 转折 → 结尾留白。",
      "3. 语言要求：不用套话与排比，不做总结性抒情，结尾不解释主题。",
      "4. 写作过程中如需改动正文，先给出改动说明并等待确认。",
    ].join("\n"));
  };

  /** 导出自建内容包。 */
  const exportContentPackFile = async () => {
    setContentPackBusy(true);
    try {
      const summary = await exportContentPack("storyloom-content-pack");
      if (summary.count === 0) {
        Alert.alert("没有可导出的内容", "内容包只导出你自己创建的规则、技能与智能体；内置的不能导出。");
        return;
      }
      Alert.alert("导出完成", `共 ${summary.count} 项，已调出系统分享，请选择保存位置。`);
    } catch (error) {
      Alert.alert("导出失败", error instanceof Error ? error.message : String(error));
    } finally {
      setContentPackBusy(false);
    }
  };

  /** 选择并导入内容包，导入前告知覆盖数量。 */
  const importContentPackFile = async () => {
    let picked: Awaited<ReturnType<typeof pickContentPack>>;
    try {
      picked = await pickContentPack();
    } catch (error) {
      Alert.alert("选择文件失败", error instanceof Error ? error.message : String(error));
      return;
    }
    if (!picked) return;
    let preview: Awaited<ReturnType<typeof previewContentPack>>;
    try {
      preview = await previewContentPack(picked as NonNullable<typeof picked>);
    } catch (error) {
      Alert.alert("无法导入", error instanceof Error ? error.message : String(error));
      return;
    }
    const total = preview.pack.rules.length + preview.pack.skills.length + preview.pack.agents.length;
    if (total === 0) {
      Alert.alert("内容包为空", "这个文件里没有可导入的条目。");
      return;
    }
    Alert.alert(
      "导入内容包",
      `共 ${total} 项（规则 ${preview.pack.rules.length} · 技能 ${preview.pack.skills.length} · 智能体 ${preview.pack.agents.length}）` +
        `${preview.conflicts > 0 ? `，其中 ${preview.conflicts} 项会覆盖本地同名条目` : ""}。确定导入吗？`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "导入",
          onPress: () => {
            void (async () => {
              setContentPackBusy(true);
              try {
                await applyContentPack(preview.pack);
                await load();
                Alert.alert("导入完成", `已导入 ${total} 项。`);
              } catch (error) {
                Alert.alert("导入失败", error instanceof Error ? error.message : String(error));
              } finally {
                setContentPackBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  /** 选择备份文件，确认后覆盖本地数据。 */
  const runRestore = async () => {
    let pickedFile: Awaited<ReturnType<typeof pickBackupFile>>;
    try {
      pickedFile = await pickBackupFile();
    } catch (pickError) {
      Alert.alert("选择文件失败", pickError instanceof Error ? pickError.message : String(pickError));
      return;
    }
    if (!pickedFile) return;
    Alert.alert(
      "恢复备份",
      "将用备份覆盖当前的全部作品、章节、笔记、智能体、技能与设置。此操作不可撤销，确定继续吗？",
      [
        { text: "取消", style: "cancel" },
        {
          text: "恢复",
          style: "destructive",
          onPress: () => {
            void (async () => {
              setBackupBusy(true);
              try {
                const summary = await restoreBackup(pickedFile as NonNullable<typeof pickedFile>);
                Alert.alert(
                  "恢复完成",
                  `已恢复 ${summary.fileCount} 个文件（备份时间 ${new Date(summary.exportedAt).toLocaleString()}）。请完全关闭并重新打开应用后生效。`,
                );
              } catch (restoreError) {
                Alert.alert("恢复失败", restoreError instanceof Error ? restoreError.message : String(restoreError));
              } finally {
                setBackupBusy(false);
              }
            })();
          },
        },
      ],
    );
  };

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [nextIndex, nextRules, nextSkills, nextAgents, nextPermissions, active, history, compress, autoSave, fontSize, fontFamily, timeout, nextModels, nextOhStoryState, nextResourceState] = await Promise.all([
        getIndexSettings(),
        getAgentRules(),
        getAgentSkills(),
        getAgentDefinitions(),
        getToolPermissions(),
        getSetting("agent.activeDefinitionId"),
        getSetting("context.historyLimit"),
        getSetting("context.compressSystemPrompts"),
        getSetting("general.autoSaveDelay"),
        getSetting(EDITOR_FONT_SIZE_KEY),
        getSetting(EDITOR_FONT_KEY),
        getSetting("connections.requestTimeout"),
        listModels(),
        getOhStoryUpdateState(),
        getRuntimeResourceState(),
      ]);
      setAppUpdate(await getLastAppUpdateCheck());
      setIndexSettings(nextIndex);
      setIndexDraft(draftFromSettings(nextIndex));
      setRules(nextRules);
      setSkills(nextSkills);
      setAgents(nextAgents);
      setPermissions(nextPermissions);
      const activeAgent = nextAgents.find((agent) => agent.id === active && agent.enabled && agent.kind === "primary")
        ?? nextAgents.find((agent) => agent.id === "builtin-agent--build" && agent.enabled)
        ?? nextAgents.find((agent) => agent.enabled && agent.kind === "primary");
      const nextActiveAgentId = activeAgent?.id ?? "";
      setActiveAgentId(nextActiveAgentId);
      if (nextActiveAgentId !== (active ?? "")) await setSetting("agent.activeDefinitionId", nextActiveAgentId);
      setHistoryLimit(history ?? "30");
      setCompression(compress === "true");
      setAutoSaveDelay(autoSave ?? "1000");
      setEditorFontSize(String(normalizeEditorFontSize(fontSize)));
      setEditorFontId(normalizeEditorFont(fontFamily));
      setRequestTimeout(timeout ?? "120000");
      setAvailableModels(nextModels);
      setOhStoryState(nextOhStoryState);
      setResourceState(nextResourceState);
      if (projectId) setIndexStats(await getProjectIndexStats(projectId));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  // 轻提示：保存成功之类的短消息，2 秒后自动消失。
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2000);
    return () => clearTimeout(timer);
  }, [notice]);

  /**
   * 保存一项键值设置。
   * restore 用于在保存失败时把输入框改回库里真正的值 —— 否则界面显示「已改」、
   * 实际没存进去，下次进来又变回去，用户会以为改了没生效。
   */
  const savePreference = async (key: string, value: string, restore?: (value: string) => void) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await setSetting(key, value);
      setNotice("已保存");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      const stored = await getSetting(key).catch(() => null);
      if (stored !== null) restore?.(stored);
    } finally {
      setSaving(false);
    }
  };

  /** 把一组键值恢复为默认值，并重新载入。 */
  const restoreDefaults = (label: string, entries: Array<{ key: string; value: string }>) => {
    Alert.alert("恢复默认值", `将「${label}」下的设置恢复为默认值。`, [
      { text: "取消", style: "cancel" },
      {
        text: "恢复",
        onPress: async () => {
          setSaving(true);
          setError(null);
          try {
            for (const entry of entries) await setSetting(entry.key, entry.value);
            await load();
            setNotice("已恢复默认值");
          } catch (restoreError) {
            setError(restoreError instanceof Error ? restoreError.message : String(restoreError));
          } finally {
            setSaving(false);
          }
        },
      },
    ]);
  };

  const downloadResources = async (kinds: OptionalResourceKind[] = ALL_OPTIONAL_RESOURCE_KINDS) => {
    setResourceBusy(true);
    setError(null);
    setResourceProgress("准备下载…");
    try {
      const { state: next, errors } = await installOptionalResources(kinds, (item) => {
        if (item.totalBytes && item.totalBytes > 0 && item.bytesWritten !== undefined) {
          setResourceProgress(`${item.label} · ${Math.min(100, Math.round(item.bytesWritten / item.totalBytes * 100))}%`);
        } else {
          setResourceProgress(item.label);
        }
      });
      setResourceState(next);
      setResourceProgress(errors.length ? errors.join("\n") : "所选内容已就绪");
      if (kinds.some((kind) => kind === "embedding" || kind === "rerank")) {
        void warmUpLocalModels().catch(() => undefined);
      }
    } catch (resourceError) {
      setError(resourceError instanceof Error ? resourceError.message : String(resourceError));
      setResourceState(await getRuntimeResourceState().catch(() => null));
    } finally {
      setResourceBusy(false);
    }
  };

  const saveIndex = async (next: IndexSettings) => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const previous = indexSettings;
      await saveIndexSettings(next);
      const stored = await getIndexSettings();
      setIndexSettings(stored);
      setIndexDraft(draftFromSettings(stored));
      const numbersChanged = previous.chunkSize !== stored.chunkSize
        || previous.chunkOverlap !== stored.chunkOverlap
        || previous.retrievalTopK !== stored.retrievalTopK
        || previous.rerankTopK !== stored.rerankTopK;
      if (numbersChanged) setIndexNeedsRebuild(true);
      setNotice("已保存");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  /**
   * 索引数字框失焦时提交：为空或非法一律回落到默认值，并把回显值写回草稿。
   * 这样用户可以先清空再重输 —— 以前直接绑数字，一删就被兜底值覆盖，等于删不动。
   */
  const commitIndexNumber = async (key: IndexNumberKey) => {
    const parsed = Number(indexDraft[key]);
    const valid = Number.isFinite(parsed) && parsed > 0;
    const finalValue = valid ? Math.round(parsed) : DEFAULT_INDEX_SETTINGS[key];
    setIndexDraft({ ...indexDraft, [key]: String(finalValue) });
    await saveIndex({ ...indexSettings, [key]: finalValue });
  };

  const rebuildIndex = async () => {
    if (!projectId) {
      setError("请先从书架打开一部作品");
      return;
    }
    // 用独立的 rebuilding 状态：以前复用 saving，导致切换索引开关时
    // 「重建索引」按钮会莫名其妙变成「索引中」并被禁用。
    setRebuilding(true);
    setIndexProgress("准备索引…");
    setError(null);
    try {
      await indexProject(projectId, {
        force: true,
        onProgress: ({ completed, total, title }) => setIndexProgress(total ? `${completed}/${total} · ${title}` : title),
      });
      setIndexStats(await getProjectIndexStats(projectId));
      setIndexProgress("索引完成");
      setIndexNeedsRebuild(false);
    } catch (indexError) {
      setError(indexError instanceof Error ? indexError.message : String(indexError));
    } finally {
      setRebuilding(false);
    }
  };

  const persistManagedState = async <T,>(
    next: T,
    persist: (value: T) => Promise<void>,
    apply: (value: T) => void,
  ): Promise<boolean> => {
    setError(null);
    try {
      await persist(next);
      apply(next);
      return true;
    } catch (persistError) {
      setError(persistError instanceof Error ? persistError.message : String(persistError));
      return false;
    }
  };

  /** 删除前的统一确认。规则 / 技能 / 智能体的内容删掉就找不回来了，必须拦一道。 */
  const confirmDelete = (title: string, message: string, onConfirm: () => void) => {
    Alert.alert(title, message, [
      { text: "取消", style: "cancel" },
      { text: "删除", style: "destructive", onPress: onConfirm },
    ]);
  };

  // —— 编辑（以前只能删除后重新录入，改一个字要重输全文）——
  const startEditRule = (rule: AgentRule) => {
    setRuleName(rule.name);
    setRuleContent(rule.content);
    setEditingRuleId(rule.id);
  };

  const cancelEditRule = () => {
    setEditingRuleId(null);
    setRuleName("");
    setRuleContent("");
  };

  const saveRuleEdit = async () => {
    if (!editingRuleId || !ruleName.trim() || !ruleContent.trim()) return;
    const next = rules.map((item) => item.id === editingRuleId
      ? { ...item, name: ruleName.trim(), content: ruleContent.trim() }
      : item);
    if (!await persistManagedState(next, saveAgentRules, setRules)) return;
    cancelEditRule();
  };

  const startEditSkill = (skill: AgentSkill) => {
    setSkillName(skill.name);
    setSkillDescription(skill.description);
    setSkillInstructions(skill.instructions);
    setEditingSkillId(skill.id);
  };

  const cancelEditSkill = () => {
    setEditingSkillId(null);
    setSkillName("");
    setSkillDescription("");
    setSkillInstructions("");
  };

  const saveSkillEdit = async () => {
    if (!editingSkillId || !skillName.trim() || !skillInstructions.trim()) return;
    const next = skills.map((item) => item.id === editingSkillId
      ? { ...item, name: skillName.trim(), description: skillDescription.trim(), instructions: skillInstructions.trim() }
      : item);
    if (!await persistManagedState(next, saveAgentSkills, setSkills)) return;
    cancelEditSkill();
  };

  const startEditAgent = (agent: AgentDefinition) => {
    setAgentName(agent.name);
    setAgentDescription(agent.description);
    setAgentPrompt(agent.systemPrompt);
    setAgentModelId(agent.modelId);
    setEditingAgentId(agent.id);
  };

  const cancelEditAgent = () => {
    setEditingAgentId(null);
    setAgentName("");
    setAgentDescription("");
    setAgentPrompt("");
    setAgentModelId("");
  };

  const saveAgentEdit = async () => {
    if (!editingAgentId || !agentName.trim() || !agentPrompt.trim()) return;
    const next = agents.map((item) => item.id === editingAgentId
      ? { ...item, name: agentName.trim(), description: agentDescription.trim(), systemPrompt: agentPrompt.trim(), modelId: agentModelId }
      : item);
    if (!await persistManagedState(next, saveAgentDefinitions, setAgents)) return;
    cancelEditAgent();
  };

  const addRule = async () => {
    if (!ruleName.trim() || !ruleContent.trim()) return;
    const next = [...rules, { id: createId(), name: ruleName.trim(), content: ruleContent.trim(), enabled: true }];
    if (!await persistManagedState(next, saveAgentRules, setRules)) return;
    setRuleName("");
    setRuleContent("");
  };

  const addSkill = async () => {
    if (!skillName.trim() || !skillInstructions.trim()) return;
    const skill: AgentSkill = {
      id: createId(),
      name: skillName.trim(),
      description: skillDescription.trim(),
      instructions: skillInstructions.trim(),
      enabled: true,
      source: "custom",
    };
    const next = [...skills, skill];
    if (!await persistManagedState(next, saveAgentSkills, setSkills)) return;
    setSkillName("");
    setSkillDescription("");
    setSkillInstructions("");
  };

  const addAgent = async () => {
    if (!agentName.trim() || !agentPrompt.trim()) return;
    const agent: AgentDefinition = {
      id: createId(),
      name: agentName.trim(),
      description: agentDescription.trim(),
      systemPrompt: agentPrompt.trim(),
      modelId: agentModelId,
      enabled: true,
      kind: "primary",
      skillIds: skills.filter((skill) => skill.enabled).map((skill) => skill.id),
      toolNames: TOOL_CATALOG.map((tool) => tool.key),
      delegatableAgentIds: agents.filter((agent) => agent.enabled && agent.kind === "subagent").map((agent) => agent.id),
      source: "custom",
    };
    const next = [...agents, agent];
    if (!await persistManagedState(next, saveAgentDefinitions, setAgents)) return;
    setAgentName("");
    setAgentDescription("");
    setAgentPrompt("");
    setAgentModelId("");
  };

  /** 直接设定某个工具的权限（取代原来的「点一下循环切换」）。 */
  const setPermission = async (key: string, mode: ToolPermissionMode) => {
    await persistManagedState({ ...permissions, [key]: mode }, saveToolPermissions, setPermissions);
  };

  /** 批量设定全部工具权限。 */
  const setAllPermissions = async (mode: ToolPermissionMode) => {
    const next: Record<string, ToolPermissionMode> = {};
    for (const tool of TOOL_CATALOG) next[tool.key] = mode;
    await persistManagedState(next, saveToolPermissions, setPermissions);
  };

  const selectAgent = async (agent: AgentDefinition) => {
    if (!agent.enabled || agent.kind !== "primary") return;
    try {
      await setSetting("agent.activeDefinitionId", agent.id);
      setActiveAgentId(agent.id);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : String(selectError));
    }
  };

  const toggleAgent = async (agentId: string, enabled: boolean) => {
    const next = agents.map((agent) => agent.id === agentId ? { ...agent, enabled } : agent);
    try {
      await saveAgentDefinitions(next);
      setAgents(next);
      if (!enabled && activeAgentId === agentId) {
        const fallback = next.find((agent) => agent.enabled && agent.kind === "primary");
        const fallbackId = fallback?.id ?? "";
        await setSetting("agent.activeDefinitionId", fallbackId);
        setActiveAgentId(fallbackId);
      }
    } catch (toggleError) {
      setError(toggleError instanceof Error ? toggleError.message : String(toggleError));
    }
  };

  const removeAgent = async (agentId: string) => {
    const next = agents.filter((agent) => agent.id !== agentId || agent.source === "builtin");
    try {
      await saveAgentDefinitions(next);
      setAgents(next);
      if (activeAgentId === agentId) {
        const fallback = next.find((agent) => agent.enabled && agent.kind === "primary");
        const fallbackId = fallback?.id ?? "";
        await setSetting("agent.activeDefinitionId", fallbackId);
        setActiveAgentId(fallbackId);
      }
    } catch (removeError) {
      setError(removeError instanceof Error ? removeError.message : String(removeError));
    }
  };

  const reloadOhStoryCatalog = async () => {
    const [nextState, nextSkills, nextAgents] = await Promise.all([
      getOhStoryUpdateState(),
      getAgentSkills(),
      getAgentDefinitions(),
    ]);
    setOhStoryState(nextState);
    setSkills(nextSkills);
    setAgents(nextAgents);
    refreshData();
  };

  const checkOhStory = async () => {
    setOhStoryBusy(true);
    setError(null);
    setOhStoryProgress("正在检查 GitHub Release…");
    try {
      const release = await checkOhStoryRelease();
      setOhStoryState((current) => ({ ...current, lastCheck: release }));
      const hasUpdate = !ohStoryState.installed
        || compareOhStoryVersions(release.version, ohStoryState.installed.version) > 0;
      const sourceChanged = Boolean(
        (ohStoryState.installed?.commitSha ?? ohStoryState.installed?.treeSha)
        && compareOhStoryVersions(release.version, ohStoryState.installed.version) === 0
        && release.commitSha !== (ohStoryState.installed.commitSha ?? ohStoryState.installed.treeSha),
      );
      setOhStoryProgress(sourceChanged
        ? `${release.version} 的源码修订已变化，已阻止同版本静默覆盖`
        : hasUpdate ? `发现 ${release.version}` : `已是最新版本 ${release.version}`);
    } catch (checkError) {
      setError(checkError instanceof Error ? checkError.message : String(checkError));
      setOhStoryProgress("");
    } finally {
      setOhStoryBusy(false);
    }
  };

  const installOhStory = async (release: OhStoryRelease) => {
    setOhStoryBusy(true);
    setError(null);
    setOhStoryProgress(`准备更新到 ${release.version}`);
    try {
      const installed = await installOhStoryRelease(release, ({ completed, total }) => {
        setOhStoryProgress(`下载并校验 ${completed}/${total}`);
      });
      await reloadOhStoryCatalog();
      setOhStoryProgress(`已安装 ${installed.version}`);
    } catch (installError) {
      setError(installError instanceof Error ? installError.message : String(installError));
    } finally {
      setOhStoryBusy(false);
    }
  };

  const confirmOhStoryInstall = (release: OhStoryRelease) => {
    Alert.alert(
      "更新 oh-story 内容包",
      `将安装 ${release.version} 的 7 个 Skill 和 6 个移动端兼容子智能体。只导入 Markdown，不执行脚本或 Hook。`,
      [
        { text: "取消", style: "cancel" },
        { text: "更新", onPress: () => void installOhStory(release) },
      ],
    );
  };

  const confirmOhStoryRollback = () => {
    const previous = ohStoryState.previous;
    if (!previous) return;
    Alert.alert("回滚 oh-story 内容包", `恢复到 ${previous.version}？当前版本会保留为可回滚版本。`, [
      { text: "取消", style: "cancel" },
      {
        text: "回滚",
        onPress: () => {
          setOhStoryBusy(true);
          setError(null);
          void rollbackOhStoryPackage()
            .then(async (restored) => {
              await reloadOhStoryCatalog();
              setOhStoryProgress(`已恢复 ${restored.version}`);
            })
            .catch((rollbackError) => setError(rollbackError instanceof Error ? rollbackError.message : String(rollbackError)))
            .finally(() => setOhStoryBusy(false));
        },
      },
    ]);
  };

  const ohStoryUpdateAvailable = Boolean(
    ohStoryState.lastCheck
    && (!ohStoryState.installed
      || compareOhStoryVersions(ohStoryState.lastCheck.version, ohStoryState.installed.version) > 0),
  );

  if (loading) return <Screen><Header title={TITLES[category]} onBack={onBack} /><View style={styles.loading}><ActivityIndicator color={colors.primary} /></View></Screen>;

  return (
    <Screen scroll>
      <Header title={TITLES[category]} onBack={onBack} />
      {error ? <View style={styles.errorWrap}><ErrorNotice message={error} onRetry={() => void load()} /></View> : null}
      {notice ? <View style={styles.noticeWrap}><Text style={styles.noticeText}>{notice}</Text></View> : null}
      {category === "general" ? (
        <View style={styles.section}>
          <Field label="自动保存延迟（毫秒）" value={autoSaveDelay} onChangeText={setAutoSaveDelay} onBlur={() => void savePreference("general.autoSaveDelay", autoSaveDelay, setAutoSaveDelay)} keyboardType="number-pad" />
          <Text style={styles.sectionHint}>可填 250 ~ 10000。数值越大写入频率越低，数值越小保存越及时。</Text>
          <SettingRow label="数据位置" value="本机 SQLite · API Key 使用 SecureStore" />
          <Button label="恢复默认" variant="secondary" onPress={() => restoreDefaults("通用", [
            { key: "general.autoSaveDelay", value: "1000" },
          ])} />
        </View>
      ) : null}
      {category === "editor" ? (
        <View style={styles.section}>
          <Field
            label={`正文字号（可填 ${MIN_EDITOR_FONT_SIZE} ~ ${MAX_EDITOR_FONT_SIZE}）`}
            value={editorFontSize}
            onChangeText={setEditorFontSize}
            onBlur={() => {
              const normalized = normalizeEditorFontSize(editorFontSize);
              setEditorFontSize(String(normalized));
              void savePreference(EDITOR_FONT_SIZE_KEY, String(normalized));
            }}
            keyboardType="number-pad"
          />
          <Text style={styles.sectionHint}>行距按字号自动换算。</Text>
          <Text style={styles.subsectionTitle}>正文字体</Text>
          <View style={styles.modelChoices}>
            {EDITOR_FONT_OPTIONS.map((option) => (
              <Pressable
                key={option.id}
                onPress={() => {
                  setEditorFontId(option.id);
                  void savePreference(EDITOR_FONT_KEY, option.id);
                }}
                style={[styles.modelChoice, editorFontId === option.id && styles.modelChoiceActive]}
              >
                <Text style={styles.modelChoiceText}>{option.label}</Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.sectionHint}>
            {EDITOR_FONT_OPTIONS.find((option) => option.id === editorFontId)?.hint}
          </Text>
          <Text style={styles.previewSample}>她推开那扇门，院子里落着一地月光。</Text>
        </View>
      ) : null}
      {category === "connections" ? (
        <View style={styles.section}>
          <Field label="模型请求超时（毫秒）" value={requestTimeout} onChangeText={setRequestTimeout} onBlur={() => void savePreference("connections.requestTimeout", requestTimeout, setRequestTimeout)} keyboardType="number-pad" />
          <Text style={styles.sectionHint}>请求超过这个时间仍未返回即判定失败。</Text>
          <SettingRow label="供应商和模型" value="在“模型”分类中管理" />
          <SettingRow label="网络边界" value="只有调用用户配置的模型 API 时联网；作品数据保存在本机" />
          <Button label="恢复默认" variant="secondary" onPress={() => restoreDefaults("连接", [
            { key: "connections.requestTimeout", value: "120000" },
          ])} />
        </View>
      ) : null}
      {category === "index" ? (
        <View style={styles.section}>
          <Text style={styles.sectionHint}>将稿件切分为片段并转换为向量存储，用于语义检索。</Text>
          <ToggleRow label="启用本地语义索引" value={indexSettings.enabled} onChange={(value) => void saveIndex({ ...indexSettings, enabled: value })} />
          <ToggleRow label="用重排模型再排一次结果" value={indexSettings.rerankEnabled} onChange={(value) => void saveIndex({ ...indexSettings, rerankEnabled: value })} />
          <Text style={styles.sectionHint}>启用重排可提升结果准确度，但需要下载重排模型（约 209 MB）。</Text>
          <Field label="切分片段大小（字符）" value={indexDraft.chunkSize} onChangeText={(value) => setIndexDraft({ ...indexDraft, chunkSize: value })} onBlur={() => void commitIndexNumber("chunkSize")} keyboardType="number-pad" />
          <Field label="相邻片段重叠（字符）" value={indexDraft.chunkOverlap} onChangeText={(value) => setIndexDraft({ ...indexDraft, chunkOverlap: value })} onBlur={() => void commitIndexNumber("chunkOverlap")} keyboardType="number-pad" />
          <Field label="检索召回条数" value={indexDraft.retrievalTopK} onChangeText={(value) => setIndexDraft({ ...indexDraft, retrievalTopK: value })} onBlur={() => void commitIndexNumber("retrievalTopK")} keyboardType="number-pad" />
          <Field label="精排输出条数" value={indexDraft.rerankTopK} onChangeText={(value) => setIndexDraft({ ...indexDraft, rerankTopK: value })} onBlur={() => void commitIndexNumber("rerankTopK")} keyboardType="number-pad" />
          <Text style={styles.sectionHint}>片段越大上下文越完整；重叠用于避免语义在切分处被截断。</Text>
          <Text style={styles.statusText}>当前索引：{indexStats.sources} 个资料源 · {indexStats.chunks} 个分块</Text>
          {indexNeedsRebuild ? (
            <Text style={styles.warnText}>参数已修改，需执行「重建索引」后新设置才会对已有内容生效。</Text>
          ) : null}
          <Button label={rebuilding ? "索引中" : "重建当前作品索引"} onPress={() => void rebuildIndex()} disabled={!projectId || rebuilding} loading={rebuilding} />
          {indexProgress ? <Text style={styles.progressText}>{indexProgress}</Text> : null}
          <Button
            label="恢复默认参数"
            variant="secondary"
            onPress={() => {
              Alert.alert(
                "恢复默认参数",
                `切分 ${DEFAULT_INDEX_SETTINGS.chunkSize}、重叠 ${DEFAULT_INDEX_SETTINGS.chunkOverlap}、候选 ${DEFAULT_INDEX_SETTINGS.retrievalTopK}、精选 ${DEFAULT_INDEX_SETTINGS.rerankTopK}。`,
                [
                  { text: "取消", style: "cancel" },
                  { text: "恢复", onPress: () => void saveIndex({ ...DEFAULT_INDEX_SETTINGS }) },
                ],
              );
            }}
          />
        </View>
      ) : null}
      {category === "context" ? (
        <View style={styles.section}>
          <Field label="保留最近消息数" value={historyLimit} onChangeText={setHistoryLimit} onBlur={() => void savePreference("context.historyLimit", historyLimit, setHistoryLimit)} keyboardType="number-pad" />
          <Text style={styles.sectionHint}>决定多少条历史消息参与后续对话，数量越大上下文越长。</Text>
          <ToggleRow label="压缩系统提示词" value={compression} onChange={(value) => {
            setCompression(value);
            void savePreference("context.compressSystemPrompts", String(value), (stored) => setCompression(stored === "true"));
          }} />
          <Button label="恢复默认" variant="secondary" onPress={() => restoreDefaults("上下文", [
            { key: "context.historyLimit", value: "30" },
            { key: "context.compressSystemPrompts", value: "false" },
          ])} />
        </View>
      ) : null}
      {category === "style" ? (
        <View style={styles.section}>
          <SettingRow label="文风书库" value="请从设置菜单重新进入" />
        </View>
      ) : null}
      {category === "agent-tools" ? (
        <View style={styles.section}>
          <Text style={styles.sectionHint}>控制助手能否读写你的内容。设为「每次询问」时，助手调用前会先征求同意。</Text>
          <View style={styles.presetRow}>
            {PERMISSION_MODES.map((mode) => (
              <Pressable key={mode.id} onPress={() => void setAllPermissions(mode.id)} style={styles.presetChip}>
                <Text style={styles.presetChipText}>全部{mode.label}</Text>
              </Pressable>
            ))}
          </View>
          {TOOL_CATALOG.map((tool) => {
            const current = permissions[tool.key] ?? "ask";
            return (
              <View key={tool.key} style={styles.permissionCard}>
                <View style={styles.manageText}>
                  <Text style={styles.settingLabel}>{tool.name}</Text>
                  <Text style={styles.settingValue}>{tool.readonly ? "只读" : "可写入"}</Text>
                </View>
                <View style={styles.modeChoices}>
                  {PERMISSION_MODES.map((mode) => (
                    <Pressable
                      key={mode.id}
                      onPress={() => void setPermission(tool.key, mode.id)}
                      style={[styles.modeChip, current === mode.id && (mode.id === "deny" ? styles.modeChipDeny : styles.modeChipActive)]}
                    >
                      <Text style={[styles.modeChipText, current === mode.id && (mode.id === "deny" ? styles.modeChipTextDeny : styles.modeChipTextActive)]}>
                        {mode.label}
                      </Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            );
          })}
        </View>
      ) : null}
      {category === "rules" ? (
        <View style={styles.section}>
          <Text style={styles.sectionHint}>规则是全书的硬性约束，助手每次生成都会遵守，无需在对话中重复交代。</Text>
          {rules.map((rule) => (
            <View key={rule.id} style={styles.manageRow}>
              <View style={styles.manageText}>
                <Text style={styles.settingLabel}>{rule.name}</Text>
                <Text numberOfLines={3} style={styles.settingValue}>{rule.content}</Text>
              </View>
              <Switch value={rule.enabled} onValueChange={(enabled) => {
                const next = rules.map((item) => item.id === rule.id ? { ...item, enabled } : item);
                void persistManagedState(next, saveAgentRules, setRules);
              }} trackColor={{ false: colors.border, true: colors.primary }} />
              <Pressable accessibilityLabel="编辑规则" onPress={() => startEditRule(rule)} style={styles.iconButton}>
                <Ionicons name="create-outline" size={19} color={colors.textMuted} />
              </Pressable>
              <Pressable accessibilityLabel="删除规则" onPress={() => confirmDelete(
                "删除规则",
                `删除「${rule.name}」？删除后无法恢复。`,
                () => {
                  const next = rules.filter((item) => item.id !== rule.id);
                  void persistManagedState(next, saveAgentRules, setRules);
                },
              )} style={styles.iconButton}><Ionicons name="trash-outline" size={19} color={colors.textMuted} /></Pressable>
            </View>
          ))}
          <Text style={styles.subsectionTitle}>{editingRuleId ? "编辑规则" : "添加规则"}</Text>
          <Field label="规则名称" value={ruleName} onChangeText={setRuleName} />
          <Field label="规则内容" value={ruleContent} onChangeText={setRuleContent} multiline style={styles.multiline} />
          {editingRuleId ? (
            <>
              <Button label="保存修改" onPress={() => void saveRuleEdit()} disabled={!ruleName.trim() || !ruleContent.trim()} />
              <Button label="取消" variant="secondary" onPress={cancelEditRule} />
            </>
          ) : (
            <Button label="添加规则" onPress={() => void addRule()} disabled={!ruleName.trim() || !ruleContent.trim()} />
          )}
        </View>
      ) : null}
      {category === "skills" ? (
        <View style={styles.section}>
          <Text style={styles.sectionHint}>技能是可按需启用的写作方法，助手会在合适的环节调用它，例如改写口吻或处理对话。</Text>
          {skills.map((skill) => (
            <View key={skill.id} style={styles.manageRow}>
              <View style={styles.manageText}>
                <Text style={styles.settingLabel}>{skill.name}</Text>
                <Text numberOfLines={2} style={styles.settingValue}>{skill.description || skill.instructions}</Text>
                <Text style={styles.modelHint}>
                  {skill.source === "builtin" ? "Storyloom 基础包" : skill.source === "plugin" ? "Lorn 文风插件" : skill.source === "remote" ? "oh-story 更新技能" : "自定义技能"} · 按需激活
                </Text>
              </View>
              <Switch value={skill.enabled} onValueChange={(enabled) => {
                const next = skills.map((item) => item.id === skill.id ? { ...item, enabled } : item);
                void persistManagedState(next, saveAgentSkills, setSkills);
              }} trackColor={{ false: colors.border, true: colors.primary }} />
              {skill.source === "custom" ? (
                <>
                  <Pressable accessibilityLabel="编辑技能" onPress={() => startEditSkill(skill)} style={styles.iconButton}>
                    <Ionicons name="create-outline" size={19} color={colors.textMuted} />
                  </Pressable>
                  <Pressable accessibilityLabel="删除技能" onPress={() => confirmDelete(
                  "删除技能",
                  `删除「${skill.name}」？删除后无法恢复。`,
                  () => {
                    const next = skills.filter((item) => item.id !== skill.id);
                    void persistManagedState(next, saveAgentSkills, setSkills);
                  },
                )} style={styles.iconButton}><Ionicons name="trash-outline" size={19} color={colors.textMuted} /></Pressable>
                </>
              ) : <View style={styles.iconButton}><Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} /></View>}
            </View>
          ))}
          <Text style={styles.subsectionTitle}>{editingSkillId ? "编辑技能" : "添加技能"}</Text>
          <Field label="技能名称" value={skillName} onChangeText={setSkillName} />
          <Field label="技能说明" value={skillDescription} onChangeText={setSkillDescription} />
          <Field label="技能指令" value={skillInstructions} onChangeText={setSkillInstructions} multiline style={styles.multiline} />
          {editingSkillId ? (
            <>
              <Button label="保存修改" onPress={() => void saveSkillEdit()} disabled={!skillName.trim() || !skillInstructions.trim()} />
              <Button label="取消" variant="secondary" onPress={cancelEditSkill} />
            </>
          ) : (
            <Button label="添加技能" onPress={() => void addSkill()} disabled={!skillName.trim() || !skillInstructions.trim()} />
          )}
        </View>
      ) : null}
      {category === "agents" ? (
        <View style={styles.section}>
          <Text style={styles.sectionHint}>智能体决定写作的分工与流程：由谁执笔、按什么步骤产出。当前启用的主智能体负责接收你的请求。</Text>
          {agents.map((agent) => (
            <View key={agent.id} style={[styles.manageRow, activeAgentId === agent.id && styles.activeRow]}>
              <View style={styles.manageText}>
                <Text style={styles.settingLabel}>{agent.name}</Text>
                <Text numberOfLines={2} style={styles.settingValue}>{agent.description || agent.systemPrompt}</Text>
                <Text style={styles.modelHint}>
                  {agent.source === "builtin" ? "Storyloom 基础包" : agent.source === "remote" ? "oh-story 更新" : "自定义"} · {agent.kind === "primary" ? "主智能体" : "子智能体"} · {agent.skillIds.length} 个技能
                </Text>
                {agent.modelId ? <Text style={styles.modelHint}>{availableModels.find((model) => model.id === agent.modelId)?.name ?? "模型已删除"}</Text> : null}
              </View>
              <Switch value={agent.enabled} onValueChange={(enabled) => void toggleAgent(agent.id, enabled)} trackColor={{ false: colors.border, true: colors.primary }} />
              {agent.kind === "primary" ? (
                <Pressable accessibilityLabel={`选择 ${agent.name} 主智能体`} disabled={!agent.enabled} onPress={() => void selectAgent(agent)} style={styles.iconButton}>
                  <Ionicons name={activeAgentId === agent.id ? "radio-button-on" : "radio-button-off"} size={21} color={activeAgentId === agent.id ? colors.primary : colors.textMuted} />
                </Pressable>
              ) : <View style={styles.iconButton}><Ionicons name="git-branch-outline" size={20} color={colors.textMuted} /></View>}
              {agent.source === "custom" ? (
                <>
                  <Pressable accessibilityLabel="编辑智能体" onPress={() => startEditAgent(agent)} style={styles.iconButton}>
                    <Ionicons name="create-outline" size={19} color={colors.textMuted} />
                  </Pressable>
                  <Pressable accessibilityLabel="删除智能体" onPress={() => confirmDelete(
                  "删除智能体",
                  `删除「${agent.name}」？它的系统提示词会一起丢失，无法恢复。`,
                  () => void removeAgent(agent.id),
                )} style={styles.iconButton}>
                  <Ionicons name="trash-outline" size={19} color={colors.textMuted} />
                </Pressable>
                </>
              ) : <View style={styles.iconButton}><Ionicons name="lock-closed-outline" size={18} color={colors.textMuted} /></View>}
            </View>
          ))}
          <Text style={styles.subsectionTitle}>{editingAgentId ? "编辑智能体" : "添加智能体"}</Text>
          <Text style={styles.sectionHint}>
            名称用于区分用途；系统提示词写明它的分工、执行步骤与输出要求。若暂无头绪，可先载入示例再按需要修改。
          </Text>
          {!editingAgentId ? (
            <Button label="载入示例" variant="secondary" onPress={fillAgentExample} />
          ) : null}
          <Field label="智能体名称" value={agentName} onChangeText={setAgentName} />
          <Field label="智能体说明" value={agentDescription} onChangeText={setAgentDescription} />
          <Field label="系统提示词" value={agentPrompt} onChangeText={setAgentPrompt} multiline style={styles.multiline} />
          <Text style={styles.sectionHint}>智能体模型</Text>
          <View style={styles.modelChoices}>
            <Pressable onPress={() => setAgentModelId("")} style={[styles.modelChoice, !agentModelId && styles.modelChoiceActive]}>
              <Text style={styles.modelChoiceText}>跟随全局</Text>
            </Pressable>
            {availableModels.map((model) => (
              <Pressable key={model.id} onPress={() => setAgentModelId(model.id)} style={[styles.modelChoice, agentModelId === model.id && styles.modelChoiceActive]}>
                <Text numberOfLines={1} style={styles.modelChoiceText}>{model.name}</Text>
              </Pressable>
            ))}
          </View>
          {editingAgentId ? (
            <>
              <Button label="保存修改" onPress={() => void saveAgentEdit()} disabled={!agentName.trim() || !agentPrompt.trim()} />
              <Button label="取消" variant="secondary" onPress={cancelEditAgent} />
            </>
          ) : (
            <Button label="添加智能体" onPress={() => void addAgent()} disabled={!agentName.trim() || !agentPrompt.trim()} />
          )}
          <View style={styles.subsectionDivider} />
          <Text style={styles.subsectionTitle}>内容包</Text>
          <Text style={styles.sectionHint}>
            把你自己创建的规则、技能与智能体打包成一个 JSON，分享给别的设备或别人；也可以导入他人分享的内容包。内置与远程内容不参与导出。
          </Text>
          <Button
            label={contentPackBusy ? "处理中" : "导出内容包"}
            onPress={() => void exportContentPackFile()}
            disabled={contentPackBusy}
            loading={contentPackBusy}
          />
          <Button
            label="导入内容包"
            variant="secondary"
            onPress={() => void importContentPackFile()}
            disabled={contentPackBusy}
          />
        </View>
      ) : null}
      {category === "advanced" ? (
        <View style={styles.section}>
          <Text style={styles.subsectionTitle}>应用版本</Text>
          <SettingRow label="当前版本" value={CURRENT_APP_VERSION} />
          <SettingRow
            label="最新版本"
            value={appUpdate ? `${appUpdate.latestVersion}${appUpdate.hasUpdate ? "（可更新）" : "（已是最新）"}` : "尚未检查"}
          />
          {appUpdate?.checkedAt ? (
            <SettingRow label="上次检查" value={new Date(appUpdate.checkedAt).toLocaleString()} />
          ) : null}
          <Button
            label={appUpdateBusy ? "检查中" : "检查应用更新"}
            onPress={() => void checkForAppUpdate()}
            disabled={appUpdateBusy}
            loading={appUpdateBusy}
          />
          {appUpdate?.hasUpdate ? (
            <>
              <Button
                label={apkBusy ? "下载中…" : `下载并安装 ${appUpdate.latestVersion}`}
                onPress={() => void downloadAndInstallUpdate()}
                disabled={apkBusy}
                loading={apkBusy}
              />
              {apkProgress ? <Text style={styles.progressText}>{apkProgress}</Text> : null}
              <Text style={styles.sectionHint}>下载失败时会自动尝试国内加速镜像；安装时系统会要求授权「安装未知应用」。</Text>
              <Button
                label="改用浏览器下载"
                variant="secondary"
                onPress={() => void Linking.openURL(appUpdate.releaseUrl)}
              />
            </>
          ) : null}
          <Button
            label="导出诊断报告"
            variant="secondary"
            onPress={() => void exportDiagnostics()}
            disabled={diagnosticsBusy}
            loading={diagnosticsBusy}
          />
          <Text style={styles.sectionHint}>遇到问题时可导出这份报告发给开发者，其中不含 API Key 与稿件内容。</Text>
          <View style={styles.subsectionDivider} />
          <Text style={styles.subsectionTitle}>备份与恢复</Text>
          <Button
            label={backupBusy ? "处理中" : "导出备份"}
            onPress={() => void runBackup()}
            disabled={backupBusy}
            loading={backupBusy}
          />
          <Button
            label="从备份恢复"
            variant="secondary"
            onPress={() => void runRestore()}
            disabled={backupBusy}
          />
          <Text style={styles.sectionHint}>
            备份包含全部作品、章节、笔记、智能体、技能与设置；不包含 API Key（恢复后需重新填写）与可重新下载的内容包资源。恢复会覆盖当前数据。
          </Text>
          {appUpdateError ? <Text style={styles.progressText}>{appUpdateError}</Text> : null}
          {appUpdate?.hasUpdate && appUpdate.notes ? (
            <Text style={styles.updateNotes} numberOfLines={12}>{appUpdate.notes}</Text>
          ) : null}
          <View style={styles.subsectionDivider} />
          <Text style={styles.subsectionTitle}>oh-story 内容包</Text>
          <SettingRow label="本地版本" value={ohStoryState.installed?.version ?? "未安装"} />
          <SettingRow label="最近发现" value={ohStoryState.lastCheck ? `${ohStoryState.lastCheck.version} · ${ohStoryState.lastCheck.commitSha.slice(0, 8)}` : "尚未检查"} />
          {ohStoryState.installed ? (
            <>
              <SettingRow
                label="已安装内容"
                value={`${ohStoryState.installed.skills.length} 个技能 · ${ohStoryState.installed.agents.length} 个子智能体 · ${ohStoryState.installed.sha256.slice(0, 12)}`}
              />
              {ohStoryState.installed.commitSha || ohStoryState.installed.treeSha ? (
                <SettingRow label="源码修订" value={(ohStoryState.installed.commitSha ?? ohStoryState.installed.treeSha ?? "").slice(0, 12)} />
              ) : null}
            </>
          ) : null}
          <Button label={ohStoryBusy ? "处理中" : "检查 GitHub Release"} onPress={() => void checkOhStory()} disabled={ohStoryBusy} loading={ohStoryBusy && ohStoryProgress.includes("检查")} />
          {ohStoryUpdateAvailable && ohStoryState.lastCheck ? (
            <Button label={`更新到 ${ohStoryState.lastCheck.version}`} onPress={() => confirmOhStoryInstall(ohStoryState.lastCheck as OhStoryRelease)} disabled={ohStoryBusy} />
          ) : null}
          {ohStoryState.previous ? (
            <Button label={`回滚到 ${ohStoryState.previous.version}`} variant="secondary" onPress={confirmOhStoryRollback} disabled={ohStoryBusy} />
          ) : null}
          {ohStoryProgress ? <Text style={styles.progressText}>{ohStoryProgress}</Text> : null}
          <View style={styles.subsectionDivider} />
          <Text style={styles.subsectionTitle}>可选内容（不影响基本使用）</Text>
          <Text style={styles.sectionHint}>
            未安装不影响写作与对话，仅影响对应的增强功能；下载时将自动尝试国内镜像。
          </Text>
          <SettingRow
            label="当前加载状态"
            value={`嵌入：${getLocalModelStatus().embeddingLoaded ? "已加载" : "未加载"} · 重排：${getLocalModelStatus().rerankLoaded ? "已加载" : "未加载"}`}
          />
          {OPTIONAL_RESOURCE_DESCRIPTIONS.map((entry) => {
            const item = resourceState?.items.find((candidate) => candidate.id === entry.id);
            const ready = item?.status === "ready";
            return (
              <View key={entry.id} style={styles.resourceCard}>
                <Text style={styles.settingLabel}>{entry.title}</Text>
                <Text style={styles.modelHint}>约 {entry.sizeMb} MB · {ready ? "已安装" : item?.detail ?? "未安装"}</Text>
                <Text style={styles.sectionHint}>{entry.purpose}</Text>
                {ready ? null : (
                  <Button
                    label={resourceBusy ? "处理中" : `下载（约 ${entry.sizeMb} MB）`}
                    variant="secondary"
                    onPress={() => void downloadResources([entry.id])}
                    disabled={resourceBusy}
                  />
                )}
              </View>
            );
          })}
          <Button label={resourceBusy ? "处理中" : "一键补齐全部"} onPress={() => void downloadResources()} disabled={resourceBusy} loading={resourceBusy} />
          {resourceProgress ? <Text style={styles.progressText}>{resourceProgress}</Text> : null}
          <Button label="清除当前作品索引" variant="secondary" onPress={() => {
            if (!projectId) return;
            Alert.alert("清除索引", "只删除索引，不删除章节、角色和世界书数据。", [
              { text: "取消", style: "cancel" },
              { text: "清除", style: "destructive", onPress: () => void clearProjectIndex(projectId).then(() => setIndexStats({ sources: 0, chunks: 0 })) },
            ]);
          }} disabled={!projectId} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  errorWrap: { padding: spacing.lg, paddingBottom: 0 },
  noticeWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
  noticeText: { color: colors.primary, fontSize: 13, fontWeight: "600" },
  warnText: { color: colors.accent, fontSize: 13, lineHeight: 18 },
  section: { gap: spacing.md, padding: spacing.lg },
  subsectionTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  subsectionDivider: { height: StyleSheet.hairlineWidth, marginVertical: spacing.sm, backgroundColor: colors.border },
  sectionHint: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  settingRow: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  settingLabel: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "600" },
  settingValue: { flex: 1, color: colors.textMuted, fontSize: 13, lineHeight: 19, textAlign: "right" },
  permissionRow: { minHeight: 60, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  permissionText: { flex: 1, minWidth: 0 },
  permissionMode: { minWidth: 64, color: colors.primary, fontSize: 13, fontWeight: "700", textAlign: "right" },
  manageRow: { minHeight: 68, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, paddingLeft: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  activeRow: { borderColor: colors.primary, backgroundColor: "#E6F3EF" },
  manageText: { flex: 1, minWidth: 0, gap: spacing.xs },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  multiline: { minHeight: 120 },
  progressText: { color: colors.primary, fontSize: 13 },
  updateNotes: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  statusText: { color: colors.textMuted, fontSize: 13 },
  modelHint: { color: colors.primary, fontSize: 12 },
  modelChoices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  resourceCard: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  permissionCard: { gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  presetChip: { minHeight: 36, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 999 },
  presetChipText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  modeChoices: { flexDirection: "row", gap: spacing.xs },
  modeChip: { flex: 1, minHeight: 34, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  modeChipActive: { borderColor: colors.primary },
  modeChipDeny: { borderColor: colors.danger },
  modeChipText: { color: colors.textMuted, fontSize: 12, fontWeight: "600" },
  modeChipTextActive: { color: colors.primary },
  modeChipTextDeny: { color: colors.danger },
  previewSample: { color: colors.text, fontSize: 15, lineHeight: 24, padding: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  modelChoice: { maxWidth: "100%", minHeight: 40, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm },
  modelChoiceActive: { borderColor: colors.primary, backgroundColor: "#E6F3EF" },
  modelChoiceText: { color: colors.text, fontSize: 13, fontWeight: "600" },
  dangerText: { color: colors.danger },
});
