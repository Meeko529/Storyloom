import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SideDrawer } from "@/components/side-drawer";
import { colors, spacing } from "@/theme";
import type { Chapter, Project, Volume } from "@/types";

/** 行内展开的一个动作：只有图标与文字，不带底色与边框。 */
function DrawerAction({
  icon,
  label,
  danger = false,
  disabled = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && !disabled && styles.actionPressed]}
    >
      <Ionicons
        name={icon}
        size={17}
        color={disabled ? colors.textMuted : danger ? colors.danger : colors.primary}
      />
      <Text
        style={[
          styles.actionText,
          danger && !disabled && styles.actionTextDanger,
          disabled && styles.actionTextDisabled,
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

/** 展开箭头：实心小三角，展开时朝下。 */
function Caret({ open, color }: { open: boolean; color: string }) {
  return <Ionicons name={open ? "caret-down" : "caret-forward"} size={14} color={color} />;
}

function RowButton({
  icon,
  label,
  color = colors.primary,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color?: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.iconButton, pressed && styles.iconButtonPressed]}
    >
      <Ionicons name={icon} size={18} color={color} />
    </Pressable>
  );
}

const toggleIn = (set: Set<string>, key: string) => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

/**
 * 作品结构抽屉。
 *
 * 树只放结构：全部作品 → 卷 → 章。点作品即切换作品，点章即打开那一章。
 * 每层行尾的按钮各自管本层：作品行的 ＋ 是新建卷、卷行的 ＋ 是新建章节；
 * ⋯ 里是与本层相关的改名、删除等动作，点开就贴在该行下面展开。
 * 出场、手势与圆角交给 SideDrawer。
 */
export function ChapterDrawer({
  visible,
  projects,
  currentProjectId,
  volumesByProject,
  chaptersByProject,
  activeChapterId,
  evolvedChapterIds,
  onClose,
  onSelectProject,
  onSelectChapter,
  onCreateVolume,
  onCreateChapter,
  onRenameProject,
  onExportProject,
  onDeleteProject,
  onRenameVolume,
  onDeleteVolume,
  onRenameChapter,
  onOpenHistory,
  onDeleteChapter,
}: {
  visible: boolean;
  projects: Project[];
  currentProjectId: string;
  volumesByProject: Record<string, Volume[]>;
  chaptersByProject: Record<string, Chapter[]>;
  activeChapterId: string | null;
  evolvedChapterIds: Set<string>;
  onClose: () => void;
  onSelectProject: (project: Project) => void;
  onSelectChapter: (project: Project, chapter: Chapter) => void;
  onCreateVolume: (project: Project) => void;
  onCreateChapter: (project: Project, volume: Volume) => void;
  onRenameProject: (project: Project) => void;
  onExportProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onRenameVolume: (project: Project, volume: Volume) => void;
  onDeleteVolume: (project: Project, volume: Volume) => void;
  onRenameChapter: (project: Project, chapter: Chapter) => void;
  onOpenHistory: (project: Project, chapter: Chapter) => void;
  onDeleteChapter: (project: Project, chapter: Chapter) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [collapsedVolumes, setCollapsedVolumes] = useState<Set<string>>(new Set());
  /** 当前展开着菜单的那一行：`p:作品` / `v:卷` / `c:章`。 */
  const [menuKey, setMenuKey] = useState<string | null>(null);

  // 每次打开都保证当前作品是展开的；顺带收起上一次留下的菜单。
  useEffect(() => {
    if (!visible) return;
    setExpanded((current) => (current.has(currentProjectId) ? current : new Set(current).add(currentProjectId)));
    setMenuKey(null);
  }, [visible, currentProjectId]);

  const handleProjectPress = (project: Project) => {
    setMenuKey(null);
    if (project.id !== currentProjectId) {
      setExpanded((current) => new Set(current).add(project.id));
      onSelectProject(project);
      return;
    }
    setExpanded((current) => toggleIn(current, project.id));
  };

  const renderProjects = () =>
    projects.map((project) => {
      const isCurrent = project.id === currentProjectId;
      const isExpanded = expanded.has(project.id);
      const volumes = volumesByProject[project.id] ?? [];
      const chapters = chaptersByProject[project.id] ?? [];
      const projectMenu = "p:" + project.id;

      return (
        <View key={project.id}>
          <View style={[styles.row, isCurrent && styles.projectRowActive]}>
            <Pressable
              accessibilityLabel={(isExpanded ? "收起" : "展开") + project.title}
              onPress={() => handleProjectPress(project)}
              style={styles.rowMain}
            >
              <Caret open={isExpanded} color={isCurrent ? colors.primary : colors.textMuted} />
              <Text numberOfLines={1} style={[styles.projectTitle, isCurrent && styles.projectTitleActive]}>
                {project.title}
              </Text>
              <Text style={styles.count}>{volumes.length} 卷</Text>
            </Pressable>
            <RowButton icon="add" label={"在《" + project.title + "》中新建卷"} onPress={() => { setMenuKey(null); onCreateVolume(project); }} />
            <RowButton
              icon="ellipsis-horizontal"
              label={project.title + "的更多操作"}
              color={colors.textMuted}
              onPress={() => setMenuKey(menuKey === projectMenu ? null : projectMenu)}
            />
          </View>

          {menuKey === projectMenu ? (
            <View style={styles.menu}>
              <DrawerAction icon="create-outline" label="重命名作品" onPress={() => { setMenuKey(null); onRenameProject(project); }} />
              <DrawerAction icon="share-outline" label="导出作品" onPress={() => { setMenuKey(null); onExportProject(project); }} />
              <DrawerAction icon="trash-outline" label="删除作品" danger onPress={() => { setMenuKey(null); onDeleteProject(project); }} />
            </View>
          ) : null}

          {isExpanded
            ? volumes.map((volume) => {
                const volumeMenu = "v:" + volume.id;
                const volumeChapters = chapters.filter((chapter) => chapter.volumeId === volume.id);
                const isVolumeOpen = !collapsedVolumes.has(volume.id);
                return (
                  <View key={volume.id}>
                    <View style={styles.volumeRow}>
                      <Pressable
                        accessibilityLabel={(isVolumeOpen ? "收起" : "展开") + volume.title}
                        onPress={() => { setMenuKey(null); setCollapsedVolumes((current) => toggleIn(current, volume.id)); }}
                        style={styles.rowMain}
                      >
                        <Caret open={isVolumeOpen} color={colors.textMuted} />
                        <Text numberOfLines={1} style={styles.volumeTitle}>{volume.title}</Text>
                        <Text style={styles.count}>{volumeChapters.length} 章</Text>
                      </Pressable>
                      <RowButton icon="add" label={"在" + volume.title + "中新建章节"} onPress={() => { setMenuKey(null); onCreateChapter(project, volume); }} />
                      <RowButton
                        icon="ellipsis-horizontal"
                        label={volume.title + "的更多操作"}
                        color={colors.textMuted}
                        onPress={() => setMenuKey(menuKey === volumeMenu ? null : volumeMenu)}
                      />
                    </View>

                    {menuKey === volumeMenu ? (
                      <View style={styles.menu}>
                        <DrawerAction icon="create-outline" label="重命名" onPress={() => { setMenuKey(null); onRenameVolume(project, volume); }} />
                        <DrawerAction icon="trash-outline" label="删除卷" danger onPress={() => { setMenuKey(null); onDeleteVolume(project, volume); }} />
                      </View>
                    ) : null}

                    {isVolumeOpen
                      ? volumeChapters.map((chapter) => {
                          const isActive = chapter.id === activeChapterId;
                          const chapterMenu = "c:" + chapter.id;
                          return (
                            <View key={chapter.id}>
                              <Pressable
                                accessibilityLabel={"打开" + chapter.title}
                                onPress={() => onSelectChapter(project, chapter)}
                                style={({ pressed }) => [styles.chapterRow, pressed && styles.rowPressed]}
                              >
                                <Text numberOfLines={1} style={[styles.chapterTitle, isActive && styles.chapterTitleActive]}>
                                  {chapter.title}
                                </Text>
                                {/* 已进化＝纯标识：该章当前这稿进化过才亮，不参与点击。 */}
                                {evolvedChapterIds.has(chapter.id) ? (
                                  <Ionicons name="sparkles-outline" size={16} color={colors.primary} />
                                ) : null}
                                <RowButton
                                  icon="ellipsis-horizontal"
                                  label={chapter.title + "的更多操作"}
                                  color={colors.textMuted}
                                  onPress={() => setMenuKey(menuKey === chapterMenu ? null : chapterMenu)}
                                />
                              </Pressable>
                              {menuKey === chapterMenu ? (
                                <View style={styles.chapterMenu}>
                                  <DrawerAction icon="create-outline" label="重命名章节" onPress={() => { setMenuKey(null); onRenameChapter(project, chapter); }} />
                                  {/* 恢复版本会把内容写进编辑器，所以只对正打开的那一章可用。 */}
                                  <DrawerAction
                                    icon="time-outline"
                                    label={isActive ? "历史版本" : "历史版本（先打开这一章）"}
                                    disabled={!isActive}
                                    onPress={() => { setMenuKey(null); onOpenHistory(project, chapter); }}
                                  />
                                  <DrawerAction icon="trash-outline" label="删除章节" danger onPress={() => { setMenuKey(null); onDeleteChapter(project, chapter); }} />
                                </View>
                              ) : null}
                            </View>
                          );
                        })
                      : null}
                  </View>
                );
              })
            : null}
        </View>
      );
    });

  return (
    <SideDrawer
      visible={visible}
      title="作品"
      meta={projects.length ? projects.length + " 部" : undefined}
      onClose={onClose}
    >
      {projects.length ? renderProjects() : <Text style={styles.empty}>还没有作品。</Text>}
    </SideDrawer>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 44,
    paddingLeft: spacing.sm,
    paddingRight: 2,
    borderRadius: 10,
  },
  // 当前作品：整行浅主色底，文字与计数随主色。
  projectRowActive: { backgroundColor: "#E6F3EF" },
  rowMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  projectTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 16, fontWeight: "600" },
  projectTitleActive: { color: colors.primary },
  count: { color: colors.textMuted, fontSize: 12 },
  volumeRow: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: 38,
    paddingLeft: 20,
    paddingRight: 2,
    borderRadius: 8,
  },
  volumeTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15, fontWeight: "600" },
  chapterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 40,
    paddingLeft: 40,
    paddingRight: 2,
    borderRadius: 8,
  },
  // 当前章只把文字换成主色，不加底色。
  chapterTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 15 },
  chapterTitleActive: { color: colors.primary },
  iconButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  iconButtonPressed: { backgroundColor: colors.surfaceMuted },
  menu: { paddingLeft: spacing.xl, paddingBottom: spacing.sm },
  chapterMenu: { paddingLeft: 40, paddingBottom: spacing.sm },
  action: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 34, paddingHorizontal: 2 },
  actionPressed: { opacity: 0.6 },
  actionText: { color: colors.text, fontSize: 15 },
  actionTextDanger: { color: colors.danger },
  actionTextDisabled: { color: colors.textMuted },
  empty: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, color: colors.textMuted, fontSize: 13, lineHeight: 20 },
});
