// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { Button, EmptyState, ErrorNotice, Field, Header, PlainScrollView, Screen, SheetBackdrop, TopSheet } from "@/components/ui";
import { ensureEditorFontLoaded } from "@/settings/font-loader";
import { exportNovel, type ExportScope, type NovelExportFormat } from "@/lib/export";
import { countNotesUnder, deleteNotesUnder } from "@/data/note-repositories";
import {
  createChapter,
  createVolume,
  deleteChapter,
  deleteChapterVersion,
  deleteVolume,
  getProject,
  getSetting,
  listChapterVersions,
  listChapters,
  listVolumes,
  renameChapter,
  renameVolume,
  restoreChapterVersion,
  saveChapter,
  listProjects,
} from "@/data/repositories";
import {
  getPendingChapterStyleEvolution,
  markChapterStyleEvolved,
  recordLatestAuthorRevision,
} from "@/data/chapter-draft-repositories";
import {
  getActiveStyleProfile,
  listStyleProfiles,
  setActiveStyleProfile,
} from "@/data/style-repositories";
import { resolveModelSelection } from "@/llm/selection";
import { editorFontFamily, readEditorPrefs, type EditorFontId } from "@/settings/editor-prefs";
import { evolveAuthorStyle } from "@/settings/lorn-style-plugin";
import { useAppStore } from "@/store/app-store";
import { colors, radius, spacing } from "@/theme";
import type { Chapter, ChapterDraftSnapshot, ChapterVersion, Project, StyleProfile, Volume } from "@/types";

const AUTO_SAVE_DELAY_MS = 1_000;

/** 历史版本时间戳：今天只显示时分，跨天带月日。 */
function formatVersionTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const time = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return date.toDateString() === new Date().toDateString()
    ? time
    : `${date.getMonth() + 1}月${date.getDate()}日 ${time}`;
}

/** 这一版是怎么留下来的。 */
function versionReasonLabel(reason: string): string {
  if (reason === "restore") return "恢复前留存";
  if (reason === "manual") return "手动保存";
  return "自动保存";
}

/** 列表行摘要：正文压成一行，够认出是哪一版就行。 */
function versionSummary(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  return flat ? (flat.length > 46 ? `${flat.slice(0, 46)}…` : flat) : "（空正文）";
}

type DraftState = {
  chapterId: string;
  title: string;
  content: string;
  dirty: boolean;
  version: number;
};

type DirectoryTarget =
  | { kind: "volume"; volume: Volume }
  | { kind: "chapter"; chapter: Chapter };

type NameDialog =
  | { kind: "create-volume" }
  | { kind: "rename-volume"; volume: Volume }
  | { kind: "create-chapter"; volume: Volume }
  | { kind: "rename-chapter"; chapter: Chapter };

export function WritingScreen() {
  const projectId = useAppStore((state) => state.currentProjectId);
  const setCurrentProject = useAppStore((state) => state.setCurrentProject);
  const currentChapterId = useAppStore((state) => state.currentChapterId);
  const setCurrentChapter = useAppStore((state) => state.setCurrentChapter);
  const refreshData = useAppStore((state) => state.refreshData);
  const revision = useAppStore((state) => state.dataRevision);
  const [project, setProject] = useState<Project | null>(null);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoSaveDelay, setAutoSaveDelay] = useState(AUTO_SAVE_DELAY_MS);
  const [editorFontSize, setEditorFontSize] = useState(17);
  const [editorFont, setEditorFont] = useState<EditorFontId>("system");
  const [chapterPickerVisible, setChapterPickerVisible] = useState(false);
  const [directoryTarget, setDirectoryTarget] = useState<DirectoryTarget | null>(null);
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [exportPickerVisible, setExportPickerVisible] = useState(false);
  const [headerMenuVisible, setHeaderMenuVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<NovelExportFormat>("markdown");
  const [projectPickerVisible, setProjectPickerVisible] = useState(false);
  const [projectPickerList, setProjectPickerList] = useState<Project[]>([]);
  const [editing, setEditing] = useState(false);
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);
  const [activeStyleProfile, setActiveStyleProfileState] = useState<StyleProfile | null>(null);
  const [stylePickerVisible, setStylePickerVisible] = useState(false);
  const [pendingEvolution, setPendingEvolution] = useState<ChapterDraftSnapshot | null>(null);
  const [evolvingStyle, setEvolvingStyle] = useState(false);
  const [fontReadyTick, setFontReadyTick] = useState(0);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [historyList, setHistoryList] = useState<ChapterVersion[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<ChapterVersion | null>(null);
  const [restoringVersion, setRestoringVersion] = useState(false);
  const draftRef = useRef<DraftState>({ chapterId: "", title: "", content: "", dirty: false, version: 0 });
  const savingRef = useRef(false);
  const persistDraftRef = useRef<(force: boolean) => Promise<boolean>>(async () => true);

  // 每次回到写作页都重读一次编辑器设置：
  // 原先只在挂载时读（useEffect + 空依赖），导致在设置里改了字号／字体后切回来不生效。
  useFocusEffect(useCallback(() => {
    void Promise.all([
      getSetting("general.autoSaveDelay"),
      readEditorPrefs(),
    ]).then(([delayValue, prefs]) => {
      const delay = Number(delayValue);
      if (Number.isInteger(delay) && delay >= 250 && delay <= 10_000) setAutoSaveDelay(delay);
      setEditorFontSize(prefs.fontSize);
      setEditorFont(prefs.fontFamily);
      // 文楷是运行时下载的字体：进入写作页时补一次注册，注册完成后再渲染一次。
      if (prefs.fontFamily === "wenkai") {
        void ensureEditorFontLoaded().then((ready) => { if (ready) setFontReadyTick((tick) => tick + 1); });
      }
    }).catch((settingsError) => {
      setError(settingsError instanceof Error ? settingsError.message : String(settingsError));
    });
  }, []));

  const activeChapter = useMemo(
    () => chapters.find((chapter) => chapter.id === currentChapterId) ?? chapters[0] ?? null,
    [chapters, currentChapterId],
  );

  /** 正文的字号、行高与字体，集中一处，编辑框与预览共用。 */
  const editorTextStyle = useMemo(
    () => ({
      fontSize: editorFontSize,
      lineHeight: Math.round(editorFontSize * 1.65),
      fontFamily: editorFontFamily(editorFont),
    }),
    [editorFontSize, editorFont, fontReadyTick],
  );

  const activeVolume = useMemo(
    () => volumes.find((volume) => volume.id === activeChapter?.volumeId) ?? null,
    [activeChapter?.volumeId, volumes],
  );

  const directorySections = useMemo(() => {
    const grouped = new Map<string, Chapter[]>();
    for (const chapter of chapters) {
      const items = grouped.get(chapter.volumeId) ?? [];
      items.push(chapter);
      grouped.set(chapter.volumeId, items);
    }
    return volumes.map((volume) => ({ volume, data: grouped.get(volume.id) ?? [] }));
  }, [chapters, volumes]);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setProject(null);
      setVolumes([]);
      setChapters([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    void Promise.all([
      getProject(projectId),
      listVolumes(projectId),
      listChapters(projectId),
      listStyleProfiles(projectId),
      getActiveStyleProfile(projectId),
    ])
      .then(([nextProject, nextVolumes, nextChapters, nextStyleProfiles, nextActiveStyle]) => {
        if (cancelled) return;
        setProject(nextProject);
        setVolumes(nextVolumes);
        setChapters(nextChapters);
        setStyleProfiles(nextStyleProfiles);
        setActiveStyleProfileState(nextActiveStyle);
        const selectedId = useAppStore.getState().currentChapterId;
        if (!selectedId || !nextChapters.some((chapter) => chapter.id === selectedId)) {
          setCurrentChapter(nextChapters[0]?.id ?? null);
        }
      })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, revision, setCurrentChapter]);

  useEffect(() => {
    if (!activeChapter || (draftRef.current.chapterId === activeChapter.id && draftRef.current.dirty)) return;
    setTitle(activeChapter.title);
    setContent(activeChapter.content);
    setSavedAt(null);
    setDirty(false);
    draftRef.current = {
      chapterId: activeChapter.id,
      title: activeChapter.title,
      content: activeChapter.content,
      dirty: false,
      version: draftRef.current.version + 1,
    };
    void getPendingChapterStyleEvolution(activeChapter.id)
      .then(setPendingEvolution)
      .catch((snapshotError) => setError(snapshotError instanceof Error ? snapshotError.message : String(snapshotError)));
  }, [activeChapter?.id, activeChapter?.updatedAt]);

  useEffect(() => {
    setEditing(false);
  }, [activeChapter?.id]);

  const clearDraft = () => {
    setTitle("");
    setContent("");
    setSavedAt(null);
    setDirty(false);
    draftRef.current = {
      chapterId: "",
      title: "",
      content: "",
      dirty: false,
      version: draftRef.current.version + 1,
    };
  };

  const persistDraft = async (force: boolean): Promise<boolean> => {
    const draft = draftRef.current;
    if (!draft.chapterId || (!force && !draft.dirty)) return true;
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const nextTitle = draft.title.trim() || "未命名章节";
      await saveChapter(draft.chapterId, nextTitle, draft.content);
      const snapshot = await recordLatestAuthorRevision(draft.chapterId, draft.content);
      const updatedAt = new Date().toISOString();
      const savedTime = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      setChapters((current) => current.map((chapter) => chapter.id === draft.chapterId
        ? { ...chapter, title: nextTitle, content: draft.content, updatedAt }
        : chapter));
      if (draftRef.current.chapterId === draft.chapterId && draftRef.current.version === draft.version) {
        setTitle(nextTitle);
        draftRef.current = { ...draftRef.current, title: nextTitle, dirty: false };
        setDirty(false);
      }
      setSavedAt(savedTime);
      setPendingEvolution(snapshot?.status === "revised" && snapshot.authorRevision !== snapshot.aiDraft ? snapshot : null);
      return true;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  useEffect(() => {
    persistDraftRef.current = persistDraft;
  });

  useEffect(() => {
    if (!dirty || saving) return;
    const timeout = setTimeout(() => {
      void persistDraft(false);
    }, autoSaveDelay);
    return () => clearTimeout(timeout);
  }, [dirty, title, content, activeChapter?.id, autoSaveDelay, saving]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") void persistDraftRef.current(false);
    });
    return () => {
      subscription.remove();
      void persistDraftRef.current(false);
    };
  }, []);

  const updateDraft = (nextTitle: string, nextContent: string) => {
    setTitle(nextTitle);
    setContent(nextContent);
    setSavedAt(null);
    setDirty(true);
    draftRef.current = {
      chapterId: activeChapter?.id ?? draftRef.current.chapterId,
      title: nextTitle,
      content: nextContent,
      dirty: true,
      version: draftRef.current.version + 1,
    };
  };

  const selectChapter = async (chapterId: string) => {
    if (chapterId === activeChapter?.id) {
      setChapterPickerVisible(false);
      return;
    }
    if (savingRef.current) {
      setError("章节正在保存，请稍后再切换");
      return;
    }
    if (!await persistDraft(false)) return;
    setCurrentChapter(chapterId);
    setChapterPickerVisible(false);
  };

  const openNameDialog = async (dialog: NameDialog, initialValue: string) => {
    if (savingRef.current) {
      setError("章节正在保存，请稍后再操作");
      return;
    }
    if (!await persistDraft(false)) return;
    setDirectoryTarget(null);
    setChapterPickerVisible(false);
    setNameValue(initialValue);
    setNameDialog(dialog);
  };

  const submitNameDialog = async () => {
    if (!projectId || !nameDialog || !nameValue.trim()) return;
    setNameSaving(true);
    setError(null);
    try {
      if (nameDialog.kind === "create-volume") {
        const volume = await createVolume(projectId, nameValue);
        setVolumes((current) => [...current, volume].sort((left, right) => left.orderIndex - right.orderIndex));
      } else if (nameDialog.kind === "rename-volume") {
        const volume = await renameVolume(nameDialog.volume.id, nameValue);
        setVolumes((current) => current.map((item) => item.id === volume.id ? volume : item));
      } else if (nameDialog.kind === "create-chapter") {
        const chapter = await createChapter(projectId, nameDialog.volume.id, nameValue);
        setChapters((current) => [...current, chapter]);
        setCurrentChapter(chapter.id);
      } else {
        const chapter = await renameChapter(nameDialog.chapter.id, nameValue);
        setChapters((current) => current.map((item) => item.id === chapter.id ? chapter : item));
        if (activeChapter?.id === chapter.id) {
          setTitle(chapter.title);
          draftRef.current = {
            ...draftRef.current,
            title: chapter.title,
            dirty: false,
            version: draftRef.current.version + 1,
          };
          setDirty(false);
        }
      }
      setNameDialog(null);
      setNameValue("");
      refreshData();
    } catch (nameError) {
      setError(nameError instanceof Error ? nameError.message : String(nameError));
    } finally {
      setNameSaving(false);
    }
  };

  const removeChapter = async (chapter: Chapter, removeNotes: boolean) => {
    if (savingRef.current) {
      setError("章节正在保存，请稍后再删除");
      return;
    }
    if (chapter.id === activeChapter?.id && !await persistDraft(false)) return;
    setError(null);
    try {
      // 先删笔记再删章节；不删的话外键 SET NULL 会让这些笔记上浮到卷级。
      if (removeNotes) await deleteNotesUnder({ chapterId: chapter.id });
      await deleteChapter(chapter.id);
      const nextChapters = chapters.filter((item) => item.id !== chapter.id);
      setChapters(nextChapters);
      if (chapter.id === activeChapter?.id) {
        const nextChapter = nextChapters[0] ?? null;
        setCurrentChapter(nextChapter?.id ?? null);
        if (!nextChapter) clearDraft();
      }
      refreshData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const confirmDeleteChapter = async (chapter: Chapter) => {
    setDirectoryTarget(null);
    setChapterPickerVisible(false);
    const noteCount = await countNotesUnder({ chapterId: chapter.id }).catch(() => 0);
    if (!noteCount) {
      Alert.alert("删除章节", "确定删除《" + chapter.title + "》？正文和本地索引会一并删除。", [
        { text: "取消", style: "cancel" },
        { text: "删除", style: "destructive", onPress: () => { void removeChapter(chapter, false); } },
      ]);
      return;
    }
    Alert.alert(
      "删除章节",
      "《" + chapter.title + "》有 " + noteCount + " 条笔记。正文和本地索引会一并删除，笔记怎么处理？",
      [
        { text: "取消", style: "cancel" },
        { text: "保留笔记", onPress: () => { void removeChapter(chapter, false); } },
        { text: "一并删除", style: "destructive", onPress: () => { void removeChapter(chapter, true); } },
      ],
    );
  };

  const removeVolume = async (volume: Volume, removeNotes: boolean) => {
    if (savingRef.current) {
      setError("章节正在保存，请稍后再删除");
      return;
    }
    const removesActiveChapter = activeChapter?.volumeId === volume.id;
    if (removesActiveChapter && !await persistDraft(false)) return;
    setError(null);
    try {
      if (removeNotes) await deleteNotesUnder({ volumeId: volume.id });
      await deleteVolume(volume.id);
      const nextVolumes = volumes.filter((item) => item.id !== volume.id);
      const nextChapters = chapters.filter((chapter) => chapter.volumeId !== volume.id);
      setVolumes(nextVolumes);
      setChapters(nextChapters);
      if (removesActiveChapter) {
        const nextChapter = nextChapters[0] ?? null;
        setCurrentChapter(nextChapter?.id ?? null);
        if (!nextChapter) clearDraft();
      }
      refreshData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const confirmDeleteVolume = (volume: Volume) => {
    setDirectoryTarget(null);
    setChapterPickerVisible(false);
    if (volumes.length <= 1) {
      Alert.alert("无法删除", "每部作品至少需要保留一卷，可以改为重命名。");
      return;
    }
    const chapterCount = chapters.filter((chapter) => chapter.volumeId === volume.id).length;
    const detail = chapterCount
      ? "其中 " + chapterCount + " 章正文和本地索引会一并删除。"
      : "该卷目前没有章节。";
    void countNotesUnder({ volumeId: volume.id }).catch(() => 0).then((noteCount) => {
      if (!noteCount) {
        Alert.alert("删除卷", "确定删除《" + volume.title + "》？" + detail, [
          { text: "取消", style: "cancel" },
          { text: "删除", style: "destructive", onPress: () => { void removeVolume(volume, false); } },
        ]);
        return;
      }
      Alert.alert(
        "删除卷",
        "《" + volume.title + "》及其章节共有 " + noteCount + " 条笔记。" + detail + "笔记怎么处理？",
        [
          { text: "取消", style: "cancel" },
          { text: "保留笔记", onPress: () => { void removeVolume(volume, false); } },
          { text: "一并删除", style: "destructive", onPress: () => { void removeVolume(volume, true); } },
        ],
      );
    });
  };

  const openNewChapter = () => {
    const volume = activeVolume ?? volumes[0];
    if (volume) {
      void openNameDialog(
        { kind: "create-chapter", volume },
        "第" + (chapters.length + 1) + "章",
      );
    } else {
      void openNameDialog({ kind: "create-volume" }, "第一卷");
    }
  };

  const saveAndPreview = async () => {
    if (await persistDraft(true)) setEditing(false);
  };

  const chooseStyle = async (profile: StyleProfile | null) => {
    if (!projectId || evolvingStyle) return;
    setError(null);
    try {
      await setActiveStyleProfile(projectId, profile?.id ?? null);
      setActiveStyleProfileState(profile);
      setStylePickerVisible(false);
    } catch (styleError) {
      setError(styleError instanceof Error ? styleError.message : String(styleError));
    }
  };

  const evolveFromRevision = async () => {
    if (!projectId || !activeChapter || !pendingEvolution || evolvingStyle) return;
    setEvolvingStyle(true);
    setError(null);
    try {
      if (!await persistDraft(false)) return;
      const selection = await resolveModelSelection();
      const evolved = await evolveAuthorStyle({
        projectId,
        aiDraft: pendingEvolution.aiDraft,
        authorRevision: pendingEvolution.authorRevision ?? content,
        selection,
      });
      await markChapterStyleEvolved(pendingEvolution.id);
      setStyleProfiles((current) => [
        evolved.profile,
        ...current.filter((profile) => profile.id !== evolved.profile.id),
      ]);
      setActiveStyleProfileState(evolved.profile);
      setPendingEvolution(null);
      refreshData();
      Alert.alert("作者文风已进化", "已保存为“" + evolved.profile.name + " V" + evolved.profile.version + "”，后续创作将使用这个版本。");
    } catch (evolutionError) {
      setError(evolutionError instanceof Error ? evolutionError.message : String(evolutionError));
    } finally {
      setEvolvingStyle(false);
    }
  };

  const handleExport = async (scope: ExportScope) => {
    if (!project) return;
    const chapterId = activeChapter?.id;
    const volumeId = activeVolume?.id;
    setExporting(true);
    setError(null);
    try {
      if (!await persistDraft(false)) return;
      const [freshVolumes, freshChapters] = await Promise.all([
        listVolumes(project.id),
        listChapters(project.id),
      ]);
      await exportNovel({ project, volumes: freshVolumes, chapters: freshChapters, scope, chapterId, volumeId, format: exportFormat });
      setExportPickerVisible(false);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : String(exportError));
    } finally {
      setExporting(false);
    }
  };

  const openChapterHistory = async () => {
    const chapter = activeChapter;
    if (!chapter) return;
    setHeaderMenuVisible(false);
    setHistoryPreview(null);
    setHistoryList([]);
    setHistoryVisible(true);
    setHistoryLoading(true);
    setError(null);
    try {
      setHistoryList(await listChapterVersions(chapter.id));
    } catch (historyError) {
      setError(historyError instanceof Error ? historyError.message : String(historyError));
    } finally {
      setHistoryLoading(false);
    }
  };

  const restoreVersion = (version: ChapterVersion) => {
    Alert.alert(
      "恢复这一版",
      `「${activeChapter?.title ?? "本章"}」的正文会替换为 ${formatVersionTime(version.createdAt)}（${version.characterCount} 字）那一版；当前正文会先留一版历史。`,
      [
        { text: "取消", style: "cancel" },
        {
          text: "恢复",
          onPress: () => {
            void (async () => {
              setRestoringVersion(true);
              setError(null);
              try {
                // 编辑器里还没落盘的字先保存，否则恢复会把这部分盖掉
                await persistDraft(true);
                const restored = await restoreChapterVersion(version.id);
                setChapters((current) => current.map((chapter) => chapter.id === restored.id ? restored : chapter));
                setTitle(restored.title);
                setContent(restored.content);
                setSavedAt(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
                setDirty(false);
                setEditing(true);
                draftRef.current = {
                  chapterId: restored.id,
                  title: restored.title,
                  content: restored.content,
                  dirty: false,
                  version: draftRef.current.version + 1,
                };
                setHistoryList(await listChapterVersions(restored.id));
                setHistoryPreview(null);
              } catch (restoreError) {
                setError(restoreError instanceof Error ? restoreError.message : String(restoreError));
              } finally {
                setRestoringVersion(false);
              }
            })();
          },
        },
      ],
    );
  };

  const removeVersion = (version: ChapterVersion) => {
    void deleteChapterVersion(version.id)
      .then(() => {
        setHistoryList((current) => current.filter((item) => item.id !== version.id));
        setHistoryPreview((current) => (current?.id === version.id ? null : current));
      })
      .catch((deleteError) => setError(deleteError instanceof Error ? deleteError.message : String(deleteError)));
  };

  const nameDialogTitle = nameDialog?.kind === "create-volume"
    ? "新建卷"
    : nameDialog?.kind === "rename-volume"
      ? "重命名卷"
      : nameDialog?.kind === "create-chapter"
        ? "新建章节"
        : "重命名章节";
  const nameDialogLabel = nameDialog?.kind === "create-volume" || nameDialog?.kind === "rename-volume"
    ? "卷名"
    : "章节名";

  if (!projectId) return <Screen><EmptyState title="请先从书架选择一部作品" /></Screen>;
  if (loading) return <Screen><Header title="写作" /><View style={styles.loading}><Text style={styles.muted}>正在打开作品...</Text></View></Screen>;

  return (
    <Screen>
      <Header
        title={project?.title ?? "写作"}
        action={(
          <View style={styles.headerActions}>
            <Pressable
              accessibilityLabel="切换作品"
              onPress={() => {
                void listProjects().then((list) => { setProjectPickerList(list); setProjectPickerVisible(true); }).catch(() => {});
              }}
              style={styles.iconButton}
            >
              <Ionicons name="swap-horizontal-outline" size={22} color={colors.primary} />
            </Pressable>
            <Pressable accessibilityLabel="更多操作" onPress={() => setHeaderMenuVisible((value) => !value)} style={styles.iconButton}>
              <Ionicons name="ellipsis-horizontal" size={22} color={colors.primary} />
            </Pressable>
          </View>
        )}
      />
      {headerMenuVisible ? (
        <>
          <Pressable accessibilityLabel="关闭更多操作" onPress={() => setHeaderMenuVisible(false)} style={styles.headerMenuBackdrop} />
          <View style={styles.headerMenuCard}>
            <Pressable
              accessibilityLabel="作品目录"
              onPress={() => { setHeaderMenuVisible(false); setChapterPickerVisible(true); }}
              style={({ pressed }) => [styles.headerMenuRow, pressed && styles.headerMenuRowPressed]}
            >
              <Ionicons name="list-outline" size={20} color={colors.primary} />
              <Text style={styles.headerMenuText}>作品目录</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="导出作品"
              onPress={() => { setHeaderMenuVisible(false); setExportPickerVisible(true); }}
              style={({ pressed }) => [styles.headerMenuRow, pressed && styles.headerMenuRowPressed]}
            >
              <Ionicons name="share-outline" size={20} color={colors.primary} />
              <Text style={styles.headerMenuText}>导出作品</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="新建卷"
              onPress={() => { setHeaderMenuVisible(false); void openNameDialog({ kind: "create-volume" }, "第一卷"); }}
              style={({ pressed }) => [styles.headerMenuRow, pressed && styles.headerMenuRowPressed]}
            >
              <Ionicons name="folder-open-outline" size={20} color={colors.primary} />
              <Text style={styles.headerMenuText}>新建卷</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="新建章节"
              onPress={() => { setHeaderMenuVisible(false); openNewChapter(); }}
              style={({ pressed }) => [styles.headerMenuRow, pressed && styles.headerMenuRowPressed]}
            >
              <Ionicons name="document-text-outline" size={20} color={colors.primary} />
              <Text style={styles.headerMenuText}>新建章节</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="章节历史版本"
              disabled={!activeChapter}
              onPress={() => { void openChapterHistory(); }}
              style={({ pressed }) => [styles.headerMenuRow, pressed && styles.headerMenuRowPressed]}
            >
              <Ionicons name="time-outline" size={20} color={activeChapter ? colors.primary : colors.textMuted} />
              <Text style={[styles.headerMenuText, !activeChapter && styles.headerMenuTextDisabled]}>历史版本</Text>
            </Pressable>
          </View>
        </>
      ) : null}
            {/* behavior=height 会按键盘高度设置容器高度；键盘收起后偶发拿到过期高度，导致编辑器整体变矮（footer 悬在页面中部）。padding 型只加内边距，收起即恢复。 */}
      <KeyboardAvoidingView style={styles.flex} behavior="padding" automaticOffset>
        {activeChapter && !editing ? (
          <View style={styles.chapterBar}>
            <View style={styles.previewHeading}>
              <Text numberOfLines={1} style={styles.previewVolume}>{activeVolume?.title ?? "作品目录"}</Text>
              <Text style={styles.previewTitle}>{title || "未命名章节"}</Text>
              <Text style={styles.previewMeta}>{content.replace(/\s/g, "").length + " 字" + (savedAt ? " · " + savedAt + " 已保存" : "")}</Text>
            </View>
            <Pressable accessibilityLabel="编辑章节" onPress={() => setEditing(true)} style={styles.editButton}>
              <Ionicons name="create-outline" size={22} color={colors.primary} />
              <Text style={styles.editButtonText}>编辑</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable accessibilityRole="button" onPress={() => setStylePickerVisible(true)} style={styles.styleSelector}>
          <Ionicons name="color-wand-outline" size={17} color={activeStyleProfile ? colors.primary : colors.textMuted} />
          <Text numberOfLines={1} style={[styles.styleSelectorText, activeStyleProfile && styles.styleSelectorTextActive]}>
            {activeStyleProfile ? activeStyleProfile.name + " V" + activeStyleProfile.version : "不使用创作文风"}
          </Text>
          <Ionicons name="chevron-down" size={16} color={colors.textMuted} />
        </Pressable>
        {error ? <View style={styles.errorWrap}><ErrorNotice message={error} /></View> : null}
        {activeChapter ? (
          <View style={styles.editor}>
            {editing ? (
              <>
                <TextInput
                  value={title}
                  onChangeText={(value) => updateDraft(value, content)}
                  style={styles.titleInput}
                  placeholder="章节标题"
                  placeholderTextColor={colors.textMuted}
                  maxLength={200}
                />
                <TextInput
                  value={content}
                  onChangeText={(value) => updateDraft(title, value)}
                  style={[styles.contentInput, editorTextStyle]}
                  placeholder="开始写作..."
                  placeholderTextColor={colors.textMuted}
                  multiline
                  textAlignVertical="top"
                  autoCorrect
                />
                <View style={styles.editorFooter}>
                  <Text style={styles.counter}>
                    {content.replace(/\s/g, "").length + " 字" + (dirty ? " · 未保存" : savedAt ? " · " + savedAt + " 已保存" : "")}
                  </Text>
                  <Button label={saving ? "保存中" : "保存并预览"} onPress={() => { void saveAndPreview(); }} disabled={saving} loading={saving} />
                </View>
              </>
            ) : (
              <View style={styles.preview}>
                <PlainScrollView style={styles.previewScroll} contentContainerStyle={styles.previewContent}>
                  <Text selectable style={[styles.previewText, editorTextStyle]}>
                    {content || "本章暂无正文，点击右上角编辑开始写作。"}
                  </Text>
                </PlainScrollView>
                <View style={styles.editorFooter}>
                  <Text style={styles.counter}>{dirty ? "正在保存修改..." : "预览模式"}</Text>
                  <View style={styles.previewActions}>
                    {pendingEvolution ? (
                      <Button label="进化作者文风" variant="secondary" onPress={() => { void evolveFromRevision(); }} disabled={saving || evolvingStyle} loading={evolvingStyle} />
                    ) : null}
                    {dirty ? <Button label="保存" onPress={() => { void persistDraft(true); }} disabled={saving} loading={saving} /> : null}
                  </View>
                </View>
              </View>
            )}
          </View>
        ) : volumes[0] ? (
          <EmptyState
            title={"《" + volumes[0].title + "》还没有章节"}
            action={<Button label="新建章节" onPress={openNewChapter} />}
          />
        ) : (
          <EmptyState
            title="还没有卷"
            action={<Button label="新建卷" onPress={() => { void openNameDialog({ kind: "create-volume" }, "第一卷"); }} />}
          />
        )}
      </KeyboardAvoidingView>

      <Modal visible={projectPickerVisible} transparent animationType="slide" onRequestClose={() => setProjectPickerVisible(false)}>
        <SheetBackdrop onPress={() => setProjectPickerVisible(false)}>
          <View style={styles.directorySheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>切换作品</Text>
              <Pressable accessibilityLabel="关闭作品列表" onPress={() => setProjectPickerVisible(false)} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <PlainScrollView style={styles.previewScroll} contentContainerStyle={styles.previewContent}>
              {projectPickerList.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => {
                    setProjectPickerVisible(false);
                    if (item.id !== projectId) setCurrentProject(item.id);
                  }}
                  style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 10, borderRadius: 12, backgroundColor: colors.surfaceMuted, marginBottom: 6 }}
                >
                  <Ionicons name={item.id === projectId ? "radio-button-on" : "radio-button-off"} size={20} color={item.id === projectId ? colors.primary : colors.textMuted} />
                  <View style={{ flex: 1 }}>
                    <Text numberOfLines={1} style={{ color: colors.text, fontSize: 15, fontWeight: "600" }}>{item.title}</Text>
                    <Text numberOfLines={1} style={{ color: colors.textMuted, fontSize: 11 }}>{item.description || "暂无简介"}</Text>
                  </View>
                </Pressable>
              ))}
            </PlainScrollView>
          </View>
        </SheetBackdrop>
      </Modal>

      <Modal visible={stylePickerVisible} transparent animationType="slide" onRequestClose={() => setStylePickerVisible(false)}>
        <SheetBackdrop onPress={() => setStylePickerVisible(false)}>
          <View style={styles.actionSheet}>
            <View style={styles.exportHeader}>
              <View>
                <Text style={styles.sheetTitle}>选择创作文风</Text>
                <Text style={styles.styleSheetMeta}>会用于助手后续生成或修改正文</Text>
              </View>
              <Pressable accessibilityLabel="关闭文风列表" onPress={() => setStylePickerVisible(false)} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <PlainScrollView style={styles.styleList} contentContainerStyle={styles.styleListContent}>
              <Pressable onPress={() => void chooseStyle(null)} style={[styles.styleOption, !activeStyleProfile && styles.styleOptionActive]}>
                <Ionicons name={!activeStyleProfile ? "radio-button-on" : "radio-button-off"} size={20} color={!activeStyleProfile ? colors.primary : colors.textMuted} />
                <View style={styles.styleOptionCopy}>
                  <Text style={styles.styleOptionTitle}>不使用文风</Text>
                  <Text style={styles.styleOptionMeta}>只遵循本轮要求与作品设定</Text>
                </View>
              </Pressable>
              {styleProfiles.map((profile) => {
                const selected = profile.id === activeStyleProfile?.id;
                return (
                  <Pressable key={profile.id} onPress={() => void chooseStyle(profile)} style={[styles.styleOption, selected && styles.styleOptionActive]}>
                    <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={20} color={selected ? colors.primary : colors.textMuted} />
                    <View style={styles.styleOptionCopy}>
                      <Text style={styles.styleOptionTitle} numberOfLines={1}>{profile.name} V{profile.version}</Text>
                      <Text style={styles.styleOptionMeta}>{profile.kind === "author" ? "当前作品作者文风" : "参考小说文风"}</Text>
                    </View>
                  </Pressable>
                );
              })}
            </PlainScrollView>
          </View>
        </SheetBackdrop>
      </Modal>

      <Modal visible={chapterPickerVisible} transparent animationType="slide" onRequestClose={() => setChapterPickerVisible(false)}>
        <SheetBackdrop onPress={() => setChapterPickerVisible(false)}>
          <View style={styles.directorySheet}>
            <View style={styles.sheetHeader}>
              <Text style={styles.sheetTitle}>作品目录</Text>
              <View style={styles.sheetHeaderActions}>
                <Pressable
                  accessibilityLabel="新建卷"
                  onPress={() => { void openNameDialog({ kind: "create-volume" }, "第" + (volumes.length + 1) + "卷"); }}
                  style={styles.iconButton}
                >
                  <Ionicons name="folder-open-outline" size={22} color={colors.primary} />
                </Pressable>
                <Pressable accessibilityLabel="关闭目录" onPress={() => setChapterPickerVisible(false)} style={styles.iconButton}>
                  <Ionicons name="close" size={24} color={colors.textMuted} />
                </Pressable>
              </View>
            </View>
            <SectionList
              sections={directorySections}
              keyExtractor={(item) => item.id}
              stickySectionHeadersEnabled={false}
              contentContainerStyle={styles.directoryList}
              renderSectionHeader={({ section }) => (
                <View style={styles.volumeHeader}>
                  <Ionicons name="folder-open-outline" size={18} color={colors.accent} />
                  <Text numberOfLines={1} style={styles.volumeTitle}>{section.volume.title}</Text>
                  <Text style={styles.volumeCount}>{section.data.length + " 章"}</Text>
                  <Pressable
                    accessibilityLabel={"在" + section.volume.title + "中新建章节"}
                    onPress={() => {
                      void openNameDialog(
                        { kind: "create-chapter", volume: section.volume },
                        "第" + (chapters.length + 1) + "章",
                      );
                    }}
                    style={styles.rowAction}
                  >
                    <Ionicons name="add" size={21} color={colors.primary} />
                  </Pressable>
                  <Pressable
                    accessibilityLabel={"管理" + section.volume.title}
                    onPress={() => setDirectoryTarget({ kind: "volume", volume: section.volume })}
                    style={styles.rowAction}
                  >
                    <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
                  </Pressable>
                </View>
              )}
              renderItem={({ item }) => (
                <Pressable
                  onPress={() => { void selectChapter(item.id); }}
                  style={[styles.chapterRow, item.id === activeChapter?.id && styles.chapterRowActive]}
                >
                  <Ionicons
                    name="document-text-outline"
                    size={18}
                    color={item.id === activeChapter?.id ? colors.primary : colors.textMuted}
                  />
                  <Text numberOfLines={1} style={[styles.chapterRowText, item.id === activeChapter?.id && styles.chapterRowTextActive]}>
                    {item.title}
                  </Text>
                  {item.id === activeChapter?.id ? <Ionicons name="checkmark" size={20} color={colors.primary} /> : null}
                  <Pressable
                    accessibilityLabel={"管理" + item.title}
                    onPress={(event) => {
                      event.stopPropagation();
                      setDirectoryTarget({ kind: "chapter", chapter: item });
                    }}
                    style={styles.rowAction}
                  >
                    <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
                  </Pressable>
                </Pressable>
              )}
              ListEmptyComponent={(
                <EmptyState
                  title="还没有卷"
                  action={<Button label="新建卷" onPress={() => { void openNameDialog({ kind: "create-volume" }, "第一卷"); }} />}
                />
              )}
            />
          </View>
        </SheetBackdrop>
      </Modal>

      <Modal visible={historyVisible} transparent animationType="fade" onRequestClose={() => setHistoryVisible(false)}>
        <TopSheet
          title={historyPreview ? "版本预览" : "历史版本"}
          subtitle={(activeChapter?.title ?? "未选择章节") + " · 每章保留最近 30 版"}
          onClose={() => { setHistoryPreview(null); setHistoryVisible(false); }}
        >
          {historyPreview ? (
            <>
              {/* 面板顶栏只有标题与关闭，预览态要退回列表就放在内容首行，避免顶栏挤两颗按钮。 */}
              <Pressable
                accessibilityLabel="返回历史版本列表"
                onPress={() => setHistoryPreview(null)}
                style={({ pressed }) => [styles.historyBackRow, pressed && styles.rowPressed]}
              >
                <Ionicons name="arrow-back" size={18} color={colors.primary} />
                <Text style={styles.historyBackText}>历史版本</Text>
              </Pressable>
              <PlainScrollView style={styles.historyScroll} contentContainerStyle={styles.historyPreviewContent}>
                <Text style={styles.historyPreviewMeta}>
                  {formatVersionTime(historyPreview.createdAt) + " · " + historyPreview.characterCount + " 字 · " + versionReasonLabel(historyPreview.reason)}
                </Text>
                <Text style={styles.historyPreviewTitle}>{historyPreview.title}</Text>
                <Text selectable style={[styles.historyPreviewText, editorTextStyle]}>
                  {historyPreview.content || "这一版正文为空。"}
                </Text>
              </PlainScrollView>
              <View style={styles.historyFooter}>
                <Button
                  label={restoringVersion ? "恢复中" : "恢复这一版"}
                  onPress={() => restoreVersion(historyPreview)}
                  loading={restoringVersion}
                />
              </View>
            </>
          ) : historyLoading ? (
            <View style={styles.loading}><ActivityIndicator color={colors.primary} /></View>
          ) : (
            <PlainScrollView style={styles.historyScroll} contentContainerStyle={styles.historyList}>
              {historyList.length ? historyList.map((version) => (
                <Pressable
                  key={version.id}
                  onPress={() => setHistoryPreview(version)}
                  style={({ pressed }) => [styles.historyRow, pressed && styles.rowPressed]}
                >
                  <View style={styles.historyRowCopy}>
                    <View style={styles.historyRowTitleLine}>
                      <Text style={styles.historyRowTime}>{formatVersionTime(version.createdAt)}</Text>
                      <Text style={styles.historyRowBadge}>{versionReasonLabel(version.reason)}</Text>
                    </View>
                    <Text numberOfLines={1} style={styles.historyRowSummary}>{versionSummary(version.content)}</Text>
                    <Text style={styles.historyRowMeta}>{version.characterCount + " 字"}</Text>
                  </View>
                  <Pressable
                    accessibilityLabel="删除这一版历史"
                    onPress={(event) => { event.stopPropagation(); removeVersion(version); }}
                    hitSlop={8}
                    style={styles.iconButton}
                  >
                    <Ionicons name="trash-outline" size={19} color={colors.textMuted} />
                  </Pressable>
                </Pressable>
              )) : (
                <EmptyState title="还没有历史版本" />
              )}
            </PlainScrollView>
          )}
        </TopSheet>
      </Modal>

      <Modal visible={exportPickerVisible} transparent animationType="slide" onRequestClose={() => setExportPickerVisible(false)}>
        <SheetBackdrop onPress={() => setExportPickerVisible(false)}>
          <View style={styles.actionSheet}>
            <View style={styles.exportHeader}>
              <Text style={styles.actionTitle}>导出作品</Text>
              <Pressable accessibilityLabel="关闭导出选项" onPress={() => setExportPickerVisible(false)} style={styles.iconButton}>
                <Ionicons name="close" size={24} color={colors.textMuted} />
              </Pressable>
            </View>
            <View style={styles.exportFormatRow}>
              <Pressable
                accessibilityLabel="导出为 Markdown"
                onPress={() => setExportFormat("markdown")}
                style={[styles.exportFormatChip, exportFormat === "markdown" && styles.exportFormatChipActive]}
              >
                <Text style={[styles.exportFormatText, exportFormat === "markdown" && styles.exportFormatTextActive]}>Markdown</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="导出为纯文本"
                onPress={() => setExportFormat("txt")}
                style={[styles.exportFormatChip, exportFormat === "txt" && styles.exportFormatChipActive]}
              >
                <Text style={[styles.exportFormatText, exportFormat === "txt" && styles.exportFormatTextActive]}>纯文本（TXT）</Text>
              </Pressable>
              <Pressable
                accessibilityLabel="导出为 EPUB"
                onPress={() => setExportFormat("epub")}
                style={[styles.exportFormatChip, exportFormat === "epub" && styles.exportFormatChipActive]}
              >
                <Text style={[styles.exportFormatText, exportFormat === "epub" && styles.exportFormatTextActive]}>EPUB</Text>
              </Pressable>
            </View>
            <Text style={styles.exportFormatHint}>
              {exportFormat === "txt"
                ? "不带任何标记符号，适合直接投稿或粘贴到别处。"
                : exportFormat === "epub"
                  ? "按卷与章节生成电子书，带作品封面，可直接放进阅读器或电子书应用。"
                  : "带标题层级，适合再排版或导入其他写作工具。"}
            </Text>
            <Pressable disabled={exporting || !activeChapter} onPress={() => { void handleExport("chapter"); }} style={[styles.exportOption, (!activeChapter || exporting) && styles.exportOptionDisabled]}>
              <Ionicons name="document-text-outline" size={23} color={activeChapter ? colors.primary : colors.textMuted} />
              <View style={styles.exportOptionText}>
                <Text style={styles.exportOptionTitle}>当前章节</Text>
                <Text style={styles.exportOptionMeta} numberOfLines={1}>{activeChapter?.title ?? "没有可导出的章节"}</Text>
              </View>
              {exporting ? <ActivityIndicator color={colors.primary} /> : <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />}
            </Pressable>
            <Pressable disabled={exporting || !activeVolume} onPress={() => { void handleExport("volume"); }} style={[styles.exportOption, (!activeVolume || exporting) && styles.exportOptionDisabled]}>
              <Ionicons name="folder-open-outline" size={23} color={activeVolume ? colors.primary : colors.textMuted} />
              <View style={styles.exportOptionText}>
                <Text style={styles.exportOptionTitle}>当前卷</Text>
                <Text style={styles.exportOptionMeta} numberOfLines={1}>{activeVolume?.title ?? "没有可导出的卷"}</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />
            </Pressable>
            <Pressable disabled={exporting || !volumes.length} onPress={() => { void handleExport("book"); }} style={[styles.exportOption, (!volumes.length || exporting) && styles.exportOptionDisabled]}>
              <Ionicons name="library-outline" size={23} color={volumes.length ? colors.primary : colors.textMuted} />
              <View style={styles.exportOptionText}>
                <Text style={styles.exportOptionTitle}>整本小说</Text>
                <Text style={styles.exportOptionMeta}>{volumes.length + " 卷 · " + chapters.length + " 章"}</Text>
              </View>
              <Ionicons name="chevron-forward" size={19} color={colors.textMuted} />
            </Pressable>
          </View>
        </SheetBackdrop>
      </Modal>
      <Modal visible={Boolean(directoryTarget)} transparent animationType="slide" onRequestClose={() => setDirectoryTarget(null)}>
        <SheetBackdrop onPress={() => setDirectoryTarget(null)}>
          <View style={styles.actionSheet}>
            <Text numberOfLines={2} style={styles.actionTitle}>
              {directoryTarget?.kind === "volume" ? directoryTarget.volume.title : directoryTarget?.chapter.title}
            </Text>
            {directoryTarget?.kind === "volume" ? (
              <Pressable
                onPress={() => {
                  void openNameDialog(
                    { kind: "create-chapter", volume: directoryTarget.volume },
                    "第" + (chapters.length + 1) + "章",
                  );
                }}
                style={styles.actionRow}
              >
                <Ionicons name="add-circle-outline" size={22} color={colors.primary} />
                <Text style={styles.actionText}>新建章节</Text>
              </Pressable>
            ) : null}
            <Pressable
              onPress={() => {
                if (directoryTarget?.kind === "volume") {
                  void openNameDialog({ kind: "rename-volume", volume: directoryTarget.volume }, directoryTarget.volume.title);
                } else if (directoryTarget?.kind === "chapter") {
                  void openNameDialog({ kind: "rename-chapter", chapter: directoryTarget.chapter }, directoryTarget.chapter.title);
                }
              }}
              style={styles.actionRow}
            >
              <Ionicons name="create-outline" size={22} color={colors.text} />
              <Text style={styles.actionText}>重命名</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                if (directoryTarget?.kind === "volume") confirmDeleteVolume(directoryTarget.volume);
                else if (directoryTarget?.kind === "chapter") void confirmDeleteChapter(directoryTarget.chapter);
              }}
              style={styles.actionRow}
            >
              <Ionicons name="trash-outline" size={22} color={colors.danger} />
              <Text style={styles.actionTextDanger}>{directoryTarget?.kind === "volume" ? "删除卷" : "删除章节"}</Text>
            </Pressable>
          </View>
        </SheetBackdrop>
      </Modal>

      <Modal visible={Boolean(nameDialog)} transparent animationType="fade" onRequestClose={() => setNameDialog(null)}>
        <KeyboardAvoidingView style={styles.centeredBackdrop} behavior="height" automaticOffset>
          <View style={styles.nameDialog}>
            <Text style={styles.nameDialogTitle}>{nameDialogTitle}</Text>
            <Field
              label={nameDialogLabel}
              value={nameValue}
              onChangeText={setNameValue}
              maxLength={200}
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => { void submitNameDialog(); }}
            />
            <View style={styles.nameDialogActions}>
              <Button label="取消" variant="secondary" onPress={() => setNameDialog(null)} />
              <Button label="确定" onPress={() => { void submitNameDialog(); }} disabled={!nameValue.trim()} loading={nameSaving} />
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.textMuted, fontSize: 15, padding: spacing.lg, textAlign: "center" },
  iconButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerActions: { flexDirection: "row", alignItems: "center" },
  headerMenuBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9 },
  headerMenuCard: { position: "absolute", top: 100, right: 18, width: 176, backgroundColor: colors.background, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 4, zIndex: 10, elevation: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 10 },
  headerMenuRow: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
  headerMenuRowPressed: { backgroundColor: colors.surfaceMuted },
  headerMenuText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  headerMenuTextDisabled: { color: colors.textMuted },
  historyHeaderCopy: { flex: 1, minWidth: 0, gap: 2 },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  // 预览态退回列表的一行。顶栏只有标题与关闭两颗位置，入口放在内容首行。
  historyBackRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  historyBackText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  historyScroll: { flex: 1 },
  // 行自带左右内边距，列表层不再加，否则左侧会缩进两次。
  historyList: { paddingBottom: spacing.lg },
  historyRow: {
    minHeight: 76,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  historyRowCopy: { flex: 1, minWidth: 0, gap: 3 },
  historyRowTitleLine: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  historyRowTime: { color: colors.text, fontSize: 15, fontWeight: "700" },
  historyRowBadge: { color: colors.primary, fontSize: 11, fontWeight: "600", paddingHorizontal: 6, paddingVertical: 1, borderRadius: radius.sm, backgroundColor: "#E6F3EF", overflow: "hidden" },
  historyRowSummary: { color: colors.textMuted, fontSize: 13 },
  historyRowMeta: { color: colors.textMuted, fontSize: 11 },
  historyPreviewContent: { padding: spacing.lg, paddingBottom: spacing.xl, gap: spacing.sm },
  historyPreviewMeta: { color: colors.textMuted, fontSize: 12 },
  historyPreviewTitle: { color: colors.text, fontSize: 19, fontWeight: "700" },
  historyPreviewText: { color: colors.text },
  historyFooter: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.lg, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  styleSelector: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.lg, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  styleSelectorText: { flex: 1, color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  styleSelectorTextActive: { color: colors.primary },
  errorWrap: { paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  editor: { flex: 1, padding: spacing.lg, gap: spacing.md },
  preview: { flex: 1, gap: spacing.md },
  chapterBar: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  previewHeading: { flex: 1, minWidth: 0, gap: spacing.xs },
  previewVolume: { color: colors.textMuted, fontSize: 12 },
  previewTitle: { color: colors.text, fontSize: 23, fontWeight: "700" },
  previewMeta: { color: colors.textMuted, fontSize: 12 },
  editButton: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: spacing.xs, paddingHorizontal: spacing.sm },
  editButtonText: { color: colors.primary, fontSize: 14, fontWeight: "700" },
  previewScroll: { flex: 1 },
  previewContent: { paddingVertical: spacing.md, paddingBottom: spacing.xl },
  previewText: { minHeight: 220, color: colors.text },
  titleInput: { color: colors.text, fontSize: 22, fontWeight: "700", paddingVertical: spacing.sm },
  contentInput: { flex: 1, minHeight: 220, color: colors.text, fontSize: 17, lineHeight: 28, padding: 0 },
  editorFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.md },
  previewActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.sm },
  counter: { flex: 1, color: colors.textMuted, fontSize: 12 },
  centeredBackdrop: { flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: colors.overlay },
  directorySheet: {
    maxHeight: "82%",
    minHeight: "46%",
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    backgroundColor: colors.background,
  },
  sheetHeader: {
    minHeight: 58,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetHeaderActions: { flexDirection: "row", alignItems: "center" },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  styleSheetMeta: { marginTop: 2, color: colors.textMuted, fontSize: 12 },
  styleList: { maxHeight: 420 },
  styleListContent: { paddingBottom: spacing.sm },
  styleOption: { minHeight: 62, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  styleOptionActive: { backgroundColor: colors.surfaceMuted },
  styleOptionCopy: { flex: 1, minWidth: 0 },
  styleOptionTitle: { color: colors.text, fontSize: 15, fontWeight: "600" },
  styleOptionMeta: { marginTop: 3, color: colors.textMuted, fontSize: 12 },
  directoryList: { paddingBottom: spacing.lg },
  volumeHeader: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surfaceMuted,
  },
  volumeTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, fontWeight: "700" },
  volumeCount: { color: colors.textMuted, fontSize: 12 },
  chapterRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.xl,
    paddingRight: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  chapterRowActive: { backgroundColor: colors.surface },
  chapterRowText: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15 },
  chapterRowTextActive: { color: colors.primary, fontWeight: "700" },
  rowAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  actionSheet: {
    maxHeight: "80%",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    backgroundColor: colors.background,
  },
  exportHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingLeft: spacing.sm },
  exportFormatRow: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  exportFormatChip: { flex: 1, minHeight: 38, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  exportFormatChipActive: { borderColor: colors.primary, backgroundColor: "#E6F3EF" },
  exportFormatText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  exportFormatTextActive: { color: colors.primary },
  exportFormatHint: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xs, color: colors.textMuted, fontSize: 12, lineHeight: 17 },
  exportOption: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  exportOptionDisabled: { opacity: 0.48 },
  exportOptionText: { flex: 1, minWidth: 0, gap: 2 },
  exportOptionTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  exportOptionMeta: { color: colors.textMuted, fontSize: 12 },
  actionTitle: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
    paddingHorizontal: spacing.sm,
    paddingBottom: spacing.sm,
  },
  actionRow: {
    minHeight: 54,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  actionText: { color: colors.text, fontSize: 16, fontWeight: "600" },
  actionTextDanger: { color: colors.danger, fontSize: 16, fontWeight: "600" },
  nameDialog: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.md, backgroundColor: colors.background },
  nameDialogTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  nameDialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
