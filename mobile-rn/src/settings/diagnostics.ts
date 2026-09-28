/**
 * 诊断报告：把排障所需的信息汇成一份文件，用户可一键分享出去。
 *
 * 原则：**只收集排障必需的信息，绝不包含 API Key、也不会包含任何稿件正文**。
 * 用户点一下即可生成并发给开发者，省去手工抓日志的麻烦。
 */
import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import { getSetting } from "@/data/repositories";
import { CURRENT_APP_VERSION } from "@/settings/app-update";

/** 会写进报告的非敏感设置项。 */
const SETTING_KEYS: Array<{ key: string; label: string }> = [
  { key: "general.autoSaveDelay", label: "自动保存延迟" },
  { key: "general.editorFontSize", label: "正文字号" },
  { key: "general.editorFontFamily", label: "正文字体" },
  { key: "connections.requestTimeout", label: "请求超时" },
  { key: "context.historyLimit", label: "保留最近消息数" },
  { key: "context.compressSystemPrompts", label: "压缩系统提示词" },
  { key: "index.enabled", label: "本地语义索引" },
  { key: "index.chunkSize", label: "切分片段大小" },
  { key: "index.chunkOverlap", label: "相邻片段重叠" },
  { key: "index.retrievalTopK", label: "检索召回条数" },
  { key: "index.rerankTopK", label: "精排输出条数" },
  { key: "index.useRerank", label: "启用重排" },
];

function deviceSummary(): string {
  const constants = (Platform as unknown as { constants?: Record<string, unknown> }).constants ?? {};
  const brand = String(constants.Brand ?? "");
  const model = String(constants.Model ?? "");
  const device = [brand, model].filter(Boolean).join(" ") || "未知机型";
  return `${device} · Android ${Platform.Version}`;
}

/** 生成诊断报告正文（Markdown）。 */
export async function buildDiagnosticsReport(): Promise<string> {
  const lines: string[] = [];
  lines.push("# Storyloom 诊断报告");
  lines.push("");
  lines.push(`生成时间：${new Date().toLocaleString()}`);
  lines.push("");
  lines.push("## 运行环境");
  lines.push("");
  lines.push(`- 应用版本：${CURRENT_APP_VERSION}`);
  lines.push(`- 设备：${deviceSummary()}`);
  lines.push(`- 平台：${Platform.OS}`);
  lines.push("");
  lines.push("## 设置摘要");
  lines.push("");
  lines.push("| 设置项 | 当前值 |");
  lines.push("| --- | --- |");
  for (const item of SETTING_KEYS) {
    let value = "（未设置）";
    try {
      value = (await getSetting(item.key)) ?? "（未设置）";
    } catch {
      value = "（读取失败）";
    }
    lines.push(`| ${item.label} | ${value} |`);
  }
  lines.push("");
  lines.push("> 本报告不包含 API Key，也不包含任何稿件内容。");
  lines.push("");
  return lines.join("\n");
}

/** 生成报告文件并调起系统分享。 */
export async function exportDiagnosticsReport(): Promise<void> {
  const content = await buildDiagnosticsReport();
  const directory = new Directory(Paths.cache, "diagnostics");
  directory.create({ intermediates: true, idempotent: true });
  const file = new File(directory, `storyloom-diagnostics.txt`);
  if (file.exists) file.delete();
  file.write(content);
  if (!(await Sharing.isAvailableAsync())) throw new Error("当前设备不支持系统分享，请稍后重试");
  await Sharing.shareAsync(file.uri, {
    mimeType: "text/plain",
    dialogTitle: "导出诊断报告",
  });
}
