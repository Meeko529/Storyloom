// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import * as ImagePicker from "expo-image-picker";
import { Directory, File, Paths } from "expo-file-system";
import type { BottomTabNavigationProp } from "@react-navigation/bottom-tabs";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { Ionicons } from "@expo/vector-icons";
import { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Dimensions, FlatList, Image, ImageBackground, Modal, Pressable, StyleSheet, TextInput, Text, View } from "react-native";
import { appendBreadcrumb } from "@/lib/crash-log";
import { importProjectFromFile } from "@/lib/doc-import";
import { downsampleToFile } from "@/lib/media-downsample";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { Button, EmptyState, ErrorNotice, Field, Header, PlainScrollView, Screen } from "@/components/ui";
import { createCategory, createProject, deleteCategory, deleteProject, getProjectStats, getProjectStatsMap, getSetting, listCategories, listProjects, renameCategory, setProjectCategory, setSetting, updateProjectCover, updateProjectInfo, type ProjectStats } from "@/data/repositories";
import type { RootStackParamList, RootTabParamList } from "@/navigation/types";
import { useAppStore } from "@/store/app-store";
import { colors, radius, shadow, spacing } from "@/theme";
import type { Category, Project } from "@/types";

const PLANK_IMAGE = require("../../assets/images/shelf-plank.png");
const BOOK_SHADOW = require("../../assets/images/book-shadow.png");

export function ProjectsScreen() {
  const navigation = useNavigation<BottomTabNavigationProp<RootTabParamList>>();
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [projects, setProjects] = useState<Project[]>([]);
  const [stats, setStats] = useState<Record<string, ProjectStats>>({});
  // 书架视图：网格（封面墙）/ 列表（信息行），选择存进设置，重启保留
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  /** 操作面板对应的作品；null 表示面板未打开 */
  const [menuProject, setMenuProject] = useState<Project | null>(null);
  const [shelfMenuVisible, setShelfMenuVisible] = useState(false);
  const [importing, setImporting] = useState(false);
  /** 书架一行的可用宽度（onLayout 实测；初值用屏宽兜底）。 */
  const [shelfInnerWidth, setShelfInnerWidth] = useState(() => Dimensions.get("window").width);
  /** 分类与排序 */
  const [categories, setCategories] = useState<Category[]>([]);
  const [shelfSort, setShelfSort] = useState<"recent" | "created" | "words">("recent");
  /** 当前显示的分组；null = 全部。存设置时用 "all" 表示全部 */
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [categoryPanelVisible, setCategoryPanelVisible] = useState(false);
  const [shelfMenuView, setShelfMenuView] = useState<"main" | "sort">("main");
  const [categoryManagerVisible, setCategoryManagerVisible] = useState(false);
  const [assignTarget, setAssignTarget] = useState<Project | null>(null);
  const [newCategoryName, setNewCategoryName] = useState("");
  const [renamingCategory, setRenamingCategory] = useState<{ id: string; name: string } | null>(null);
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
      setStats(await getProjectStatsMap());
      setCategories(await listCategories());
      void getSetting("general.shelfView")
        .then((value) => setViewMode(value === "list" ? "list" : "grid"))
        .catch(() => {});
      void getSetting("general.shelfSort")
        .then((value) => setShelfSort(value === "created" || value === "words" ? value : "recent"))
        .catch(() => {});
      void getSetting("general.shelfCategory")
        .then((value) => setSelectedCategoryId(value && value !== "all" ? value : null))
        .catch(() => {});
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    void loadProjects();
  }, [loadProjects]));

  /** 网格 / 列表切换：选择写进设置，重启保留。 */
  const toggleViewMode = () => {
    const next = viewMode === "grid" ? "list" : "grid";
    setViewMode(next);
    void setSetting("general.shelfView", next);
  };

  const openProject = (project: Project) => {
    appendBreadcrumb(`书架点开作品「${project.title}」`);
    setCurrentProject(project.id);
    navigation.navigate("Writing");
  };

  /** 排序：改设置即生效；分类开关同理。 */
  const applyShelfSort = (rule: "recent" | "created" | "words") => {
    setShelfSort(rule);
    setShelfMenuView("main");
    void setSetting("general.shelfSort", rule);
  };
  /** 选择书架当前显示的分组（持久化；分类被删时回落「全部」）。 */
  const selectShelfCategory = (categoryId: string | null) => {
    setSelectedCategoryId(categoryId);
    setCategoryPanelVisible(false);
    void setSetting("general.shelfCategory", categoryId ?? "all");
  };
  const closeCategoryManager = () => { setCategoryManagerVisible(false); setRenamingCategory(null); };
  const addCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;
    await createCategory(name);
    setNewCategoryName("");
    setCategories(await listCategories());
  };
  const saveCategoryRename = async () => {
    if (!renamingCategory || !renamingCategory.name.trim()) return;
    await renameCategory(renamingCategory.id, renamingCategory.name.trim());
    setRenamingCategory(null);
    setCategories(await listCategories());
  };
  const removeCategory = (category: Category) => {
    Alert.alert("删除分类", `删除「${category.name}」？名下作品将回到未分类。`, [
      { text: "取消", style: "cancel" },
      {
        text: "删除",
        style: "destructive",
        onPress: () => {
          void (async () => {
            await deleteCategory(category.id);
            setCategories(await listCategories());
            await loadProjects();
          })();
        },
      },
    ]);
  };
  const assignToCategory = async (categoryId: string | null) => {
    if (!assignTarget) return;
    await setProjectCategory(assignTarget.id, categoryId);
    setCategoryManagerVisible(false);
    setAssignTarget(null);
    await loadProjects();
  };

  /** 排序后的作品列表。 */
  const sortedProjects = useMemo(() => {
    const list = [...projects];
    if (shelfSort === "created") list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    else if (shelfSort === "words") list.sort((a, b) => (stats[b.id]?.characters ?? 0) - (stats[a.id]?.characters ?? 0));
    else list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return list;
  }, [projects, shelfSort, stats]);

  /** 渲染条目：只显示当前选中的分组；「全部」平铺。 */
  const currentCategoryName = selectedCategoryId
    ? categories.find((category) => category.id === selectedCategoryId)?.name ?? "全部"
    : "全部";
  const hasUncategorized = projects.some((project) => !project.categoryId || !categories.some((category) => category.id === project.categoryId));
  const shelfItems = useMemo(() => {
    const visible = !selectedCategoryId
      ? sortedProjects
      : sortedProjects.filter((project) => selectedCategoryId === "uncategorized"
        ? !project.categoryId || !categories.some((category) => category.id === project.categoryId)
        : project.categoryId === selectedCategoryId);
    const items: Array<{ kind: "row"; row: Project[] } | { kind: "project"; project: Project }> = [];
    if (viewMode === "grid") for (const row of chunkProjects(visible, 4)) items.push({ kind: "row", row });
    else for (const project of visible) items.push({ kind: "project", project });
    return items;
  }, [projects, sortedProjects, categories, selectedCategoryId, viewMode]);

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
  const runShelfImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const project = await importProjectFromFile();
      setShelfMenuVisible(false);
      if (!project) return;
      await loadProjects();
      openProject(project);
    } catch (importError) {
      Alert.alert("导入失败", importError instanceof Error ? importError.message : String(importError));
    } finally {
      setImporting(false);
    }
  };

  const openProjectMenu = (project: Project) => setMenuProject(project);

/** 把书架列表按每行 4 本分块，行下面渲染整条书架板。 */
function chunkProjects(list: Project[], size: number): Project[][] {
  const rows: Project[][] = [];
  for (let index = 0; index < list.length; index += size) rows.push(list.slice(index, index + size));
  return rows;
}

/** 无封面书封的书名排版：按长度拆成两行。 */
function bookTitleLines(title: string): string[] {
  const clean = title.trim();
  if (clean.length <= 4) return [clean];
  const half = Math.ceil(clean.length / 2);
  return [clean.slice(0, half), clean.slice(half)];
}

/** 书架封面卡：无封面时按书名哈希取低饱和底色 + 首字水印（借鉴 QMAI / 51码字的书封卡片）。 */
const COVER_COLORS = ["#2E6B5A", "#8A5A4A", "#4A5B8A", "#7A6A4A", "#5F4A6B"];
function coverColor(title: string): string {
  let hash = 0;
  for (let index = 0; index < title.length; index += 1) hash = (hash * 31 + title.charCodeAt(index)) >>> 0;
  return COVER_COLORS[hash % COVER_COLORS.length];
}

  /**
   * 从相册选图作为作品封面。
   *
   * 每次用**唯一文件名**：旧实现固定写成 `<作品id>.<扩展名>`，第二次换封面时文件内容确实换了、
   * 但路径（URI）没变，图片组件按 URI 缓存 → 界面上「没反应」。路径一变，缓存自然失效。
   */
  const pickProjectCover = async (project: Project) => {
    setMenuProject(null);
    let picked: ImagePicker.ImagePickerAsset | null = null;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ["images"],
        allowsEditing: true,
        aspect: [3, 4],
        quality: 0.9,
      });
      if (result.canceled || !result.assets[0]) return;
      picked = result.assets[0];
    } catch (pickError) {
      Alert.alert("无法打开相册", pickError instanceof Error ? pickError.message : String(pickError));
      return;
    }

    const directory = new Directory(Paths.document, "project-covers");
    let target: File;
    try {
      directory.create({ intermediates: true, idempotent: true });
      const extension = (picked.fileName?.split(".").pop() ?? "jpg").toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
      target = new File(directory, `${project.id}-${Date.now()}.${extension}`);
      new File(picked.uri).copy(target);
      try {
        await downsampleToFile(target.uri, 1080);
      } catch {}
      void appendBreadcrumb(`封面已保存（降采样）`);
    } catch (copyError) {
      Alert.alert("封面保存失败", `图片已选中，但写入本地目录失败：${copyError instanceof Error ? copyError.message : String(copyError)}`);
      return;
    }

    try {
      await updateProjectCover(project.id, target.uri);
    } catch (dbError) {
      Alert.alert("封面保存失败", `图片已复制，但写入作品记录失败：${dbError instanceof Error ? dbError.message : String(dbError)}`);
      return;
    }

    // 记录写成功后再清理旧封面；清理失败不影响本次结果。
    if (project.coverPath) {
      try {
        const previous = new File(project.coverPath);
        if (previous.exists) previous.delete();
      } catch {
        // 旧文件可能正被系统占用，下次覆盖时再清理
      }
    }
    setProjects((current) => current.map((item) => (item.id === project.id ? { ...item, coverPath: target.uri } : item)));
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
        title={
          categories.length ? (
            <Pressable accessibilityLabel="选择分组" onPress={() => setCategoryPanelVisible((value) => !value)} style={styles.shelfTitleButton}>
              <Text style={styles.shelfTitleText}>{currentCategoryName}</Text>
              <Ionicons name={categoryPanelVisible ? "chevron-up" : "chevron-down"} size={16} color={colors.text} />
            </Pressable>
          ) : (
            "全部"
          )
        }
        action={
          <View style={styles.headerActions}>
            <Pressable accessibilityLabel="新建作品" onPress={() => setShowCreate(true)} style={styles.iconButton}>
              <Ionicons name="add" size={26} color={colors.primary} />
            </Pressable>
            <Pressable accessibilityLabel="书架菜单" onPress={() => setShelfMenuVisible(true)} style={styles.iconButton}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.primary} />
            </Pressable>
          </View>
        }
      />
      {categoryPanelVisible ? (
        <>
          <Pressable accessibilityLabel="关闭分组面板" onPress={() => setCategoryPanelVisible(false)} style={styles.shelfMenuBackdrop} />
          <View style={styles.categoryPanel}>
            <Pressable onPress={() => selectShelfCategory(null)} style={[styles.shelfChip, !selectedCategoryId && styles.shelfChipActive]}>
              <Text style={[styles.shelfChipText, !selectedCategoryId && styles.shelfChipTextActive]}>全部</Text>
            </Pressable>
            {categories.map((category) => (
              <Pressable key={category.id} onPress={() => selectShelfCategory(category.id)} style={[styles.shelfChip, selectedCategoryId === category.id && styles.shelfChipActive]}>
                <Text style={[styles.shelfChipText, selectedCategoryId === category.id && styles.shelfChipTextActive]}>{category.name}</Text>
              </Pressable>
            ))}
            {hasUncategorized ? (
              <Pressable onPress={() => selectShelfCategory("uncategorized")} style={[styles.shelfChip, selectedCategoryId === "uncategorized" && styles.shelfChipActive]}>
                <Text style={[styles.shelfChipText, selectedCategoryId === "uncategorized" && styles.shelfChipTextActive]}>未分类</Text>
              </Pressable>
            ) : null}
          </View>
        </>
      ) : null}
      {shelfMenuVisible && shelfMenuView === "main" ? (
        <>
          <Pressable accessibilityLabel="关闭书架菜单" onPress={() => setShelfMenuVisible(false)} style={styles.shelfMenuBackdrop} />
          <View style={styles.shelfMenuCard}>
            <Pressable
              accessibilityLabel="本机导入"
              disabled={importing}
              onPress={() => void runShelfImport()}
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
            >
              {importing
                ? <ActivityIndicator size={20} color={colors.primary} />
                : <Ionicons name="document-outline" size={20} color={colors.primary} />}
              <Text style={styles.menuRowText}>本机导入</Text>
            </Pressable>
            <Pressable
              accessibilityLabel={viewMode === "grid" ? "书架样式：切换为列表" : "书架样式：切换为网格"}
              onPress={() => { toggleViewMode(); setShelfMenuVisible(false); }}
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
            >
              <Ionicons name={viewMode === "grid" ? "list-outline" : "grid-outline"} size={20} color={colors.primary} />
              <Text style={styles.menuRowText}>书架样式</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="分类管理"
              onPress={() => { setShelfMenuVisible(false); setCategoryManagerVisible(true); }}
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
            >
              <Ionicons name="folder-open-outline" size={20} color={colors.primary} />
              <Text style={styles.menuRowText}>分类管理</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="书架排序"
              onPress={() => setShelfMenuView("sort")}
              style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
            >
              <Ionicons name="swap-vertical-outline" size={20} color={colors.primary} />
              <Text style={styles.menuRowText}>书架排序</Text>
            </Pressable>
          </View>
        </>
      ) : null}
      {shelfMenuVisible && shelfMenuView === "sort" ? (
        <>
          <Pressable accessibilityLabel="关闭排序选择" onPress={() => { setShelfMenuView("main"); setShelfMenuVisible(false); }} style={styles.shelfMenuBackdrop} />
          <View style={styles.shelfMenuCard}>
            <Text style={styles.menuTitle}>书架排序</Text>
            {([
              { id: "recent", label: "最近更新" },
              { id: "created", label: "创建时间" },
              { id: "words", label: "字数" },
            ] as const).map((option) => (
              <Pressable
                key={option.id}
                accessibilityLabel={`排序方式：${option.label}`}
                onPress={() => applyShelfSort(option.id)}
                style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
              >
                <Text style={styles.menuRowText}>{option.label}</Text>
                {shelfSort === option.id ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
              </Pressable>
            ))}
          </View>
        </>
      ) : null}
      <FlatList
        key={viewMode}
        data={shelfItems}
        keyExtractor={(item, index) => (item.kind === "row" ? `row-${index}` : item.project.id)}
        contentContainerStyle={projects.length ? styles.list : styles.emptyList}
        ItemSeparatorComponent={viewMode === "grid" ? () => null : () => <View style={styles.separator} />}
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
            {categories.length ? (
              <PlainScrollView horizontal keyboardShouldPersistTaps="handled" style={styles.shelfChipsRow} contentContainerStyle={styles.shelfChipsContent}>
                <Pressable onPress={() => selectShelfCategory(null)} style={({ pressed }) => [styles.shelfChip, !selectedCategoryId && styles.shelfChipActive]}>
                  <Text style={[styles.shelfChipText, !selectedCategoryId && styles.shelfChipTextActive]}>全部</Text>
                </Pressable>
                {categories.map((category) => (
                  <Pressable key={category.id} onPress={() => selectShelfCategory(category.id)} style={({ pressed }) => [styles.shelfChip, selectedCategoryId === category.id && styles.shelfChipActive]}>
                    <Text style={[styles.shelfChipText, selectedCategoryId === category.id && styles.shelfChipTextActive]}>{category.name}</Text>
                  </Pressable>
                ))}
                {hasUncategorized ? (
                  <Pressable onPress={() => selectShelfCategory("uncategorized")} style={({ pressed }) => [styles.shelfChip, selectedCategoryId === "uncategorized" && styles.shelfChipActive]}>
                    <Text style={[styles.shelfChipText, selectedCategoryId === "uncategorized" && styles.shelfChipTextActive]}>未分类</Text>
                  </Pressable>
                ) : null}
              </PlainScrollView>
            ) : null}
            {error ? <View style={styles.errorWrap}><ErrorNotice message={error} onRetry={() => void loadProjects()} /></View> : null}
          </View>
        }
        ListEmptyComponent={loading ? <ActivityIndicator color={colors.primary} /> : <EmptyState title="还没有作品" action={<Button label="新建作品" onPress={() => setShowCreate(true)} />} />}
        renderItem={({ item }) => {
          if (viewMode === "grid") {
            const row = item.kind === "row" ? item.row : [];
            // 书架 = 一行的背景层（照书架类应用的画法）：层板贴图铺在行底部、全宽贯通，
            // 书格底对齐站在板上；与本书数无关——1 本书板也贯通。
            const cellWidth = Math.max(60, Math.floor((shelfInnerWidth - 28 - 12 - 3 * 10) / 4));
            const plankStrip = Math.round(shelfInnerWidth / (3322 / 383));
            const plankBelow = Math.round(plankStrip * 0.62);
            const rowHeight = Math.round((cellWidth * 4) / 3) + plankBelow;
            return (
              <View
                style={styles.shelfRow}
                onLayout={(event) => {
                  const width = event.nativeEvent.layout.width;
                  if (Math.abs(width - shelfInnerWidth) > 1) setShelfInnerWidth(width);
                }}
              >
                <View style={{ height: rowHeight, justifyContent: "flex-end" }}>
                <ImageBackground
                  source={PLANK_IMAGE}
                  resizeMode="stretch"
                  style={{ position: "absolute", left: -60, right: -60, bottom: 0, height: plankStrip }}
                />
                <View style={[styles.shelfBooks, { paddingBottom: plankBelow }]}>
                  {row.map((project) => {
                    const lines = bookTitleLines(project.title);
                    return (
                      <Pressable key={project.id} onPress={() => openProject(project)} onLongPress={() => openProjectMenu(project)} style={({ pressed }) => [styles.shelfCell, { width: cellWidth }, pressed && styles.rowPressed]}>
                        <Image source={BOOK_SHADOW} style={styles.bookShadowImage} resizeMode="stretch" />
                        <View style={[styles.bookObject, { backgroundColor: coverColor(project.title) }]}>
                          <View style={styles.bookSpine} />
                          {project.coverPath ? (
                            <Image source={{ uri: project.coverPath }} style={styles.gridCoverImage} resizeMethod="resize" />
                          ) : (
                            <View style={styles.bookCoverTextWrap}>
                              {lines.map((line, index) => (
                                <Text key={index} style={[styles.bookCoverLine, index === 0 && lines.length > 1 && styles.bookCoverLineLead]} numberOfLines={1}>{line}</Text>
                              ))}
                            </View>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
                </View>
                <View style={styles.shelfLabels}>
                  {row.map((project) => {
                    const st = stats[project.id];
                    const statsLine = st ? `${st.volumes} 卷 · ${st.chapters} 章 · ${(st.characters / 10000).toFixed(1)} 万字` : "…";
                    return (
                      <View key={project.id} style={[styles.shelfLabelCell, { width: cellWidth }]}>
                        <Text style={styles.gridName} numberOfLines={1}>{project.title}</Text>
                        <Text style={styles.gridStats} numberOfLines={1}>{statsLine}</Text>
                      </View>
                    );
                  })}
                </View>
              </View>
            );
          }
          const project = item.kind === "project" ? item.project : (item as unknown as Project);
          const statsLine = (() => { const st = stats[project.id]; return st ? `${st.volumes} 卷 · ${st.chapters} 章 · ${(st.characters / 10000).toFixed(1)} 万字` : "…"; })();
          const progress = Math.min(100, Math.round(((stats[project.id]?.characters ?? 0) / 100000) * 100));
          const coverNode = (
            <View style={[styles.cover, { backgroundColor: coverColor(project.title) }]}>
              {project.coverPath ? (
                <Image source={{ uri: project.coverPath }} style={styles.coverImage} resizeMethod="resize" />
              ) : (
                <Text style={styles.coverText}>{project.title.slice(0, 1)}</Text>
              )}
            </View>
          );
          const menu = (
            <Pressable accessibilityLabel={`《${project.title}》的操作`} onPress={(event) => { event.stopPropagation(); openProjectMenu(project); }} hitSlop={8} style={styles.rowAction}>
              <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
            </Pressable>
          );
          return (
            <Pressable onPress={() => openProject(project)} onLongPress={() => openProjectMenu(project)} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
              {coverNode}
              <View style={styles.rowText}>
                <Text style={styles.title} numberOfLines={1}>{project.title}</Text>
                <Text style={styles.description} numberOfLines={1}>{project.description || "暂无简介"}</Text>
                <View style={styles.statsRow}>
                  <View style={styles.meter}>
                    <View style={[styles.meterFill, { width: `${progress}%` }]} />
                  </View>
                  <Text style={styles.statsText}>{statsLine}</Text>
                </View>
              </View>
              {menu}
            </Pressable>
          );
        }}
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
            {categories.length ? (
              <Pressable
                accessibilityLabel="归入分类"
                onPress={() => {
                  const target = menuProject;
                  setMenuProject(null);
                  if (target) { setAssignTarget(target); setCategoryManagerVisible(true); }
                }}
                style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
              >
                <Ionicons name="folder-outline" size={20} color={colors.primary} />
                <Text style={styles.menuRowText}>归入分类…</Text>
                <Text style={styles.menuRowHint}>{categories.find((category) => category.id === menuProject?.categoryId)?.name ?? "未分类"}</Text>
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

      <Modal visible={categoryManagerVisible} transparent animationType="slide" onRequestClose={closeCategoryManager}>
        <KeyboardAvoidingView style={styles.menuBackdrop} behavior="height" automaticOffset>
          <Pressable accessibilityLabel="关闭分类管理" onPress={closeCategoryManager} style={styles.sheetBackdropFill} />
          <View style={styles.menuSheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>{assignTarget ? "归入分类" : "分类管理"}</Text>
              <Pressable accessibilityLabel="关闭" onPress={closeCategoryManager} style={styles.sheetClose}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </Pressable>
            </View>
            <PlainScrollView style={styles.sheetScroll} contentContainerStyle={styles.sheetScrollContent} keyboardShouldPersistTaps="handled">
              {assignTarget ? (
                <>
                  <Text style={styles.sheetSectionTitle}>归入</Text>
                  <Text style={styles.categorySectionHint}>将《{assignTarget.title}》归入：</Text>
                  <Pressable
                    accessibilityLabel="归入未分类"
                    onPress={() => void assignToCategory(null)}
                    style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
                  >
                    <Ionicons name="albums-outline" size={20} color={colors.textMuted} />
                    <Text style={styles.menuRowText}>未分类</Text>
                  </Pressable>
                  {categories.map((category) => (
                    <Pressable
                      key={category.id}
                      accessibilityLabel={`归入${category.name}`}
                      onPress={() => void assignToCategory(category.id)}
                      style={({ pressed }) => [styles.menuRow, pressed && styles.menuRowPressed]}
                    >
                      <Ionicons name="folder-outline" size={20} color={colors.primary} />
                      <Text style={styles.menuRowText}>{category.name}</Text>
                      {assignTarget.categoryId === category.id ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
                    </Pressable>
                  ))}
                </>
              ) : (
                <>
                  <Text style={styles.sheetSectionTitle}>新建分类</Text>
                  <Field label="分类名" value={newCategoryName} onChangeText={setNewCategoryName} />
                  <Button label="创建分类" onPress={() => void addCategory()} disabled={!newCategoryName.trim()} />
                  <Text style={styles.sheetSectionTitle}>已有分类</Text>
                  {categories.length ? categories.map((category) => {
                    const count = projects.filter((project) => project.categoryId === category.id).length;
                    const renaming = renamingCategory?.id === category.id;
                    return renaming ? (
                      <View key={category.id} style={styles.categoryEditRow}>
                        <Field label="分类名" value={renamingCategory.name} onChangeText={(value) => setRenamingCategory({ id: category.id, name: value })} />
                        <View style={styles.categoryActions}>
                          <Button label="取消" variant="secondary" onPress={() => setRenamingCategory(null)} />
                          <Button label="保存" onPress={() => void saveCategoryRename()} disabled={!renamingCategory.name.trim()} />
                        </View>
                      </View>
                    ) : (
                      <View key={category.id} style={styles.categoryRow}>
                        <View style={[styles.categoryRow, { flex: 1 }]}>
                          <Text style={[styles.title, { fontSize: 14 }]}>{category.name}</Text>
                          <Text style={styles.categoryMeta}>{count} 部作品</Text>
                        </View>
                        <Pressable accessibilityLabel={`重命名 ${category.name}`} onPress={() => setRenamingCategory({ id: category.id, name: category.name })} style={styles.iconButton}>
                          <Ionicons name="create-outline" size={19} color={colors.textMuted} />
                        </Pressable>
                        <Pressable accessibilityLabel={`删除 ${category.name}`} onPress={() => removeCategory(category)} style={styles.iconButton}>
                          <Ionicons name="trash-outline" size={19} color={colors.textMuted} />
                        </Pressable>
                      </View>
                    );
                  }) : <Text style={styles.categorySectionHint}>还没有分类，先创建一个。</Text>}
                </>
              )}
            </PlainScrollView>
          </View>
        </KeyboardAvoidingView>
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
  quickAction: { flex: 1, minHeight: 54, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: colors.background },
  quickActionDisabled: { opacity: 0.48 },
  quickActionText: { color: colors.text, fontSize: 15, fontWeight: "700" },
  errorWrap: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  list: { paddingVertical: spacing.sm },
  emptyList: { flexGrow: 1 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginLeft: 88 },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.sm, paddingVertical: 8, marginBottom: 2 },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  cover: { width: 52, height: 70, borderRadius: 8, alignItems: "flex-end", justifyContent: "center", overflow: "hidden" },
  coverImage: { width: 52, height: 70 },
  coverText: { color: "rgba(255,255,255,0.85)", fontSize: 34, fontWeight: "800", lineHeight: 40, marginBottom: 2 },
  statsRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, marginTop: 6 },
  meter: { width: 56, height: 4, borderRadius: 99, backgroundColor: colors.surfaceMuted, overflow: "hidden" },
  meterFill: { height: 4, borderRadius: 99, backgroundColor: colors.primary },
  statsText: { flex: 1, color: colors.textMuted, fontSize: 10.5 },
  headerActions: { flexDirection: "row", alignItems: "center" },
  shelfRow: { paddingHorizontal: 14, marginBottom: 2 },
  shelfBooks: { flexDirection: "row", alignItems: "flex-end", gap: 10, paddingHorizontal: 6 },
  shelfCell: { alignItems: "center" },
  bookObject: { width: "100%", aspectRatio: 3 / 4, borderRadius: 10, overflow: "hidden", justifyContent: "center" },
  bookShadowImage: { position: "absolute", left: 4, top: 0, width: "100%", height: "100%", borderRadius: 10 },
  bookSpine: { position: "absolute", left: 0, top: 0, bottom: 0, width: "9%", backgroundColor: "#EDE6D8", borderRightWidth: 1, borderRightColor: "rgba(0,0,0,0.10)" },
  bookCoverTextWrap: { alignSelf: "stretch", alignItems: "center", gap: 2, paddingHorizontal: 18 },
  bookCoverLine: { color: "rgba(255,255,255,0.95)", fontSize: 16, fontWeight: "800", letterSpacing: 1 },
  bookCoverLineLead: { fontSize: 20 },
  shelfLabels: { flexDirection: "row", gap: 10, marginTop: 8 },
  shelfLabelCell: { alignItems: "center" },
  gridCover: { width: "100%", aspectRatio: 3 / 4, borderRadius: 10, alignItems: "flex-end", justifyContent: "center", overflow: "hidden" },
  gridCoverImage: { width: "100%", height: "100%" },
  gridCoverText: { color: "rgba(255,255,255,0.85)", fontSize: 40, fontWeight: "800", lineHeight: 46, marginBottom: 2 },
  gridName: { alignSelf: "stretch", fontSize: 12, fontWeight: "600", textAlign: "center" },
  gridStats: { alignSelf: "stretch", fontSize: 10, color: colors.textMuted, textAlign: "center" },
  shelfMenuBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9 },
  shelfMenuCard: { position: "absolute", top: 100, right: 18, width: 176, backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingVertical: 4, zIndex: 10, elevation: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 10 },
  menuBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  sheetBackdropFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  sheetHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  sheetTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  sheetClose: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  sheetScroll: { maxHeight: 460 },
  sheetScrollContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, gap: spacing.sm },
  sheetSectionTitle: { marginTop: spacing.xs, color: colors.textMuted, fontSize: 12, fontWeight: "700" },
  menuSheet: { maxHeight: "80%", paddingVertical: spacing.sm, paddingTop: spacing.md, paddingBottom: spacing.xl, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, backgroundColor: colors.background },
  menuTitle: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xs, color: colors.textMuted, fontSize: 13 },
  menuRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 52, paddingHorizontal: spacing.lg },
  menuRowPressed: { backgroundColor: colors.surfaceMuted },
  menuRowDisabled: { opacity: 0.55 },
  shelfTitleButton: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  shelfTitleText: { color: colors.text, fontSize: 16, fontWeight: "700" },
  categoryPanel: { position: "absolute", top: 104, left: 16, right: 16, backgroundColor: colors.background, borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: spacing.sm, flexDirection: "row", flexWrap: "wrap", gap: 8, zIndex: 10, elevation: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 10 },
  shelfChipsRow: { marginTop: 2 },
  shelfChipsContent: { flexDirection: "row", gap: 8, paddingHorizontal: 14, paddingVertical: 4 },
  shelfChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  shelfChipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  shelfChipText: { color: colors.text, fontSize: 13 },
  shelfChipTextActive: { color: "#FFFFFF" },
  categoryRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  categoryEditRow: { paddingVertical: spacing.sm },
  categoryHint: { marginLeft: "auto", color: colors.textMuted, fontSize: 12 },
  categorySectionHint: { color: colors.textMuted, fontSize: 13, lineHeight: 19, paddingVertical: 6 },
  categoryActions: { flexDirection: "row", gap: 10, marginTop: 8 },
  categoryMeta: { color: colors.textMuted, fontSize: 12, marginTop: 2 },
  menuRowHint: { marginLeft: "auto", color: colors.textMuted, fontSize: 12 },
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
