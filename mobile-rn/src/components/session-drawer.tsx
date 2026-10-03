import { Ionicons } from "@expo/vector-icons";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { SideDrawer } from "@/components/side-drawer";
import { colors, spacing } from "@/theme";
import type { ChatSession, Project } from "@/types";

/**
 * 助手在没有选中作品时自建的那部作品的标题。
 *
 * 它是系统自动创建的真实作品（描述写着"助手未选作品时的聊天记录（系统自动创建）"），
 * 书架页同样能看到。数据层认定它是靠标题匹配，界面这里也用同一个口径，行尾标一个
 * 「临时」，免得用户纳闷"我没建过这本书"。用户自建的同名作品会一并被标记 —— 与
 * 数据层的认定口径一致，不会出现"标记的与实际用的不是同一部"。
 */
const SCRATCH_PROJECT_TITLE = "未命名";

/** 行内展开的一个动作：只有图标与文字，不带底色与边框。 */
function DrawerAction({
  icon,
  label,
  danger = false,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
    >
      <Ionicons name={icon} size={16} color={danger ? colors.danger : colors.primary} />
      <Text style={[styles.actionText, danger && styles.actionTextDanger]}>{label}</Text>
    </Pressable>
  );
}

/** 展开箭头：实心小三角，展开时朝下。 */
function Caret({ open, color }: { open: boolean; color: string }) {
  return <Ionicons name={open ? "caret-down" : "caret-forward"} size={13} color={color} />;
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
      <Ionicons name={icon} size={17} color={color} />
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
 * 助手页的对话抽屉。
 *
 * 树只放两级：全部作品 → 各自的对话。点作品即切换作品，点对话即切换对话。
 * 作品行的 ＋ 是新建对话、⋯ 里是作品的改名与删除；对话行的 ⋯ 里是对话的改名与删除。
 * 出场、手势、圆角与写作页共用同一个 SideDrawer。
 */
export function SessionDrawer({
  visible,
  projects,
  currentProjectId,
  sessionsByProject,
  activeSessionId,
  onClose,
  onSelectProject,
  onSelectSession,
  onCreateSession,
  onRenameProject,
  onDeleteProject,
  onRenameSession,
  onDeleteSession,
}: {
  visible: boolean;
  projects: Project[];
  currentProjectId: string;
  sessionsByProject: Record<string, ChatSession[]>;
  activeSessionId: string | null;
  onClose: () => void;
  onSelectProject: (project: Project) => void;
  onSelectSession: (project: Project, session: ChatSession) => void;
  onCreateSession: (project: Project) => void;
  onRenameProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
  onRenameSession: (project: Project, session: ChatSession) => void;
  onDeleteSession: (project: Project, session: ChatSession) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /** 当前展开着菜单的那一行：`p:作品` / `s:对话`。 */
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
      const sessions = sessionsByProject[project.id] ?? [];
      const projectMenu = "p:" + project.id;
      const isScratch = project.title === SCRATCH_PROJECT_TITLE;

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
              {isScratch ? <Text style={styles.scratchTag}>临时</Text> : null}
              <Text style={styles.count}>{sessions.length} 个对话</Text>
            </Pressable>
            <RowButton icon="add" label={"在《" + project.title + "》中新建对话"} onPress={() => { setMenuKey(null); onCreateSession(project); }} />
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
              <DrawerAction icon="trash-outline" label="删除作品" danger onPress={() => { setMenuKey(null); onDeleteProject(project); }} />
            </View>
          ) : null}

          {isExpanded
            ? sessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const sessionMenu = "s:" + session.id;
                return (
                  <View key={session.id}>
                    <Pressable
                      accessibilityLabel={"切换到对话 " + session.title}
                      onPress={() => onSelectSession(project, session)}
                      style={({ pressed }) => [styles.sessionRow, pressed && styles.rowPressed]}
                    >
                      <Text numberOfLines={1} style={[styles.sessionTitle, isActive && styles.sessionTitleActive]}>
                        {session.title}
                      </Text>
                      <RowButton
                        icon="ellipsis-horizontal"
                        label={session.title + "的更多操作"}
                        color={colors.textMuted}
                        onPress={() => setMenuKey(menuKey === sessionMenu ? null : sessionMenu)}
                      />
                    </Pressable>
                    {menuKey === sessionMenu ? (
                      <View style={styles.sessionMenu}>
                        <DrawerAction icon="create-outline" label="重命名" onPress={() => { setMenuKey(null); onRenameSession(project, session); }} />
                        <DrawerAction icon="trash-outline" label="删除" danger onPress={() => { setMenuKey(null); onDeleteSession(project, session); }} />
                      </View>
                    ) : null}
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
  // 当前作品：整行浅主色底，文字随主色。
  projectRowActive: { backgroundColor: "#E6F3EF" },
  rowMain: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 44 },
  rowPressed: { backgroundColor: colors.surfaceMuted },
  projectTitle: { flexShrink: 1, minWidth: 0, color: colors.text, fontSize: 14, fontWeight: "600" },
  projectTitleActive: { color: colors.primary },
  // 「临时」这个小标记是给系统自建作品用的，比正文小一号、颜色压到最淡。
  scratchTag: { color: colors.textMuted, fontSize: 10, borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, borderRadius: 5, paddingHorizontal: 4, paddingVertical: 1 },
  count: { flex: 1, color: colors.textMuted, fontSize: 11, textAlign: "right", marginRight: spacing.xs },
  sessionRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    minHeight: 40,
    paddingLeft: 26,
    paddingRight: 2,
    borderRadius: 8,
  },
  // 当前对话只把文字换主色，不加底色。
  sessionTitle: { flex: 1, minWidth: 0, color: colors.text, fontSize: 13 },
  sessionTitleActive: { color: colors.primary },
  iconButton: { width: 30, height: 30, alignItems: "center", justifyContent: "center", borderRadius: 8 },
  iconButtonPressed: { backgroundColor: colors.surfaceMuted },
  menu: { paddingLeft: spacing.xl, paddingBottom: spacing.sm },
  sessionMenu: { paddingLeft: 46, paddingBottom: spacing.sm },
  action: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 34, paddingHorizontal: 2 },
  actionPressed: { opacity: 0.6 },
  actionText: { color: colors.text, fontSize: 13 },
  actionTextDanger: { color: colors.danger },
  empty: { paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, color: colors.textMuted, fontSize: 13, lineHeight: 20 },
});
