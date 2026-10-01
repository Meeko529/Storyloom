/**
 * 写入类工具的「改动预览」与撤销。
 *
 * 借鉴 DeepWrite 与 denova 的共同做法：AI 的写入**不直接落盘**，先给出「改前 / 改后」的差异，
 * 由用户按**一组**接受或驳回（denova 的粒度结论：整组，而非逐行）。
 *
 * 这里只负责三件事：
 * 1. 判断某个工具是否属于"会改动正文 / 设定"的写入类工具；
 * 2. 生成人类可读的改动预览（改前 / 改后）；
 * 3. 维护一份单级撤销栈——记住被改动对象的改前状态，用户点「撤销」即可还原。
 *
 * 预览阶段读取的"改前"内容同时作为撤销快照，避免二次读取产生不一致。
 */
import {
  getChapter,
  getCharacter,
  getWorldInfoEntry,
  saveChapter,
  saveCharacter,
  saveWorldInfoEntry,
} from "@/data/repositories";
import { getNote, updateNote } from "@/data/note-repositories";
import type { Character } from "@/types";

const WRITE_TOOLS = new Set([
  "write_chapter",
  "edit_chapter",
  "write_note",
  "edit_note",
  "create_character",
  "edit_character",
  "delete_character",
  "create_world_entry",
  "edit_world_entry",
  "delete_world_entry",
]);

export interface WritePreview {
  /** 被改动对象的名字，用于提示"要动哪一章/哪条设定" */
  target: string;
  /** 改前内容：**完整正文**，不做截断 —— 它同时充当撤销快照。 */
  before: string;
  /** 改后内容：**完整正文**，不做截断 —— 截断会让 diff 统计失真。 */
  after: string;
}

interface UndoEntry {
  label: string;
  restore: () => Promise<void>;
}

/** 单级撤销：只保留最近一次被接受的改动，符合"刚写错了想退回"的真实场景。 */
let lastUndo: UndoEntry | null = null;

export function isWriteTool(name: string): boolean {
  return WRITE_TOOLS.has(name);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 预览用文本：只做 trim。
 * 🔴 这里曾按 600 字截断，两个后果：①长章节里改动落在 600 字之后时，改动前后一模一样，
 * 差值统计恒为「+0 行 −0 行」；②before 同时是撤销快照，截断后点撤销会把整章正文写成那 600 字。
 * 预览该显示多少行由界面决定，不在这一层丢信息。
 */
function previewText(value: string): string {
  return value.trim();
}

/** 生成改动预览；非写入类工具或找不到目标时返回 null（此时按原逻辑只确认工具名）。 */
export async function buildWritePreview(name: string, args: Record<string, unknown>): Promise<WritePreview | null> {
  if (!isWriteTool(name)) return null;
  if (name === "write_chapter" || name === "edit_chapter") {
    const id = text(args.chapterId ?? args.chapter_id);
    const chapter = id ? await getChapter(id) : null;
    return {
      target: chapter ? `章节《${chapter.title}》` : "章节",
      before: previewText(chapter?.content ?? ""),
      after: previewText(text(args.content)),
    };
  }
  if (name === "write_note" || name === "edit_note") {
    const id = text(args.noteId ?? args.note_id);
    const note = id ? await getNote(id) : null;
    return {
      target: note ? `笔记《${note.title}》` : "笔记",
      before: previewText(note?.content ?? ""),
      after: previewText(text(args.content)),
    };
  }
  if (name === "create_character" || name === "edit_character" || name === "delete_character") {
    const id = text(args.characterId ?? args.character_id);
    const character = id ? await getCharacter(id) : null;
    const after = name === "delete_character" ? "（该角色将被删除）" : previewText(text(args.description));
    return {
      target: character ? `角色「${character.name}」` : "角色",
      before: previewText(character?.description ?? ""),
      after,
    };
  }
  const id = text(args.entryId ?? args.entry_id);
  const entry = id ? await getWorldInfoEntry(id) : null;
  const after = name === "delete_world_entry" ? "（该条目将被删除）" : previewText(text(args.content));
  return {
    target: entry ? `世界书条目「${entry.name}」` : "世界书条目",
    before: previewText(entry?.content ?? ""),
    after,
  };
}

/**
 * 记录一份撤销快照。只保存"改前状态 + 还原动作"，不保存整份数据，避免内存膨胀。
 * 调用时机：写入类工具**执行成功后**。
 */
export function rememberUndo(name: string, args: Record<string, unknown>, preview: WritePreview | null): void {
  if (!preview) return;
  const chapterId = text(args.chapterId ?? args.chapter_id);
  const noteId = text(args.noteId ?? args.note_id);
  const characterId = text(args.characterId ?? args.character_id);
  const entryId = text(args.entryId ?? args.entry_id);

  if (name === "write_chapter" || name === "edit_chapter") {
    if (!chapterId) return;
    lastUndo = {
      label: preview.target,
      restore: () => saveChapter(chapterId, preview.target.replace(/^章节《|》$/g, ""), preview.before),
    };
    return;
  }
  if (name === "write_note" || name === "edit_note") {
    if (!noteId) return;
    lastUndo = {
      label: preview.target,
      restore: async () => {
        await updateNote({ id: noteId, content: preview.before });
      },
    };
    return;
  }
  if (characterId) {
    lastUndo = {
      label: preview.target,
      restore: async () => {
        const character = await getCharacter(characterId);
        if (!character) return;
        await saveCharacter({ ...(character as Character), description: preview.before });
      },
    };
    return;
  }
  if (entryId) {
    lastUndo = {
      label: preview.target,
      restore: async () => {
        const entry = await getWorldInfoEntry(entryId);
        if (!entry) return;
        await saveWorldInfoEntry({ ...entry, content: preview.before });
      },
    };
  }
}

export function undoLabel(): string | null {
  return lastUndo?.label ?? null;
}

/** 还原最近一次被接受的改动；没有可撤销内容时返回 null。 */
export async function undoLastWrite(): Promise<string | null> {
  const entry = lastUndo;
  if (!entry) return null;
  lastUndo = null;
  await entry.restore();
  return entry.label;
}
