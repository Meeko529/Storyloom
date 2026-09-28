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
    note: "目前免费调用，注册后在控制台生成 API Key 即可。",
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
    note: "该模型免费额度长期有效，注册即送。",
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
    note: "带 :free 后缀的模型免费，无需充值。",
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
    note: "新用户赠送一定额度的免费 token，用完按量计费。",
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
    note: "官方提供免费档配额，需自备可访问的网络环境。",
    type: "google-genai",
    providerName: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    modelId: "gemini-2.0-flash",
    signupUrl: "https://aistudio.google.com/apikey",
  },
];
