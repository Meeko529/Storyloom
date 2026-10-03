// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState, type PropsWithChildren, type ReactNode } from "react";
import {
  ActivityIndicator,
  Animated,
  KeyboardAvoidingView,
  Modal,
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
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";

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

export function Header({ title, action, onBack, leading }: { title?: ReactNode; action?: ReactNode; onBack?: () => void; leading?: ReactNode }) {
  return (
    <View style={styles.header}>
      <View style={styles.headerLeading}>
        {onBack ? (
          <Pressable accessibilityLabel="返回" onPress={onBack} style={styles.headerBack}>
            <Ionicons name="chevron-back" size={24} color={colors.text} />
          </Pressable>
        ) : null}
        {leading}
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
 * 居中的确认卡。
 *
 * 破坏性动作（删除卷、删除章节、删除作品、恢复历史版本）与必须让人看见的告知都用它，
 * 尺寸与颜色与写作页的命名输入卡完全一致：同一层遮罩浓度、同一张卡，换页不换观感。
 *
 * 三颗按钮时改为竖排：横排在窄屏上会挤成两行、且删除键紧挨取消键。竖排把确认放在
 * 最上、取消放在最下，误触代价最低的位置留给取消。
 */
export function ConfirmDialog({
  visible,
  title,
  message,
  onClose,
  confirmLabel,
  onConfirm,
  danger = false,
  extraLabel,
  onExtra,
}: {
  visible: boolean;
  title: string;
  message: string;
  /** 取消、点遮罩、系统返回键都走这里。 */
  onClose: () => void;
  /** 不传即纯告知，只剩一颗「知道了」。 */
  confirmLabel?: string;
  onConfirm?: () => void;
  /** 主按钮为删除一类的破坏性动作时置为 true。 */
  danger?: boolean;
  /** 可选的第二个中性动作，例如删章节时的「保留笔记」。 */
  extraLabel?: string;
  onExtra?: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.dialogBackdrop}>
        {/* 遮罩是兄弟节点、排在前：点卡外即取消，点卡内不会命中它。 */}
        <Pressable accessibilityLabel="关闭对话框" style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.dialogCard}>
          <Text style={styles.dialogTitle}>{title}</Text>
          <Text style={styles.dialogMessage}>{message}</Text>
          {!confirmLabel ? (
            <View style={[styles.dialogActions, styles.dialogActionsStacked]}>
              <Button label="知道了" onPress={onClose} />
            </View>
          ) : extraLabel ? (
            <View style={[styles.dialogActions, styles.dialogActionsStacked]}>
              <Button label={confirmLabel} variant={danger ? "danger" : "primary"} onPress={onConfirm ?? onClose} />
              <Button label={extraLabel} variant="secondary" onPress={onExtra ?? onClose} />
              <Button label="取消" variant="secondary" onPress={onClose} />
            </View>
          ) : (
            <View style={styles.dialogActions}>
              <Button label="取消" variant="secondary" onPress={onClose} />
              <Button label={confirmLabel} variant={danger ? "danger" : "primary"} onPress={onConfirm ?? onClose} />
            </View>
          )}
        </View>
      </View>
    </Modal>
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
      {children}
    </View>
  );
}

/**
 * 底部弹层。
 *
 * 全项目统一的底部弹层：面板贴屏幕左右两边、只有上沿两个圆角、从屏幕底部滑入。
 * 高度上限按屏高折算；内容区由调用方给滚动容器，且**必须用 `flexShrink: 1`** ——
 * 用 `flex: 1` 时父层高度由内容撑，会被算成 0；什么都不写则按内容撑满、被面板裁掉。
 */
export function BottomSheet({
  visible,
  title,
  subtitle,
  onClose,
  avoidKeyboard = false,
  maxHeightRatio = 0.8,
  children,
}: PropsWithChildren<{
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** 面板内有输入框时打开：键盘弹起时把面板整体顶上去，输入框不被盖住。 */
  avoidKeyboard?: boolean;
  maxHeightRatio?: number;
}>) {
  const [viewportHeight, setViewportHeight] = useState(0);
  const panel = (
    <View style={[styles.sheet, { maxHeight: viewportHeight > 0 ? viewportHeight * maxHeightRatio : undefined }]}>
      <View style={styles.sheetHeader}>
        <View style={styles.sheetTitleWrap}>
          <Text style={styles.sheetTitle} numberOfLines={1}>{title}</Text>
          {subtitle ? <Text style={styles.sheetSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
        </View>
        <Pressable accessibilityLabel={`关闭${title}`} onPress={onClose} style={styles.sheetClose}>
          <Ionicons name="close" size={24} color={colors.textMuted} />
        </Pressable>
      </View>
      {children}
    </View>
  );
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View
        style={styles.sheetBackdrop}
        onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
      >
        <Pressable accessibilityLabel="关闭弹层" style={StyleSheet.absoluteFill} onPress={onClose} />
        {avoidKeyboard
          ? <KeyboardAvoidingView behavior="padding" style={styles.sheetAvoid}>{panel}</KeyboardAvoidingView>
          : panel}
      </View>
    </Modal>
  );
}

/**
 * 顶部下滑面板。
 *
 * 与 `SheetBackdrop` 的差别在方向：那个从底部升起，这个从顶栏下方向下垂、盖住下方
 * 全屏。选择器与列表类内容（对话、版本、分类）用这个形态，读起来像"从上面拉下来的
 * 一层"，不打断当前页面；底部升起留给输入类与破坏性确认。
 *
 * 面板自身只渲染覆盖层与卡片，圆角在下沿；内容由调用方给，高度上限由 `maxHeightRatio`
 * 按屏高折算，避免小屏上把顶栏顶出屏幕。
 */
export function TopSheet({
  title,
  subtitle,
  onClose,
  maxHeightRatio = 0.72,
  avoidKeyboard = false,
  children,
}: PropsWithChildren<{
  title: string;
  subtitle?: string;
  onClose: () => void;
  maxHeightRatio?: number;
  /** 面板内有输入框时打开：键盘弹起时把面板整体顶上去，输入框不被盖住。 */
  avoidKeyboard?: boolean;
}>) {
  const insets = useSafeAreaInsets();
  const [viewportHeight, setViewportHeight] = useState(0);
  // 进场用位移 + 透明度，Modal 的 animationType 只做整层的淡入 —— 那样面板是"啪地
  // 出现"，与从上方垂下的观感相反。
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(enter, { toValue: 1, duration: 200, useNativeDriver: true }).start();
  }, [enter]);
  const body = (
    <>
      <Pressable accessibilityLabel={`关闭${title}`} style={StyleSheet.absoluteFill} onPress={onClose} />
      <Animated.View
        style={[
          styles.topSheet,
          {
            // 落在顶栏下沿之下：顶栏高 58，留 4 的缝，看起来是"挂在顶栏下面"。
            marginTop: insets.top + 62,
            maxHeight: viewportHeight > 0 ? viewportHeight * maxHeightRatio : undefined,
            opacity: enter,
            transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
          },
        ]}
      >
        <View style={styles.topSheetHeader}>
          <View style={styles.topSheetTitleWrap}>
            <Text style={styles.topSheetTitle} numberOfLines={1}>{title}</Text>
            {subtitle ? <Text style={styles.topSheetSubtitle} numberOfLines={1}>{subtitle}</Text> : null}
          </View>
          <Pressable accessibilityLabel={`关闭${title}`} onPress={onClose} style={styles.topSheetClose}>
            <Ionicons name="close" size={22} color={colors.textMuted} />
          </Pressable>
        </View>
        {children}
      </Animated.View>
    </>
  );
  return (
    <View
      style={styles.topSheetBackdrop}
      onLayout={(event) => setViewportHeight(event.nativeEvent.layout.height)}
    >
      {avoidKeyboard ? (
        <KeyboardAvoidingView behavior="padding" style={styles.topSheetAvoid}>
          {body}
        </KeyboardAvoidingView>
      ) : body}
    </View>
  );
}

/**
 * 顶部下滑面板里的滚动区。
 *
 * `PanelScroll` 是 `PlainScrollView` 加上「占满面板剩余高度」的样式，
 * 让面板在内容超出一屏时能滚，而不是把面板撑到屏外。
 * `TopSheetPadScrollContent` 给内容加左右与底部留白；行自身已带内边距时用
 * `TopSheetPadBottomContent`，否则左侧会缩进两次。
 */
export function PanelScroll({ contentStyle, children }: PropsWithChildren<{ contentStyle?: StyleProp<ViewStyle> }>) {
  return (
    <PlainScrollView style={styles.panelScroll} contentContainerStyle={contentStyle}>
      {children}
    </PlainScrollView>
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
 * 这里踩过三个坑，都写下来免得再犯：
 *
 * 🔴 一、`ScrollView` 自带的底样式是 `flexGrow: 1`（见 react-native 的
 * `ScrollView.js` 里 `styles.baseVertical`）。只写 `maxHeight` 时它会往上长到上限，
 * 内容再少也占满 —— 表现为卡片下方一大片空白、按钮被推到卡底。所以这里必须显式
 * 写回 `flexGrow: 0`，`maxHeight` 只是"上限"而不是"目标高度"。
 *
 * 🔴 二、不要用「先不夹、量到内容高再夹」的写法去绕上面那条：那会让展开的第一帧
 * 按内容全高渲染（长轨迹上千 px），下一帧才夹到上限。这一帧的高度差足以让外层
 * 列表整片重排，看起来就是文字叠在一起、或者跳到空白处。高度上限必须从第一帧
 * 就成立，因此这里**不持有任何测量状态**。
 *
 * 🔴 三、早先还在按高度于 `ScrollView` / `View` 两个分支间切换，两个分支的根元素
 * 类型不同，跨阈值时 React 会卸载重建整棵子树、内部 `useState` 全归零（点了没反应）。
 * 现在固定只用 `ScrollView`，永远不换根节点。
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
   * 表现为「想滑卡内内容，结果整条对话跟着滑」。
   *
   * 只在**滑动**时抢，绝不在触摸开始就抢：`onStartShouldSetResponderCapture` 里
   * 返回 true 会把展开区里所有可点元素一起吃掉（工具行、展开变更、提问选项），
   * 表现为点了没反应。所以起手只记起点、返回 false，等位移超过阈值再抢。
   */
  claimGesture?: boolean;
}>) {
  const gestureStart = useRef<{ x: number; y: number } | null>(null);
  return (
    <ScrollView
      nestedScrollEnabled
      showsVerticalScrollIndicator={false}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps={keyboardShouldPersistTaps}
      onStartShouldSetResponderCapture={claimGesture ? (event) => {
        gestureStart.current = { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY };
        return false;
      } : undefined}
      onMoveShouldSetResponderCapture={claimGesture ? (event) => {
        const start = gestureStart.current;
        if (!start) return false;
        const dx = event.nativeEvent.pageX - start.x;
        const dy = event.nativeEvent.pageY - start.y;
        return Math.abs(dy) > 6 && Math.abs(dy) >= Math.abs(dx);
      } : undefined}
      style={[styles.adaptiveScroll, style, { maxHeight }]}
      contentContainerStyle={contentContainerStyle}
    >
      {children}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  // 居中卡与写作页的命名输入卡同一套数值：遮罩 0.48、卡片内边距 24、圆角 14、底色跟页面一致。
  dialogBackdrop: { flex: 1, justifyContent: "center", padding: spacing.lg, backgroundColor: colors.overlay },
  dialogCard: { gap: spacing.md, padding: spacing.xl, borderRadius: radius.md, backgroundColor: colors.background },
  dialogTitle: { color: colors.text, fontSize: 20, fontWeight: "700" },
  dialogMessage: { color: colors.textMuted, fontSize: 14, lineHeight: 21 },
  dialogActions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm, marginTop: spacing.xs },
  dialogActionsStacked: { flexDirection: "column", alignItems: "stretch" },
  sheetBackdrop: { flex: 1, justifyContent: "flex-end", backgroundColor: colors.overlay },
  topSheetBackdrop: { flex: 1, backgroundColor: colors.overlaySoft },
  topSheetAvoid: { flex: 1 },
  sheet: {
    maxHeight: "80%",
    paddingBottom: spacing.xl,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    backgroundColor: colors.background,
  },
  sheetHeader: {
    minHeight: 64,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  sheetTitleWrap: { flex: 1, minWidth: 0 },
  sheetTitle: { color: colors.text, fontSize: 18, fontWeight: "700" },
  sheetSubtitle: { marginTop: 2, color: colors.textMuted, fontSize: 12 },
  sheetClose: { width: 44, height: 44, alignItems: "flex-end", justifyContent: "center" },
  sheetAvoid: { width: "100%" },
  topSheet: {
    flexShrink: 1,
    // 左右留边让面板浮在页面之上，而不是贴屏幕两缘。
    marginHorizontal: spacing.md,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    borderBottomLeftRadius: radius.sheet,
    borderBottomRightRadius: radius.sheet,
    // 面板下沿要投一层轻影，否则与被遮住的页面之间没有分界，看着像浮在空中。
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.16,
    shadowRadius: 12,
    elevation: 12,
    overflow: "hidden",
  },
  topSheetHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.sm,
  },
  topSheetTitleWrap: { flex: 1, minWidth: 0 },
  topSheetTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  topSheetSubtitle: { marginTop: 2, color: colors.textMuted, fontSize: 12 },
  topSheetClose: { width: 40, height: 40, alignItems: "flex-end", justifyContent: "flex-start" },
  panelScroll: { flexShrink: 1 },
  // ScrollView 自带 flexGrow: 1，会被撑到 maxHeight；这里写回 0，让它是「上限」而不是「目标高度」。
  adaptiveScroll: { flexGrow: 0 },
  // 行自带左右内边距时只补底部留白，否则左侧缩进两次。
  // 面板内容首行的动作入口（如「新建卷」），顶栏只留标题与关闭。
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
