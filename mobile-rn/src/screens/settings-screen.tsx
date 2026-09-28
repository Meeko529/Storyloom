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
import { SettingsCategoryScreen, type SettingsCategory } from "@/screens/settings-category-screen";
import { useAppStore } from "@/store/app-store";
import { colors, radius, spacing } from "@/theme";
import type { Model, Provider, ProviderType } from "@/types";

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
  { id: "zhipu", label: "智谱", name: "智谱 GLM", url: "https://open.bigmodel.cn/api/paas/v4", modelHint: "glm-4.7-flash" },
  { id: "deepseek", label: "DeepSeek", name: "DeepSeek", url: "https://api.deepseek.com/v1", modelHint: "deepseek-chat" },
  { id: "dashscope", label: "通义千问", name: "阿里云百炼", url: "https://dashscope.aliyuncs.com/compatible-mode/v1", modelHint: "qwen-turbo" },
  { id: "siliconflow", label: "硅基流动", name: "硅基流动", url: "https://api.siliconflow.cn/v1", modelHint: "Qwen/Qwen2.5-7B-Instruct" },
  { id: "moonshot", label: "Kimi", name: "月之暗面 Kimi", url: "https://api.moonshot.cn/v1", modelHint: "moonshot-v1-8k" },
  { id: "custom", label: "中转站 / 自定义", name: "", url: "", modelHint: "" },
];

const settingsCategories: Array<{
  id: SettingsCategory;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
}> = [
  { id: "general", label: "通用", icon: "options-outline" },
  { id: "editor", label: "编辑器", icon: "text-outline" },
  { id: "connections", label: "连接", icon: "link-outline" },
  { id: "models", label: "模型与供应商", icon: "hardware-chip-outline" },
  { id: "index", label: "索引", icon: "layers-outline" },
  { id: "context", label: "上下文", icon: "document-text-outline" },
  { id: "style", label: "作者文风", icon: "color-wand-outline" },
  { id: "agent-tools", label: "工具权限", icon: "shield-checkmark-outline" },
  { id: "rules", label: "规则", icon: "list-outline" },
  { id: "skills", label: "技能", icon: "flash-outline" },
  { id: "agents", label: "智能体", icon: "git-network-outline" },
  { id: "advanced", label: "高级", icon: "construct-outline" },
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
  const [modelId, setModelId] = useState("");
  const [temperature, setTemperature] = useState("0.8");
  const [maxTokens, setMaxTokens] = useState(String(DEFAULT_MAX_OUTPUT_TOKENS));
  const [saving, setSaving] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [fetchingProviderId, setFetchingProviderId] = useState<string | null>(null);
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

  if (activeCategory && activeCategory !== "models") {
    return <SettingsCategoryScreen category={activeCategory} onBack={() => setActiveCategory(null)} />;
  }

  if (!activeCategory) {
    return (
      <Screen scroll>
        <Header title="设置" />
        <View style={styles.categoryList}>
          {settingsCategories.map((category) => (
            <Pressable
              key={category.id}
              onPress={() => {
                if (category.id === "style") rootNavigation.navigate("StyleLibrary");
                else setActiveCategory(category.id);
              }}
              style={({ pressed }) => [styles.categoryRow, pressed && styles.categoryRowPressed]}
            >
              <View style={styles.categoryIcon}><Ionicons name={category.icon} size={21} color={colors.primary} /></View>
              <Text style={styles.categoryLabel}>{category.label}</Text>
              <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />
            </Pressable>
          ))}
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <Header title="模型与供应商" onBack={() => setActiveCategory(null)} />
      {error ? <View style={styles.errorWrap}><ErrorNotice message={error} onRetry={() => void load()} /></View> : null}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>供应商</Text>
        <Text style={styles.fieldHint}>选择常用服务商可自动填入接口地址。</Text>
        <View style={styles.presetRow}>
          {PROVIDER_PRESETS.map((preset) => (
            <Pressable
              key={preset.id}
              onPress={() => applyPreset(preset)}
              style={[styles.presetChip, presetId === preset.id && styles.presetChipActive]}
            >
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
        <Button label="保存供应商" onPress={() => void addProvider()} disabled={!providerName.trim() || !baseUrl.trim() || !apiKey.trim()} loading={saving} />
        {providerType === "openai-compatible" ? (
          <>
            <Pressable onPress={() => setShowNewAdvanced((current) => !current)} style={styles.advancedToggle}>
              <Ionicons name={showNewAdvanced ? "chevron-down" : "chevron-forward"} size={17} color={colors.primary} />
              <Text style={styles.advancedToggleText}>高级设置（中转站 / 自建网关）</Text>
            </Pressable>
            {showNewAdvanced ? <AdvancedFields value={newAdvanced} onChange={setNewAdvanced} /> : null}
          </>
        ) : null}
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
                accessibilityLabel="获取模型列表"
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
            <Pressable key={model.id} onPress={() => void selectModel(model)} style={styles.modelRow}>
              <Ionicons name={activeModelId === model.id ? "radio-button-on" : "radio-button-off"} size={20} color={activeModelId === model.id ? colors.primary : colors.textMuted} />
              <View style={styles.modelText}>
                <Text style={styles.modelName}>{model.name}</Text>
                <Text style={styles.modelId}>{model.modelId}</Text>
              </View>
            </Pressable>
          ))}
        </View>
      ))}

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>添加模型</Text>
        <View style={styles.providerChoices}>
          {providers.map((provider) => (
            <Pressable key={provider.id} onPress={() => setSelectedProviderId(provider.id)} style={[styles.choice, selectedProviderId === provider.id && styles.choiceActive]}>
              <Text style={[styles.choiceText, selectedProviderId === provider.id && styles.choiceTextActive]}>{provider.name}</Text>
            </Pressable>
          ))}
        </View>
        <Field label="模型名称（显示用）" value={modelName} onChangeText={setModelName} placeholder="Gemini 2.5 Pro" />
        <Field label="模型 ID（服务商提供的标识）" value={modelId} onChangeText={setModelId} autoCapitalize="none" placeholder={activePreset?.modelHint || "gemini-2.5-pro"} />
        <Text style={styles.fieldHint}>
          需与服务商提供的模型标识完全一致{activePreset?.modelHint ? `，例如 ${activePreset.label} 可填 ${activePreset.modelHint}` : ""}；也可通过上方「获取模型」自动载入。
        </Text>
        <Field label="温度" value={temperature} onChangeText={setTemperature} keyboardType="decimal-pad" />
        <Text style={styles.fieldHint}>取值范围 0 ~ 2，数值越大生成结果越发散；小说创作建议 0.7 ~ 0.9。</Text>
        <Field label="最大输出 Token 数" value={maxTokens} onChangeText={setMaxTokens} keyboardType="number-pad" />
        <Text style={styles.fieldHint}>单次回复长度，不是上下文窗口；1M 上下文模型保持 {DEFAULT_MAX_OUTPUT_TOKENS} 或按需填写，最高 {MAX_CONFIGURED_OUTPUT_TOKENS}。</Text>
        <Button label="添加模型" onPress={() => void addModel()} disabled={!selectedProviderId || !modelName.trim() || !modelId.trim()} loading={savingModel} />
      </View>

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
  categoryRow: { minHeight: 58, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  categoryRowPressed: { backgroundColor: colors.surfaceMuted },
  categoryIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: radius.sm, backgroundColor: "#E6F3EF" },
  categoryLabel: { flex: 1, color: colors.text, fontSize: 16, fontWeight: "600" },
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
  providerBlock: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
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
  modelSheet: { maxHeight: "78%", paddingBottom: spacing.lg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, backgroundColor: colors.background },
  modelFilterWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  modelFilterEmpty: { padding: spacing.lg, color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  sheetHeader: { minHeight: 64, flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  remoteModelRow: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
});
