import { getSetting, setSetting } from "@/data/repositories";

/**
 * 供应商"高级设置"：给中转站 / 自建网关准备的兼容开关。
 *
 * 存放位置：settings 表里的 `provider.advanced.<providerId>`（JSON 字符串）。
 * 刻意不往 provider 表加字段——那张表在 SQLite 里，加字段要写数据库迁移，
 * 而 settings 表是现成的键值表，存这里零迁移风险。
 */
export interface ProviderAdvanced {
  /** 额外请求头，每行一条 `名字: 值`；以 # 开头或没有冒号的行会被忽略。 */
  extraHeaders: string;
  /** 鉴权用的请求头名字。默认 Authorization。 */
  authHeader: string;
  /** 鉴权值加在 Key 前面的前缀。默认 "Bearer "；留空表示直接发原始 Key。 */
  authPrefix: string;
  /** 不发送 tools（部分中转站不支持 function calling，发了会直接报错）。 */
  disableTools: boolean;
  /** 用 max_completion_tokens 代替 max_tokens（个别供应商只认前者）。 */
  useMaxCompletionTokens: boolean;
}

export const DEFAULT_PROVIDER_ADVANCED: ProviderAdvanced = {
  extraHeaders: "",
  authHeader: "Authorization",
  authPrefix: "Bearer ",
  disableTools: false,
  useMaxCompletionTokens: false,
};

const KEY_PREFIX = "provider.advanced.";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 宽容解析：缺字段就落回默认值，坏数据不会让整个请求挂掉。 */
export function parseProviderAdvanced(value: unknown): ProviderAdvanced {
  if (!isRecord(value)) return { ...DEFAULT_PROVIDER_ADVANCED };
  return {
    extraHeaders: typeof value.extraHeaders === "string" ? value.extraHeaders : "",
    authHeader: typeof value.authHeader === "string" && value.authHeader.trim()
      ? value.authHeader
      : DEFAULT_PROVIDER_ADVANCED.authHeader,
    authPrefix: typeof value.authPrefix === "string" ? value.authPrefix : DEFAULT_PROVIDER_ADVANCED.authPrefix,
    disableTools: value.disableTools === true,
    useMaxCompletionTokens: value.useMaxCompletionTokens === true,
  };
}

/** 是否偏离了默认值——用来在界面上提示"这个供应商动过高级设置"。 */
export function hasCustomAdvanced(advanced: ProviderAdvanced): boolean {
  return advanced.extraHeaders.trim().length > 0
    || advanced.authHeader.trim() !== DEFAULT_PROVIDER_ADVANCED.authHeader
    || advanced.authPrefix !== DEFAULT_PROVIDER_ADVANCED.authPrefix
    || advanced.disableTools
    || advanced.useMaxCompletionTokens;
}

/** 把多行 `名字: 值` 解析成请求头对象。 */
export function parseHeaderLines(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const name = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (name) headers[name] = value;
  }
  return headers;
}

/** 组装鉴权相关请求头：额外头在前，鉴权头在后（同名时以鉴权头为准）。 */
export function buildAuthHeaders(advanced: ProviderAdvanced, apiKey: string): Record<string, string> {
  const headers = parseHeaderLines(advanced.extraHeaders);
  const name = advanced.authHeader.trim() || DEFAULT_PROVIDER_ADVANCED.authHeader;
  headers[name] = `${advanced.authPrefix}${apiKey}`;
  return headers;
}

export async function getProviderAdvanced(providerId: string): Promise<ProviderAdvanced> {
  if (!providerId) return { ...DEFAULT_PROVIDER_ADVANCED };
  let raw: string | null = null;
  try {
    raw = await getSetting(`${KEY_PREFIX}${providerId}`);
  } catch {
    return { ...DEFAULT_PROVIDER_ADVANCED };
  }
  if (!raw) return { ...DEFAULT_PROVIDER_ADVANCED };
  try {
    return parseProviderAdvanced(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_PROVIDER_ADVANCED };
  }
}

export async function saveProviderAdvanced(providerId: string, advanced: ProviderAdvanced): Promise<void> {
  if (!providerId) return;
  await setSetting(`${KEY_PREFIX}${providerId}`, JSON.stringify(advanced));
}
