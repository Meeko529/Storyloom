// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import * as ImagePicker from "expo-image-picker";
import { Directory, File, Paths } from "expo-file-system";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { Button, EmptyState, ErrorNotice, Field, Header, Screen } from "@/components/ui";
import { createProject, deleteProject, getProjectStats, listProjects, updateProjectCover, updateProjectInfo, type ProjectStats } from "@/data/repositories";
import type { RootStackParamList, RootTabParamList } from "@/navigation/types";
import { useAppStore } from "@/store/app-store";
import { colors, radius, spacing } from "@/theme";
import type { Project } from "@/types";

export function ProjectsScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabParamList>>();
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  /** 操作面板对应的作品；null 表示面板未打开 */
  const [menuProject, setMenuProject] = useState<Project | null>(null);
  /** 「编辑信息」面板 */
  const [infoProject, setInfoProject] = useState<Project | null>(null);
  const [infoTitle, setInfoTitle] = useState("");
  const [infoDescription, setInfoDescription] = useState("");
  const [infoStats, setInfoStats] = useState<ProjectStats | null>(null);
  const [infoSaving, setInfoSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const setCurrentProject = useAppStore((state) => state.setCurrentProject);
  const currentProjectId = useAppStore((state) => state.currentProjectId);
  const loadProjects = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setProjects(await listProjects());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadProjects();
  }, [loadProjects]));

  const openProject = (project: Project) => {
    setCurrentProject(project.id);
    navigation.navigate("Writing");
  };

  const submit = async () => {
    if (!title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const project = await createProject(title, description);
      setTitle("");
      setDescription("");
      setShowCreate(false);
      setProjects((current) => [project, ...current.filter((item) => item.id !== project.id)]);
      openProject(project);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
    } finally {
      setSaving(false);
    }
  };

  /** 打开「编辑信息」面板，顺带载入作品规模统计。 */
  const openProjectInfo = (project: Project) => {
    setMenuProject(null);
    setInfoProject(project);
    setInfoTitle(project.title);
    setInfoDescription(project.description);
    setInfoStats(null);
    void getProjectStats(project.id).then(setInfoStats).catch(() => setInfoStats(null));
  };

  const saveProjectInfo = async () => {
    if (!infoProject || !infoTitle.trim()) return;
    setInfoSaving(true);
    try {
      await updateProjectInfo(infoProject.id, infoTitle, infoDescription);
      setProjects((current) => current.map((item) => (
        item.id === infoProject.id
          ? { ...item, title: infoTitle.trim(), description: infoDescription.trim() }
          : item
      )));
      setInfoProject(null);
    } catch (infoError) {
      Alert.alert("保存失败", infoError instanceof Error ? infoError.message : String(infoError));
    } finally {
      setInfoSaving(false);
    }
  };

  /** 打开作品操作面板（封面与删除统一收在这里，避免误触直接删）。 */
  const openProjectMenu = (project: Project) => setMenuProject(project);

  /** 从相册选图作为作品封面，复制到应用私有目录后写入作品记录。 */
  const pickProjectCover = async (project: Project) => {
    setMenuProject(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]) return;
      const asset = result.assets[0];
      const directory = new Directory(Paths.document, "project-covers");
      directory.create({ intermediates: true, idempotent: true });
      const extension = (asset.fileName?.split(".").pop() ?? "jpg").toLowerCase();
      const target = new File(directory, `${project.id}.${extension}`);
      if (target.exists) target.delete();
      new File(asset.uri).copy(target);
      await updateProjectCover(project.id, target.uri);
      setProjects((current) => current.map((item) => (item.id === project.id ? { ...item, coverPath: target.uri } : item)));
    } catch (pickError) {
      Alert.alert("无法读取图片", pickError instanceof Error ? pickError.message : String(pickError));
    }
  };

  /** 移除封面：清空记录并删掉本地图片文件。 */
  const removeProjectCover = async (project: Project) => {
    setMenuProject(null);
    try {
      if (project.coverPath) {
        const file = new File(project.coverPath);
        if (file.exists) file.delete();
      }
      await updateProjectCover(project.id, null);
      setProjects((current) => current.map((item) => (item.id === project.id ? { ...item, coverPath: null } : item)));
    } catch (removeError) {
      Alert.alert("无法移除封面", removeError instanceof Error ? removeError.message : String(removeError));
    }
  };

  const confirmDelete = (project: Project) => {
    Alert.alert("删除作品", `确定删除《${project.title}》及全部本地数据？`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void deleteProject(project.id)
            .then(() => {
              setProjects((current) => current.filter((item) => item.id !== project.id));
              if (currentProjectId === project.id) setCurrentProject(null);
            })
            .catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : String(deleteError)));
        },
      },
    ]);
  };

  return (
    <Screen>
      <Header
        title="Storyloom"
        action={
          <Pressable accessibilityLabel="新建作品" onPress={() => setShowCreate(true)} style={styles.iconButton}>
            <Ionicons name="add" size={26} color={colors.primary} />
          </Pressable>
        }
      />
      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        contentContainerStyle={projects.length ? styles.list : styles.emptyList}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListHeaderComponent={
          <View>
            <View style={styles.quickActions}>
              <Pressable
                disabled={!currentProjectId}
                onPress={() => rootNavigation.navigate("Characters")}
                style={[styles.quickAction, !currentProjectId && styles.quickActionDisabled]}
              >
                <Ionicons name="people-outline" size={22} color={currentProjectId ? colors.primary : colors.textMuted} />
                <Text style={styles.quickActionText}>角色</Text>
              </Pressable>
              <Pressable
                disabled={!currentProjectId}
                onPress={() => rootNavigation.navigate("WorldInfo")}
                style={[styles.quickAction, !currentProjectId && styles.quickActionDisabled]}
              >
                <Ionicons name="globe-outline" size={22} color={currentProjectId ? colors.primary : colors.textMuted} />
                <Text style={styles.quickActionText}>世界书</Text>
              </Pressable>
              <Pressable
                disabled={!currentProjectId}
                onPress={() => rootNavigation.navigate("Notes")}
                style={[styles.quickAction, !currentProjectId && styles.quickActionDisabled]}
              >
                <Ionicons name="reader-outline" size={22} color={currentProjectId ? colors.primary : colors.textMuted} />
                <Text style={styles.quickActionText}>笔记</Text>
              </Pressable>
              <Pressable
                onPress={() => rootNavigation.navigate("StyleLibrary")}
                style={styles.quickAction}
              >
                <Ionicons name="color-wand-outline" size={22} color={colors.primary} />
                <Text style={styles.quickActionText}>文风库</Text>
              </Pressable>
            </View>
            {error ? <View style={styles.errorWrap}><ErrorNotice message={error} onRetry={() => void loadProjects()} /></View> : null}
          </View>
        }
        ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} /> : <EmptyState title="还没有作品" action={<Button label="新建作品" onPress={() => setShowCreate(true)} />} />}
        renderItem={({ item }) => (
          <Pressable onPress={() => openProject(item)} onLongPress={() => openProjectMenu(item)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
            <View style={styles.cover}>
              {item.coverPath ? (
                <Image source={{ uri: item.coverPath }} style={styles.coverImage} />
              ) : (
                <Text style={styles.coverText}>{item.title.slice(0, 1)}</Text>
              )}
            </View>
            <View style={styles.rowText}>
              <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.description} numberOfLines={2}>{item.description || "暂无简介"}</Text>
            </View>
            <Pressable accessibilityLabel={`《${item.title}》的操作`} onPress={(event) => { event.stopPropagation(); openProjectMenu(item); }} hitSlop={8} style={styles.rowAction}>
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
            </Pressable>
          </Pressable>
        )}
      />

      <Modal visible={infoProject !== null} transparent animationType="slide" onRequestClose={() => setInfoProject(null)}>
        <KeyboardAvoidingView style={styles.menuBackdrop} behavior="height" automaticOffset>
          <View style={styles.infoSheet}>
            <Text style={styles.menuTitle}>编辑信息</Text>
            <Field label="作品名" value={infoTitle} onChangeText={setInfoTitle} autoFocus />
            <Field label="简介" value={infoDescription} onChangeText={setInfoDescription} multiline style={styles.infoDescription} />
            <Text style={styles.infoStats}>
              {infoStats
                ? `${infoStats.volumes} 卷 · ${infoStats.chapters} 章 · ${infoStats.characters.toLocaleString()} 字`
                : "正在统计作品规模…"}
            </Text>
            <View style={styles.infoActions}>
              <Button label="取消" variant="secondary" onPress={() => setInfoProject(null)} />
              <Button label={infoSaving ? "保存中" : "保存"} onPress={() => void saveProjectInfo()} disabled={!infoTitle.trim()} loading={infoSaving} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      <Modal visible={menuProject !== null} transparent animationType="slide" onRequestClose={() => setMenuProject(null)}>
        <Pressable onPress={() => setMenuProject(null)} style={styles.menuBackdrop}>
          <View style={styles.menuSheet}>
            <Text numberOfLines={1} style={styles.menuTitle}>{menuProject?.title ?? ""}</Text>
            <Pressable
              accessibilityLabel="编辑信息"
              onPress={() => { if (menuProject) openProjectInfo(menuProject); }}
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
            >
              <Ionicons name="create-outline" size={20} color={colors.primary} />
              <Text style={styles.menuRowText}>编辑信息</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="上传封面"
              onPress={() => { if (menuProject) void pickProjectCover(menuProject); }}
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
            >
              <Ionicons name="image-outline" size={20} color={colors.primary} />
              <Text style={styles.menuRowText}>{menuProject?.coverPath ? "更换封面" : "上传封面"}</Text>
            </Pressable>
            {menuProject?.coverPath ? (
              <Pressable
                accessibilityLabel="移除封面"
                onPress={() => { if (menuProject) void removeProjectCover(menuProject); }}
                style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
              >
                <Ionicons name="close-circle-outline" size={20} color={colors.textMuted} />
                <Text style={styles.menuRowText}>移除封面</Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityLabel="删除作品"
              onPress={() => {
                const target = menuProject;
                setMenuProject(null);
                if (target) confirmDelete(target);
              }}
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
            >
              <Ionicons name="trash-outline" size={20} color={colors.danger} />
              <Text style={[styles.menuRowText, styles.menuRowDanger]}>删除作品</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>

      <Modal visible={showCreate} transparent animationType="fade" onRequestClose={() => setShowCreate(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} behavior="height" automaticOffset>
          <View style={styles.modalBody}>
            <Text style={styles.modalTitle}>新建作品</Text>
            <Field label="书名" value={title} onChangeText={setTitle} autoFocus />
            <Field label="简介" value={description} onChangeText={setDescription} multiline />
            <View style={styles.modalActions}>
              <Button label="取消" variant="secondary" onPress={() => setShowCreate(false)} />
              <Button label="创建" onPress={() => void submit()} disabled={!title.trim()} loading={saving} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  quickActions: { flexDirection: "row", gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  quickAction: { flex: 1, minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.surface },
  quickActionDisabled: { opacity: 0.48 },
  quickActionText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  errorWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  list: { paddingVertical: spacing.sm },
  emptyList: { flexGrow: 1 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 88 },
  row: { minHeight: 92, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  cover: { width: 56, height: 68, borderRadius: radius.sm, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center", overflow: "hidden" },
  coverImage: { width: 56, height: 68 },
  coverText: { color: "#FFFFFF", fontSize: 24, fontWeight: "700" },
  menuBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  menuSheet: { paddingVertical: spacing.sm, paddingBottom: spacing.xl, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, backgroundColor: colors.background },
  menuTitle: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs, color: colors.textMuted, fontSize: 13 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52, paddingHorizontal: spacing.lg },
  menuRowPressed: { backgroundColor: colors.surfaceMuted },
  menuRowText: { color: colors.text, fontSize: 15, fontWeight: "600" },
  menuRowDanger: { color: colors.danger },
  infoSheet: { padding: spacing.lg, gap: spacing.sm, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, backgroundColor: colors.background },
  infoDescription: { minHeight: 96 },
  infoStats: { color: colors.textMuted, fontSize: 13 },
  infoActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  rowText: { flex: 1, gap: spacing.xs },
  rowAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  title: { color: colors.text, fontSize: 17, fontWeight: "700" },
  description: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },
  modalBackdrop: { flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: colors.overlay },
  modalBody: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.md, backgroundColor: colors.background },
  modalTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  modalActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
