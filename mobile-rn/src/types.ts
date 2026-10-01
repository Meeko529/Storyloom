export type ProviderType = "openai-compatible" | "google-genai" | "anthropic";

export interface Project {
  id: string;
  title: string;
  description: string;
  /** 封面图片的本地路径；未设置封面时为 null */
  coverPath: string | null;
  /** 所属分类；未分类时为 null */
  categoryId: string | null;
  createdAt: string;
  updatedAt: string;
}

/** 书架作品分类 */
export interface Category {
  id: string;
  name: string;
  orderIndex: number;
}

export interface Volume {
  id: string;
  projectId: string;
  title: string;
  orderIndex: number;
}

export interface Chapter {
  id: string;
  projectId: string;
  volumeId: string;
  title: string;
  content: string;
  orderIndex: number;
  updatedAt: string;
}

/** 章节历史版本（时间机器）：被覆盖前的那一版正文。 */
export interface ChapterVersion {
  id: string;
  chapterId: string;
  projectId: string;
  title: string;
  content: string;
  characterCount: number;
  /** autosave = 自动保存覆盖前留存；manual = 手动保存覆盖前留存；restore = 恢复旧版前留存 */
  reason: string;
  createdAt: string;
}

/** 笔记的归属层级：两个外键都为空是整书，只有卷是卷级，有章是章级。 */
export type NoteScope = "project" | "volume" | "chapter";

export interface Note {
  id: string;
  projectId: string;
  volumeId: string | null;
  chapterId: string | null;
  title: string;
  content: string;
  orderIndex: number;
  createdAt: string;
  updatedAt: string;
}

export type StyleSourceFormat = "txt" | "markdown" | "epub" | "docx";

export interface StyleSource {
  id: string;
  title: string;
  fileName: string;
  format: StyleSourceFormat;
  fileUri: string;
  sizeBytes: number;
  contentHash: string;
  characterCount: number;
  createdAt: string;
  updatedAt: string;
}

export type StyleProfileKind = "reference" | "author";

export interface StyleProfile {
  id: string;
  seriesId: string;
  projectId: string | null;
  sourceId: string | null;
  kind: StyleProfileKind;
  name: string;
  version: number;
  guide: string;
  createdAt: string;
  updatedAt: string;
}

export type ChapterDraftStatus = "generated" | "revised" | "evolved";

export interface ChapterDraftSnapshot {
  id: string;
  projectId: string;
  chapterId: string;
  styleProfileId: string | null;
  aiDraft: string;
  authorRevision: string | null;
  status: ChapterDraftStatus;
  createdAt: string;
  updatedAt: string;
}

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKeyRef: string;
  createdAt: string;
}

export interface Model {
  id: string;
  providerId: string;
  name: string;
  modelId: string;
  temperature: number;
  maxTokens: number;
  /** 是否支持工具调用（function calling）：不支持时助手只能对话，无法读写作品 */
  supportsTools: boolean;
  /** 是否支持图片输入：决定能否给助手发图片 */
  supportsVision: boolean;
}

export interface ChatSession {
  id: string;
  projectId: string;
  title: string;
  modelId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AgentRunStatus = "running" | "completed" | "error";
export type AgentTraceEventStatus = "running" | "waiting" | "completed" | "error";
export type AgentTraceEventKind = "agent" | "tool" | "skill" | "question" | "consistency";

export interface AgentTraceEvent {
  id: string;
  kind: AgentTraceEventKind;
  status: AgentTraceEventStatus;
  title: string;
  agentName: string;
  toolName?: string;
  detail?: string;
  input?: string;
  output?: string;
  startedAt: string;
  completedAt?: string;
}

export interface AgentRunTrace {
  version: 1;
  id: string;
  status: AgentRunStatus;
  primaryAgentId: string;
  primaryAgentName: string;
  collaborationRequired: boolean;
  startedAt: string;
  completedAt?: string;
  events: AgentTraceEvent[];
}

export interface AgentClarificationOption {
  label: string;
  description?: string;
}

export interface AgentClarificationQuestion {
  title: string;
  description?: string;
  options: AgentClarificationOption[];
}

export interface AgentClarificationAnswer {
  question: string;
  answer: string;
}

export interface AgentClarificationRequest {
  id: string;
  agentName: string;
  questions: AgentClarificationQuestion[];
}

export interface AgentClarificationResponse {
  answers: AgentClarificationAnswer[];
  cancelled: boolean;
}

export interface ChatMessageMetadata {
  agentTrace?: AgentRunTrace;
  /** 思考型模型的推理过程；仅在模型提供时记录 */
  reasoning?: string;
  /** 本次请求总耗时（秒，含思考与执行）；≥1 才记录 */
  processingSeconds?: number;
  /** 随该条消息发送的文本附件摘要（正文不落库，只记来源与体量） */
  attachments?: Array<{ name: string; characters: number }>;
  taskStatus?: "completed" | "failed";
  errorMessage?: string;
  errorDetail?: string;
  retryContext?: {
    userMessageId: string;
    modelId: string;
    agentId: string | null;
  };
}

export interface ChatMessage {
  id: string;
  projectId: string;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: ChatMessageMetadata | null;
  createdAt: string;
}

export interface Character {
  id: string;
  projectId: string;
  name: string;
  description: string;
  imagePath: string | null;
  isFavorited: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorldInfo {
  id: string;
  projectId: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}

export interface WorldInfoEntry {
  id: string;
  worldInfoId: string;
  uid: number;
  name: string;
  order: number;
  content: string;
  tokenCount: number;
  /** 主触发关键词：导入 SillyTavern 世界书时保留原 key[]；写作与对话时供模型按需检索。 */
  keywords: string[];
  /** 次要触发关键词（SillyTavern 的 keysecondary[]）：与主关键词配合判断条目是否该被读到。 */
  secondaryKeywords: string[];
  /** 常驻条目（SillyTavern 的 constant）：不看关键词，任何时候都该被读到。 */
  isConstant: boolean;
  /** 触发概率 0–100（SillyTavern 的 probability）；100 表示必定触发。 */
  probability: number;
  /** 扫描深度：往前回看多少条对话里找关键词；0 表示不限制。 */
  scanDepth: number;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type IndexSourceType = "chapter" | "character" | "world-entry";

export interface LocalSearchResult {
  id: string;
  sourceType: IndexSourceType;
  sourceId: string;
  title: string;
  content: string;
  score: number;
  rerankScore?: number;
}

export interface ModelSelection {
  provider: Provider;
  model: Model;
  apiKey: string;
}
