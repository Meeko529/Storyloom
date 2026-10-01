export const colors = {
  background: "#F7F7F5",
  surface: "#FFFFFF",
  surfaceMuted: "#EFEFEC",
  text: "#20211F",
  textMuted: "#696B66",
  border: "#D9DAD5",
  primary: "#176B57",
  primaryPressed: "#0F5444",
  accent: "#D95D39",
  danger: "#B42318",
  overlay: "rgba(20, 21, 19, 0.48)",
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 10, md: 14, lg: 20, /** 底部弹层顶角，Material 3 规范值 */ sheet: 28 } as const;

/** 卡片阴影：Android 走 elevation，iOS 走四件套。只用于可点卡片与浮层，标题栏/tab 栏保持扁平。 */
export const shadow = {
  card: {
    shadowColor: "#20211F",
    shadowOpacity: 0.07,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
} as const;
