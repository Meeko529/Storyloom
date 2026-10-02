import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from "react-native";
import { KeyboardAwareScrollView, KeyboardAvoidingView } from "react-native-keyboard-controller";

import { Button, EmptyState, ErrorNotice, Field, Header, Screen } from "@/components/ui";
import {
  deleteWorldInfoEntry,
  getOrCreateWorldInfo,
  getProject,
  listWorldInfoEntries,
  saveWorldInfo,
  saveWorldInfoEntry,
} from "@/data/repositories";
import { exportWorldInfo, type LibraryExportFormat } from "@/lib/export";
import { logImportBreadcrumb, parseSillyTavernWorldInfo, pickSillyTavernFile } from "@/lib/sillytavern";
import type { RootStackParamList } from "@/navigation/types";
import { useAppStore } from "@/store/app-store";
import { colors, radius, spacing } from "@/theme";
import type { Project, WorldInfo, WorldInfoEntry } from "@/types";

/** 关键词输入：中英文逗号、顿号都能分隔。 */
const splitKeywords = (value: string): string[] =>
  value.split(/[,，、]/).map((part) => part.trim()).filter(Boolean);

/** 列表行上的触发条件摘要；没有触发条件返回空串。 */
function triggerSummary(entry: WorldInfoEntry): string {
  const parts: string[] = [];
  if (entry.isConstant) parts.push("常驻");
  if (entry.keywords.length) parts.push(`关键词 ${entry.keywords.length}`);
  if (entry.secondaryKeywords.length) parts.push(`次要 ${entry.secondaryKeywords.length}`);
  if (entry.probability !== 100) parts.push(`概率 ${entry.probability}%`);
  return parts.join(" · ");
}

export function WorldInfoScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const projectId = useAppStore((state) => state.currentProjectId);
  const [project, setProject] = useState<Project | null>(null);
  const [worldInfo, setWorldInfo] = useState<WorldInfo | null>(null);
  const [entries, setEntries] = useState<WorldInfoEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bookName, setBookName] = useState("");
  const [bookDescription, setBookDescription] = useState("");
  const [entryEditorVisible, setEntryEditorVisible] = useState(false);
  const [editingEntry, setEditingEntry] = useState<WorldInfoEntry | null>(null);
  const [entryName, setEntryName] = useState("");
  const [entryContent, setEntryContent] = useState("");
  const [entryKeywords, setEntryKeywords] = useState("");
  const [entrySecondaryKeywords, setEntrySecondaryKeywords] = useState("");
  const [entryConstant, setEntryConstant] = useState(false);
  const [entryProbability, setEntryProbability] = useState("100");
  const [entryScanDepth, setEntryScanDepth] = useState("4");
  const [entryTriggerVisible, setEntryTriggerVisible] = useState(false);
  const [entryEnabled, setEntryEnabled] = useState(true);
  const [importingSt, setImportingSt] = useState(false);

  const load = useCallback(async () => {
    if (!projectId) {
      setProject(null);
      setWorldInfo(null);
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [nextProject, nextWorldInfo] = await Promise.all([getProject(projectId), getOrCreateWorldInfo(projectId)]);
      if (!nextProject) throw new Error("作品不存在");
      setProject(nextProject);
      setWorldInfo(nextWorldInfo);
      setBookName(nextWorldInfo.name);
      setBookDescription(nextWorldInfo.description);
      setEntries(await listWorldInfoEntries(nextWorldInfo.id));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useFocusEffect(useCallback(() => {
    void load();
  }, [load]));

  const saveBook = async () => {
    if (!worldInfo || !bookName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      setWorldInfo(await saveWorldInfo({ id: worldInfo.id, projectId: worldInfo.projectId, name: bookName, description: bookDescription }));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const openEntryEditor = (entry?: WorldInfoEntry) => {
    setEditingEntry(entry ?? null);
    setEntryName(entry?.name ?? "");
    setEntryContent(entry?.content ?? "");
    setEntryKeywords(entry?.keywords.join(", ") ?? "");
    setEntrySecondaryKeywords(entry?.secondaryKeywords.join(", ") ?? "");
    setEntryConstant(entry?.isConstant ?? false);
    setEntryProbability(String(entry?.probability ?? 100));
    setEntryScanDepth(String(entry?.scanDepth ?? 4));
    // 已经设过触发条件的条目，打开时直接摊开高级区，免得用户以为条件丢了。
    setEntryTriggerVisible(Boolean(entry && (entry.secondaryKeywords.length || entry.isConstant || entry.probability !== 100)));
    setEntryEnabled(entry?.isEnabled ?? true);
    setEntryEditorVisible(true);
  };

  /** 导入 SillyTavern 世界书 JSON：key[] → keywords，comment/key[0] → 条目名，触发条件原样保留。 */
  const importStWorldInfo = async () => {
    if (!worldInfo || importingSt) return;
    setImportingSt(true);
    setError(null);
    try {
      const picked = await pickSillyTavernFile();
      if (!picked) return;
      const parsed = parseSillyTavernWorldInfo(new TextDecoder().decode(picked.bytes));
      const saved: WorldInfoEntry[] = [];
      for (const entry of parsed) {
        saved.push(await saveWorldInfoEntry({
          worldInfoId: worldInfo.id,
          name: entry.name,
          content: entry.content,
          keywords: entry.keywords,
          secondaryKeywords: entry.secondaryKeywords,
          isConstant: entry.isConstant,
          probability: entry.probability,
          scanDepth: entry.scanDepth,
          isEnabled: entry.isEnabled,
        }));
      }
      setEntries((current) => [...saved, ...current].sort((left, right) => left.order - right.order));
      const withTriggers = parsed.filter((entry) => entry.keywords.length || entry.secondaryKeywords.length || entry.isConstant).length;
      logImportBreadcrumb("世界书", picked.fileName, `${parsed.length} 个条目（带触发条件 ${withTriggers} 条）`);
      Alert.alert("已导入", `${saved.length} 个条目`);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : String(importError));
    } finally {
      setImportingSt(false);
    }
  };

  const saveEntry = async () => {
    if (!worldInfo || !entryName.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const probabilityValue = Number(entryProbability.trim());
      const scanDepthValue = Number(entryScanDepth.trim());
      const saved = await saveWorldInfoEntry({
        id: editingEntry?.id,
        worldInfoId: worldInfo.id,
        name: entryName,
        content: entryContent,
        keywords: splitKeywords(entryKeywords),
        secondaryKeywords: splitKeywords(entrySecondaryKeywords),
        isConstant: entryConstant,
        probability: Number.isFinite(probabilityValue) ? probabilityValue : 100,
        scanDepth: Number.isFinite(scanDepthValue) ? scanDepthValue : 4,
        isEnabled: entryEnabled,
      });
      setEntries((current) => [saved, ...current.filter((item) => item.id !== saved.id)].sort((left, right) => left.order - right.order));
      setEntryEditorVisible(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  };

  const removeEntry = (entry: WorldInfoEntry) => {
    Alert.alert("删除世界书条目", `确定删除“${entry.name}”吗？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void deleteWorldInfoEntry(entry.id)
            .then(() => setEntries((current) => current.filter((item) => item.id !== entry.id)))
            .catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : String(deleteError)));
        },
      },
    ]);
  };

  const runExport = async (items: WorldInfoEntry[], format: LibraryExportFormat) => {
    if (!project || !worldInfo || exporting) return;
    setExporting(true);
    setError(null);
    try {
      await exportWorldInfo(project, worldInfo, items, format);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setExporting(false);
    }
  };

  const chooseExport = (items: WorldInfoEntry[], title: string) => {
    Alert.alert(title, "选择导出格式", [
      { text: "取消", style: "cancel" },
      { text: "JSON", onPress: () => void runExport(items, "json") },
      { text: "Markdown", onPress: () => void runExport(items, "markdown") },
    ]);
  };

  if (!projectId) return <Screen><Header title="世界书" onBack={() => navigation.goBack()} /><EmptyState title="请先从书架打开一部作品" /></Screen>;

  return (
    <Screen>
      <Header
        title="世界书"
        onBack={() => navigation.goBack()}
        action={(
          <View style={styles.headerActions}>
            <Pressable accessibilityLabel="导入 SillyTavern 世界书" disabled={importingSt} onPress={() => void importStWorldInfo()} style={styles.iconButton}>
              {importingSt ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="cloud-download-outline" size={22} color={colors.primary} />}
            </Pressable>
            <Pressable accessibilityLabel="批量导出世界书" disabled={exporting || !entries.length} onPress={() => chooseExport(entries, "导出全部世界书条目")} style={styles.iconButton}>
              {exporting ? <ActivityIndicator size="small" color={colors.primary} /> : <Ionicons name="download-outline" size={22} color={entries.length ? colors.primary : colors.textMuted} />}
            </Pressable>
            <Pressable accessibilityLabel="新建世界书条目" onPress={() => openEntryEditor()} style={styles.iconButton}><Ionicons name="add" size={26} color={colors.primary} /></Pressable>
          </View>
        )}
      />
      {error ? <View style={styles.errorWrap}><ErrorNotice message={error} onRetry={() => void load()} /></View> : null}
      {loading || !worldInfo ? <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View> : (
        <KeyboardAvoidingView style={styles.flex} behavior="height" automaticOffset>
          <FlatList
            data={entries}
            keyExtractor={(item) => item.id}
            style={styles.flex}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            contentContainerStyle={entries.length ? styles.list : styles.emptyList}
            ListHeaderComponent={
              <View style={styles.bookForm}>
                <Field label="世界书名称" value={bookName} onChangeText={setBookName} />
                <Field label="说明" value={bookDescription} onChangeText={setBookDescription} multiline textAlignVertical="top" style={styles.bookDescription} />
                <Button label="保存世界书信息" onPress={() => void saveBook()} disabled={!bookName.trim()} loading={saving} />
                <Text style={styles.sectionTitle}>条目 · {entries.length}</Text>
              </View>
            }
            ListEmptyComponent={<EmptyState title="还没有世界书条目" action={<Button label="新建条目" onPress={() => openEntryEditor()} />} />}
            renderItem={({ item }) => (
              <Pressable onPress={() => openEntryEditor(item)} style={({ pressed }) => [styles.entryRow, pressed && styles.rowPressed]}>
                <View style={styles.entryNumber}><Text style={styles.entryNumberText}>{item.uid}</Text></View>
                <View style={styles.entryText}>
                  <View style={styles.entryTitleLine}>
                    <Text numberOfLines={1} style={styles.entryName}>{item.name}</Text>
                    <Switch value={item.isEnabled} onValueChange={(value) => {
                      void saveWorldInfoEntry({ ...item, worldInfoId: item.worldInfoId, isEnabled: value })
                        .then((saved) => setEntries((current) => current.map((entry) => entry.id === saved.id ? saved : entry)))
                        .catch((toggleError) => setError(toggleError instanceof Error ? toggleError.message : String(toggleError)));
                    }} trackColor={{ false: colors.border, true: colors.primary }} />
                  </View>
                  <Text numberOfLines={2} style={styles.entryContent}>{item.content || "暂无内容"}</Text>
                  {triggerSummary(item) ? <Text numberOfLines={1} style={styles.entryTrigger}>{triggerSummary(item)}</Text> : null}
                </View>
                <View style={styles.rowActions}>
                  <Pressable accessibilityLabel={`导出世界书条目 ${item.name}`} disabled={exporting} onPress={(event) => { event.stopPropagation(); chooseExport([item], `导出条目“${item.name}”`); }} hitSlop={8} style={styles.iconButton}>
                    <Ionicons name="download-outline" size={19} color={colors.textMuted} />
                  </Pressable>
                  <Pressable accessibilityLabel="删除世界书条目" onPress={(event) => { event.stopPropagation(); removeEntry(item); }} hitSlop={8} style={styles.iconButton}>
                    <Ionicons name="trash-outline" size={19} color={colors.textMuted} />
                  </Pressable>
                </View>
              </Pressable>
            )}
          />
        </KeyboardAvoidingView>
      )}

      <Modal visible={entryEditorVisible} transparent animationType="slide" onRequestClose={() => setEntryEditorVisible(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior="height" automaticOffset>
          <View style={styles.modalBody}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{editingEntry ? "编辑条目" : "新建条目"}</Text>
              <Pressable accessibilityLabel="关闭世界书编辑" onPress={() => setEntryEditorVisible(false)} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <KeyboardAwareScrollView
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              showsHorizontalScrollIndicator={false}
              bottomOffset={spacing.lg}
              extraKeyboardSpace={spacing.md}
              contentContainerStyle={styles.form}
            >
              <Field label="条目名称" value={entryName} onChangeText={setEntryName} autoFocus={!editingEntry} />
              <Field label="触发关键词（用逗号分隔，可选）" value={entryKeywords} onChangeText={setEntryKeywords} placeholder="对话中出现这些词时，写作助手会优先读取本条目" />
              <Field label="条目内容" value={entryContent} onChangeText={setEntryContent} multiline textAlignVertical="top" style={styles.entryInput} placeholder="人物关系、地点规则、时代背景等" />
              <Pressable
                accessibilityLabel={entryTriggerVisible ? "收起触发条件" : "展开触发条件"}
                onPress={() => setEntryTriggerVisible((value) => !value)}
                style={({ pressed }) => [styles.triggerToggle, pressed && styles.rowPressed]}
              >
                <Ionicons name={entryTriggerVisible ? "chevron-down" : "chevron-forward"} size={17} color={colors.textMuted} />
                <Text style={styles.triggerToggleText}>触发条件（常驻 / 概率 / 深度 / 次要关键词）</Text>
              </Pressable>
              {entryTriggerVisible ? (
                <View style={styles.triggerBox}>
                  <View style={styles.switchRow}>
                    <View style={styles.triggerCopy}>
                      <Text style={styles.switchLabel}>常驻条目</Text>
                      <Text style={styles.triggerHint}>不看关键词，任何时候都提供给写作助手</Text>
                    </View>
                    <Switch value={entryConstant} onValueChange={setEntryConstant} trackColor={{ false: colors.border, true: colors.primary }} />
                  </View>
                  <Field
                    label="触发概率（0–100）"
                    value={entryProbability}
                    onChangeText={setEntryProbability}
                    keyboardType="number-pad"
                    placeholder="100 表示必定触发"
                  />
                  <Field
                    label="扫描深度（往前回看多少条消息）"
                    value={entryScanDepth}
                    onChangeText={setEntryScanDepth}
                    keyboardType="number-pad"
                    placeholder="0 表示不限制"
                  />
                  <Field
                    label="次要关键词（用逗号分隔，可选）"
                    value={entrySecondaryKeywords}
                    onChangeText={setEntrySecondaryKeywords}
                    placeholder="与主关键词配合的限定词"
                  />
                </View>
              ) : null}
              <View style={styles.switchRow}>
                <Text style={styles.switchLabel}>启用条目</Text>
                <Switch value={entryEnabled} onValueChange={setEntryEnabled} trackColor={{ false: colors.border, true: colors.primary }} />
              </View>
              <View style={styles.modalActions}>
                <Button label="取消" variant="secondary" onPress={() => setEntryEditorVisible(false)} />
                <Button label="保存" onPress={() => void saveEntry()} disabled={!entryName.trim()} loading={saving} />
              </View>
            </KeyboardAwareScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  headerActions: { flexDirection: "row", alignItems: "center" },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  errorWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  list: { paddingBottom: spacing.lg },
  emptyList: { flexGrow: 1 },
  bookForm: { gap: spacing.md, padding: spacing.lg, paddingBottom: spacing.xl, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  bookDescription: { minHeight: 90 },
  sectionTitle: { color: colors.text, fontSize: 17, fontWeight: "700", marginTop: spacing.sm },
  entryRow: { minHeight: 90, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  entryNumber: { width: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceMuted },
  entryNumberText: { color: colors.primary, fontSize: 13, fontWeight: "700" },
  entryText: { flex: 1, minWidth: 0, gap: spacing.xs },
  rowActions: { flexDirection: "row", alignItems: "center" },
  entryTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  entryName: { flex: 1, color: colors.text, fontSize: 15, fontWeight: "700" },
  entryContent: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  entryTrigger: { color: colors.primary, fontSize: 12, fontWeight: "600" },
  modalBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  modalBody: { maxHeight: "88%", padding: spacing.lg, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, backgroundColor: colors.background },
  modalHeader: { minHeight: 52, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  form: { gap: spacing.lg, paddingVertical: spacing.sm },
  entryInput: { minHeight: 190 },
  switchRow: { minHeight: 50, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  switchLabel: { color: colors.text, fontSize: 15, fontWeight: "600" },
  triggerToggle: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  triggerToggleText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  triggerBox: { gap: spacing.lg, padding: spacing.md, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted },
  triggerCopy: { flex: 1, minWidth: 0, gap: 2 },
  triggerHint: { color: colors.textMuted, fontSize: 12 },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
