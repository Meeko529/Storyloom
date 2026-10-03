/**
 * 免费模型专区。
 *
 * 把常用平台**当前可免费使用的模型**做成一份清单：点一下就把供应商地址、模型 ID 全部填好，
 * 用户只剩"领一个 Key 粘进来"这一步。
 *
 * 为什么不代持 Key：那需要一台能下发清单、能替用户保管密钥的服务器。本应用没有服务端、
 * 也不中转用户请求，免费额度因此仍需用户到自己注册的账号下领取 —— 这是"数据只在本机"
 * 定位的必然取舍。
 *
 * 这份清单是**本地模板**：各家的免费政策随时会调整，模型下架也不会自己从这里消失。
 * 上一次逐条核对：2026-10-03。改动清单时记得一并更新这个日期。
 */
export interface FreeModel {
  id: string;
  /** 平台名，界面上作为主标签 */
  platform: string;
  /** 模型名，界面上作为副标签 */
  modelLabel: string;
  /** 免费额度说明 */
  note: string;
  /** 供应商类型：Google 走独立协议，其余为 OpenAI 兼容 */
  type: "openai-compatible" | "google-genai";
  /** 自动填入的供应商显示名 */
  providerName: string;
  /** 自动填入的接口地址 */
  baseUrl: string;
  /** 自动填入的模型 ID（必须与平台文档一致） */
  modelId: string;
  /** 领取 Key 的注册地址 */
  signupUrl: string;
}

export const FREE_MODELS: FreeModel[] = [
  {
    id: "zhipu-flash",
    platform: "智谱",
    modelLabel: "GLM-4.7-Flash",
    note: "该模型当前免费开放，注册后在控制台生成 API Key。",
    type: "openai-compatible",
    providerName: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    modelId: "glm-4.7-flash",
    signupUrl: "https://open.bigmodel.cn/",
  },
  {
    id: "siliconflow-xing",
    platform: "硅基流动",
    modelLabel: "Xing4.0-29B",
    note: "该模型当前免费，注册并完成实名认证后即可调用（29B，256K 上下文，支持工具调用）。",
    type: "openai-compatible",
    providerName: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    modelId: "XingChenAGI/Xing4.0-29B",
    signupUrl: "https://cloud.siliconflow.cn/",
  },
  {
    id: "hunyuan-lite",
    platform: "腾讯混元",
    modelLabel: "Hunyuan-Lite",
    note: "Lite 版长期免费，适合轻量任务；需完成腾讯云实名认证后在控制台生成 API Key。",
    type: "openai-compatible",
    providerName: "腾讯混元",
    baseUrl: "https://api.hunyuan.cloud.tencent.com/v1",
    modelId: "hunyuan-lite",
    signupUrl: "https://cloud.tencent.com/product/hunyuan",
  },
  {
    id: "qianfan-ernie-speed",
    platform: "百度千帆",
    modelLabel: "ERNIE-Speed-8K",
    note: "Speed / Lite / Tiny 三个系列对已实名用户免费开放（QPS 50）；控制台需先对该型号点一次「免费开通」。",
    type: "openai-compatible",
    providerName: "百度千帆",
    baseUrl: "https://qianfan.baidubce.com/v2",
    modelId: "ernie-speed-8k",
    signupUrl: "https://console.bce.baidu.com/qianfan/",
  },
  {
    id: "dashscope-turbo",
    platform: "通义千问",
    modelLabel: "qwen-turbo",
    note: "新用户赠送一定额度的免费 token（有效期 180 天），超出后按量计费。",
    type: "openai-compatible",
    providerName: "阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelId: "qwen-turbo",
    signupUrl: "https://bailian.console.aliyun.com/",
  },
  {
    id: "modelscope-qwen",
    platform: "阿里魔搭",
    modelLabel: "Qwen3.5-27B",
    note: "每天 2000 次调用、单模型 500 次；需绑定阿里云账号并完成实名认证。",
    type: "openai-compatible",
    providerName: "魔搭社区",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    modelId: "Qwen/Qwen3.5-27B",
    signupUrl: "https://www.modelscope.cn",
  },
  {
    id: "xfyun-spark-lite",
    platform: "讯飞星火",
    modelLabel: "Spark Lite",
    note: "Lite 版长期免费、Token 不限量（QPS 2/秒）；这里的 Key 指控制台里的 APIPassword。",
    type: "openai-compatible",
    providerName: "讯飞星火",
    baseUrl: "https://spark-api-open.xf-yun.com/v1",
    modelId: "lite",
    signupUrl: "https://xinghuo.xfyun.cn/sparkapi",
  },
  {
    id: "agnes-flash",
    platform: "Agnes AI",
    modelLabel: "Agnes-2.5-Flash",
    note: "官方定价为 0（输入输出均免费），512K 上下文；有每分钟请求限流，高峰期可能变慢。",
    type: "openai-compatible",
    providerName: "Agnes AI",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    modelId: "agnes-2.5-flash",
    signupUrl: "https://platform.agnes-ai.com",
  },
  {
    id: "openrouter-space-bunny",
    platform: "OpenRouter",
    modelLabel: "Space Bunny Alpha",
    note: "定价为 0，100 万上下文，支持工具调用与推理；注册后在 OpenRouter 的 Keys 页生成 API Key，同一账号的 Key 可用于全部免费条目。",
    type: "openai-compatible",
    providerName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    modelId: "stealth/space-bunny-alpha",
    signupUrl: "https://openrouter.ai/",
  },
  {
    id: "openrouter-qwen-3-8",
    platform: "OpenRouter",
    modelLabel: "Qwen3.8-27B",
    note: "定价为 0，通义千问 3.8 系列的 27B 版本，约 26 万上下文，支持工具调用与推理；Key 在 OpenRouter 的 Keys 页生成，同一账号的 Key 可用于全部免费条目。",
    type: "openai-compatible",
    providerName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    modelId: "qwen/qwen3.8-27b:free",
    signupUrl: "https://openrouter.ai/",
  },
  {
    id: "openrouter-ling-sante",
    platform: "OpenRouter",
    modelLabel: "Ling 3.0 Flash Sante",
    note: "定价为 0，inclusionAI 的 Ling 3.0 系列快速档，约 26 万上下文，支持工具调用与推理；Key 在 OpenRouter 的 Keys 页生成，同一账号的 Key 可用于全部免费条目。",
    type: "openai-compatible",
    providerName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    modelId: "inclusionai/ling-3.0-flash-sante:free",
    signupUrl: "https://openrouter.ai/",
  },
  {
    id: "openrouter-gemma-4",
    platform: "OpenRouter",
    modelLabel: "Gemma 4 31B",
    note: "定价为 0，Google Gemma 4 系列的 31B 版本，约 26 万上下文，支持工具调用与推理；Key 在 OpenRouter 的 Keys 页生成，同一账号的 Key 可用于全部免费条目。",
    type: "openai-compatible",
    providerName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    modelId: "google/gemma-4-31b-it:free",
    signupUrl: "https://openrouter.ai/",
  },
  {
    id: "groq-gpt-oss",
    platform: "Groq",
    modelLabel: "GPT-OSS-120B",
    note: "30 次/分钟、1000 次/天、每模型 20 万 Token/天；免费计划已不含 Llama 聊天模型；国内需自行保证网络可达。",
    type: "openai-compatible",
    providerName: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    modelId: "openai/gpt-oss-120b",
    signupUrl: "https://console.groq.com/keys",
  },
  {
    id: "cloudflare-workers-ai",
    platform: "Cloudflare",
    modelLabel: "Llama 3.3 70B",
    note: "每天 10,000 Neurons 免费额度（超额当天报错、次日恢复）；需把地址中的「账户ID」替换为自己的 Account ID（登录控制台首页可见），部分较新模型需绑卡。",
    type: "openai-compatible",
    providerName: "Cloudflare Workers AI",
    baseUrl: "https://api.cloudflare.com/client/v4/accounts/账户ID/ai/v1",
    modelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    signupUrl: "https://dash.cloudflare.com/",
  },
];
