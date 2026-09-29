// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import type { Chapter, Character, Project, Volume, WorldInfo, WorldInfoEntry } from "@/types";

export type ExportScope = "chapter" | "volume" | "book";
export type LibraryExportFormat = "json" | "markdown";
/** 正文导出格式：Markdown 便于再排版，纯文本便于直接投稿或粘贴到别处。 */
export type NovelExportFormat = "markdown" | "txt";

export interface ExportNovelInput {
  project: Project;
  volumes: Volume[];
  chapters: Chapter[];
  scope: ExportScope;
  chapterId?: string;
  volumeId?: string;
  format?: NovelExportFormat;
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001F]/g, "_").trim().slice(0, 80) || "Storyloom";
}

function renderChapter(chapter: Chapter): string {
  return `### ${chapter.title}\n\n${chapter.content.trim() || "（本章暂无正文）"}\n`;
}

/** 纯文本渲染：不写任何标记符号，章节标题独立成行，正文原样保留。 */
function renderChapterText(chapter: Chapter): string {
  return `${chapter.title}\n\n${chapter.content.trim() || "（本章暂无正文）"}\n`;
}

export async function exportNovel(input: ExportNovelInput): Promise<void> {
  const format: NovelExportFormat = input.format === "txt" ? "txt" : "markdown";
  const isPlainText = format === "txt";
  const orderedVolumes = [...input.volumes].sort((left, right) => left.orderIndex - right.orderIndex);
  const orderedChapters = [...input.chapters].sort((left, right) => left.orderIndex - right.orderIndex);
  const renderBody = isPlainText ? renderChapterText : renderChapter;
  let title = input.project.title;
  // 纯文本不写 # 记号：书名与卷名各占一行，其余保持正文原样，方便直接投稿或粘贴。
  let content = isPlainText ? `${input.project.title}\n\n` : `# ${input.project.title}\n\n`;

  if (input.project.description.trim()) content += `${input.project.description.trim()}\n\n`;

  if (input.scope === "chapter") {
    const chapter = orderedChapters.find((item) => item.id === input.chapterId);
    if (!chapter) throw new Error("当前章节不存在，无法导出");
    title = chapter.title;
    content += renderBody(chapter);
  } else {
    const volumes = input.scope === "volume"
      ? orderedVolumes.filter((volume) => volume.id === input.volumeId)
      : orderedVolumes;
    if (!volumes.length) throw new Error(input.scope === "volume" ? "当前卷不存在，无法导出" : "作品没有可导出的卷");
    if (input.scope === "volume") title = volumes[0].title;
    for (const volume of volumes) {
      content += isPlainText ? `${volume.title}\n\n` : `## ${volume.title}\n\n`;
      const volumeChapters = orderedChapters.filter((chapter) => chapter.volumeId === volume.id);
      content += volumeChapters.length
        ? volumeChapters.map(renderBody).join("\n")
        : "（本卷暂无章节）\n\n";
    }
  }

  const scopeLabel = input.scope === "chapter" ? "章节" : input.scope === "volume" ? "卷" : "全书";
  const timestamp = new Date().toISOString().replace(/[.:]/g, "-");
  const extension = isPlainText ? "txt" : "md";
  const file = new File(Paths.cache, `${safeFileName(input.project.title)}-${safeFileName(title)}-${scopeLabel}-${timestamp}.${extension}`);
  if (file.exists) file.delete();
  file.write(content);
  if (!(await Sharing.isAvailableAsync())) throw new Error("当前设备不支持系统分享，请稍后重试");
  await Sharing.shareAsync(file.uri, {
    mimeType: isPlainText ? "text/plain" : "text/markdown",
    dialogTitle: `导出${scopeLabel}`,
  });
}

function dateStamp(): string {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function libraryFileName(projectTitle: string, label: string, format: LibraryExportFormat): string {
  return `${safeFileName(projectTitle)}_${label}_${dateStamp()}.${format === "json" ? "json" : "md"}`;
}

async function shareTextFile(fileName: string, content: string, format: LibraryExportFormat, dialogTitle: string): Promise<void> {
  const file = new File(Paths.cache, fileName);
  if (file.exists) file.delete();
  file.write(content);
  if (!(await Sharing.isAvailableAsync())) throw new Error("当前设备不支持系统分享，请稍后重试");
  await Sharing.shareAsync(file.uri, {
    mimeType: format === "json" ? "application/json" : "text/markdown",
    dialogTitle,
  });
}

function renderCharacterMarkdown(character: Character): string {
  return `## ${character.name}\n\n- ID：${character.id}\n- 作品 ID：${character.projectId}\n- 图片路径：${character.imagePath || "暂无"}\n- 收藏：${character.isFavorited ? "是" : "否"}\n- 创建时间：${character.createdAt}\n- 更新时间：${character.updatedAt}\n\n### 角色设定\n\n${character.description || "暂无"}\n`;
}

function renderWorldEntryMarkdown(entry: WorldInfoEntry): string {
  return `## ${entry.name}\n\n- ID：${entry.id}\n- UID：${entry.uid}\n- 顺序：${entry.order}\n- 启用：${entry.isEnabled ? "是" : "否"}\n- Token 数：${entry.tokenCount}\n- 创建时间：${entry.createdAt}\n- 更新时间：${entry.updatedAt}\n\n### 条目内容\n\n${entry.content || "暂无"}\n`;
}

export async function exportCharacters(
  project: Project,
  characters: Character[],
  format: LibraryExportFormat,
): Promise<void> {
  if (!characters.length) throw new Error("没有可导出的角色");
  const exportedAt = new Date().toISOString();
  const content = format === "json"
    ? JSON.stringify({ schemaVersion: "1.0", type: "openficm.characters", projectId: project.id, exportedAt, entries: characters }, null, 2)
    : `# ${project.title} · 角色库\n\n- 作品 ID：${project.id}\n- 导出时间：${exportedAt}\n\n${characters.map(renderCharacterMarkdown).join("\n")}`;
  await shareTextFile(libraryFileName(project.title, "角色库", format), content, format, "导出角色库");
}

export async function exportWorldInfo(
  project: Project,
  worldInfo: WorldInfo,
  entries: WorldInfoEntry[],
  format: LibraryExportFormat,
): Promise<void> {
  if (!entries.length) throw new Error("没有可导出的世界书条目");
  const exportedAt = new Date().toISOString();
  const content = format === "json"
    ? JSON.stringify({ schemaVersion: "1.0", type: "openficm.world-info", projectId: project.id, exportedAt, worldInfo, entries }, null, 2)
    : `# ${project.title} · ${worldInfo.name}\n\n- 作品 ID：${project.id}\n- 世界书 ID：${worldInfo.id}\n- 导出时间：${exportedAt}\n\n${worldInfo.description ? `${worldInfo.description}\n\n` : ""}${entries.map(renderWorldEntryMarkdown).join("\n")}`;
  await shareTextFile(libraryFileName(project.title, "世界书", format), content, format, "导出世界书");
}
