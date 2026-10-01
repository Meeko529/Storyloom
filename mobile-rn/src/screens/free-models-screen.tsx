// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import { Ionicons } from "@expo/vector-icons";
import { useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { Button, Field, Header, Screen } from "@/components/ui";
import { saveModel, saveProvider, setSetting } from "@/data/repositories";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "@/llm/limits";
import { FREE_MODELS, type FreeModel } from "@/settings/free-models";
import { guessModelCapabilities } from "@/settings/model-capabilities";
import { colors, spacing } from "@/theme";

/**
 * 免费模型专区：独立分类页，对齐 DeepWrite 的 settings/free-models 入口形态。
 * 每个免费模型一张卡片，选中后展开——领 Key、粘贴、一键保存并启用。
 */
export function FreeModelsScreen({ onBack }: { onBack: () => void }) {
  const [selectedId, setSelectedId] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selected = FREE_MODELS.find((item) => item.id === selectedId) ?? null;

  const saveAndUse = async (item: FreeModel) => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const provider = await saveProvider({
        name: item.providerName,
        type: item.type,
        baseUrl: item.baseUrl,
        apiKey,
      });
      const model = await saveModel({
        providerId: provider.id,
        name: item.modelLabel,
        modelId: item.modelId,
        temperature: 0.8,
        maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
        // 免费档多为纯文本小模型：工具调用能力按模型名推测，视觉一律不开启（用户可事后在模型设置里改）
        supportsTools: guessModelCapabilities(item.modelId).supportsTools,
        supportsVision: guessModelCapabilities(item.modelId).supportsVision,
      });
      await setSetting("activeModelId", model.id);
      setApiKey("");
      setSelectedId("");
      Alert.alert("已启用", `当前模型：${item.platform} · ${item.modelLabel}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen scroll>
      <Header title="免费模型" onBack={onBack} />
      <View style={styles.section}>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {FREE_MODELS.map((item) => {
          const expanded = selectedId === item.id;
          return (
            <View key={item.id} style={[styles.card, expanded && styles.cardExpanded]}>
              <Pressable
                accessibilityLabel={`选用 ${item.platform} ${item.modelLabel}`}
                onPress={() => { setSelectedId(expanded ? "" : item.id); setError(null); }}
                style={styles.cardHeader}
              >
                <View style={styles.cardIcon}>
                  <Ionicons name="sparkles-outline" size={20} color={colors.primary} />
                </View>
                <View style={styles.cardText}>
                  <Text numberOfLines={1} style={styles.cardTitle}>{item.platform} · {item.modelLabel}</Text>
                  <Text numberOfLines={2} style={styles.cardNote}>{item.note}</Text>
                </View>
                <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
              </Pressable>
              {expanded ? (
                <View style={styles.cardBody}>
                  <Button
                    label={`前往 ${item.platform} 领取 Key`}
                    variant="secondary"
                    onPress={() => void Linking.openURL(item.signupUrl)}
                  />
                  <Field label="API Key" value={apiKey} onChangeText={setApiKey} autoCapitalize="none" secureTextEntry />
                  <Button
                    label="保存并启用该模型"
                    onPress={() => void saveAndUse(item)}
                    disabled={!apiKey.trim()}
                    loading={saving}
                  />
                  <Text style={styles.cardHint}>保存后自动设为当前模型。</Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  section: { padding: spacing.lg, gap: spacing.md },
  errorText: { color: colors.danger ?? "#A32D2D", fontSize: 12 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: "hidden" },
  cardExpanded: { borderColor: colors.primary },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  cardIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "#E6F3EF" },
  cardText: { flex: 1 },
  cardTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  cardNote: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: 2 },
  cardBody: { gap: spacing.md, padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  cardHint: { color: colors.textMuted, fontSize: 12, lineHeight: 17 },
});
