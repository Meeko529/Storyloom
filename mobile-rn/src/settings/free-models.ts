/**
 * 免费模型专区。
 *
 * 参照 DeepWrite 的「免费模型」入口：把常用平台**当前可免费使用的模型**做成一份清单，
 * 点一下就把供应商地址、模型 ID 全部填好，用户只剩"领一个 Key 粘进来"这一步。
 *
 * 与 DeepWrite 的关键差异（写在文档里，也写在这里）：
 * DeepWrite 由**官方代持 API Key**，随远端清单下发到客户端；我们没有服务端、也不中转用户请求，
 * 因此不做代持——免费额度仍需用户到自己注册的账号下领取。这是"数据只在本机"定位的必然取舍。
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
    id: "siliconflow-qwen",
    platform: "硅基流动",
    modelLabel: "Qwen2.5-7B",
    note: "该模型免费额度长期有效，注册即可获得。",
    type: "openai-compatible",
    providerName: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    modelId: "Qwen/Qwen2.5-7B-Instruct",
    signupUrl: "https://cloud.siliconflow.cn/",
  },
  {
    id: "openrouter-deepseek",
    platform: "OpenRouter",
    modelLabel: "DeepSeek V3.1",
    note: "带 :free 后缀的模型均可免费调用，无需充值。",
    type: "openai-compatible",
    providerName: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    modelId: "deepseek/deepseek-chat-v3.1:free",
    signupUrl: "https://openrouter.ai/",
  },
  {
    id: "dashscope-turbo",
    platform: "通义千问",
    modelLabel: "qwen-turbo",
    note: "新用户赠送一定额度的免费 token，超出后按量计费。",
    type: "openai-compatible",
    providerName: "阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelId: "qwen-turbo",
    signupUrl: "https://bailian.console.aliyun.com/",
  },
  {
    id: "gemini-flash",
    platform: "Google Gemini",
    modelLabel: "Gemini 2.0 Flash",
    note: "官方提供免费调用配额，需自行确保网络可达。",
    type: "google-genai",
    providerName: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    modelId: "gemini-2.0-flash",
    signupUrl: "https://aistudio.google.com/apikey",
  },
  {
    id: "agnes-flash",
    platform: "Agnes AI",
    modelLabel: "Agnes-2.0-Flash",
    note: "2026 年 6 月起文本/图片/视频全模态无限期免费，无 Token 上限（1M 上下文）；有每分钟请求限流，高峰期可能变慢。",
    type: "openai-compatible",
    providerName: "Agnes AI",
    baseUrl: "https://apihub.agnes-ai.com/v1",
    modelId: "agnes-2.0-flash",
    signupUrl: "https://platform.agnes-ai.com",
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
    id: "siliconflow-r1-distill",
    platform: "硅基流动",
    modelLabel: "DeepSeek-R1-Distill-Qwen-7B",
    note: "推理型模型永久免费（1000 RPM / 50K TPM）；与现有 Qwen2.5-7B 条目共用同一账号 Key。",
    type: "openai-compatible",
    providerName: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    modelId: "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",
    signupUrl: "https://cloud.siliconflow.cn/",
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
