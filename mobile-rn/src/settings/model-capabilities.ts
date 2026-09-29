/**
 * 模型能力推测。
 *
 * 本应用不内置模型清单——模型由用户自行接入，命名与能力随服务商变动，
 * 因此无法维护一份可信的权威表。做法是：**按模型 ID 命名规律给出建议值，用户可随时手动改**。
 *
 * 推测只影响界面提示与开关默认值，不参与任何请求逻辑；判断错了改一下开关即可，不会损坏数据。
 */

export interface ModelCapabilityGuess {
  supportsTools: boolean;
  supportsVision: boolean;
  /** 依据说明，展示给用户看，避免"猜了却不说是猜的" */
  reason: string;
}

/** 常见视觉模型的命名特征。 */
const VISION_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(^|[/\-_])glm-4(\.\d+)?v/i, label: "GLM 视觉版（glm-4v 系列）" },
  { pattern: /qwen[\d.]*-?vl/i, label: "通义千问视觉版（qwen-vl 系列）" },
  { pattern: /gpt-4o|gpt-4\.1|gpt-5|o[34]-/i, label: "OpenAI 多模态系列" },
  { pattern: /gemini/i, label: "Gemini 系列默认支持图片输入" },
  { pattern: /claude-(3|4|opus|sonnet|haiku)/i, label: "Claude 3 及以上支持图片输入" },
  { pattern: /(^|[/\-_])vl([\-_]|$)|vision|multimodal|omni/i, label: "名称含视觉/多模态标识" },
  { pattern: /glm-4\.5v|step-1v|internvl|minicpm-v|llava/i, label: "常见开源视觉模型" },
];

/** 明确不支持工具调用的模型特征（推理档、纯对话档、嵌入模型等）。 */
const NO_TOOLS_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /reasoner|r1(?![\d])|thinking|think/i, label: "推理档模型通常不提供工具调用" },
  { pattern: /embed|rerank|bge-|text-embedding/i, label: "嵌入与重排模型不提供对话能力" },
];

export function guessModelCapabilities(modelId: string): ModelCapabilityGuess {
  const value = modelId.trim();
  if (!value) return { supportsTools: true, supportsVision: false, reason: "模型 ID 为空，按通用默认值" };

  const vision = VISION_PATTERNS.find((entry) => entry.pattern.test(value));
  const noTools = NO_TOOLS_PATTERNS.find((entry) => entry.pattern.test(value));

  const reasons: string[] = [];
  if (vision) reasons.push(vision.label);
  if (noTools) reasons.push(noTools.label);
  if (!vision && !noTools) reasons.push("名称中没有可识别的能力标识，按通用默认值");

  return {
    supportsTools: !noTools,
    supportsVision: Boolean(vision),
    reason: reasons.join("；"),
  };
}
