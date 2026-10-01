// 本文件基于 OpenFicM（Apache-2.0）修改
// 改动说明见仓库根目录 docs/上游来源与改动清单.md
import { appendBreadcrumb } from "@/lib/crash-log";
import type { ModelSelection } from "@/types";
import { fetch as expoFetch } from "expo/fetch";
import { getSetting } from "@/data/repositories";

import type { AgentMessage, AgentToolCall, AgentToolDefinition, ModelTurn } from "./types";
import { MAX_CONFIGURED_OUTPUT_TOKENS, normalizeMaxOutputTokens } from "./limits";
import { buildAuthHeaders, getProviderAdvanced } from "./provider-advanced";

const REQUEST_TIMEOUT_MS = 120_000;
const MAX_REQUEST_ATTEMPTS = 3;
// 服务端过载类错误只重试一次，避免中转站限流时把请求量再翻倍。
const MAX_SERVER_ERROR_ATTEMPTS = 2;
const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJsonObject(value: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function openAiExtraContent(call: Record<string, any>): Record<string, unknown> | undefined {
  const candidates = [call.extra_content, call.extraContent, call.provider_metadata, call.providerMetadata];
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !Object.keys(candidate).length) continue;
    if (isRecord(candidate.openAiExtraContent)) return candidate.openAiExtraContent;
    if (typeof candidate.geminiThoughtSignature === "string" && candidate.geminiThoughtSignature.trim()) {
      return { google: { thought_signature: candidate.geminiThoughtSignature } };
    }
    return candidate;
  }
  const signature = call.thought_signature ?? call.thoughtSignature;
  if (typeof signature === "string" && signature.trim()) {
    return { google: { thought_signature: signature } };
  }
  return undefined;
}

function errorDetail(data: Record<string, any>, text: string, statusText: string): string {
  const candidates = [
    isRecord(data.error) ? data.error.message : data.error,
    isRecord(data.error) ? data.error.detail : undefined,
    data.message,
    data.detail,
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const primary = candidates[0]?.trim();
  if (primary && !/^\d{3}$/.test(primary)) return primary;
  const raw = text.trim();
  if (raw && !/^\{?\s*"?error"?\s*:\s*"?\d{3}"?\s*\}?$/i.test(raw)) return raw.slice(0, 4_000);
  return primary || statusText || "供应商未返回错误详情";
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) return Math.min(30_000, seconds * 1_000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.min(30_000, Math.max(0, date - Date.now()));
  }
  return Math.min(8_000, 1_500 * 2 ** attempt);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** 把请求失败归成四类，写进操作轨迹供诊断报告取证。 */
function describeRequestFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (text.includes("模型请求超时")) return "超时被中止（timeout/abort）";
  if (text.includes("fetch failed")) return text.includes("SocketException") ? "连接层被重置（SocketException）" : "连接层失败（fetch failed）";
  if (text.startsWith("HTTP ")) return `服务端返回错误（${text.slice(0, 120)}）`;
  return text.slice(0, 140);
}

async function requestJson(url: string, init: RequestInit): Promise<Record<string, any>> {
  const configuredTimeout = Number(await getSetting("connections.requestTimeout"));
  const requestTimeout = Number.isInteger(configuredTimeout) && configuredTimeout >= 10_000 && configuredTimeout <= 300_000
    ? configuredTimeout
    : REQUEST_TIMEOUT_MS;
  let lastError: unknown;
  const host = new URL(url).host;
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
    const attemptStartedAt = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), requestTimeout);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      const text = await response.text();
      let data: Record<string, any> = {};
      if (text) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(text);
        } catch {
          // 丢掉响应体会让这类故障完全无法诊断，带一段原文出来。
          if (response.ok) throw new Error(`模型服务返回了无法解析的非 JSON 响应：${text.trim().slice(0, 300)}`);
        }
        if (isRecord(parsed)) data = parsed;
        else if (parsed !== undefined && response.ok) {
          throw new Error(`模型服务返回的 JSON 不是对象：${text.trim().slice(0, 300)}`);
        }
      } else if (response.ok) {
        throw new Error("模型服务返回了空响应体");
      }
      if (response.ok) return data;
      const detail = errorDetail(data, text, response.statusText);
      const requestError = new Error(`HTTP ${response.status}: ${detail}`);
      lastError = requestError;
      // Surface rate limiting immediately so one failed agent turn cannot amplify it.
      const maxAttempts = response.status === 429 ? 1 : MAX_SERVER_ERROR_ATTEMPTS;
      if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt + 1 >= maxAttempts) throw requestError;
      await sleep(retryDelay(response, attempt));
    } catch (error) {
      if (isRecord(error) && error.name === "AbortError") {
        lastError = new Error("模型请求超时，请检查网络或 Base URL");
      } else if (error instanceof TypeError) {
        const detail = error.message.trim();
        lastError = new Error(`fetch failed${detail ? `: ${detail}` : ""}`);
      } else {
        lastError = error;
      }
      // 取证：每一次失败的尝试都留一条轨迹（分类 + 耗时 + 目标主机），不改重试行为。
      appendBreadcrumb(`模型请求（${host}）：第 ${attempt + 1}/${MAX_REQUEST_ATTEMPTS} 次尝试失败，${Math.round((Date.now() - attemptStartedAt) / 1000)}s —— ${describeRequestFailure(lastError)}`);
      if (attempt + 1 >= MAX_REQUEST_ATTEMPTS || !(error instanceof TypeError || (isRecord(error) && error.name === "AbortError"))) {
        throw lastError;
      }
      await sleep(Math.min(4_000, 1_000 * 2 ** attempt));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("模型请求失败");
}

/** 逐块读取 SSE：按空行切事件，忽略注释（: keep-alive）行，兼容 \r\n。 */
async function readSse(response: Response, handle: (payload: string, eventName: string) => void): Promise<void> {
  const body = (response as unknown as { body?: { getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }> } } }).body;
  if (!body) throw new Error("当前运行时不支持流式响应");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: true });
    let separator = buffer.search(/\r?\n\r?\n/);
    while (separator >= 0) {
      const raw = buffer.slice(0, separator);
      buffer = buffer.slice(separator + (buffer[separator] === "\r" ? 4 : 2));
      let eventName = "";
      const dataLines: string[] = [];
      for (const line of raw.split(/\r?\n/)) {
        if (!line || line.startsWith(":")) continue;
        if (line.startsWith("event:")) eventName = line.slice(6).trim();
        else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
      }
      if (dataLines.length) handle(dataLines.join("\n"), eventName);
      separator = buffer.search(/\r?\n\r?\n/);
    }
  }
  // 收尾：没有以空行结束的最后一帧
  const tail = buffer.trim();
  if (tail) {
    const dataLines = tail.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart());
    if (dataLines.length) handle(dataLines.join("\n"), "");
  }
}

/**
 * 流式请求：与 requestJson 同一套超时 / 重试 / 取证口径，区别是逐块读取。
 * 空闲超时（每收到数据就重置），而不是整轮总超时——长回答不会被总时长掐断。
 */
async function requestStream(
  url: string,
  init: RequestInit,
  handle: (payload: string, eventName: string) => void,
): Promise<void> {
  const configuredTimeout = Number(await getSetting("connections.requestTimeout"));
  const idleTimeout = Number.isInteger(configuredTimeout) && configuredTimeout >= 10_000 && configuredTimeout <= 300_000
    ? configuredTimeout
    : REQUEST_TIMEOUT_MS;
  const host = new URL(url).host;
  let received = false;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_REQUEST_ATTEMPTS; attempt += 1) {
    const attemptStartedAt = Date.now();
    const controller = new AbortController();
    let timer = setTimeout(() => controller.abort(), idleTimeout);
    const resetIdle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => controller.abort(), idleTimeout);
    };
    try {
      const response = await expoFetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        const text = await response.text();
        let detail = response.statusText;
        try {
          const parsed: unknown = JSON.parse(text);
          if (isRecord(parsed)) detail = errorDetail(parsed, text, response.statusText);
        } catch {
          if (text.trim()) detail = text.trim().slice(0, 300);
        }
        const requestError = new Error(`HTTP ${response.status}: ${detail}`);
        lastError = requestError;
        const maxAttempts = response.status === 429 ? 1 : MAX_SERVER_ERROR_ATTEMPTS;
        if (!RETRYABLE_STATUS_CODES.has(response.status) || attempt + 1 >= maxAttempts || received) throw requestError;
        await sleep(retryDelay(response, attempt));
        continue;
      }
      // 部分中转站忽略 stream 参数、直接返回整包 JSON：识别出来交给上层回退非流式。
      const contentType = response.headers.get("content-type") ?? "";
      if (contentType && !contentType.includes("event-stream") && !contentType.includes("stream")) {
        throw new Error(`端点未返回 SSE（content-type: ${contentType.slice(0, 60)}）`);
      }
      await readSse(response, (payload, eventName) => {
        received = true;
        resetIdle();
        handle(payload, eventName);
      });
      clearTimeout(timer);
      return;
    } catch (error) {
      clearTimeout(timer);
      if (isRecord(error) && error.name === "AbortError") {
        lastError = new Error("模型请求超时，请检查网络或 Base URL");
      } else if (error instanceof TypeError) {
        const detail = error.message.trim();
        lastError = new Error(`fetch failed${detail ? `: ${detail}` : ""}`);
      } else {
        lastError = error;
      }
      appendBreadcrumb(`模型请求（${host}，流式）：第 ${attempt + 1}/${MAX_REQUEST_ATTEMPTS} 次尝试失败，${Math.round((Date.now() - attemptStartedAt) / 1000)}s —— ${describeRequestFailure(lastError)}`);
      // 已经开始收到数据就不再重试，避免把半截内容重复叠加。
      if (received || attempt + 1 >= MAX_REQUEST_ATTEMPTS || !(error instanceof TypeError || (isRecord(error) && error.name === "AbortError"))) {
        throw lastError;
      }
      await sleep(Math.min(4_000, 1_000 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error("模型请求失败");
}

function normalizeBaseUrl(value: string): string {
  const normalized = value.trim().replace(/\/+$/, "");
  if (!/^https?:\/\/[^\s]+$/i.test(normalized)) throw new Error("模型 Base URL 无效");
  return normalized;
}

interface OpenAiRequestParts {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  maxOutputTokens: number;
}

async function buildOpenAiRequest(
  selection: ModelSelection,
  messages: AgentMessage[],
  tools: AgentToolDefinition[],
  options: ModelCallOptions | undefined,
  streamMode: boolean,
): Promise<OpenAiRequestParts> {
  const maxOutputTokens = resolveOutputTokens(selection, options);
  const advanced = await getProviderAdvanced(selection.provider.id);
  return {
    url: `${normalizeBaseUrl(selection.provider.baseUrl)}/chat/completions`,
    headers: { "Content-Type": "application/json", ...buildAuthHeaders(advanced, selection.apiKey) },
    maxOutputTokens,
    body: {
      model: selection.model.modelId,
      temperature: selection.model.temperature,
      [advanced.useMaxCompletionTokens ? "max_completion_tokens" : "max_tokens"]: maxOutputTokens,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.toolCalls?.length ? (message.content || null) : message.content,
        ...(message.toolCalls?.length ? {
          tool_calls: message.toolCalls.map((call) => ({
            id: call.id,
            type: "function",
            function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            ...(call.providerMetadata?.openAiExtraContent
              ? { extra_content: call.providerMetadata.openAiExtraContent }
              : {}),
          })),
        } : {}),
        ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
      })),
      ...(!advanced.disableTools && tools.length ? {
        tools: tools.map((tool) => ({ type: "function", function: tool })),
        tool_choice: "auto",
      } : {}),
      ...(streamMode ? { stream: true } : {}),
    },
  };
}

function parseOpenAiToolCalls(rawCalls: any[]): AgentToolCall[] {
  return rawCalls
    .filter((call: unknown): call is Record<string, any> => isRecord(call))
    .map((call: Record<string, any>) => {
      const metadata = openAiExtraContent(call);
      return {
        id: String(call.id ?? ""),
        name: String(call.function?.name ?? ""),
        arguments: parseJsonObject(String(call.function?.arguments ?? "{}")),
        ...(metadata ? { providerMetadata: { openAiExtraContent: metadata } } : {}),
      };
    });
}

async function callOpenAiNonStream(
  selection: ModelSelection,
  messages: AgentMessage[],
  tools: AgentToolDefinition[],
  options?: ModelCallOptions,
): Promise<ModelTurn> {
  const request = await buildOpenAiRequest(selection, messages, tools, options, false);
  const data = await requestJson(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  });
  const choice = isRecord(data.choices?.[0]) ? data.choices[0] : {};
  const message = choice.message ?? {};
  const finishReason = typeof choice.finish_reason === "string" ? choice.finish_reason : "";
  const toolCalls = parseOpenAiToolCalls(message.tool_calls ?? []);
  const content = typeof message.content === "string" ? message.content : "";
  const reasoning = firstNonEmptyText(message.reasoning_content, message.reasoning, message.thinking);
  if (!content.trim() && !toolCalls.length) {
    if (finishReason === "length") {
      throw new Error(`模型在返回正文前就用完了 ${request.maxOutputTokens} 个输出 Token（finish_reason=length）。思考型模型的推理过程也计入这个上限，请在模型设置中调高最大输出 Token 数，或换用非思考模型。`);
    }
    if (finishReason && finishReason !== "stop") {
      throw new Error(`模型没有返回内容，finish_reason=${finishReason}`);
    }
  }
  return { content, toolCalls, ...(reasoning ? { reasoning } : {}) };
}

/**
 * 流式（OpenAI 兼容 / SSE）：正文与推理增量实时回调；
 * 工具调用按 index 累加 id / name / arguments 分片，流结束才拼装执行。
 */
async function callOpenAiStream(
  selection: ModelSelection,
  messages: AgentMessage[],
  tools: AgentToolDefinition[],
  options: ModelCallOptions | undefined,
  state: { received: boolean },
): Promise<ModelTurn> {
  const request = await buildOpenAiRequest(selection, messages, tools, options, true);
  let content = "";
  let reasoning = "";
  let finishReason = "";
  const pending = new Map<number, { id: string; name: string; args: string; extra?: Record<string, unknown> }>();
  await requestStream(request.url, {
    method: "POST",
    headers: request.headers,
    body: JSON.stringify(request.body),
  }, (payload) => {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === "[DONE]") return;
    let chunk: unknown;
    try {
      chunk = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!isRecord(chunk)) return;
    const choice = isRecord(chunk.choices?.[0]) ? chunk.choices[0] : null;
    if (!choice) return;
    const delta: Record<string, any> = isRecord(choice.delta) ? choice.delta : {};
    const textDelta = typeof delta.content === "string" ? delta.content : "";
    if (textDelta) {
      content += textDelta;
      state.received = true;
      options?.onDelta?.({ content: textDelta });
    }
    const reasoningDelta = firstNonEmptyText(delta.reasoning_content, delta.reasoning, delta.thinking);
    if (reasoningDelta) {
      reasoning += reasoningDelta;
      state.received = true;
      options?.onDelta?.({ reasoning: reasoningDelta });
    }
    const rawCalls = Array.isArray(delta.tool_calls) ? delta.tool_calls : [];
    for (const raw of rawCalls) {
      if (!isRecord(raw)) continue;
      const index = typeof raw.index === "number" ? raw.index : 0;
      const entry = pending.get(index) ?? { id: "", name: "", args: "" };
      if (typeof raw.id === "string" && raw.id) entry.id = raw.id;
      const fn = isRecord(raw.function) ? raw.function : {};
      if (typeof fn.name === "string" && fn.name) entry.name += fn.name;
      if (typeof fn.arguments === "string" && fn.arguments) entry.args += fn.arguments;
      const metadata = openAiExtraContent(raw);
      if (metadata) entry.extra = metadata;
      pending.set(index, entry);
    }
    if (typeof choice.finish_reason === "string" && choice.finish_reason) finishReason = choice.finish_reason;
  });
  const toolCalls: AgentToolCall[] = [...pending.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([, entry]) => ({
      id: entry.id,
      name: entry.name,
      arguments: parseJsonObject(entry.args || "{}"),
      ...(entry.extra ? { providerMetadata: { openAiExtraContent: entry.extra } } : {}),
    }));
  if (!content.trim() && !toolCalls.length) {
    if (finishReason === "length") {
      throw new Error(`模型在返回正文前就用完了 ${request.maxOutputTokens} 个输出 Token（finish_reason=length）。思考型模型的推理过程也计入这个上限，请在模型设置中调高最大输出 Token 数，或换用非思考模型。`);
    }
  }
  return { content, toolCalls, ...(reasoning ? { reasoning } : {}) };
}

/** 优先流式；端点不支持 SSE（中转站常见）且尚未收到任何增量时回退非流式。 */
async function callOpenAi(
  selection: ModelSelection,
  messages: AgentMessage[],
  tools: AgentToolDefinition[],
  options?: ModelCallOptions,
): Promise<ModelTurn> {
  if (options?.stream === false) return callOpenAiNonStream(selection, messages, tools, options);
  const state = { received: false };
  try {
    return await callOpenAiStream(selection, messages, tools, options, state);
  } catch (error) {
    if (state.received) throw error;
    appendBreadcrumb(`流式不可用，回退非流式：${error instanceof Error ? error.message : String(error)}`);
    return callOpenAiNonStream(selection, messages, tools, options);
  }
}

/** 依次取第一个非空字符串字段，用于兼容各家推理字段命名差异。 */
function firstNonEmptyText(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return "";
}

function toGeminiSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(toGeminiSchema);
  if (!value || typeof value !== "object") return value;
  const source = value as Record<string, unknown>;
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source)) {
    if (key === "type" && typeof item === "string") output[key] = item.toUpperCase();
    else if (key === "required" && Array.isArray(item) && item.length === 0) continue;
    else if (key !== "additionalProperties") output[key] = toGeminiSchema(item);
  }
  if (!output.type && isRecord(source.properties)) output.type = "OBJECT";
  if (!output.type && source.items) output.type = "ARRAY";
  if (!output.type && Array.isArray(source.enum) && source.enum.length) {
    const sample = source.enum[0];
    output.type = typeof sample === "number" ? "NUMBER" : typeof sample === "boolean" ? "BOOLEAN" : "STRING";
  }
  if (!output.type) output.type = "STRING";
  return output;
}

function geminiContents(messages: AgentMessage[]): Record<string, unknown>[] {
  const contents: Record<string, unknown>[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      const part = { functionResponse: { name: message.toolName, response: parseJsonObject(message.content) } };
      const previous = contents.at(-1);
      if (previous?.role === "user" && Array.isArray(previous.parts)
        && previous.parts.every((item) => isRecord(item) && "functionResponse" in item)) {
        previous.parts.push(part);
      } else {
        contents.push({ role: "user", parts: [part] });
      }
      continue;
    }
    const parts: Record<string, unknown>[] = [];
    if (message.content) parts.push({ text: message.content });
    for (const call of message.toolCalls ?? []) {
      parts.push({
        functionCall: { name: call.name, args: call.arguments },
        ...(call.providerMetadata?.geminiThoughtSignature
          ? { thoughtSignature: call.providerMetadata.geminiThoughtSignature }
          : {}),
      });
    }
    if (parts.length) contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
  }
  return contents;
}

async function buildGeminiRequest(
  selection: ModelSelection,
  messages: AgentMessage[],
  tools: AgentToolDefinition[],
  options: ModelCallOptions | undefined,
  streamMode: boolean,
): Promise<{ url: string; init: RequestInit; maxOutputTokens: number }> {
  const maxOutputTokens = resolveOutputTokens(selection, options);
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  const baseUrl = normalizeBaseUrl(selection.provider.baseUrl);
  const method = streamMode ? "streamGenerateContent?alt=sse" : "generateContent";
  return {
    url: `${baseUrl}/models/${encodeURIComponent(selection.model.modelId)}:${method}`,
    maxOutputTokens,
    init: {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": selection.apiKey },
      body: JSON.stringify({
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        contents: geminiContents(messages),
        ...(tools.length ? {
          tools: [{ functionDeclarations: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: toGeminiSchema(tool.parameters),
          })) }],
        } : {}),
        generationConfig: {
          temperature: selection.model.temperature,
          maxOutputTokens,
        },
      }),
    },
  };
}

function geminiTurnFromParts(parts: any[], finishReason: string, maxOutputTokens: number): ModelTurn {
  if (!parts.length) {
    if (finishReason === "MAX_TOKENS") {
      throw new Error(`模型在返回正文前就用完了 ${maxOutputTokens} 个输出 Token（finishReason=MAX_TOKENS）。思考型模型的推理过程也计入这个上限，请在模型设置中调高最大输出 Token 数。`);
    }
    if (finishReason) throw new Error(`Gemini 请求未完成: ${finishReason}`);
  }
  const toolCalls = parts.filter((part) => part.functionCall).map((part, index) => ({
    id: `gemini-${Date.now()}-${index}`,
    name: String(part.functionCall.name),
    arguments: isRecord(part.functionCall.args) ? part.functionCall.args : {},
    ...(typeof (part.thoughtSignature ?? part.thought_signature) === "string" ? {
      providerMetadata: { geminiThoughtSignature: part.thoughtSignature ?? part.thought_signature },
    } : {}),
  }));
  const geminiReasoning = parts.filter((part) => part.thought === true && typeof part.text === "string")
    .map((part) => part.text).join("");
  return {
    content: parts.filter((part) => typeof part.text === "string" && part.thought !== true).map((part) => part.text).join(""),
    toolCalls,
    ...(geminiReasoning ? { reasoning: geminiReasoning } : {}),
  };
}

async function callGeminiNonStream(
  selection: ModelSelection,
  messages: AgentMessage[],
  tools: AgentToolDefinition[],
  options?: ModelCallOptions,
): Promise<ModelTurn> {
  const request = await buildGeminiRequest(selection, messages, tools, options, false);
  const data = await requestJson(request.url, request.init);
  const parts: any[] = data.candidates?.[0]?.content?.parts ?? [];
  const finishReason = String(data.candidates?.[0]?.finishReason ?? "");
  if (!parts.length && !finishReason) {
    const reason = data.promptFeedback?.blockReason ?? "模型没有返回内容";
    throw new Error(`Gemini 请求未完成: ${reason}`);
  }
  return geminiTurnFromParts(parts, finishReason, request.maxOutputTokens);
}

async function callGeminiStream(
  selection: ModelSelection,
  messages: AgentMessage[],
  tools: AgentToolDefinition[],
  options: ModelCallOptions | undefined,
  state: { received: boolean },
): Promise<ModelTurn> {
  const request = await buildGeminiRequest(selection, messages, tools, options, true);
  const parts: any[] = [];
  let finishReason = "";
  await requestStream(request.url, request.init, (payload) => {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === "[DONE]") return;
    let chunk: unknown;
    try {
      chunk = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!isRecord(chunk)) return;
    const candidate = isRecord(chunk.candidates?.[0]) ? chunk.candidates[0] : null;
    if (!candidate) return;
    const chunkParts: any[] = Array.isArray(candidate.content?.parts) ? candidate.content.parts : [];
    for (const part of chunkParts) {
      parts.push(part);
      if (typeof part.text === "string" && part.text) {
        state.received = true;
        options?.onDelta?.(part.thought === true ? { reasoning: part.text } : { content: part.text });
      } else if (part.functionCall) {
        state.received = true;
      }
    }
    if (typeof candidate.finishReason === "string" && candidate.finishReason) finishReason = candidate.finishReason;
  });
  return geminiTurnFromParts(parts, finishReason, request.maxOutputTokens);
}

async function callGemini(
  selection: ModelSelection,
  messages: AgentMessage[],
  tools: AgentToolDefinition[],
  options?: ModelCallOptions,
): Promise<ModelTurn> {
  if (options?.stream === false) return callGeminiNonStream(selection, messages, tools, options);
  const state = { received: false };
  try {
    return await callGeminiStream(selection, messages, tools, options, state);
  } catch (error) {
    if (state.received) throw error;
    appendBreadcrumb(`Gemini 流式不可用，回退非流式：${error instanceof Error ? error.message : String(error)}`);
    return callGeminiNonStream(selection, messages, tools, options);
  }
}

function anthropicMessages(messages: AgentMessage[]): Record<string, unknown>[] {
  const output: Record<string, any>[] = [];
  for (const message of messages) {
    if (message.role === "system") continue;
    const role = message.role === "assistant" ? "assistant" : "user";
    const blocks: Record<string, unknown>[] = [];
    if (message.role === "tool") {
      const result = parseJsonObject(message.content);
      blocks.push({
        type: "tool_result",
        tool_use_id: message.toolCallId,
        content: message.content,
        ...(typeof result.error === "string" ? { is_error: true } : {}),
      });
    } else {
      if (message.content) blocks.push({ type: "text", text: message.content });
      for (const call of message.toolCalls ?? []) blocks.push({ type: "tool_use", id: call.id, name: call.name, input: call.arguments });
    }
    if (!blocks.length) continue;
    const previous = output.at(-1);
    if (previous?.role === role && Array.isArray(previous.content)) previous.content.push(...blocks);
    else output.push({ role, content: blocks });
  }
  return output;
}

function anthropicRequestBody(
  selection: ModelSelection,
  messages: AgentMessage[],
  tools: AgentToolDefinition[],
  maxOutputTokens: number,
  streamMode: boolean,
): Record<string, unknown> {
  const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
  return {
    model: selection.model.modelId,
    system,
    temperature: selection.model.temperature,
    max_tokens: maxOutputTokens,
    messages: anthropicMessages(messages),
    ...(tools.length ? {
      tools: tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })),
    } : {}),
    ...(streamMode ? { stream: true } : {}),
  };
}

const ANTHROPIC_HEADERS = (apiKey: string): Record<string, string> => ({
  "Content-Type": "application/json",
  "x-api-key": apiKey,
  "anthropic-version": "2023-06-01",
});

function anthropicBlocksToTurn(blocks: any[], stopReason: string, maxOutputTokens: number): ModelTurn {
  const content = blocks.filter((block) => block.type === "text").map((block) => block.text).join("");
  const anthropicReasoning = blocks.filter((block) => block.type === "thinking" && typeof block.thinking === "string")
    .map((block) => block.thinking).join("");
  const toolCalls = blocks.filter((block) => block.type === "tool_use").map((block) => ({
    id: String(block.id), name: String(block.name), arguments: block.input ?? {},
  }));
  if (!content.trim() && !toolCalls.length && stopReason === "max_tokens") {
    throw new Error(`模型在返回正文前就用完了 ${maxOutputTokens} 个输出 Token（stop_reason=max_tokens）。请在模型设置中调高最大输出 Token 数。`);
  }
  return { content, toolCalls, ...(anthropicReasoning ? { reasoning: anthropicReasoning } : {}) };
}

async function callAnthropicNonStream(
  selection: ModelSelection,
  messages: AgentMessage[],
  tools: AgentToolDefinition[],
  options?: ModelCallOptions,
): Promise<ModelTurn> {
  const maxOutputTokens = resolveOutputTokens(selection, options);
  const data = await requestJson(`${normalizeBaseUrl(selection.provider.baseUrl)}/messages`, {
    method: "POST",
    headers: ANTHROPIC_HEADERS(selection.apiKey),
    body: JSON.stringify(anthropicRequestBody(selection, messages, tools, maxOutputTokens, false)),
  });
  return anthropicBlocksToTurn(data.content ?? [], String(data.stop_reason ?? ""), maxOutputTokens);
}

/**
 * 流式（Anthropic 命名事件）：text_delta → 正文，thinking_delta → 推理，
 * tool_use 块以 input_json_delta 分片累加，content_block_stop 后才拼装。
 */
async function callAnthropicStream(
  selection: ModelSelection,
  messages: AgentMessage[],
  tools: AgentToolDefinition[],
  options: ModelCallOptions | undefined,
  state: { received: boolean },
): Promise<ModelTurn> {
  const maxOutputTokens = resolveOutputTokens(selection, options);
  const blocks: Record<number, any> = {};
  const order: number[] = [];
  let stopReason = "";
  await requestStream(`${normalizeBaseUrl(selection.provider.baseUrl)}/messages`, {
    method: "POST",
    headers: ANTHROPIC_HEADERS(selection.apiKey),
    body: JSON.stringify(anthropicRequestBody(selection, messages, tools, maxOutputTokens, true)),
  }, (payload) => {
    const trimmed = payload.trim();
    if (!trimmed || trimmed === "[DONE]") return;
    let event: unknown;
    try {
      event = JSON.parse(trimmed);
    } catch {
      return;
    }
    if (!isRecord(event)) return;
    const type = String(event.type ?? "");
    const index = typeof event.index === "number" ? event.index : order.length;
    if (type === "content_block_start") {
      const block = isRecord(event.content_block) ? event.content_block : {};
      const kind = String(block.type ?? "");
      if (kind === "tool_use") {
        blocks[index] = { type: "tool_use", id: String(block.id ?? ""), name: String(block.name ?? ""), json: "" };
      } else if (kind === "thinking") {
        blocks[index] = { type: "thinking", thinking: typeof block.thinking === "string" ? block.thinking : "" };
      } else {
        blocks[index] = { type: "text", text: typeof block.text === "string" ? block.text : "" };
      }
      if (!order.includes(index)) order.push(index);
      return;
    }
    if (type === "content_block_delta") {
      const delta = isRecord(event.delta) ? event.delta : {};
      const kind = String(delta.type ?? "");
      const entry = blocks[index] ?? (blocks[index] = { type: kind === "thinking_delta" ? "thinking" : kind === "input_json_delta" ? "tool_use" : "text" });
      if (!order.includes(index)) order.push(index);
      if (kind === "text_delta" && typeof delta.text === "string") {
        entry.text = (entry.text ?? "") + delta.text;
        state.received = true;
        options?.onDelta?.({ content: delta.text });
      } else if (kind === "thinking_delta" && typeof delta.thinking === "string") {
        entry.thinking = (entry.thinking ?? "") + delta.thinking;
        state.received = true;
        options?.onDelta?.({ reasoning: delta.thinking });
      } else if (kind === "input_json_delta" && typeof delta.partial_json === "string") {
        entry.json = (entry.json ?? "") + delta.partial_json;
        state.received = true;
      }
      return;
    }
    if (type === "message_delta") {
      const delta = isRecord(event.delta) ? event.delta : {};
      if (typeof delta.stop_reason === "string") stopReason = delta.stop_reason;
    }
  });
  const blocksInOrder = order.map((index) => blocks[index]).filter(Boolean).map((block) => {
    if (block.type !== "tool_use") return block;
    return { type: "tool_use", id: block.id, name: block.name, input: parseJsonObject(block.json || "{}") };
  });
  return anthropicBlocksToTurn(blocksInOrder, stopReason, maxOutputTokens);
}

async function callAnthropic(
  selection: ModelSelection,
  messages: AgentMessage[],
  tools: AgentToolDefinition[],
  options?: ModelCallOptions,
): Promise<ModelTurn> {
  if (options?.stream === false) return callAnthropicNonStream(selection, messages, tools, options);
  const state = { received: false };
  try {
    return await callAnthropicStream(selection, messages, tools, options, state);
  } catch (error) {
    if (state.received) throw error;
    appendBreadcrumb(`Anthropic 流式不可用，回退非流式：${error instanceof Error ? error.message : String(error)}`);
    return callAnthropicNonStream(selection, messages, tools, options);
  }
}

export interface ModelCallOptions {
  /** 保证本次请求至少有这么多输出 Token。用于结构上必须长输出的步骤（例如文风汇总），不会低于用户自己配置的上限。 */
  minOutputTokens?: number;
  /** 增量回调：正文与推理过程实时回传（流式）。 */
  onDelta?: (delta: { content?: string; reasoning?: string }) => void;
  /** 传 false 强制非流式（默认流式，端点不支持 SSE 时自动回退）。 */
  stream?: boolean;
}

function resolveOutputTokens(selection: ModelSelection, options?: ModelCallOptions): number {
  const configured = normalizeMaxOutputTokens(selection.model.maxTokens);
  if (!options?.minOutputTokens) return configured;
  return Math.min(MAX_CONFIGURED_OUTPUT_TOKENS, Math.max(configured, options.minOutputTokens));
}

export function callModel(
  selection: ModelSelection,
  messages: AgentMessage[],
  tools: AgentToolDefinition[],
  options?: ModelCallOptions,
): Promise<ModelTurn> {
  if (selection.provider.type === "google-genai") return callGemini(selection, messages, tools, options);
  if (selection.provider.type === "anthropic") return callAnthropic(selection, messages, tools, options);
  return callOpenAi(selection, messages, tools, options);
}
