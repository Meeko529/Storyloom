// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useNavigation } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, BackHandler, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { Button, ErrorNotice, Field, Header, Screen, SheetBackdrop } from "@/components/ui";
import {
  deleteProvider,
  getProviderApiKey,
  getSetting,
  listModels,
  listProviders,
  saveModel,
  saveProvider,
  setSetting,
  dedupeProvidersAndModels,
} from "@/data/repositories";
import { fetchProviderModels, type RemoteModel } from "@/llm/model-catalog";
import { DEFAULT_MAX_OUTPUT_TOKENS, MAX_CONFIGURED_OUTPUT_TOKENS } from "@/llm/limits";
import {
  DEFAULT_PROVIDER_ADVANCED,
  getProviderAdvanced,
  hasCustomAdvanced,
  saveProviderAdvanced,
  type ProviderAdvanced,
} from "@/llm/provider-advanced";
import type { RootStackParamList } from "@/navigation/types";
import { SettingsCategoryScreen, SettingRow, ToggleRow, type SettingsCategory } from "@/screens/settings-category-screen";
import { guessModelCapabilities } from "@/settings/model-capabilities";
import { CONTEXT_WINDOW_KEY } from "@/agent/context-usage";
import { useAppStore } from "@/store/app-store";
import { colors, radius, spacing } from "@/theme";
import type { Model, Provider, ProviderType } from "@/types";
import { FreeModelsScreen } from "@/screens/free-models-screen";

const providerDefaults: Record<ProviderType, { name: string; url: string }> = {
  "openai-compatible": { name: "OpenAI Compatible", url: "https://api.openai.com/v1" },
  "google-genai": { name: "Google Gemini", url: "https://generativelanguage.googleapis.com/v1beta" },
  anthropic: { name: "Anthropic", url: "https://api.anthropic.com/v1" },
};

/**
 * 常用服务商预设：点一下自动填好「显示名称 + Base URL」。
 * 用户只需要去对应站点注册、生成一个 API Key 粘进来即可，不用自己查地址和格式。
 * 这些厂商都提供 OpenAI 兼容接口，所以统一走 openai-compatible 档。
 */
const PROVIDER_PRESETS: Array<{
  id: string;
  label: string;
  name: string;
  url: string;
  modelHint: string;
}> = [
  // 免费额度与免费模型的说明统一由「免费模型」分类页负责，此处只做地址预设。
  { id: "zhipu", label: "智谱", name: "智谱 GLM", url: "https://open.bigmodel.cn/api/paas/v4", modelHint: "glm-4.7-flash" },
  { id: "siliconflow", label: "硅基流动", name: "硅基流动", url: "https://api.siliconflow.cn/v1", modelHint: "Qwen/Qwen2.5-7B-Instruct" },
  { id: "openrouter", label: "OpenRouter", name: "OpenRouter", url: "https://openrouter.ai/api/v1", modelHint: "deepseek/deepseek-chat-v3.1:free" },
  { id: "dashscope", label: "通义千问", name: "阿里云百炼", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", modelHint: "qwen-turbo" },
  { id: "deepseek", label: "DeepSeek", name: "DeepSeek", url: "https://api.deepseek.com/v1", modelHint: "deepseek-chat" },
  { id: "moonshot", label: "Kimi", name: "月之暗面 Kimi", url: "https://api.moonshot.cn/v1", modelHint: "moonshot-v1-8k" },
  { id: "custom", label: "中转站 / 自定义", name: "", url: "", modelHint: "" },
];

/**
 * 设置分组：13 个入口按职能分成 5 组，避免平铺一长串。
 * 入口只显示名称，不写说明——说明统一放在二级页顶部，保持列表一致与清爽。
 */
const settingsGroups: Array<{
  title: string;
  hint?: string;
  items: Array<{
    id: SettingsCategory;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
  }>;
}> = [
  {
    title: "基础",
    items: [
      { id: "editor", label: "编辑器", icon: "text-outline" },
    ],
  },
  {
    title: "连接与模型",
    items: [
      { id: "models", label: "模型", icon: "hardware-chip-outline" },
      { id: "free-models", label: "免费模型", icon: "gift-outline" },
      { id: "model-capabilities", label: "模型能力", icon: "speedometer-outline" },
      { id: "conv-advanced", label: "连接", icon: "link-outline" },
    ],
  },
  {
    title: "创作系统",
    items: [
      { id: "agents", label: "智能体", icon: "git-network-outline" },
      { id: "skills", label: "技能", icon: "flash-outline" },
      { id: "rules", label: "规则", icon: "list-outline" },
      { id: "agent-tools", label: "工具权限", icon: "shield-checkmark-outline" },
      { id: "style", label: "作者文风", icon: "color-wand-outline" },
    ],
  },
  {
    title: "知识",
    items: [
      { id: "index", label: "索引", icon: "layers-outline" },
    ],
  },
  {
    title: "系统",
    items: [
      { id: "advanced", label: "高级", icon: "construct-outline" },
    ],
  },
];

/**
 * 中转站 / 自建网关的兼容设置表单。新建供应商和编辑已有供应商共用这一份。
 */
function AdvancedFields({ value, onChange }: { value: ProviderAdvanced; onChange: (next: ProviderAdvanced) => void }) {
  const toggle = (key: "disableTools" | "useMaxCompletionTokens") => {
    onChange({ ...value, [key]: !value[key] });
  };
  return (
    <View style={styles.advancedGroup}>
      <Field
        label="额外请求头（每行一条「名字: 值」，# 开头是注释）"
        value={value.extraHeaders}
        onChangeText={(text) => onChange({ ...value, extraHeaders: text })}
        placeholder={"HTTP-Referer: https://example.com\nX-Title: Storyloom"}
        autoCapitalize="none"
        autoCorrect={false}
        multiline
      />
      <Field
        label="鉴权请求头名字"
        value={value.authHeader}
        onChangeText={(text) => onChange({ ...value, authHeader: text })}
        placeholder="Authorization"
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field
        label="鉴权前缀（留空＝直接发原始 Key）"
        value={value.authPrefix}
        onChangeText={(text) => onChange({ ...value, authPrefix: text })}
        placeholder="Bearer "
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Pressable onPress={() => toggle("disableTools")} style={[styles.toggleRow, value.disableTools && styles.toggleRowOn]}>
        <Ionicons
          name={value.disableTools ? "checkbox" : "square-outline"}
          size={20}
          color={value.disableTools ? colors.primary : colors.textMuted}
        />
        <Text style={styles.toggleText}>不发送 tools（极少数中转站不支持 function calling 时才需要）</Text>
      </Pressable>
      <Pressable onPress={() => toggle("useMaxCompletionTokens")} style={[styles.toggleRow, value.useMaxCompletionTokens && styles.toggleRowOn]}>
        <Ionicons
          name={value.useMaxCompletionTokens ? "checkbox" : "square-outline"}
          size={20}
          color={value.useMaxCompletionTokens ? colors.primary : colors.textMuted}
        />
        <Text style={styles.toggleText}>用 max_completion_tokens 代替 max_tokens</Text>
      </Pressable>
    </View>
  );
}

export function SettingsScreen() {
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const revision = useAppStore((state) => state.dataRevision);
  const refreshData = useAppStore((state) => state.refreshData);
  const [providers, setProviders] = useState<Provider[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [providerType, setProviderType] = useState<ProviderType>("openai-compatible");
  const [presetId, setPresetId] = useState("custom");
  const [providerName, setProviderName] = useState(providerDefaults["openai-compatible"].name);
  const [baseUrl, setBaseUrl] = useState(providerDefaults["openai-compatible"].url);
  const [apiKey, setApiKey] = useState("");
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [modelName, setModelName] = useState("");
  const [supportsTools, setSupportsTools] = useState(true);
  const [supportsVision, setSupportsVision] = useState(false);
  // 用户手动改过开关后，就不再按模型名自动覆盖，避免输入模型 ID 时把用户的判断冲掉
  const [capabilityTouched, setCapabilityTouched] = useState(false);
  const [modelId, setModelId] = useState("");
  const [temperature, setTemperature] = useState("0.8");
  const [maxTokens, setMaxTokens] = useState(String(DEFAULT_MAX_OUTPUT_TOKENS));
  const [saving, setSaving] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [fetchingProviderId, setFetchingProviderId] = useState<string | null>(null);
  const [modelsView, setModelsView] = useState<"home" | "addProvider">("home");
  const [addStep, setAddStep] = useState(1);
  const [convSheetModel, setConvSheetModel] = useState<Model | null>(null);
  const [convScope, setConvScope] = useState<"model" | "global">("model");
  const [convHistory, setConvHistory] = useState("30");
  const [convWindow, setConvWindow] = useState("32768");
  const [convCompress, setConvCompress] = useState(false);
  const [capExpandedId, setCapExpandedId] = useState<string | null>(null);
  const [capDraft, setCapDraft] = useState({ temperature: "0.8", maxTokens: "4096", supportsTools: true, supportsVision: false });
  const [requestTimeout, setRequestTimeout] = useState("60000");
  const [modelPickerProvider, setModelPickerProvider] = useState<Provider | null>(null);
  const [remoteModels, setRemoteModels] = useState<RemoteModel[]>([]);
  const [modelFilter, setModelFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<SettingsCategory | null>(null);
  const [newAdvanced, setNewAdvanced] = useState<ProviderAdvanced>({ ...DEFAULT_PROVIDER_ADVANCED });
  const [showNewAdvanced, setShowNewAdvanced] = useState(false);
  const [advancedTarget, setAdvancedTarget] = useState<Provider | null>(null);
  const [advancedDraft, setAdvancedDraft] = useState<ProviderAdvanced>({ ...DEFAULT_PROVIDER_ADVANCED });
  const [advancedFlags, setAdvancedFlags] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setError(null);
    try {
      const [nextProviders, nextModels, selected] = await Promise.all([listProviders(), listModels(), getSetting("activeModelId")]);
      setProviders(nextProviders);
      setModels(nextModels);
      const validSelected = selected && nextModels.some((model) => model.id === selected) ? selected : null;
      setActiveModelId(validSelected);
      setSelectedProviderId((current) => current && nextProviders.some((provider) => provider.id === current)
        ? current
        : nextProviders[0]?.id ?? "");
      if (selected && !validSelected) await setSetting("activeModelId", "");
      const flags = await Promise.all(nextProviders.map(async (provider) => [
        provider.id,
        hasCustomAdvanced(await getProviderAdvanced(provider.id)),
      ] as const));
      setAdvancedFlags(Object.fromEntries(flags));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load, revision]));

  const modelsByProvider = useMemo(() => new Map(providers.map((provider) => [
    provider.id,
    models.filter((model) => model.providerId === provider.id),
  ])), [providers, models]);

  const provNameOf = (id: string) => providers.find((p) => p.id === id)?.name ?? "?";
  const toastSafe = (msg: string) => Alert.alert(msg);

  const chooseType = (type: ProviderType) => {
    setProviderType(type);
    setProviderName(providerDefaults[type].name);
    setBaseUrl(providerDefaults[type].url);
    setPresetId("custom");
    setNewAdvanced({ ...DEFAULT_PROVIDER_ADVANCED });
    setShowNewAdvanced(false);
  };

  /** 套用常用服务商预设：自动填好类型、名称与地址，用户只需粘贴 API Key。 */
  const applyPreset = (preset: (typeof PROVIDER_PRESETS)[number]) => {
    setPresetId(preset.id);
    setProviderType("openai-compatible");
    setProviderName(preset.name);
    setBaseUrl(preset.url);
    setNewAdvanced({ ...DEFAULT_PROVIDER_ADVANCED });
    setShowNewAdvanced(false);
  };

  const activePreset = PROVIDER_PRESETS.find((item) => item.id === presetId) ?? null;

  /** 按模型名推测能力；用户手动改过开关后不再自动覆盖。 */
  const capabilityGuess = useMemo(() => guessModelCapabilities(modelId), [modelId]);

  const applyCapabilityGuess = (value: string) => {
    const guess = guessModelCapabilities(value);
    setSupportsTools(guess.supportsTools);
    setSupportsVision(guess.supportsVision);
    setCapabilityTouched(false);
  };

  const handleModelIdChange = (value: string) => {
    setModelId(value);
    if (!capabilityTouched) {
      const guess = guessModelCapabilities(value);
      setSupportsTools(guess.supportsTools);
      setSupportsVision(guess.supportsVision);
    }
  };

  const addProvider = async () => {
    if (!providerName.trim() || !baseUrl.trim() || !apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const provider = await saveProvider({ name: providerName, type: providerType, baseUrl, apiKey });
      const customized = hasCustomAdvanced(newAdvanced);
      if (customized) await saveProviderAdvanced(provider.id, newAdvanced);
      setAdvancedFlags((current) => ({ ...current, [provider.id]: customized }));
      setNewAdvanced({ ...DEFAULT_PROVIDER_ADVANCED });
      setShowNewAdvanced(false);
      setApiKey("");
      setSelectedProviderId(provider.id);
      refreshData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally { setSaving(false); }
  };

  const addModel = async () => {
    if (!selectedProviderId || !modelName.trim() || !modelId.trim()) return;
    const parsedTemperature = Number(temperature);
    const parsedMaxTokens = Number(maxTokens);
    if (!Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2) {
      setError("温度必须在 0 到 2 之间");
      return;
    }
    if (!Number.isInteger(parsedMaxTokens) || parsedMaxTokens < 1 || parsedMaxTokens > MAX_CONFIGURED_OUTPUT_TOKENS) {
      setError(`最大输出 Token 数必须在 1 到 ${MAX_CONFIGURED_OUTPUT_TOKENS} 之间；1M 通常是上下文窗口，不需要填写 1000000`);
      return;
    }
    setSavingModel(true);
    setError(null);
    try {
      const model = await saveModel({
        providerId: selectedProviderId,
        name: modelName,
        modelId,
        temperature: parsedTemperature,
        maxTokens: parsedMaxTokens,
        supportsTools,
        supportsVision,
      });
      if (!activeModelId) {
        await setSetting("activeModelId", model.id);
        setActiveModelId(model.id);
      }
      setModelName("");
      setModelId("");
      refreshData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSavingModel(false);
    }
  };

  const openAdvancedEditor = async (provider: Provider) => {
    setAdvancedTarget(provider);
    setAdvancedDraft(await getProviderAdvanced(provider.id));
  };

  const saveAdvancedEditor = async () => {
    if (!advancedTarget) return;
    try {
      await saveProviderAdvanced(advancedTarget.id, advancedDraft);
      setAdvancedFlags((current) => ({ ...current, [advancedTarget.id]: hasCustomAdvanced(advancedDraft) }));
      setAdvancedTarget(null);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    }
  };

  const removeProvider = async (provider: Provider) => {
    try {
      await deleteProvider(provider);
      refreshData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const openConvSheet = async (model: Model) => {
    setConvSheetModel(model);
    setConvScope("model");
    try {
      const overrideRaw = await getSetting(`context.override.${model.id}`);
      let historyValue = "";
      let windowValue = "";
      let compressValue = false;
      if (overrideRaw) {
        try {
          const parsed = JSON.parse(overrideRaw) as { historyLimit?: number; windowTokens?: number };
          if (parsed?.historyLimit) historyValue = String(parsed.historyLimit);
          if (parsed?.windowTokens) windowValue = String(parsed.windowTokens);
        } catch {}
      }
      const [globalHistory, globalWindow, globalCompress] = await Promise.all([
        getSetting("context.historyLimit"),
        getSetting(CONTEXT_WINDOW_KEY),
        getSetting("context.compressSystemPrompts"),
      ]);
      if (!historyValue) historyValue = globalHistory ?? "30";
      if (!windowValue) windowValue = globalWindow ?? "32768";
      compressValue = globalCompress === "true";
      setConvHistory(historyValue);
      setConvWindow(windowValue);
      setConvCompress(compressValue);
    } catch {
      setConvHistory("30"); setConvWindow("32768"); setConvCompress(false);
    }
  };

  const selectModel = async (model: Model) => {
    try {
      await setSetting("activeModelId", model.id);
      setActiveModelId(model.id);
      refreshData();
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : String(selectError));
    }
  };

  const fetchRemoteModels = async (provider: Provider) => {
    setFetchingProviderId(provider.id);
    setError(null);
    try {
      const key = await getProviderApiKey(provider);
      const fetched = await fetchProviderModels(provider, key);
      if (!fetched.length) throw new Error("供应商没有返回可用于生成内容的模型");
      setRemoteModels(fetched);
      setModelFilter("");
      setModelPickerProvider(provider);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
    } finally {
      setFetchingProviderId(null);
    }
  };

  const chooseRemoteModel = (model: RemoteModel) => {
    if (!modelPickerProvider) return;
    setSelectedProviderId(modelPickerProvider.id);
    setModelName(model.name);
    setModelId(model.id);
    setModelFilter("");
    setModelPickerProvider(null);
  };

  // 中转站常常返回几百个模型，按名称和 ID 做不区分大小写的子串过滤。
  const filteredRemoteModels = useMemo(() => {
    const keyword = modelFilter.trim().toLowerCase();
    if (!keyword) return remoteModels;
    return remoteModels.filter((model) => model.name.toLowerCase().includes(keyword)
      || model.id.toLowerCase().includes(keyword));
  }, [modelFilter, remoteModels]);

  // 「作者文风」有独立页面。之前它只是分类页里的一句空壳提示 —— 点了没有任何反应。
  useEffect(() => {
    if (activeCategory !== "style") return;
    setActiveCategory(null);
    rootNavigation.navigate("StyleLibrary");
  }, [activeCategory, rootNavigation]);

  // 离开设置页时收起分类：这样从其它标签页切回设置，看到的是总面板，而不是上次停留的子页。
  useFocusEffect(useCallback(() => () => setActiveCategory(null), []));

  // Android 返回键：在子页时先回到总面板，而不是直接退出应用或跳到别处。
  useEffect(() => {
    if (!activeCategory) return;
    const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
      setActiveCategory(null);
      return true; // 已处理，阻止默认行为
    });
    return () => subscription.remove();
  }, [activeCategory]);

  if (activeCategory === "free-models") {
    return <FreeModelsScreen onBack={() => setActiveCategory(null)} />;
  }

  if (activeCategory === "model-capabilities") {
    return (
      <Screen scroll>
        <Header title="模型能力" onBack={() => setActiveCategory(null)} />
        {models.map((model) => (
          <View key={model.id} style={styles.providerBlock}>
            <Pressable onPress={() => {
              if (capExpandedId === model.id) { setCapExpandedId(null); return; }
              setCapExpandedId(model.id);
              setCapDraft({ temperature: String(model.temperature), maxTokens: String(model.maxTokens), supportsTools: model.supportsTools, supportsVision: model.supportsVision });
            }} style={styles.providerHeader}>
              <View style={styles.providerInfo}>
                <Text style={styles.providerName}>{model.name}</Text>
                <Text style={styles.providerUrl}>{provNameOf(model.providerId)} · {model.modelId}</Text>
              </View>
              <Ionicons name={capExpandedId === model.id ? "chevron-down" : "chevron-forward"} size={18} color={colors.textMuted} />
            </Pressable>
            {capExpandedId === model.id ? (
              <View style={styles.capExpand}>
                <Field label="温度（0 ~ 2，越大越发散；小说创作建议 0.7 ~ 0.9）" value={capDraft.temperature} onChangeText={(v) => setCapDraft({ ...capDraft, temperature: v })} keyboardType="decimal-pad" />
                <Field label={`最大输出 Token 数（1 ~ ${MAX_CONFIGURED_OUTPUT_TOKENS}）`} value={capDraft.maxTokens} onChangeText={(v) => setCapDraft({ ...capDraft, maxTokens: v })} keyboardType="number-pad" />
                <Text style={styles.fieldHint}>单次回复长度，不是上下文窗口；1M 上下文模型保持 {DEFAULT_MAX_OUTPUT_TOKENS} 或按需填写。</Text>
                <ToggleRow label="支持工具调用" value={capDraft.supportsTools} onChange={(value) => setCapDraft({ ...capDraft, supportsTools: value })} />
                <Text style={styles.fieldHint}>关闭后助手只能对话，无法读取或写入作品内容。</Text>
                <ToggleRow label="支持图片输入" value={capDraft.supportsVision} onChange={(value) => setCapDraft({ ...capDraft, supportsVision: value })} />
                <Text style={styles.fieldHint}>当前判断依据：{guessModelCapabilities(model.modelId).reason}</Text>
                <View style={{ marginTop: spacing.sm }}>
                <Button label="按模型名重新推测" variant="secondary" onPress={() => {
                  const guess = guessModelCapabilities(model.modelId);
                  setCapDraft({ ...capDraft, supportsTools: guess.supportsTools, supportsVision: guess.supportsVision });
                }} />
                </View>
                <View style={{ marginTop: spacing.sm }}>
                <Button label="保存" onPress={() => {
                  const parsedTemperature = Number(capDraft.temperature);
                  const parsedMaxTokens = Number(capDraft.maxTokens);
                  if (!Number.isFinite(parsedTemperature) || parsedTemperature < 0 || parsedTemperature > 2) { setError("温度必须在 0 到 2 之间"); return; }
                  if (!Number.isInteger(parsedMaxTokens) || parsedMaxTokens < 1 || parsedMaxTokens > MAX_CONFIGURED_OUTPUT_TOKENS) { setError(`最大输出 Token 数必须在 1 到 ${MAX_CONFIGURED_OUTPUT_TOKENS} 之间`); return; }
                  void saveModel({ ...model, temperature: parsedTemperature, maxTokens: parsedMaxTokens, supportsTools: capDraft.supportsTools, supportsVision: capDraft.supportsVision })
                    .then(() => { refreshData(); toastSafe("已保存「" + model.name + "」"); })
                    .catch((saveError) => setError(saveError instanceof Error ? saveError.message : String(saveError)));
                }} loading={savingModel} />
                </View>
              </View>
            ) : null}
          </View>
        ))}
        {error ? <View style={styles.errorWrap}><ErrorNotice message={error} onRetry={() => void load()} /></View> : null}
        <View style={{ height: spacing.md }} />
      </Screen>
    );
  }

  if (activeCategory === "conv-advanced") {
    return (
      <Screen scroll>
        <Header title="连接与高级" onBack={() => setActiveCategory(null)} />
        <View style={styles.section}>
          <Field label="模型请求超时（毫秒）" value={requestTimeout} onChangeText={setRequestTimeout} onBlur={() => void setSetting("connections.requestTimeout", requestTimeout)} keyboardType="number-pad" />
          <Text style={styles.fieldHint}>请求超过这个时间仍未返回即判定失败。</Text>
        </View>

        {error ? <View style={styles.errorWrap}><ErrorNotice message={error} onRetry={() => void load()} /></View> : null}
        <View style={{ height: spacing.md }} />
      </Screen>
    );
  }

  const defaultModel = models.find((m) => m.id === activeModelId) ?? null;
  if (activeCategory && activeCategory !== "models") {
    return <SettingsCategoryScreen category={activeCategory} onBack={() => setActiveCategory(null)} />;
  }

  if (!activeCategory) {
    return (
      <Screen scroll>
        <Header title="设置" />
        <View style={styles.categoryList}>
        {settingsGroups.map((group) => (
          <View key={group.title}>
            <View style={styles.groupHeader}>
              <Text style={styles.groupTitle}>{group.title}</Text>
              {group.hint ? <Text style={styles.groupHint}>{group.hint}</Text> : null}
            </View>
            {group.items.map((category) => (
              <Pressable
                key={category.id}
                onPress={() => {
                  if (category.id === "style") rootNavigation.navigate("StyleLibrary");
                  else setActiveCategory(category.id);
                }}
                style={({ pressed }) => [styles.categoryRow, pressed && styles.categoryRowPressed]}
              >
                <View style={styles.categoryIcon}><Ionicons name={category.icon} size={21} color={colors.primary} /></View>
                <View style={styles.categoryTextWrap}>
                  <Text style={styles.categoryLabel}>{category.label}</Text>
                </View>
                <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />
              </Pressable>
            ))}
          </View>
        ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header
        title={modelsView === "addProvider" ? "添加供应商" : "模型"}
        onBack={modelsView === "addProvider" ? () => setModelsView("home") : () => setActiveCategory(null)}
        action={
          <View style={styles.providerActions}>
            <Pressable
              accessibilityLabel="清理重复"
              onPress={() => {
                Alert.alert("清理重复", "合并同名供应商并删除重复模型（优先保留有 API Key 的）。", [
                  { text: "取消", style: "cancel" },
                  { text: "清理", style: "destructive", onPress: () => {
                    void dedupeProvidersAndModels()
                      .then((r) => { refreshData(); Alert.alert("清理完成", `合并供应商 ${r.mergedProviders} 个，删除重复模型 ${r.removedModels} 个`); })
                      .catch((cleanError) => setError(cleanError instanceof Error ? cleanError.message : String(cleanError)));
                  } },
                ]);
              }}
              style={styles.fetchButton}
            >
              <Text style={{ color: colors.primary, fontSize: 13, fontWeight: "600" }}>清理重复</Text>
            </Pressable>
            <Pressable accessibilityLabel="添加供应商" onPress={() => { setModelsView("addProvider"); setAddStep(1); }} style={styles.iconButton}>
              <Ionicons name="add" size={24} color={colors.primary} />
            </Pressable>
          </View>
        }
      />
      {error ? <View style={styles.errorWrap}><ErrorNotice message={error} onRetry={() => void load()} /></View> : null}
      {modelsView === "addProvider" ? (
        <View>
          <View style={styles.segmented}>
            {[1, 2, 3].map((step) => (
              <Pressable key={step} onPress={() => setAddStep(step)} style={[styles.segment, addStep === step && styles.segmentActive]}>
                <Text style={[styles.segmentText, addStep === step && styles.segmentTextActive]}>
                  {step === 1 ? "① 供应商" : step === 2 ? "② 高级设置" : "③ 确认"}
                </Text>
              </Pressable>
            ))}
          </View>
          {addStep === 1 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>常用服务商</Text>
              <Text style={styles.fieldHint}>选择常用服务商可自动填入接口地址。</Text>
              <View style={styles.presetRow}>
                {PROVIDER_PRESETS.map((preset) => (
                  <Pressable key={preset.id} onPress={() => applyPreset(preset)} style={[styles.presetChip, presetId === preset.id && styles.presetChipActive]}>
                    <Text style={[styles.presetChipText, presetId === preset.id && styles.presetChipTextActive]}>{preset.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.sectionTitle}>或者手动填</Text>
              <View style={styles.segmented}>
                {(["openai-compatible", "google-genai", "anthropic"] as ProviderType[]).map((type) => (
                  <Pressable key={type} onPress={() => chooseType(type)} style={[styles.segment, providerType === type && styles.segmentActive]}>
                    <Text style={[styles.segmentText, providerType === type && styles.segmentTextActive]}>
                      {type === "openai-compatible" ? "OpenAI" : type === "google-genai" ? "Gemini" : "Anthropic"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.fieldHint}>OpenAI 为通用接口格式，国内多数厂商与中转服务均兼容此格式，并非特指 OpenAI 官方服务。</Text>
              <Field label="显示名称" value={providerName} onChangeText={setProviderName} />
              <Field label="Base URL" value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" keyboardType="url" />
              <Text style={styles.fieldHint}>接口地址填写至 /v1 或 /v4 层级即可，对话路径由程序自动拼接。</Text>
              <Field label="API Key" value={apiKey} onChangeText={setApiKey} autoCapitalize="none" secureTextEntry />
              <Text style={styles.fieldHint}>密钥仅存于系统安全存储，不会写入数据库。</Text>
            </View>
          ) : null}
          {addStep === 2 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>高级设置（中转站 / 自建网关，可跳过）</Text>
              <AdvancedFields value={newAdvanced} onChange={setNewAdvanced} />
              <Button label="跳过，用默认值" variant="secondary" onPress={() => setAddStep(3)} />
            </View>
          ) : null}
          {addStep === 3 ? (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>确认</Text>
              <SettingRow label="显示名称" value={providerName} />
              <SettingRow label="Base URL" value={baseUrl} />
              <SettingRow label="API Key" value={apiKey ? "● 已填写" : "○ 未填写"} />
              <Button label="保存供应商" onPress={() => void addProvider()} disabled={!providerName.trim() || !baseUrl.trim() || !apiKey.trim()} loading={saving} />
              <Text style={styles.fieldHint}>保存后回到模型页，用该供应商行的「获取模型」拉取并勾选要用的模型。</Text>
            </View>
          ) : null}
          <View style={{ height: spacing.md }} />
        </View>
      ) : (
        <View>
          <View style={styles.defaultCard}>
            <Text style={styles.defaultCardLabel}>当前默认模型</Text>
            <Text style={styles.defaultCardName}>{defaultModel ? defaultModel.name : "未选择"}</Text>
            <Text style={styles.defaultCardPro}>{defaultModel ? provNameOf(defaultModel.providerId) + " · 支持 function calling" : "点下方模型行选择默认模型"}</Text>
          </View>
          {providers.map((provider) => (
            <View key={provider.id} style={styles.providerBlock}>
              <View style={styles.providerHeader}>
                <View style={styles.providerInfo}>
                  <Text style={styles.providerName}>{provider.name}</Text>
                  <Text style={styles.providerUrl} numberOfLines={1}>{provider.baseUrl}</Text>
                </View>
                <View style={styles.providerActions}>
                  <Pressable
                    accessibilityLabel="获取模型"
                    disabled={fetchingProviderId !== null}
                    onPress={() => void fetchRemoteModels(provider)}
                    style={styles.fetchButton}
                  >
                    {fetchingProviderId === provider.id
                      ? <ActivityIndicator size="small" color={colors.primary} />
                      : <Ionicons name="cloud-download-outline" size={18} color={colors.primary} />}
                    <Text style={styles.fetchButtonText}>获取模型</Text>
                  </Pressable>
                  <Pressable
                    accessibilityLabel="高级设置"
                    onPress={() => void openAdvancedEditor(provider)}
                    style={styles.iconButton}
                  >
                    <Ionicons
                      name={advancedFlags[provider.id] ? "options" : "options-outline"}
                      size={18}
                      color={advancedFlags[provider.id] ? colors.primary : colors.textMuted}
                    />
                  </Pressable>
                  <Pressable accessibilityLabel="删除供应商" onPress={() => {
                    Alert.alert("删除供应商", `删除 ${provider.name} 及其全部模型？`, [
                      { text: "取消", style: "cancel" },
                      { text: "删除", style: "destructive", onPress: () => void removeProvider(provider) },
                    ]);
                  }} style={styles.iconButton}><Ionicons name="trash-outline" size={20} color={colors.danger} /></Pressable>
                </View>
              </View>
              {(modelsByProvider.get(provider.id) ?? []).map((model) => (
                <Pressable
                  key={model.id}
                  onPress={() => void selectModel(model)}
                  onLongPress={() => void openConvSheet(model)}
                  style={styles.modelRow}
                >
                  <Ionicons name={activeModelId === model.id ? "radio-button-on" : "radio-button-off"} size={20} color={activeModelId === model.id ? colors.primary : colors.textMuted} />
                  <View style={styles.modelText}>
                    <Text style={styles.modelName}>{model.name}</Text>
                    <Text style={styles.modelId}>长按设置该模型的对话参数</Text>
                  </View>
                </Pressable>
              ))}
              <Pressable accessibilityLabel={`为${provider.name}添加模型`} onPress={() => { setSelectedProviderId(provider.id); setModelPickerProvider(provider); }} style={styles.addModelRow}>
                <Ionicons name="add-circle-outline" size={18} color={colors.primary} />
                <Text style={{ color: colors.primary, fontSize: 12.5, fontWeight: "600" }}>添加模型（获取列表勾选或手动输入）</Text>
              </Pressable>
            </View>
          ))}
          <View style={{ height: spacing.md }} />
        </View>
      )}
      <Modal
        visible={convSheetModel !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setConvSheetModel(null)}
      >
        <SheetBackdrop onPress={() => setConvSheetModel(null)}>
          <View style={styles.modelSheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.providerInfo}>
                <Text style={styles.sectionTitle}>对话设置</Text>
                <Text style={styles.providerUrl}>{convSheetModel ? convSheetModel.name : ""}</Text>
              </View>
              <Pressable accessibilityLabel="关闭对话设置" onPress={() => setConvSheetModel(null)} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <View style={styles.segmented}>
              <Pressable onPress={() => setConvScope("model")} style={[styles.segment, convScope === "model" && styles.segmentActive]}>
                <Text style={[styles.segmentText, convScope === "model" && styles.segmentTextActive]}>仅此模型</Text>
              </Pressable>
              <Pressable onPress={() => setConvScope("global")} style={[styles.segment, convScope === "global" && styles.segmentActive]}>
                <Text style={[styles.segmentText, convScope === "global" && styles.segmentTextActive]}>全局默认</Text>
              </Pressable>
            </View>
            <Field label="保留最近消息数（4 ~ 100）" value={convHistory} onChangeText={setConvHistory} keyboardType="number-pad" />
            <Field label="模型上下文窗口（Token，按所用模型填写）" value={convWindow} onChangeText={setConvWindow} keyboardType="number-pad" />
            {convScope === "global" ? (
              <ToggleRow label="压缩系统提示词（全局）" value={convCompress} onChange={(value) => { setConvCompress(value); void setSetting("context.compressSystemPrompts", value ? "true" : "false"); }} />
            ) : (
              <Text style={[styles.fieldHint, { marginTop: spacing.sm, marginBottom: spacing.xs }]}>压缩系统提示词为全局设置；切到「全局默认」可修改。</Text>
            )}
            <View style={styles.btnrow}>
              {convScope === "model" ? (
                <Button label="恢复默认" variant="secondary" onPress={() => {
                  if (!convSheetModel) return;
                  void setSetting(`context.override.${convSheetModel.id}`, "").then(() => {
                    toastSafe("已恢复跟随全局默认");
                    setConvSheetModel(null);
                  });
                }} />
              ) : null}
              <Button label="保存" onPress={() => {
                const parsedHistory = Number(convHistory);
                const parsedWindow = Number(convWindow);
                if (!convSheetModel) return;
                if (convScope === "model") {
                  const override = {
                    historyLimit: Number.isInteger(parsedHistory) && parsedHistory >= 4 && parsedHistory <= 100 ? parsedHistory : null,
                    windowTokens: Number.isInteger(parsedWindow) && parsedWindow > 0 ? parsedWindow : null,
                  };
                  void setSetting(`context.override.${convSheetModel.id}`, JSON.stringify(override)).then(() => {
                    toastSafe("已保存（仅此模型生效）");
                    setConvSheetModel(null);
                  });
                } else {
                  void Promise.all([
                    setSetting("context.historyLimit", String(Number.isInteger(parsedHistory) && parsedHistory >= 4 ? parsedHistory : 30)),
                    setSetting(CONTEXT_WINDOW_KEY, String(Number.isInteger(parsedWindow) && parsedWindow > 0 ? parsedWindow : 32768)),
                  ]).then(() => {
                    toastSafe("已保存（全局默认）");
                    setConvSheetModel(null);
                  });
                }
              }} />
            </View>
          </View>
        </SheetBackdrop>
      </Modal>
      <Modal
        visible={modelPickerProvider !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setModelPickerProvider(null)}
      >
        <SheetBackdrop onPress={() => setModelPickerProvider(null)}>
          <View style={styles.modelSheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.providerInfo}>
                <Text style={styles.sectionTitle}>选择模型</Text>
                <Text style={styles.providerUrl}>
                  {modelFilter.trim()
                    ? `${filteredRemoteModels.length} / ${remoteModels.length} 个模型`
                    : `${remoteModels.length} 个可用模型`}
                </Text>
              </View>
              <Pressable accessibilityLabel="关闭模型列表" onPress={() => setModelPickerProvider(null)} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <View style={styles.modelFilterWrap}>
              <Field
                label="查找模型"
                value={modelFilter}
                onChangeText={setModelFilter}
                placeholder="输入名称或模型 ID 的一部分"
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
            <FlatList
              data={filteredRemoteModels}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={(
                <Text style={styles.modelFilterEmpty}>
                  {remoteModels.length ? `没有匹配“${modelFilter.trim()}”的模型` : "还没有获取到模型列表"}
                </Text>
              )}
              renderItem={({ item }) => (
                <Pressable onPress={() => chooseRemoteModel(item)} style={styles.remoteModelRow}>
                  <View style={styles.modelText}>
                    <Text style={styles.modelName}>{item.name}</Text>
                    <Text style={styles.modelId}>{item.id}</Text>
                  </View>
                  <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
                </Pressable>
              )}
            />
          </View>
        </SheetBackdrop>
      </Modal>

      <Modal
        visible={advancedTarget !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setAdvancedTarget(null)}
      >
        <SheetBackdrop onPress={() => setAdvancedTarget(null)}>
          <View style={styles.modelSheet}>
            <View style={styles.sheetHeader}>
              <View style={styles.providerInfo}>
                <Text style={styles.sectionTitle}>高级设置</Text>
                <Text style={styles.providerUrl}>{advancedTarget ? advancedTarget.name : ""}</Text>
              </View>
              <Pressable accessibilityLabel="关闭高级设置" onPress={() => setAdvancedTarget(null)} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView
              style={styles.advancedSheetBody}
              contentContainerStyle={styles.advancedSheetContent}
              keyboardShouldPersistTaps="handled"
            >
              <AdvancedFields value={advancedDraft} onChange={setAdvancedDraft} />
              <Button label="保存高级设置" onPress={() => void saveAdvancedEditor()} />
            </ScrollView>
          </View>
        </SheetBackdrop>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  categoryList: { paddingVertical: spacing.sm },
  groupHeader: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.xs },
  groupTitle: { color: colors.textMuted, fontSize: 13, fontWeight: "700" },
  groupHint: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  categoryRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  categoryRowPressed: { backgroundColor: colors.surfaceMuted },
  categoryIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: "#E6F3EF" },
  categoryTextWrap: { flex: 1 },
  categoryLabel: { color: colors.text, fontSize: 16, fontWeight: "600" },
  section: { padding: spacing.lg, gap: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  errorWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  sectionTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  segmented: { flexDirection: "row", padding: 3, borderRadius: radius.md, backgroundColor: colors.surfaceMuted },
  segment: { flex: 1, minHeight: 38, alignItems: "center", justifyContent: "center", borderRadius: radius.sm },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  segmentTextActive: { color: colors.primary },
  presetRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  presetChip: { minHeight: 36, justifyContent: "center", paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: 999 },
  presetChipActive: { borderColor: colors.primary, backgroundColor: "#E6F3EF" },
  presetChipText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  presetChipTextActive: { color: colors.primary },
  advancedToggle: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  advancedToggleText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  advancedGroup: { gap: spacing.md },
  advancedSheetBody: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  advancedSheetContent: { gap: spacing.md, paddingBottom: spacing.xl },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm, paddingHorizontal: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  toggleRowOn: { borderColor: colors.primary, backgroundColor: "#E6F3EF" },
  toggleText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  defaultCard: { margin: spacing.md, marginBottom: spacing.sm, backgroundColor: colors.primary, borderRadius: radius.lg, padding: spacing.lg },
  defaultCardLabel: { color: "rgba(255,255,255,0.75)", fontSize: 10, letterSpacing: 1, marginBottom: 4 },
  defaultCardName: { color: "#FFFFFF", fontSize: 19, fontWeight: "800" },
  defaultCardPro: { color: "rgba(255,255,255,0.85)", fontSize: 11, marginTop: 3 },
  addModelRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  btnrow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  providerBlock: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  capExpand: { paddingTop: spacing.sm, paddingBottom: spacing.md, gap: spacing.sm },
  providerHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  providerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  providerInfo: { flex: 1, minWidth: 0, marginRight: spacing.sm },
  providerName: { color: colors.text, fontSize: 16, fontWeight: "700" },
  providerUrl: { color: colors.textMuted, fontSize: 12, marginTop: 3 },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  fetchButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm },
  fetchButtonText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  modelRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md },
  modelText: { flex: 1 },
  modelName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  modelId: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  fieldHint: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: -spacing.sm },
  providerChoices: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  choice: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md },
  choiceActive: { borderColor: colors.primary, backgroundColor: "#E6F3EF" },
  choiceText: { color: colors.textMuted, fontSize: 13 },
  choiceTextActive: { color: colors.primary, fontWeight: "700" },
  modelSheet: { maxHeight: "78%", paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.lg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, backgroundColor: colors.background },
  modelFilterWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  modelFilterEmpty: { padding: spacing.lg, color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  sheetHeader: { minHeight: 64, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  remoteModelRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
