// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import { Ionicons } from "@expo/vector-icons";
import { useState, type PropsWithChildren, type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { SafeAreaView } from "react-native-safe-area-context";

import { colors, radius, spacing } from "@/theme";

export function Screen({ children, scroll = false }: PropsWithChildren<{ scroll?: boolean }>) {
  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      {scroll ? (
        <KeyboardAwareScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          showsHorizontalScrollIndicator={false}
          bottomOffset={spacing.lg}
        >
          {children}
        </KeyboardAwareScrollView>
      ) : children}
    </SafeAreaView>
  );
}

export function Header({ title, action, onBack }: { title?: ReactNode; action?: ReactNode; onBack?: () => void }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeading}>
        {onBack ? (
          <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.headerBack}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
        ) : null}
        <Text style={styles.headerTitle} numberOfLines={1}>{title}</Text>
      </View>
      {action}
    </View>
  );
}

export function Field({ label, style, ...props }: TextInputProps & { label: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {/* 用数组合并样式：调用方传 style 时只做覆盖（例如多行高度），不会丢掉输入框自己的边框与内边距 */}
      <TextInput placeholderTextColor={colors.textMuted} {...props} style={[styles.input, style]} />
    </View>
  );
}

export function Button({
  label,
  onPress,
  variant = "primary",
  disabled = false,
  loading = false,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        variant === "primary" && styles.buttonPrimary,
        variant === "secondary" && styles.buttonSecondary,
        variant === "danger" && styles.buttonDanger,
        (pressed || disabled) && styles.buttonPressed,
      ]}
    >
      {loading ? <ActivityIndicator color={variant === "secondary" ? colors.text : "#FFFFFF"} /> : (
        <Text style={[styles.buttonText, variant === "secondary" && styles.buttonTextSecondary]}>{label}</Text>
      )}
    </Pressable>
  );
}

export function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>{title}</Text>
      {action}
    </View>
  );
}

export function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <View accessibilityLiveRegion="polite" style={styles.errorNotice}>
      <Text style={styles.errorText}>{message}</Text>
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryText}>重试</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * 底部弹层的遮罩。遮罩是铺满全屏的兄弟节点并排在内容之前，内容自然盖在它上面，
 * 因此点击内容不会命中遮罩，点击内容之外才会关闭。
 *
 * 不要退回"用 Pressable 包住整个弹层、再给内容加 onStartShouldSetResponder"的写法：
 * 那样会在触摸开始时抢走 JS responder，慢速拖动就会挡住内部 ScrollView 的滚动，
 * 表现为滚动时灵时不灵。
 */
export function SheetBackdrop({ onPress, children }: PropsWithChildren<{ onPress: () => void }>) {
  return (
    <View style={styles.sheetBackdrop}>
      <Pressable accessibilityLabel="关闭弹层" style={StyleSheet.absoluteFill} onPress={onPress} />
      {/* 顶部把手：负下边距让它压进弹层上沿，zIndex 保证画在弹层之上。 */}
      <View pointerEvents="none" style={styles.sheetHandle} />
      {children}
    </View>
  );
}

/**
 * 全项目统一的滚动容器。
 *
 * 一律不显示滚动条：Android 上 ScrollView 默认画一条灰色竖条，落在卡内或弹层里很脏。
 * 做这一个组件是为了「关掉滚动条」只写一次 —— 此前 17 处滚动容器各写各的，
 * 漏关的地方就留到用户反馈里。
 */
export function PlainScrollView({
  horizontal = false,
  style,
  contentContainerStyle,
  keyboardShouldPersistTaps,
  children,
}: PropsWithChildren<{
  horizontal?: boolean;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: boolean | "always" | "never" | "handled";
}>) {
  return (
    <ScrollView
      horizontal={horizontal}
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      style={style}
      contentContainerStyle={contentContainerStyle}
    >
      {children}
    </ScrollView>
  );
}

/**
 * 限高滚动容器（内容自适应高度）。
 *
 * 语义：内容高度 ≤ maxHeight 时高度等于内容高度（不撑开、不留空档）；超过上限才可滚动。
 *
 * 🔴 曾经在这里犯过一个反复出现的错：早先的实现按高度在两个分支间切换
 * `ScrollView` 与 `View`。两个分支的根元素**类型不同**，高度跨过阈值时 React 会把
 * 整棵子树卸载重建，容器内所有 `useState` 归零 —— 于是「展开」点了没反应、且在
 * 阈值附近来回抖动时明显卡顿。现在固定只用 `ScrollView`，靠 `onContentSizeChange`
 * 动态调 `maxHeight`，**永远不换根节点**。
 */
export function AdaptiveScroll({
  maxHeight,
  style,
  contentContainerStyle,
  keyboardShouldPersistTaps,
  claimGesture = false,
  children,
}: PropsWithChildren<{
  maxHeight: number;
  style?: StyleProp<ViewStyle>;
  contentContainerStyle?: StyleProp<ViewStyle>;
  keyboardShouldPersistTaps?: boolean | "always" | "never" | "handled";
  /**
   * 抢下手势：用在「倒置 FlatList 里内嵌的限高滚动」场景。
   * 外层列表是 inverted 的，两层滚动方向判定相反，触摸会先被外层吃掉 ——
   * 表现为「想滑卡内内容，结果整条对话跟着滑」。让内层在触摸开始时就成为 responder
   * 才能拿到手势。只在确实嵌套倒置列表时开，普通页面保持默认。
   */
  claimGesture?: boolean;
}>) {
  // 内容实测高度；未测到时先按上限夹住，避免撑开一帧。
  const [contentHeight, setContentHeight] = useState(0);
  const clamped = contentHeight > maxHeight ? maxHeight : undefined;
  return (
    <ScrollView
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      onStartShouldSetResponderCapture={claimGesture ? () => true : undefined}
      onContentSizeChange={(_width, height) => setContentHeight(height)}
      style={[style, { maxHeight: clamped }]}
      contentContainerStyle={contentContainerStyle}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  sheetHandle: { alignSelf: "center", width: 36, height: 4, borderRadius: 2, backgroundColor: "rgba(20,20,20,0.16)", marginBottom: -14, zIndex: 2 },
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { paddingBottom: 40 },
  header: {
    minHeight: 58,
    paddingHorizontal: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  headerLeading: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center" },
  headerBack: { width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" },
  headerTitle: { flex: 1, color: colors.text, fontSize: 22, fontWeight: "700" },
  field: { gap: spacing.sm },
  label: { color: colors.textMuted, fontSize: 13, fontWeight: "600" },
  input: {
    minHeight: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  button: {
    minHeight: 44,
    minWidth: 44,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonPrimary: { backgroundColor: colors.primary },
  buttonSecondary: { backgroundColor: colors.surfaceMuted, borderWidth: 1, borderColor: colors.border },
  buttonDanger: { backgroundColor: colors.danger },
  buttonPressed: { opacity: 0.64 },
  buttonText: { color: "#FFFFFF", fontWeight: "700", fontSize: 15 },
  buttonTextSecondary: { color: colors.text },
  empty: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  emptyTitle: { color: colors.textMuted, fontSize: 16, textAlign: "center" },
  errorNotice: {
    minHeight: 44,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: "#FDECEA",
  },
  errorText: { flex: 1, color: colors.danger, fontSize: 13, lineHeight: 19 },
  retryButton: { minWidth: 44, minHeight: 44, alignItems: "center", justifyContent: "center" },
  retryText: { color: colors.danger, fontSize: 13, fontWeight: "700" },
});
