// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";

import { Button, EmptyState, ErrorNotice, Field, Header, PlainScrollView, Screen, BottomSheet, TopSheet } from "@/components/ui";
import { ChapterDrawer } from "@/components/chapter-drawer";
import { ensureEditorFontLoaded } from "@/settings/font-loader";
import { debounce } from "@/lib/debounce";
import { exportNovel, type ExportScope, type NovelExportFormat } from "@/lib/export";
import { countNotesUnder, deleteNotesUnder } from "@/data/note-repositories";
import {
  createChapter,
  createVolume,
  deleteChapter,
  deleteChapterVersion,
  deleteProject,
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
  updateProjectInfo,
} from "@/data/repositories";
import {
  getPendingChapterStyleEvolution,
  listEvolvedChapterIds,
  markChapterStyleEvolved,
  recordLatestAuthorRevision,
} from "@/data/chapter-draft-repositories";
import {
  getActiveStyleProfile,
  listStyleProfiles,
  setActiveStyleProfile,
} from "@/data/style-repositories";
import { resolveModelSelection } from "@/llm/selection";
import type { RootStackParamList } from "@/navigation/types";
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

/** 统计非空白字符数：预览态与编辑态共用，避免各处重复写正则。 */
function countCharacters(text: string): number {
  let characters = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (!/\s/.test(text.charAt(index))) characters += 1;
  }
  return characters;
}

/**
 * 编辑态正文输入框：value 存在组件自己的 state 里，输入时不把正文塞进父级。
 *
 * 写作页父组件持有作品、卷章、文风、弹层等几十个 state，正文一动就整页重渲染；
 * 父级每次重渲染还要对正文做一遍 `replace(/\s/g,"")` 统计字数，长章节下每按一键
 * 就是一次全文扫描 —— 这正是"能滑动但发涩"的来源。
 *
 * 所以这里只回调两件小事：正文进 `draftRef`（落盘与切章都从它读，不丢稿），
 * 字数交给父级去抖后写 state。换章用 `key` 重挂载，不做值同步。
 */
function ChapterContentInput({
  initialContent,
  editorStyle,
  onChangeContent,
  onCharacters,
}: {
  initialContent: string;
  editorStyle?: StyleProp<TextStyle>;
  onChangeContent: (value: string) => void;
  onCharacters: (characters: number) => void;
}) {
  const [value, setValue] = useState(initialContent);
  // 换章由调用方给的 key 处理（key 变了组件整体重挂载）。

  const handleChange = (next: string) => {
    setValue(next);
    onChangeContent(next);
    onCharacters(countCharacters(next));
  };

  return (
    <TextInput
      value={value}
      onChangeText={handleChange}
      style={[styles.contentInput, editorStyle]}
      placeholder="开始写作..."
      placeholderTextColor={colors.textMuted}
      multiline
      textAlignVertical="top"
      autoCorrect
    />
  );
}

type DraftState = {
  chapterId: string;
  title: string;
  content: string;
  dirty: boolean;
  version: number;
};

type NameDialog =
  | { kind: "create-volume"; project: Project }
  | { kind: "rename-volume"; volume: Volume }
  | { kind: "create-chapter"; volume: Volume }
  | { kind: "rename-chapter"; chapter: Chapter }
  | { kind: "rename-project"; project: Project };

export function WritingScreen() {
  const projectId = useAppStore((state) => state.currentProjectId);
  const setCurrentProject = useAppStore((state) => state.setCurrentProject);
  const currentChapterId = useAppStore((state) => state.currentChapterId);
  const setCurrentChapter = useAppStore((state) => state.setCurrentChapter);
  const refreshData = useAppStore((state) => state.refreshData);
  const revision = useAppStore((state) => state.dataRevision);
  /** 资料页挂在 Stack 上，写作页是 Tab 里的一屏，跳转要从这里往上冒泡。 */
  const rootNavigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [project, setProject] = useState<Project | null>(null);
  const [volumes, setVolumes] = useState<Volume[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  /**
   * 字数：编辑期间由输入框算好送进来，但要去抖后才写入 state。
   * 直接跟 content 走会让「每按一键就整页重渲染并全文统计字数」。
   */
  const [characterCount, setCharacterCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoSaveDelay, setAutoSaveDelay] = useState(AUTO_SAVE_DELAY_MS);
  const [editorFontSize, setEditorFontSize] = useState(17);
  const [editorFont, setEditorFont] = useState<EditorFontId>("system");
  /** 作品结构抽屉：全部作品与它们各自的卷章都收在里面。 */
  const [drawerVisible, setDrawerVisible] = useState(false);
  /** 抽屉用的数据：全部作品，以及每部作品自己的卷与章。 */
  const [drawerProjects, setDrawerProjects] = useState<Project[]>([]);
  const [drawerVolumes, setDrawerVolumes] = useState<Record<string, Volume[]>>({});
  const [drawerChapters, setDrawerChapters] = useState<Record<string, Chapter[]>>({});
  const [nameDialog, setNameDialog] = useState<NameDialog | null>(null);
  const [nameValue, setNameValue] = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const [exportPickerVisible, setExportPickerVisible] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportFormat, setExportFormat] = useState<NovelExportFormat>("markdown");
  const [headerMenuVisible, setHeaderMenuVisible] = useState(false);
  const [editing, setEditing] = useState(false);
  const [styleProfiles, setStyleProfiles] = useState<StyleProfile[]>([]);
  const [activeStyleProfile, setActiveStyleProfileState] = useState<StyleProfile | null>(null);
  const [pendingEvolution, setPendingEvolution] = useState<ChapterDraftSnapshot | null>(null);
  /** 目录里标「已进化」的章节集合；纯标识，不参与点击。 */
  const [evolvedChapterIds, setEvolvedChapterIds] = useState<Set<string>>(new Set());
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
  /** 供事件监听与卸载清理使用：那里的闭包不会随 render 更新（与 persistDraftRef 同理）。 */
  const flushAutoSaveRef = useRef<() => void>(() => {});

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
    setCharacterCount(countCharacters(activeChapter.content));
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

  // 抽屉打开时把全部作品与它们各自的卷章读一遍。写操作后会 refreshData，
  // revision 一变这里就重查，所以新建、改名、删除之后列表会跟上。
  useEffect(() => {
    if (!drawerVisible) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = await listProjects();
        const volumeMap: Record<string, Volume[]> = {};
        const chapterMap: Record<string, Chapter[]> = {};
        const evolved = new Set<string>();
        await Promise.all(list.map(async (item) => {
          const [itemVolumes, itemChapters, itemEvolved] = await Promise.all([
            listVolumes(item.id),
            listChapters(item.id),
            listEvolvedChapterIds(item.id),
          ]);
          volumeMap[item.id] = itemVolumes;
          chapterMap[item.id] = itemChapters;
          for (const id of itemEvolved) evolved.add(id);
        }));
        if (cancelled) return;
        setDrawerProjects(list);
        setDrawerVolumes(volumeMap);
        setDrawerChapters(chapterMap);
        setEvolvedChapterIds(evolved);
      } catch {
        // 抽屉数据读失败不打断写作：沿用上一次读到的结果。
      }
    })();
    return () => { cancelled = true; };
  }, [drawerVisible, revision]);

  const clearDraft = () => {
    setTitle("");
    setContent("");
    setCharacterCount(0);
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
        setContent(draft.content);
        setCharacterCount(countCharacters(draft.content));
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
    flushAutoSaveRef.current = flushAutoSave;
  });

  /**
   * 自动保存：草稿一变就排一次，停止输入后落盘。
   *
   * 关键点是**保存不依赖任何 React 状态的变化**。早先的写法是 `useEffect` 盯着
   * `dirty / title / content`，正文不再进 state 之后这套依赖就失灵了，只能再造假
   * state 补住 —— 那是绕路。现在的做法是：改动时直接排一次去抖，落盘时自己去读
   * `draftRef`，与渲染链路无关。
   *
   * 去抖器用 `useMemo` 按等待时长缓存：时长来自设置，改设置才重建。
   * 若每次 render 都新建，连续打字会排出多个互不取消的定时器。
   */
  const autoSave = useMemo(
    () => debounce(() => { void persistDraftRef.current(false); }, autoSaveDelay),
    [autoSaveDelay],
  );
  const scheduleAutoSave = () => { autoSave(); };
  /** 立刻落盘挂起的改动 —— 切后台、失焦、关页面时用，不等去抖窗口。 */
  const flushAutoSave = () => { autoSave.flush(); };

  useEffect(() => () => { autoSave.cancel(); }, [autoSave]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (nextState !== "active") flushAutoSaveRef.current();
    });
    return () => {
      subscription.remove();
      flushAutoSaveRef.current();
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
    // 排在草稿写入之后：去抖读的是 draftRef，顺序颠倒就成了"存上一版"。
    scheduleAutoSave();
  };

  /**
   * 正文变化的轻量通道：只更新草稿与"未保存"标记，不把正文塞进 state。
   * 退出编辑态时 `saveAndPreview` 会把 `draftRef` 的正文一次性同步回 state。
   */
  const updateContentDraft = (nextContent: string) => {
    setSavedAt(null);
    setDirty(true);
    draftRef.current = {
      chapterId: activeChapter?.id ?? draftRef.current.chapterId,
      title: draftRef.current.title,
      content: nextContent,
      dirty: true,
      version: draftRef.current.version + 1,
    };
    scheduleAutoSave();
  };

  /**
   * 字数：停止输入后再写入 state。打字的每一帧都统计全文，写 state 只会让整页
   * 重渲染 —— 而重渲染正是这批要消除的开销。
   */
  const scheduleCharacterCount = useMemo(
    () => debounce((characters: number) => { setCharacterCount(characters); }, 300),
    [],
  );

  useEffect(() => () => { scheduleCharacterCount.cancel(); }, [scheduleCharacterCount]);

  const selectChapter = async (chapterId: string) => {
    if (chapterId === activeChapter?.id) {
      setDrawerVisible(false);
      return;
    }
    if (savingRef.current) {
      setError("章节正在保存，请稍后再切换");
      return;
    }
    if (!await persistDraft(false)) return;
    setCurrentChapter(chapterId);
    setDrawerVisible(false);
  };

  const openNameDialog = async (dialog: NameDialog, initialValue: string) => {
    if (savingRef.current) {
      setError("章节正在保存，请稍后再操作");
      return;
    }
    if (!await persistDraft(false)) return;
    setDrawerVisible(false);
    setNameValue(initialValue);
    setNameDialog(dialog);
  };

  const submitNameDialog = async () => {
    if (!projectId || !nameDialog || !nameValue.trim()) return;
    setNameSaving(true);
    setError(null);
    try {
      if (nameDialog.kind === "create-volume") {
        // 抽屉里按下的是某一部作品的 ＋，新卷归那部作品。
        const volume = await createVolume(nameDialog.project.id, nameValue);
        if (nameDialog.project.id === projectId) {
          setVolumes((current) => [...current, volume].sort((left, right) => left.orderIndex - right.orderIndex));
        }
      } else if (nameDialog.kind === "rename-project") {
        await updateProjectInfo(nameDialog.project.id, nameValue, nameDialog.project.description);
      } else if (nameDialog.kind === "rename-volume") {
        const volume = await renameVolume(nameDialog.volume.id, nameValue);
        setVolumes((current) => current.map((item) => item.id === volume.id ? volume : item));
      } else if (nameDialog.kind === "create-chapter") {
        const volume = nameDialog.volume;
        const chapter = await createChapter(volume.projectId, volume.id, nameValue);
        if (volume.projectId === projectId) {
          setChapters((current) => [...current, chapter]);
          setCurrentChapter(chapter.id);
        }
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
    setDrawerVisible(false);
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
    setDrawerVisible(false);
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

  const removeProject = async (target: Project) => {
    if (savingRef.current) {
      setError("章节正在保存，请稍后再删除");
      return;
    }
    if (target.id === projectId && !await persistDraft(false)) return;
    setError(null);
    try {
      await deleteProject(target.id);
      // 删掉的正是正打开的那部：交给上层回到"还没有选作品"的状态。
      if (target.id === projectId) setCurrentProject(null);
      refreshData();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
    }
  };

  const confirmDeleteProject = (target: Project) => {
    setDrawerVisible(false);
    Alert.alert(
      "删除作品",
      "确定删除《" + target.title + "》？这部作品的卷、章节与本地索引会一并删除。",
      [
        { text: "取消", style: "cancel" },
        { text: "删除", style: "destructive", onPress: () => { void removeProject(target); } },
      ],
    );
  };

  const openNewChapter = () => {
    const volume = activeVolume ?? volumes[0];
    if (volume) {
      void openNameDialog(
        { kind: "create-chapter", volume },
        "第" + (chapters.length + 1) + "章",
      );
    } else if (project) {
      void openNameDialog({ kind: "create-volume", project }, "第一卷");
    }
  };

  const saveAndPreview = async () => {
    if (await persistDraft(true)) setEditing(false);
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
        sourceChapterId: pendingEvolution.chapterId,
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
                setCharacterCount(countCharacters(restored.content));
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
        : nameDialog?.kind === "rename-chapter"
          ? "重命名章节"
          : "重命名作品";
  const nameDialogLabel = nameDialog?.kind === "create-volume" || nameDialog?.kind === "rename-volume"
    ? "卷名"
    : nameDialog?.kind === "rename-project"
      ? "作品名"
      : "章节名";

  if (!projectId) return <Screen><EmptyState title="请先从书架选择一部作品" /></Screen>;
  if (loading) return <Screen><Header title="写作" /><View style={styles.loading}><Text style={styles.muted}>正在打开作品...</Text></View></Screen>;

  return (
    <Screen>
      <Header
        leading={(
          <Pressable accessibilityLabel="作品结构" onPress={() => setDrawerVisible(true)} style={styles.iconButton}>
            {/* 两条线，一长一短：与多数阅读类应用的入口一致，不与返回箭头混。 */}
            <View style={styles.menuGlyph}>
              <View style={[styles.menuGlyphBar, styles.menuGlyphBarLong]} />
              <View style={[styles.menuGlyphBar, styles.menuGlyphBarShort]} />
            </View>
          </Pressable>
        )}
        title={project?.title ?? "写作"}
        action={(
          <Pressable accessibilityLabel="更多操作" onPress={() => setHeaderMenuVisible((value) => !value)} style={styles.iconButton}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.primary} />
          </Pressable>
        )}
      />
      {headerMenuVisible ? (
        <>
          <Pressable accessibilityLabel="关闭更多操作" onPress={() => setHeaderMenuVisible(false)} style={styles.headerMenuBackdrop} />
          <View style={styles.headerMenuCard}>
            <Pressable
              accessibilityLabel="导出作品"
              onPress={() => { setHeaderMenuVisible(false); setExportPickerVisible(true); }}
              style={({ pressed }) => [styles.headerMenuRow, pressed && styles.headerMenuRowPressed]}
            >
              <Ionicons name="share-outline" size={20} color={colors.primary} />
              <Text style={styles.headerMenuText}>导出作品</Text>
            </Pressable>
            <Pressable
              accessibilityLabel="章节历史版本"
              disabled={!activeChapter}
              onPress={() => { setHeaderMenuVisible(false); void openChapterHistory(); }}
              style={({ pressed }) => [styles.headerMenuRow, pressed && styles.headerMenuRowPressed]}
            >
              <Ionicons name="time-outline" size={20} color={activeChapter ? colors.primary : colors.textMuted} />
              <Text style={[styles.headerMenuText, !activeChapter && styles.headerMenuTextDisabled]}>历史版本</Text>
            </Pressable>
          </View>
        </>
      ) : null}
            {/* 键盘避让用位移而非改内边距：改 padding 会让整棵子树重新布局，
            长正文下键盘弹出与收起各触发一次，走 UI 线程的位移只做合成。
            顶栏在容器之外，不会被一起顶走。 */}
      <KeyboardAvoidingView style={styles.flex} behavior="translate-with-padding" automaticOffset>
        {activeChapter && !editing ? (
          <View style={styles.chapterBar}>
            <View style={styles.previewHeading}>
              <Text numberOfLines={1} style={styles.previewVolume}>{activeVolume?.title ?? "作品目录"}</Text>
              <Text style={styles.previewTitle}>{title || "未命名章节"}</Text>
              <Text style={styles.previewMeta}>{characterCount + " 字" + (savedAt ? " · " + savedAt + " 已保存" : "")}</Text>
            </View>
            {pendingEvolution ? (
              <Pressable
                accessibilityLabel="进化作者文风"
                disabled={saving || evolvingStyle}
                onPress={() => { void evolveFromRevision(); }}
                style={styles.chapterIconAction}
              >
                {evolvingStyle
                  ? <ActivityIndicator size="small" color={colors.primary} />
                  : <Ionicons name="sparkles-outline" size={22} color={colors.primary} />}
              </Pressable>
            ) : null}
            <Pressable accessibilityLabel="编辑章节" onPress={() => setEditing(true)} style={styles.editButton}>
              <Ionicons name="create-outline" size={22} color={colors.primary} />
              <Text style={styles.editButtonText}>编辑</Text>
            </Pressable>
          </View>
        ) : null}
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
                <ChapterContentInput
                  // 换章时重挂载：局部 value 里的正文必须整份换掉，
                  // 靠 useEffect 同步在"外部值恰好等于上次记录值"时会漏。
                  key={activeChapter.id}
                  initialContent={content}
                  editorStyle={editorTextStyle}
                  onChangeContent={updateContentDraft}
                  onCharacters={scheduleCharacterCount}
                />
                <View style={styles.editorFooter}>
                  <Text style={styles.counter}>
                    {characterCount + " 字" + (dirty ? " · 未保存" : savedAt ? " · " + savedAt + " 已保存" : "")}
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
            action={<Button label="新建卷" onPress={() => { if (project) void openNameDialog({ kind: "create-volume", project }, "第一卷"); }} />}
          />
        )}
      </KeyboardAvoidingView>

      <ChapterDrawer
        visible={drawerVisible}
        projects={drawerProjects}
        currentProjectId={projectId}
        volumesByProject={drawerVolumes}
        chaptersByProject={drawerChapters}
        activeChapterId={activeChapter?.id ?? null}
        evolvedChapterIds={evolvedChapterIds}
        onClose={() => setDrawerVisible(false)}
        onSelectProject={(target) => {
          if (target.id === projectId) return;
          // 换作品前先把当前草稿落盘，否则没保存的字会跟着整页重载一起没。
          void (async () => {
            if (!await persistDraft(false)) return;
            setCurrentProject(target.id);
          })();
        }}
        onSelectChapter={(_target, chapter) => { void selectChapter(chapter.id); }}
        onCreateVolume={(target) => {
          const count = drawerVolumes[target.id]?.length ?? 0;
          void openNameDialog({ kind: "create-volume", project: target }, "第" + (count + 1) + "卷");
        }}
        onCreateChapter={(_target, volume) => {
          const count = (drawerChapters[volume.projectId] ?? []).filter((item) => item.volumeId === volume.id).length;
          void openNameDialog({ kind: "create-chapter", volume }, "第" + (count + 1) + "章");
        }}
        onRenameProject={(target) => { void openNameDialog({ kind: "rename-project", project: target }, target.title); }}
        onExportProject={(target) => {
          // 导出面板导出的是"正打开的那部"，所以先切过去再开面板。
          void (async () => {
            if (target.id !== projectId) {
              if (!await persistDraft(false)) return;
              setCurrentProject(target.id);
            }
            setExportPickerVisible(true);
          })();
        }}
        onDeleteProject={confirmDeleteProject}
        onRenameVolume={(_target, volume) => { void openNameDialog({ kind: "rename-volume", volume }, volume.title); }}
        onDeleteVolume={(_target, volume) => confirmDeleteVolume(volume)}
        onRenameChapter={(_target, chapter) => { void openNameDialog({ kind: "rename-chapter", chapter }, chapter.title); }}
        onOpenHistory={(_target, chapter) => {
          // 恢复会把版本内容灌进编辑器，所以只对正打开的那一章放行。
          if (chapter.id === activeChapter?.id) void openChapterHistory();
        }}
        onDeleteChapter={(_target, chapter) => { void confirmDeleteChapter(chapter); }}
      />

      <Modal visible={historyVisible} transparent animationType="fade" onRequestClose={() => { setHistoryPreview(null); setHistoryVisible(false); }}>
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
              <PlainScrollView style={styles.panelScroll} contentContainerStyle={styles.historyPreviewContent}>
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
            <PlainScrollView style={styles.panelScroll} contentContainerStyle={styles.historyList}>
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

      <BottomSheet
        visible={exportPickerVisible}
        title="导出作品"
        subtitle={project?.title ?? "当前作品"}
        onClose={() => setExportPickerVisible(false)}
      >
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
        </BottomSheet>
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
  // 顶栏入口：两条线，上长下短。
  menuGlyph: { width: 20, gap: 5 },
  menuGlyphBar: { height: 2, borderRadius: 2, backgroundColor: colors.primary },
  menuGlyphBarLong: { width: 20 },
  menuGlyphBarShort: { width: 13 },
  headerMenuBackdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 9 },
  headerMenuCard: { position: "absolute", top: 100, right: 18, width: 176, backgroundColor: colors.background, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, paddingVertical: 4, zIndex: 10, elevation: 8, shadowColor: "#000", shadowOffset: { width: 0, height: 6 }, shadowOpacity: 0.25, shadowRadius: 10 },
  headerMenuRow: { minHeight: 46, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md },
  headerMenuRowPressed: { backgroundColor: colors.surfaceMuted },
  headerMenuText: { color: colors.text, fontSize: 14, fontWeight: "600" },
  headerMenuTextDisabled: { color: colors.textMuted },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  // 预览态退回列表的一行。顶栏只有标题与关闭两颗位置，入口放在内容首行。
  historyBackRow: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  historyBackText: { color: colors.primary, fontSize: 14, fontWeight: "600" },
  // 弹层里的滚动区：高度上限由面板给，超出在这里滚。
  panelScroll: { flexShrink: 1 },
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
  // 章头的文风进化入口：与「编辑」同一行，只在有待进化素材时出现。
  chapterIconAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  previewScroll: { flex: 1 },
  previewContent: { paddingVertical: spacing.md, paddingBottom: spacing.xl },
  previewText: { minHeight: 220, color: colors.text },
  titleInput: { color: colors.text, fontSize: 22, fontWeight: "700", paddingVertical: spacing.sm },
  contentInput: { flex: 1, minHeight: 220, color: colors.text, fontSize: 17, lineHeight: 28, padding: 0 },
  editorFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: spacing.md },
  previewActions: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end", gap: spacing.sm },
  counter: { flex: 1, color: colors.textMuted, fontSize: 12 },
  centeredBackdrop: { flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: colors.overlay },
  exportFormatRow: { flexDirection: "row", gap: spacing.xs, paddingHorizontal: spacing.sm, paddingBottom: spacing.xs },
  exportFormatChip: { flex: 1, minHeight: 38, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: colors.surface },
  exportFormatChipActive: { borderColor: colors.primary, backgroundColor: "#E6F3EF" },
  exportFormatText: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  exportFormatTextActive: { color: colors.primary },
  exportFormatHint: { paddingHorizontal: spacing.sm, paddingBottom: spacing.xs, color: colors.textMuted, fontSize: 12, lineHeight: 18 },
  exportOption: { minHeight: 66, flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  exportOptionDisabled: { opacity: 0.48 },
  exportOptionText: { flex: 1, minWidth: 0, gap: 2 },
  exportOptionTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  exportOptionMeta: { color: colors.textMuted, fontSize: 12 },
  nameDialog: { gap: spacing.lg, padding: spacing.xl, borderRadius: radius.md, backgroundColor: colors.background },
  nameDialogTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  nameDialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
});
