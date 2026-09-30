import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { moveAsync, deleteAsync } from "expo-file-system";

/**
 * 把本地图片降采样到指定宽度并写回原路径（覆盖）。
 * 用途：封面 / 头像选图后落盘前压尺寸，消除全分辨率解码的内存峰值（闪退根因）。
 * 返回是否实际发生了降采样。
 */
export async function downsampleToFile(uri: string, width: number, quality = 0.85): Promise<boolean> {
  const result = await manipulateAsync(
    uri,
    [{ resize: { width } }],
    { compress: quality, format: SaveFormat.JPEG },
  );
  // 目标比原图还大（图本来就小）→ 不覆盖，清理临时文件
  try {
    await deleteAsync(result.uri, { idempotent: true });
  } catch {}
  try {
    await moveAsync({ from: result.uri, to: uri });
    return true;
  } catch {
    return false;
  }
}
