/**
 * 上下文用量估算。
 *
 * 目的不是精确计费，而是让用户在写长对话时有一个可感知的刻度：
 * 当前历史大约占多少 Token、离模型窗口还有多远、有多少条已经超出保留范围。
 *
 * 估算规则（按主流分词器的经验值）：
 * - 中文、日文等 CJK 字符：约 1 字 ≈ 1 Token
 * - 其他字符（含英文、标点、空白）：约 4 字符 ≈ 1 Token
 *
 * 误差通常在 10% ~ 20%，用于观察趋势足够；不同厂商分词器差异较大，不做精确承诺。
 */
import type { ChatMessage } from "@/types";

export const CONTEXT_WINDOW_KEY = "context.windowTokens";
export const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_768;
export const MIN_CONTEXT_WINDOW_TOKENS = 4_096;
export const MAX_CONTEXT_WINDOW_TOKENS = 2_000_000;

/** 每轮请求固定携带的开销（系统提示、技能说明、工具定义等），粗估一个常数便于换算。 */
const FIXED_REQUEST_OVERHEAD_TOKENS = 1_500;

export function normalizeContextWindow(value: string | number | null | undefined): number {
  const size = Number(value);
  if (!Number.isFinite(size)) return DEFAULT_CONTEXT_WINDOW_TOKENS;
  return Math.min(MAX_CONTEXT_WINDOW_TOKENS, Math.max(MIN_CONTEXT_WINDOW_TOKENS, Math.round(size)));
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  let cjk = 0;
  let other = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    // CJK 统一表意文字、扩展区、全角标点与假名按「一字一 Token」计
    if ((code >= 0x3000 && code <= 0x303f) || (code >= 0x3400 && code <= 0x9fff) || (code >= 0xf900 && code <= 0xfaff) || (code >= 0xff00 && code <= 0xffef)) {
      cjk += 1;
    } else {
      other += 1;
    }
  }
  return cjk + Math.ceil(other / 4);
}

export interface ContextUsage {
  /** 会话中的消息总数 */
  messages: number;
  characters: number;
  /** 实际会发给模型的消息条数（受「保留最近消息数」限制） */
  keptMessages: number;
  /** 超出保留范围、不会发送的条数 */
  droppedMessages: number;
  estimatedTokens: number;
  windowTokens: number;
  /** 估算占用比例（0 ~ 1，可能超过 1） */
  ratio: number;
  /** 是否已超过窗口上限 */
  overflow: boolean;
}

export function computeContextUsage(
  messages: ChatMessage[],
  windowTokens: number,
  historyLimit: number,
): ContextUsage {
  const limit = Math.max(1, Math.round(historyLimit));
  const kept = messages.slice(Math.max(0, messages.length - limit));
  const characters = kept.reduce((total, message) => total + message.content.length, 0);
  const messageTokens = kept.reduce((total, message) => total + estimateTokens(message.content), 0);
  const estimatedTokens = messageTokens + FIXED_REQUEST_OVERHEAD_TOKENS;
  const window = normalizeContextWindow(windowTokens);
  return {
    messages: messages.length,
    characters,
    keptMessages: kept.length,
    droppedMessages: Math.max(0, messages.length - kept.length),
    estimatedTokens,
    windowTokens: window,
    ratio: estimatedTokens / window,
    overflow: estimatedTokens > window,
  };
}

/** 把比例格式化成百分比文本，超过 100% 时如实显示。 */
export function formatUsagePercent(ratio: number): string {
  const percent = Math.round(ratio * 100);
  return `${percent}%`;
}
