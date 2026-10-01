/**
 * 正文中文字体的运行时加载。
 *
 * 字体文件不随安装包分发，用户在「设置 → 可选内容」里按需下载；
 * 下载后由这里注册给 expo-font，写作页按族名渲染。未下载时 RN 会回落到系统字体。
 */
import * as Font from "expo-font";

import { FONT_PACK_INFO, getInstalledFontFilePath } from "@/settings/remote-resources";

let loaded = false;
let pending: Promise<boolean> | null = null;

/** 把已下载的字体注册给 expo-font；未下载或注册失败返回 false（调用方按回落处理）。 */
export async function ensureEditorFontLoaded(): Promise<boolean> {
  if (loaded) return true;
  if (pending) return pending;
  pending = (async () => {
    try {
      const uri = getInstalledFontFilePath();
      if (!uri) return false;
      await Font.loadAsync(FONT_PACK_INFO.family, { uri });
      loaded = true;
      return true;
    } catch {
      return false;
    } finally {
      pending = null;
    }
  })();
  return pending;
}

/** 字体是否已注册完成（写作页用它决定是否需要等一次加载）。 */
export function isEditorFontLoaded(): boolean {
  return loaded;
}
