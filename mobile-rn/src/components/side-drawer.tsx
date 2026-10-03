import { Ionicons } from "@expo/vector-icons";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, Dimensions, Easing, PanResponder, Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { PlainScrollView } from "@/components/ui";
import { colors, radius, spacing } from "@/theme";

const DRAWER_WIDTH_RATIO = 0.76;

/**
 * 侧边抽屉外壳。
 *
 * 只负责「怎么出场」：从左侧滑出时走缓动曲线（先快后慢）而不是线性平移，
 * 右沿两角收圆、带一层柔和的投影，遮罩极浅（主界面仍看得清），
 * 点空白处或左滑都能收起。内容由调用方给：写作页装作品结构，助手页装历史对话。
 *
 * 常挂不卸载：开合只改位移与遮罩透明度，避免每次开合都重建整棵内容树。
 */
export function SideDrawer({
  visible,
  title,
  meta,
  onClose,
  children,
}: {
  visible: boolean;
  title: string;
  /** 标题右侧的计数一类的短信息，与标题同一行。 */
  meta?: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const width = useMemo(() => Math.round(Dimensions.get("window").width * DRAWER_WIDTH_RATIO), []);
  const translateX = useRef(new Animated.Value(-width)).current;
  const backdropOpacity = useRef(new Animated.Value(0)).current;
  // 手势回调是常驻闭包，用 ref 取最新的 onClose，避免拿到过期的那一个。
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: visible ? 0 : -width,
        duration: visible ? 260 : 190,
        // 出场用 ease-out：起步快、落位慢，看着是「滑进去」而不是被推出来。
        easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropOpacity, {
        toValue: visible ? 1 : 0,
        duration: visible ? 260 : 190,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    ]).start();
  }, [visible, width, translateX, backdropOpacity]);

  /** 左滑关闭：位移超过抽屉宽度三成即收起，否则弹回；纵向滑动交给内容滚动。 */
  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_event, gesture) =>
        Math.abs(gesture.dx) > 8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
      onPanResponderMove: (_event, gesture) => {
        if (gesture.dx < 0) translateX.setValue(Math.max(gesture.dx, -width));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (gesture.dx < -width * 0.3) {
          closeRef.current();
          return;
        }
        Animated.timing(translateX, {
          toValue: 0,
          duration: 180,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  return (
    <View style={styles.host} pointerEvents={visible ? "auto" : "none"}>
      <Animated.View style={[styles.backdrop, { opacity: backdropOpacity }]}>
        <Pressable accessibilityLabel="关闭侧边栏" onPress={onClose} style={styles.backdropPress} />
      </Animated.View>

      <Animated.View
        style={[styles.panel, { width, paddingTop: insets.top + spacing.sm, transform: [{ translateX }] }]}
        {...pan.panHandlers}
      >
        <View style={styles.panelHeader}>
          <View style={styles.panelHeading}>
            <Text numberOfLines={1} style={styles.panelTitle}>{title}</Text>
            {meta ? <Text numberOfLines={1} style={styles.panelMeta}>{meta}</Text> : null}
          </View>
          <Pressable accessibilityLabel="关闭侧边栏" onPress={onClose} style={styles.iconButton}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </Pressable>
        </View>

        <PlainScrollView contentContainerStyle={styles.panelBody} keyboardShouldPersistTaps="handled">
          {children}
        </PlainScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 20 },
  backdrop: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: colors.overlaySoft },
  backdropPress: { flex: 1 },
  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: colors.background,
    // 与弹层同一套圆角，落在外沿这一侧。
    borderTopRightRadius: radius.sheet,
    borderBottomRightRadius: radius.sheet,
    paddingBottom: spacing.sm,
    shadowColor: "#000",
    shadowOffset: { width: 6, height: 0 },
    shadowOpacity: 0.16,
    shadowRadius: 14,
    elevation: 12,
  },
  panelHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    paddingBottom: spacing.sm,
  },
  panelHeading: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "baseline", gap: spacing.sm },
  panelTitle: { color: colors.text, fontSize: 17, fontWeight: "700" },
  panelMeta: { color: colors.textMuted, fontSize: 12 },
  iconButton: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  panelBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
});
