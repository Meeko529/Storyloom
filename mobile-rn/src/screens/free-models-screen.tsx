// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import { Ionicons } from "@expo/vector-icons";
import { useMemo, useState } from "react";
import { Alert, Linking, Pressable, StyleSheet, Text, View } from "react-native";

import { Button, Field, Header, Screen } from "@/components/ui";
import { saveModel, saveProvider, setSetting } from "@/data/repositories";
import { DEFAULT_MAX_OUTPUT_TOKENS } from "@/llm/limits";
import { FREE_MODELS, type FreeModel } from "@/settings/free-models";
import { guessModelCapabilities } from "@/settings/model-capabilities";
import { colors, spacing } from "@/theme";

/**
 * 免费模型专区：独立分类页。
 *
 * 清单按平台归组：一个平台一张卡，同平台的免费模型在卡内用标签切换，额度说明随所
 * 选模型变化。折叠时露两行做预览；展开后在卡内单独给出一块说明全文，那块文字不设
 * 行数上限，长说明（例如需要替换账户 ID 的那类）能整段读完。
 *
 * 清单是本地模板（`settings/free-models.ts`），不依赖任何服务端。
 */
export function FreeModelsScreen({ onBack }: { onBack: () => void }) {
  const [expandedPlatform, setExpandedPlatform] = useState("");
  const [pickedModelIds, setPickedModelIds] = useState<Record<string, string>>({});
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 按平台归组，保持清单里的先后顺序。 */
  const groups = useMemo(() => {
    const byPlatform = new Map<string, FreeModel[]>();
    for (const item of FREE_MODELS) {
      const list = byPlatform.get(item.platform) ?? [];
      list.push(item);
      byPlatform.set(item.platform, list);
    }
    return [...byPlatform.entries()].map(([platform, models]) => ({ platform, models }));
  }, []);

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
      setExpandedPlatform("");
      Alert.alert("已启用", `当前模型：${item.platform} · ${item.modelLabel}`);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const toggle = (platform: string) => {
    setError(null);
    if (expandedPlatform === platform) {
      setExpandedPlatform("");
      return;
    }
    // 换到另一个平台时清空输入，免得把上一家的 Key 存到这一家。
    setExpandedPlatform(platform);
    setApiKey("");
  };

  const pickModel = (platform: string, modelId: string) => {
    setError(null);
    setPickedModelIds((current) => ({ ...current, [platform]: modelId }));
  };

  return (
    <Screen scroll>
      <Header title="免费模型" onBack={onBack} />
      <View style={styles.section}>
        <Text style={styles.intro}>
          各平台当前可免费调用的模型集中在这里。选好模型、填上自己账号的 API Key，即可保存并启用。
        </Text>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
        {groups.map((group) => {
          const expanded = expandedPlatform === group.platform;
          const selected =
            group.models.find((item) => item.id === pickedModelIds[group.platform]) ?? group.models[0];
          const multiple = group.models.length > 1;
          return (
            <View key={group.platform} style={[styles.card, expanded && styles.cardExpanded]}>
              <Pressable
                accessibilityLabel={`展开 ${group.platform} 的免费模型`}
                onPress={() => toggle(group.platform)}
                style={styles.cardHeader}
              >
                <View style={styles.cardIcon}>
                  <Ionicons name="sparkles-outline" size={20} color={colors.primary} />
                </View>
                <View style={styles.cardText}>
                  <View style={styles.cardTitleRow}>
                    <Text numberOfLines={1} style={styles.cardTitle}>{group.platform}</Text>
                    <Text style={styles.cardCount}>{group.models.length} 个免费模型</Text>
                  </View>
                  {/* 折叠时露两行做预览；展开后由卡内那块说明全文承担，这里不再重复。 */}
                  {expanded ? (
                    <Text numberOfLines={1} style={styles.cardSubtitle}>{selected.modelLabel}</Text>
                  ) : (
                    <Text numberOfLines={2} style={styles.cardNote}>{selected.modelLabel} · {selected.note}</Text>
                  )}
                </View>
                <Ionicons name={expanded ? "chevron-up" : "chevron-down"} size={18} color={colors.textMuted} />
              </Pressable>
              {expanded ? (
                <View style={styles.cardBody}>
                  {multiple ? (
                    <View style={styles.chipRow}>
                      {group.models.map((item) => {
                        const active = item.id === selected.id;
                        return (
                          <Pressable
                            key={item.id}
                            accessibilityLabel={`选用 ${item.modelLabel}`}
                            onPress={() => pickModel(group.platform, item.id)}
                            style={[styles.chip, active && styles.chipActive]}
                          >
                            <Text style={[styles.chipText, active && styles.chipTextActive]}>{item.modelLabel}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                  <View style={styles.noteBox}>
                    <Text style={styles.noteLabel}>{selected.modelLabel}</Text>
                    <Text style={styles.noteFull}>{selected.note}</Text>
                  </View>
                  <Button
                    label={`前往 ${group.platform} 领取 Key`}
                    variant="secondary"
                    onPress={() => void Linking.openURL(selected.signupUrl)}
                  />
                  <Field label="API Key" value={apiKey} onChangeText={setApiKey} autoCapitalize="none" secureTextEntry />
                  <Button
                    label="保存并启用该模型"
                    onPress={() => void saveAndUse(selected)}
                    disabled={!apiKey.trim()}
                    loading={saving}
                  />
                  <Text style={styles.cardHint}>
                    {multiple
                      ? "保存后自动设为当前模型；同一平台的条目共用这一个 Key。"
                      : "保存后自动设为当前模型。"}
                  </Text>
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
  intro: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  errorText: { color: colors.danger ?? "#A32D2D", fontSize: 12 },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, overflow: "hidden" },
  cardExpanded: { borderColor: colors.primary },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md },
  cardIcon: { width: 36, height: 36, alignItems: "center", justifyContent: "center", borderRadius: 8, backgroundColor: "#E6F3EF" },
  cardText: { flex: 1, minWidth: 0 },
  cardTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  cardTitle: { flexShrink: 1, color: colors.text, fontSize: 15, fontWeight: "600" },
  cardCount: { color: colors.textMuted, fontSize: 11 },
  cardSubtitle: { marginTop: 2, color: colors.textMuted, fontSize: 12 },
  cardNote: { color: colors.textMuted, fontSize: 12, lineHeight: 18, marginTop: 2 },
  cardBody: { gap: spacing.md, padding: spacing.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.background },
  chipActive: { borderColor: colors.primary, backgroundColor: "#E6F3EF" },
  chipText: { color: colors.text, fontSize: 12 },
  chipTextActive: { color: colors.primary, fontWeight: "600" },
  noteBox: { gap: 4, padding: spacing.md, borderRadius: 10, backgroundColor: colors.surfaceMuted },
  noteLabel: { color: colors.text, fontSize: 13, fontWeight: "600" },
  noteFull: { color: colors.textMuted, fontSize: 12, lineHeight: 19 },
  cardHint: { color: colors.textMuted, fontSize: 12, lineHeight: 18 },
});
