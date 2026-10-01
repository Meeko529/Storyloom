/**
 * SillyTavern 生态导入：世界书 World Info JSON 与角色卡（JSON / PNG 内嵌卡）。
 *
 * 只做格式解析与字段映射，不复制 SillyTavern 代码（AGPL-3.0，只可参考设计）。
 * 世界书条目保留 key[] 为 keywords（方案 B：关键词索引，导入后由模型按需读取）。
 */
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";

import { appendBreadcrumb, appendCrashLog } from "@/lib/crash-log";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;

export interface StWorldEntry {
  name: string;
  content: string;
  keywords: string[];
  isEnabled: boolean;
}

export interface StCharacterCard {
  name: string;
  description: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim());
  }
  if (typeof value === "string" && value.trim()) {
    return value.split(",").map((part) => part.trim()).filter(Boolean);
  }
  return [];
}

/** 世界书 JSON：兼容 { entries: {..} } / { entries: [..] } / 裸数组三种形态。 */
export function parseSillyTavernWorldInfo(text: string): StWorldEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("不是有效的 JSON 文件");
  }
  let rawEntries: unknown;
  if (isRecord(parsed) && "entries" in parsed) rawEntries = parsed.entries;
  else if (Array.isArray(parsed)) rawEntries = parsed;
  else throw new Error("文件里没有 entries 字段，不是 SillyTavern 世界书");

  const rows: Array<Record<string, unknown>> = Array.isArray(rawEntries)
    ? rawEntries.filter(isRecord)
    : Object.values(rawEntries as Record<string, unknown>).filter(isRecord);
  const entries: StWorldEntry[] = [];
  for (const row of rows) {
    const content = typeof row.content === "string" ? row.content.trim() : "";
    const keys = asStringArray(row.key);
    if (!content && keys.length === 0) continue;
    const uid = typeof row.uid === "number" ? row.uid : entries.length + 1;
    const comment = typeof row.comment === "string" && row.comment.trim() ? row.comment.trim() : "";
    entries.push({
      name: comment || keys[0] || `条目 ${uid}`,
      content,
      keywords: keys,
      isEnabled: row.disable !== true,
    });
  }
  if (!entries.length) throw new Error("没有可导入的条目（条目需要至少有内容或关键词）");
  return entries;
}

function descriptionFromCard(card: Record<string, unknown>): StCharacterCard {
  const data = isRecord(card.data) ? card.data : card;
  const pick = (field: string): string => (typeof data[field] === "string" ? (data[field] as string).trim() : "");
  const name = pick("name") || "导入角色";
  const sections: string[] = [];
  const description = pick("description");
  if (description) sections.push(description);
  const personality = pick("personality");
  if (personality) sections.push(`【性格】${personality}`);
  const scenario = pick("scenario");
  if (scenario) sections.push(`【场景】${scenario}`);
  const firstMes = pick("first_mes");
  if (firstMes) sections.push(`【开场白示例】${firstMes}`);
  if (!sections.length) throw new Error("角色卡里没有可用的描述内容");
  return { name, description: sections.join("\n\n") };
}

/** 角色卡：JSON（V1/V2/V3）或 PNG（tEXt 内嵌 base64 卡）。 */
export function parseCharacterCard(bytes: Uint8Array): StCharacterCard {
  const decoder = new TextDecoder();
  const head = decoder.decode(bytes.slice(0, Math.min(bytes.length, 64)));
  let jsonText: string;
  if (head.includes("{")) {
    jsonText = decoder.decode(bytes);
  } else if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    jsonText = extractPngCardJson(bytes) ?? "";
    if (!jsonText) throw new Error("PNG 里没有内嵌角色卡数据（tEXt/chara）");
  } else {
    throw new Error("只支持 JSON 角色卡或带内嵌卡的 PNG 图片");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new Error("角色卡 JSON 解析失败");
  }
  return descriptionFromCard(isRecord(parsed) ? parsed : {});
}

function extractPngCardJson(bytes: Uint8Array): string | null {
  const decoder = new TextDecoder("latin1");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8; // 跳过 PNG 签名
  let fallback: string | null = null;
  while (offset + 8 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = decoder.decode(bytes.slice(offset + 4, offset + 8));
    const dataStart = offset + 8;
    if (type === "tEXt") {
      const raw = decoder.decode(bytes.slice(dataStart, dataStart + length));
      const separator = raw.indexOf("\0");
      if (separator > 0) {
        const keyword = raw.slice(0, separator);
        const payload = raw.slice(separator + 1);
        try {
          if (keyword === "ccv3") return atobStrict(payload) ?? fallback;
          if (keyword === "chara") fallback = atobStrict(payload) ?? fallback;
        } catch {
          // base64 解码失败时继续找下一块
        }
      }
    }
    if (type === "IEND") break;
    offset = dataStart + length + 4; // 跳过 CRC
  }
  return fallback;
}

function atobStrict(payload: string): string | null {
  const binary = payload.replace(/\s/g, "");
  const decoded = globalThis.atob(binary);
  return decoded ? new TextDecoder().decode(Uint8Array.from(decoded, (char) => char.charCodeAt(0))) : null;
}

/** 选一个角色卡 / 世界书文件（JSON 或 PNG）。 */
export async function pickSillyTavernFile(): Promise<{ fileName: string; bytes: Uint8Array } | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["application/json", "image/png", "application/octet-stream"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  try {
    const file = new File(asset.uri);
    const bytes = await file.bytes();
    if (!bytes.length) throw new Error("文件是空的");
    if (bytes.length > MAX_IMPORT_BYTES) throw new Error("文件必须小于 20 MB");
    return { fileName: asset.name, bytes };
  } catch (error) {
    appendCrashLog(`SillyTavern 导入读取失败：${asset.name}`, error);
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export function logImportBreadcrumb(subject: string, fileName: string, detail: string): void {
  appendBreadcrumb(`SillyTavern 导入${subject}「${fileName}」：${detail}`);
}
