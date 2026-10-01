import { Platform } from "react-native";

import { getSetting, setSetting } from "@/data/repositories";

/** 正文可选的字体档位。 */
export type EditorFontId = "system" | "serif" | "kai" | "wenkai";

export const EDITOR_FONT_KEY = "general.editorFontFamily";
export const EDITOR_FONT_SIZE_KEY = "general.editorFontSize";
/** 对话与界面文本单独一套：写作讲究久读舒适，对话讲究信息密度，两者诉求不同。 */
export const CHAT_FONT_KEY = "general.chatFontFamily";
export const CHAT_FONT_SIZE_KEY = "general.chatFontSize";

export const DEFAULT_EDITOR_FONT: EditorFontId = "system";
export const DEFAULT_EDITOR_FONT_SIZE = 17;
export const DEFAULT_CHAT_FONT_SIZE = 15;
export const MIN_EDITOR_FONT_SIZE = 11;
export const MAX_EDITOR_FONT_SIZE = 28;

export const EDITOR_FONT_OPTIONS: Array<{ id: EditorFontId; label: string; hint: string }> = [
  { id: "system", label: "黑体", hint: "系统默认，笔画清晰" },
  { id: "serif", label: "宋体", hint: "衬线字体，观感接近纸书印刷" },
  { id: "kai", label: "楷体", hint: "手写风格，观感柔和；部分设备可能回落到默认字体" },
  { id: "wenkai", label: "文楷", hint: "霞鹜文楷（OFL-1.1）：笔画带手写笔意，接近纸书；需先在「设置 → 可选内容」中下载" },
];

export function normalizeEditorFont(value: string | null | undefined): EditorFontId {
  return value === "serif" || value === "kai" || value === "wenkai" ? value : DEFAULT_EDITOR_FONT;
}

/** 把存储值夹到合法区间；非法值回落到默认字号。 */
export function normalizeEditorFontSize(value: string | number | null | undefined): number {
  const size = Number(value);
  if (!Number.isFinite(size)) return DEFAULT_EDITOR_FONT_SIZE;
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, Math.round(size)));
}

/** 对话字号同样有下限与上限，但默认值与正文不同。 */
export function normalizeChatFontSize(value: string | number | null | undefined): number {
  const size = Number(value);
  if (!Number.isFinite(size)) return DEFAULT_CHAT_FONT_SIZE;
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, Math.round(size)));
}

/**
 * 返回可直接传给 RN 样式的 fontFamily。
 * system 返回 undefined —— 即不设置该属性，沿用系统默认字体。
 */
export function editorFontFamily(id: EditorFontId): string | undefined {
  if (id === "serif") return Platform.select({ ios: "Songti SC", android: "serif", default: "serif" });
  if (id === "kai") return Platform.select({ ios: "Kaiti SC", android: "casual", default: "cursive" });
  // 文楷需要先由 font-loader 注册；未安装时 RN 会回落到系统字体。
  if (id === "wenkai") return EDITOR_FONT_FAMILY_WENKAI;
  return undefined;
}

/** 与 remote-resources 中字体包登记的族名保持一致。 */
export const EDITOR_FONT_FAMILY_WENKAI = "StoryloomWenKai";

export interface EditorPrefs {
  fontSize: number;
  fontFamily: EditorFontId;
}

export async function readEditorPrefs(): Promise<EditorPrefs> {
  const [fontValue, sizeValue] = await Promise.all([
    getSetting(EDITOR_FONT_KEY),
    getSetting(EDITOR_FONT_SIZE_KEY),
  ]);
  return {
    fontFamily: normalizeEditorFont(fontValue),
    fontSize: normalizeEditorFontSize(sizeValue),
  };
}

export async function saveEditorFont(id: EditorFontId): Promise<void> {
  await setSetting(EDITOR_FONT_KEY, id);
}

export async function saveEditorFontSize(size: number): Promise<void> {
  await setSetting(EDITOR_FONT_SIZE_KEY, String(normalizeEditorFontSize(size)));
}

/** 读取「对话时」的字体与字号；未设置过时沿用默认值。 */
export async function readChatPrefs(): Promise<EditorPrefs> {
  const [fontValue, sizeValue] = await Promise.all([
    getSetting(CHAT_FONT_KEY),
    getSetting(CHAT_FONT_SIZE_KEY),
  ]);
  return {
    fontFamily: normalizeEditorFont(fontValue),
    fontSize: normalizeChatFontSize(sizeValue),
  };
}

export async function saveChatFont(id: EditorFontId): Promise<void> {
  await setSetting(CHAT_FONT_KEY, id);
}

export async function saveChatFontSize(size: number): Promise<void> {
  await setSetting(CHAT_FONT_SIZE_KEY, String(normalizeChatFontSize(size)));
}
