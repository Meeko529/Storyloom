import { Platform } from "react-native";

import { getSetting, setSetting } from "@/data/repositories";

/** 正文可选的字体档位。 */
export type EditorFontId = "system" | "serif" | "kai";

export const EDITOR_FONT_KEY = "general.editorFontFamily";
export const EDITOR_FONT_SIZE_KEY = "general.editorFontSize";

export const DEFAULT_EDITOR_FONT: EditorFontId = "system";
export const DEFAULT_EDITOR_FONT_SIZE = 17;
export const MIN_EDITOR_FONT_SIZE = 11;
export const MAX_EDITOR_FONT_SIZE = 28;

export const EDITOR_FONT_OPTIONS: Array<{ id: EditorFontId; label: string; hint: string }> = [
  { id: "system", label: "黑体", hint: "系统默认，笔画清晰" },
  { id: "serif", label: "宋体", hint: "衬线字体，观感接近纸书印刷" },
  { id: "kai", label: "楷体", hint: "手写风格，观感柔和；部分设备可能回落到默认字体" },
];

export function normalizeEditorFont(value: string | null | undefined): EditorFontId {
  return value === "serif" || value === "kai" ? value : DEFAULT_EDITOR_FONT;
}

/** 把存储值夹到合法区间；非法值回落到默认字号。 */
export function normalizeEditorFontSize(value: string | number | null | undefined): number {
  const size = Number(value);
  if (!Number.isFinite(size)) return DEFAULT_EDITOR_FONT_SIZE;
  return Math.min(MAX_EDITOR_FONT_SIZE, Math.max(MIN_EDITOR_FONT_SIZE, Math.round(size)));
}

/**
 * 返回可直接传给 RN 样式的 fontFamily。
 * system 返回 undefined —— 即不设置该属性，沿用系统默认字体。
 */
export function editorFontFamily(id: EditorFontId): string | undefined {
  if (id === "serif") return Platform.select({ ios: "Songti SC", android: "serif", default: "serif" });
  if (id === "kai") return Platform.select({ ios: "Kaiti SC", android: "casual", default: "cursive" });
  return undefined;
}

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
