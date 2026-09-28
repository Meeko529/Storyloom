/**
 * 自制内容包：把用户自己创建的规则 / 技能 / 智能体导出为 JSON，并在另一台设备上导入。
 *
 * 只导出 `source === "custom"` 的条目——内置、插件与远程内容包的代码不属于用户创作，
 * 导出它们既没意义，也有把上游内容重新分发的许可风险。
 *
 * 导入策略：同 id 覆盖、其余保留；导入前列出冲突项，由调用方确认后再写入。
 */
import * as DocumentPicker from "expo-document-picker";
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

import {
  getAgentDefinitions,
  getAgentRules,
  getAgentSkills,
  saveAgentDefinitions,
  saveAgentRules,
  saveAgentSkills,
  type AgentDefinition,
  type AgentRule,
  type AgentSkill,
} from "@/settings/config";

const PACK_FORMAT = "storyloom-content-pack";
const PACK_VERSION = 1;

export interface ContentPack {
  format: typeof PACK_FORMAT;
  version: number;
  exportedAt: string;
  rules: AgentRule[];
  skills: AgentSkill[];
  agents: AgentDefinition[];
}

export interface ContentPackSummary {
  count: number;
  sizeBytes: number;
}

export interface ContentPackPreview {
  pack: ContentPack;
  /** 与本地同 id 的条目数，用于提示用户"导入会覆盖这些" */
  conflicts: number;
}

/** 打包用户自建内容并调起系统分享。 */
export async function exportContentPack(title: string): Promise<ContentPackSummary> {
  const [rules, skills, agents] = await Promise.all([getAgentRules(), getAgentSkills(), getAgentDefinitions()]);
  const customRules = rules.filter((item) => item.id.startsWith("custom") || !isBuiltinId(item.id));
  const customSkills = skills.filter((item) => item.source === "custom");
  const customAgents = agents.filter((item) => item.source === "custom");

  const pack: ContentPack = {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    exportedAt: new Date().toISOString(),
    rules: customRules,
    skills: customSkills,
    agents: customAgents,
  };
  const payload = JSON.stringify(pack, null, 2);

  const directory = new Directory(Paths.cache, "content-packs");
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, `${safeFileName(title)}.json`);
  if (file.exists) file.delete();
  file.write(payload);

  if (!(await Sharing.isAvailableAsync())) throw new Error("当前设备不支持系统分享，请稍后重试");
  await Sharing.shareAsync(file.uri, { mimeType: "application/json", dialogTitle: "导出内容包" });
  return {
    count: customRules.length + customSkills.length + customAgents.length,
    sizeBytes: payload.length,
  };
}

/** 选择内容包文件；取消时返回 null。 */
export async function pickContentPack(): Promise<File | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true, multiple: false });
  if (result.canceled) return null;
  return new File(result.assets[0].uri);
}

/** 解析内容包，返回内容与冲突数；不写入任何数据。 */
export async function previewContentPack(source: File): Promise<ContentPackPreview> {
  const pack = parseContentPack(await source.text());
  const [rules, skills, agents] = await Promise.all([getAgentRules(), getAgentSkills(), getAgentDefinitions()]);
  const conflicts = pack.rules.filter((item) => rules.some((local) => local.id === item.id)).length
    + pack.skills.filter((item) => skills.some((local) => local.id === item.id)).length
    + pack.agents.filter((item) => agents.some((local) => local.id === item.id)).length;
  return { pack, conflicts };
}

/** 写入内容包：同 id 覆盖，其余保留。 */
export async function applyContentPack(pack: ContentPack): Promise<ContentPackSummary> {
  const [rules, skills, agents] = await Promise.all([getAgentRules(), getAgentSkills(), getAgentDefinitions()]);
  await saveAgentRules(mergeById(rules, pack.rules));
  await saveAgentSkills(mergeById(skills, pack.skills));
  await saveAgentDefinitions(mergeById(agents, pack.agents));
  return { count: pack.rules.length + pack.skills.length + pack.agents.length, sizeBytes: 0 };
}

function mergeById<T extends { id: string }>(local: T[], incoming: T[]): T[] {
  const map = new Map(local.map((item) => [item.id, item]));
  for (const item of incoming) map.set(item.id, item);
  return [...map.values()];
}

function parseContentPack(text: string): ContentPack {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("无法解析该文件，请选择由「导出内容包」生成的 JSON 文件");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("该文件不是有效的 Storyloom 内容包");
  const record = parsed as Partial<ContentPack>;
  if (record.format !== PACK_FORMAT) throw new Error("该文件不是 Storyloom 内容包（缺少格式标识）");
  if (record.version !== PACK_VERSION) throw new Error("内容包版本不兼容，无法导入");
  return {
    format: PACK_FORMAT,
    version: PACK_VERSION,
    exportedAt: typeof record.exportedAt === "string" ? record.exportedAt : "",
    rules: Array.isArray(record.rules) ? record.rules : [],
    skills: Array.isArray(record.skills) ? record.skills : [],
    agents: Array.isArray(record.agents) ? record.agents : [],
  };
}

/** 内置条目的 id 都有统一前缀（builtin / plugin / remote / oh-story 等），据此排除。 */
function isBuiltinId(id: string): boolean {
  return /^(builtin|plugin|remote|oh-story|lorn|openficm|storyloom-agent--)/i.test(id);
}

function safeFileName(value: string): string {
  return value.replace(/[\\/:*?"<>|]/g, "-").trim() || "storyloom-content-pack";
}
