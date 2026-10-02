/**
 * 写入类工具的「改动预览」与撤销。
 *
 * 原则：AI 的写入不直接落盘，先给出改前 / 改后的差异，由用户按一整组接受或驳回 ——
 * 粒度是整组而非逐行，因为逐行确认在长正文上不现实。
 *
 * 这里负责三件事：
 * 1. 判断某个工具是否属于"会改动正文 / 设定"的写入类工具；
 * 2. 生成人类可读的改动预览（改前 / 改后）；
 * 3. 维护按目标分组的撤销栈——记住被改动对象的改前状态，用户点「撤销」即可还原。
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

/**
 * 会改动数据的工具全名单。
 *
 * 🔴 这份名单必须与 `settings/config.ts` 里标 `readonly: false` 的工具**完全一致** ——
 * 少一个，那个工具就能在用户不知情时落盘。核对方法见文件末尾的对照说明。
 */
const WRITE_TOOLS = new Set([
  // 正文与笔记
  "write_chapter",
  "edit_chapter",
  "write_note",
  "edit_note",
  "delete_note",
  "move_note",
  // 结构：作品 / 卷 / 章
  "create_project",
  "create_volume",
  "create_chapter",
  // 角色与世界书
  "create_character",
  "edit_character",
  "delete_character",
  "create_world_entry",
  "edit_world_entry",
  "delete_world_entry",
  // 文风
  "select_style_profile",
  "evolve_author_style",
  "save_author_style_guide",
  "save_reference_style_profile",
]);

/**
 * 「新建」类工具：改前必然为空，只需说明要建什么。
 * 与「修改」类分开，是因为它们的预览形态不同（只有改后、没有改前）。
 */
const CREATE_TOOLS = new Set([
  "create_project",
  "create_volume",
  "create_chapter",
  "create_character",
  "create_world_entry",
]);

export interface WritePreview {
  /** 被改动对象的名字，用于提示"要动哪一章/哪条设定" */
  target: string;
  /** 改前内容：**完整正文**，不做截断 —— 它同时充当撤销快照。 */
  before: string;
  /** 改后内容：**完整正文**，不做截断 —— 截断会让 diff 统计失真。 */
  after: string;
  /**
   * 这次改动没有逐行正文可比（新建结构、切换文风），只有一句动作说明。
   * 界面据此显示说明文字，而不是渲染「+ 说明」这种把说明当正文看的差异。
   */
  actionOnly?: boolean;
}

interface UndoEntry {
  label: string;
  restore: () => Promise<void>;
}

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
  if (name === "create_project") {
    return {
      target: `新作品《${text(args.title)}》`,
      before: "",
      after: previewText(text(args.description)) || "新建一部空白作品",
      actionOnly: true,
    };
  }
  if (name === "create_volume") {
    return { target: `新卷《${text(args.title)}》`, before: "", after: "新建一卷，正文为空", actionOnly: true };
  }
  if (name === "create_chapter") {
    return { target: `新章节《${text(args.title)}》`, before: "", after: "新建一章，正文为空", actionOnly: true };
  }
  if (name === "select_style_profile") {
    const id = text(args.profile_id);
    return {
      target: id === "none" ? "本次不使用创作文风" : "切换创作文风",
      before: "",
      after: id === "none" ? "本轮不再使用创作文风" : "本轮改用所选文风",
      actionOnly: true,
    };
  }
  if (name === "move_note") {
    const id = text(args.note_id ?? args.noteId);
    const note = id ? await getNote(id) : null;
    const chapterId = text(args.chapter_id ?? args.chapterId);
    const volumeId = text(args.volume_id ?? args.volumeId);
    const scope = chapterId ? "移到章节" : volumeId ? "移到整卷" : "移到整书";
    return { target: note ? `笔记《${note.title}》${scope}` : `笔记${scope}`, before: "", after: `把这条笔记${scope}`, actionOnly: true };
  }
  if (name === "delete_note") {
    const id = text(args.note_id ?? args.noteId);
    const note = id ? await getNote(id) : null;
    return { target: note ? `笔记《${note.title}》` : "笔记", before: previewText(note?.content ?? ""), after: "（该笔记将被删除）" };
  }
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
    const before = previewText(character?.description ?? "");
    if (name === "delete_character") {
      return { target: character ? `角色「${character.name}」` : "角色", before, after: "（该角色将被删除）" };
    }
    if (!before) {
      return {
        target: "新角色",
        before: "",
        after: previewText(text(args.description)) || "新建一个角色",
        actionOnly: true,
      };
    }
    return { target: character ? `角色「${character.name}」` : "角色", before, after: previewText(text(args.description)) };
  }
  if (name === "create_world_entry" || name === "edit_world_entry" || name === "delete_world_entry") {
    const id = text(args.entryId ?? args.entry_id);
    const entry = id ? await getWorldInfoEntry(id) : null;
    const before = previewText(entry?.content ?? "");
    if (name === "delete_world_entry") {
      return { target: entry ? `世界书条目「${entry.name}」` : "世界书条目", before, after: "（该条目将被删除）" };
    }
    if (!before) {
      return {
        target: "新世界书条目",
        before: "",
        after: previewText(text(args.content)) || "新建一条世界书设定",
        actionOnly: true,
      };
    }
    return { target: entry ? `世界书条目「${entry.name}」` : "世界书条目", before, after: previewText(text(args.content)) };
  }
  // 文风类工具没有可直接读取的正文形态：给出动作说明，界面按"操作类确认"呈现。
  const labels: Record<string, string> = {
    evolve_author_style: "进化作者文风",
    save_author_style_guide: "保存作者文风指南",
    save_reference_style_profile: "保存为参考文风版本",
  };
  return { target: labels[name] ?? name, before: "", after: labels[name] ?? name, actionOnly: true };
}

/**
 * 撤销栈：按改动目标分组。
 *
 * 🔴 此前是单个全局变量 `lastUndo`，一轮对话里写入两次时，前一次的撤销记录会被
 * 后一次直接覆盖 —— 用户只能撤销最后一次。改为按目标键保存，各章各条的改动互不
 * 覆盖。栈有上限，超出丢最旧的。
 */
const MAX_UNDO_ENTRIES = 20;
const undoEntries = new Map<string, UndoEntry>();

function rememberUndoFor(key: string, entry: UndoEntry): void {
  // 同一目标重新写入时，旧的撤销记录作废（内容已被覆盖，撤不回去）。
  undoEntries.delete(key);
  undoEntries.set(key, entry);
  while (undoEntries.size > MAX_UNDO_ENTRIES) {
    const oldest = undoEntries.keys().next();
    if (oldest.done) break;
    undoEntries.delete(oldest.value);
  }
}

/** 改动的目标键：同一章 / 同一条笔记算同一个目标。 */
function undoTargetKey(name: string, args: Record<string, unknown>): string | null {
  const chapterId = text(args.chapterId ?? args.chapter_id);
  const noteId = text(args.noteId ?? args.note_id);
  const characterId = text(args.characterId ?? args.character_id);
  const entryId = text(args.entryId ?? args.entry_id);
  if (name === "write_chapter" || name === "edit_chapter") return chapterId ? `chapter:${chapterId}` : null;
  if (name === "write_note" || name === "edit_note" || name === "move_note") return noteId ? `note:${noteId}` : null;
  if (characterId) return `character:${characterId}`;
  if (entryId) return `world-entry:${entryId}`;
  return null;
}

/**
 * 记录一份撤销快照。只保存"改前状态 + 还原动作"，不保存整份数据，避免内存膨胀。
 * 调用时机：写入类工具**执行成功后**。新建类与文风类工具没有可还原的旧内容，不入栈。
 */
export function rememberUndo(name: string, args: Record<string, unknown>, preview: WritePreview | null): void {
  if (!preview) return;
  // 新建类没有可还原的旧内容；只有 before 为空的工具（如移动归属）也不能入栈 ——
  // 撤销会把该对象的内容写成空字符串，那是破坏而不是还原。
  if (CREATE_TOOLS.has(name)) return;
  if (!preview.before) return;
  const chapterId = text(args.chapterId ?? args.chapter_id);
  const noteId = text(args.noteId ?? args.note_id);
  const characterId = text(args.characterId ?? args.character_id);
  const entryId = text(args.entryId ?? args.entry_id);
  const key = undoTargetKey(name, args);
  if (!key) return;

  if (name === "write_chapter" || name === "edit_chapter") {
    if (!chapterId) return;
    rememberUndoFor(key, {
      label: preview.target,
      restore: () => saveChapter(chapterId, preview.target.replace(/^章节《|》$/g, ""), preview.before),
    });
    return;
  }
  if (name === "write_note" || name === "edit_note") {
    if (!noteId) return;
    rememberUndoFor(key, {
      label: preview.target,
      restore: async () => {
        await updateNote({ id: noteId, content: preview.before });
      },
    });
    return;
  }
  if (characterId) {
    rememberUndoFor(key, {
      label: preview.target,
      restore: async () => {
        const character = await getCharacter(characterId);
        if (!character) return;
        await saveCharacter({ ...(character as Character), description: preview.before });
      },
    });
    return;
  }
  if (entryId) {
    rememberUndoFor(key, {
      label: preview.target,
      restore: async () => {
        const entry = await getWorldInfoEntry(entryId);
        if (!entry) return;
        await saveWorldInfoEntry({ ...entry, content: preview.before });
      },
    });
  }
}

export function undoLabel(): string | null {
  const last = [...undoEntries.values()][undoEntries.size - 1];
  return last?.label ?? null;
}

/** 还原最近一次被接受的改动；没有可撤销内容时返回 null。 */
export async function undoLastWrite(): Promise<string | null> {
  const keys = [...undoEntries.keys()];
  const key = keys[keys.length - 1];
  if (!key) return null;
  const entry = undoEntries.get(key);
  undoEntries.delete(key);
  if (!entry) return null;
  await entry.restore();
  return entry.label;
}
