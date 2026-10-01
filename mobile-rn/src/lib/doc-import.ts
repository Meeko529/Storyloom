import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";
import { Buffer } from "buffer";
import iconv from "iconv-lite";

import { appendBreadcrumb, appendCrashLog } from "@/lib/crash-log";
import { readDocxText } from "@/lib/docx";
import { extractEpub } from "@/style/source-library";
import { createChapter, createProject, createVolume } from "@/data/repositories";
import type { Project } from "@/types";

const MAX_IMPORT_BYTES = 50 * 1024 * 1024;
/** 单章上限与 repositories.ts 的编辑器限制一致：100k 字符 / 2000 行 */
const MAX_CHAPTER_CHARACTERS = 100_000;
const MAX_CHAPTER_LINES = 2_000;
const MAX_CHAPTERS = 500;

/** 支持的格式：txt / md / docx / epub（按扩展名判定，判定失败回显信息便于定位） */
function formatForName(name: string): "txt" | "md" | "docx" | "epub" | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(name.trim());
  if (!match) return null;
  const ext = match[1].toLowerCase();
  if (ext === "txt") return "txt";
  if (ext === "md" || ext === "markdown") return "md";
  if (ext === "docx") return "docx";
  if (ext === "epub") return "epub";
  return null;
}

/** 文本解码：BOM 优先，UTF-8 失败率高于 GB18030 时改用 GB18030（与参考书库同一策略） */
function decodeText(bytes: Uint8Array): string {
  const buffer = Buffer.from(bytes);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return iconv.decode(buffer.subarray(3), "utf8");
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return iconv.decode(buffer.subarray(2), "utf16-le");
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return iconv.decode(buffer.subarray(2), "utf16-be");
  const utf8 = iconv.decode(buffer, "utf8");
  const utf8ReplacementCount = (utf8.match(/\uFFFD/g) ?? []).length;
  if (utf8ReplacementCount === 0) return utf8;
  const gb18030 = iconv.decode(buffer, "gb18030");
  const gbReplacementCount = (gb18030.match(/\uFFFD/g) ?? []).length;
  return gbReplacementCount < utf8ReplacementCount ? gb18030 : utf8;
}

function normalizeText(value: string): string {
  return value.replace(/\r\n?/g, "\n").replace(/\n{4,}/g, "\n\n\n").trim();
}

const VOLUME_RE = /^\s*(第\s*[0-9零一二三四五六七八九十百千两]+\s*[卷部][^\n]{0,30})$/;
const CHAPTER_RE = /^\s*((第\s*[0-9零一二三四五六七八九十百千两]+\s*章[^\n]{0,40})|(序章|楔子|引子|尾声|终章|番外[^\n]{0,20})|(Chapter\s+\d+[^\n]{0,40}))\s*$/;
const NUMBER_TITLE_RE = /^\s*\d{1,4}[、.．,，]\s*\S[^\n]{0,30}$/;
const MD_HEADING_RE = /^#\s+(.+)$/;

interface ImportSection {
  volumeTitle: string | null;
  title: string;
  content: string;
}

/** 按卷/章标题行切分；无任何标题行时整本作为一章「正文」。 */
function splitSections(text: string): ImportSection[] {
  const lines = text.split("\n");
  const sections: ImportSection[] = [];
  let currentVolume: string | null = null;
  let currentTitle: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const content = buffer.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    buffer = [];
    if (!content) return;
    sections.push({ volumeTitle: currentVolume, title: currentTitle ?? "正文", content });
    currentTitle = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, "");
    const volumeMatch = VOLUME_RE.exec(line);
    if (volumeMatch) {
      flush();
      currentVolume = volumeMatch[1].replace(/\s+/g, "");
      continue;
    }
    const chapterMatch = CHAPTER_RE.exec(line);
    const numberMatch = NUMBER_TITLE_RE.exec(line);
    const mdMatch = MD_HEADING_RE.exec(line);
    if (chapterMatch) {
      flush();
      currentTitle = chapterMatch[1].replace(/\s+/g, " ").trim();
      continue;
    }
    if (numberMatch) {
      flush();
      currentTitle = numberMatch[0].trim();
      continue;
    }
    if (mdMatch) {
      flush();
      currentTitle = mdMatch[1].trim();
      continue;
    }
    buffer.push(rawLine);
  }
  flush();

  // 标题行紧跟的空段（比如卷名后没有内容）跳过；没有切出任何章节就整本一章
  const withContent = sections.filter((section) => section.content.length > 0);
  if (withContent.length === 0) {
    return [{ volumeTitle: null, title: "正文", content: normalizeText(text) }];
  }
  return withContent.slice(0, MAX_CHAPTERS);
}

/** 超过单章上限的长段按段落再切，保证能通过编辑器限制。 */
function splitOversize(section: ImportSection): ImportSection[] {
  const chunks: ImportSection[] = [];
  let current: string[] = [];
  let currentLines = 0;
  let currentChars = 0;
  let part = 1;
  const pushChunk = () => {
    const content = current.join("\n").trim();
    if (!content) return;
    chunks.push({
      volumeTitle: section.volumeTitle,
      title: part === 1 ? section.title : `${section.title}（${part}）`,
      content,
    });
    part += 1;
    current = [];
    currentLines = 0;
    currentChars = 0;
  };
  for (const paragraph of section.content.split("\n")) {
    const lineLength = paragraph.length + 1;
    if (currentChars + lineLength > MAX_CHAPTER_CHARACTERS - 100 || currentLines + 1 > MAX_CHAPTER_LINES - 2) {
      pushChunk();
    }
    current.push(paragraph);
    currentLines += 1;
    currentChars += lineLength;
  }
  pushChunk();
  return chunks.length ? chunks : [section];
}

function titleFromName(name: string): string {
  const base = name.replace(/\.[A-Za-z0-9]+$/, "").trim();
  return base || "导入作品";
}

/**
 * 本机导入：选择 txt / md / docx / epub，按卷章标题切分后创建为作品。
 * 成功返回创建的作品（调用方负责跳转），用户取消返回 null。
 */
export async function importProjectFromFile(): Promise<Project | null> {
  try {
    return await runImport();
  } catch (error) {
    appendCrashLog("导入作品", error);
    appendBreadcrumb(`导入作品失败：${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

async function runImport(): Promise<Project | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: [
      "text/*",
      "application/json",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/epub+zip",
      "application/octet-stream",
    ],
    copyToCacheDirectory: true,
    multiple: false,
  }).catch((pickerError: unknown) => {
    throw new Error(`导入失败（选择文件）：${pickerError instanceof Error ? pickerError.message : String(pickerError)}`);
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const file = new File(asset.uri);
  let bytes: Uint8Array;
  try {
    bytes = await file.bytes();
  } catch (error) {
    throw new Error(`导入失败（读取文件）：无法读取「${asset.name || "所选文件"}」，${error instanceof Error ? error.message : String(error)}`);
  }
  if (bytes.byteLength > MAX_IMPORT_BYTES) throw new Error("作品文件必须小于 50 MB");

  const format = formatForName(asset.name ?? "");
  if (!format) {
    throw new Error(`导入失败（识别格式）：仅支持 TXT、Markdown、Word（.docx）与 EPUB（文件名：${asset.name || "空"}，类型：${asset.mimeType || "未知"}）`);
  }

  let title: string | null = null;
  let text: string;
  if (format === "docx") {
    text = readDocxText(bytes);
  } else if (format === "epub") {
    const extracted = extractEpub(bytes);
    title = extracted.title;
    text = extracted.text;
  } else {
    text = decodeText(bytes);
  }
  text = normalizeText(text);
  if (!text) throw new Error("文件中没有可读取的正文");

  const sections = splitSections(text).flatMap(splitOversize);
  if (!sections.length) throw new Error("文件中没有可读取的正文");

  const project = await createProject(title || titleFromName(asset.name ?? ""), "");
  const volumeCache = new Map<string, string>();
  for (const section of sections) {
    const volumeTitle = section.volumeTitle ?? "正文";
    let volumeId = volumeCache.get(volumeTitle);
    if (!volumeId) {
      const volume = await createVolume(project.id, volumeTitle);
      volumeId = volume.id;
      volumeCache.set(volumeTitle, volumeId);
    }
    await createChapter(project.id, volumeId, section.title, section.content);
  }
  appendBreadcrumb(`导入作品「${project.title}」：${sections.length} 章`);
  return project;
}
