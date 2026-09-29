/**
 * 助手对话的文本附件。
 *
 * 两条使用路径，都由"选一个文件"这一个动作发起：
 * 1. **加入本次对话**：把文件内容随消息一并发给模型，这次请求即可按它作答（不进数据库）；
 * 2. **存入资料**：写成本作品的笔记，之后助手可检索、可长期引用（进数据库）。
 *
 * 只接收纯文本类文件。图片需要模型具备视觉输入能力，且要额外依赖，暂不在本模块处理。
 */
import * as DocumentPicker from "expo-document-picker";
import { File } from "expo-file-system";

import { createNote } from "@/data/note-repositories";

/** 单份附件的字符上限：与笔记内容上限保持一致，避免"能存不能引"的落差。 */
export const MAX_ATTACHMENT_CHARACTERS = 100_000;
/** 一条消息最多携带的附件数，防止一次把上下文挤满。 */
export const MAX_ATTACHMENTS_PER_MESSAGE = 3;

const TEXT_EXTENSIONS = ["txt", "md", "markdown", "json", "csv", "yaml", "yml", "log"];

export interface TextAttachment {
  name: string;
  text: string;
  characters: number;
  truncated: boolean;
}

function extensionOf(name: string): string {
  const index = name.lastIndexOf(".");
  return index < 0 ? "" : name.slice(index + 1).toLowerCase();
}

/** 让用户选一个文本文件并读入内容；取消返回 null。 */
export async function pickTextAttachment(): Promise<TextAttachment | null> {
  const result = await DocumentPicker.getDocumentAsync({
    type: ["text/*", "application/json", "application/x-yaml"],
    copyToCacheDirectory: true,
    multiple: false,
  });
  if (result.canceled) return null;
  const asset = result.assets[0];
  const name = asset.name || "未命名文件";
  const extension = extensionOf(name);
  if (extension && !TEXT_EXTENSIONS.includes(extension)) {
    throw new Error(`暂不支持 .${extension} 文件，请选择纯文本类文件（${TEXT_EXTENSIONS.join(" / ")}）`);
  }
  const raw = await new File(asset.uri).text();
  const text = raw.trim();
  if (!text) throw new Error("该文件没有可读取的文字内容");
  const truncated = text.length > MAX_ATTACHMENT_CHARACTERS;
  const kept = truncated ? text.slice(0, MAX_ATTACHMENT_CHARACTERS) : text;
  return { name, text: kept, characters: kept.length, truncated };
}

/**
 * 把附件拼成随请求发送的上下文块。
 * 放在用户消息之前作为独立的一条 user 消息，模型能明确区分"资料"与"指令"。
 */
export function attachmentContextBlock(attachments: TextAttachment[]): string {
  const sections = attachments.map((item) => [
    `<资料 文件名="${item.name}"${item.truncated ? " 已截断=\"true\"" : ""}>`,
    item.text,
    "</资料>",
  ].join("\n"));
  return [
    "以下是我提供的资料，请把它们当作事实依据；需要时按资料内容执行我的指令，不要自行编造资料中没有的设定。",
    "",
    ...sections,
  ].join("\n");
}

/** 把附件存成本作品的笔记；返回笔记标题。 */
export async function saveAttachmentAsNote(projectId: string, attachment: TextAttachment): Promise<string> {
  const title = attachment.name.replace(/\.[^.]+$/, "").trim() || "导入的资料";
  await createNote({ projectId, title, content: attachment.text });
  return title;
}
