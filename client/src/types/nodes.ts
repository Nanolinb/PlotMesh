/**
 * types/nodes.ts · 全局节点 / 边 / 包 / 模型 类型定义
 * ---------------------------------------------------------------
 * 这里定义工作流的"形状"，store/nodes.ts、components/nodes/* 都依赖它。
 * 所有节点的 data 字段最终会序列化到 localStorage 和导出 JSON 里，所以
 * 字段尽量保持稳定；新增字段都做成 optional 以兼容历史画布。
 */

// 节点类型枚举
export enum NodeType {
  FILE_UPLOAD = 'fileUpload',
  TEXT_PROMPT = 'textPrompt',
  LLM = 'llm',
  OUTPUT = 'output',
  WEB_LINK = 'webLink', // v1.5.2 新增：抓取 wiki / 在线文档 / 新闻等
}

// 模型类型
export type ModelType = 'hunyuan' | 'deepseek' | 'glm' | 'gpt' | 'claude' | 'kimi' | 'qwen';

export const MODEL_OPTIONS: { value: ModelType; label: string }[] = [
  { value: 'hunyuan', label: '腾讯混元' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'glm', label: '智谱 GLM' },
  { value: 'gpt', label: 'OpenAI GPT' },
  { value: 'claude', label: 'Claude' },
  { value: 'kimi', label: 'Kimi (Moonshot)' },
  { value: 'qwen', label: '通义千问 (Qwen)' },
];

// 输出格式类型
export type OutputFormat = 'text' | 'markdown' | 'docx' | 'xlsx' | 'pdf' | 'image' | 'web' | 'tencentDocs';

export const OUTPUT_FORMAT_OPTIONS: { value: OutputFormat; label: string }[] = [
  { value: 'text', label: '纯文本 (.txt)' },
  { value: 'markdown', label: 'Markdown (.md)' },
  { value: 'docx', label: 'Word 文档 (.docx)' },
  { value: 'xlsx', label: 'Excel 表格 (.xlsx)' },
  { value: 'pdf', label: 'PDF 文档 (.pdf)' },
  { value: 'image', label: '图片 (.png)' },
  { value: 'web', label: '网页 (浏览器打开)' },
  { value: 'tencentDocs', label: '☁️ 输出到腾讯文档' },
];

// 节点执行状态
export type NodeStatus = 'idle' | 'running' | 'success' | 'error';

// 自定义节点数据
export interface FileUploadNodeData {
  type: NodeType.FILE_UPLOAD;
  label: string;
  files: Array<{
    id: string;
    originalName: string;
    filename: string;
    path: string;
    ext: string;
  }>;
  status: NodeStatus;
  error?: string;
}

export interface TextPromptNodeData {
  type: NodeType.TEXT_PROMPT;
  label: string;
  text: string;
  promptNumber: number; // 自动编号
  status: NodeStatus;
  error?: string;
}

export interface LLMNodeData {
  type: NodeType.LLM;
  label: string;
  model: ModelType;
  /**
   * 可选：自定义模型版本号（v1.5.3 起）
   * 留空 → 用 MODEL_OPTIONS 里厂商的默认版本（如 deepseek-chat / qwen-plus）
   * 填值 → server 会用这个值替换默认 modelName 发给厂商 API
   *        例：qwen → qwen3-coder-plus；deepseek → deepseek-reasoner；kimi → kimi-k2-0905-preview
   * 这样新厂商出新模型版本不必改前端代码。
   */
  customModelName?: string;
  systemPrompt: string;
  temperature: number;
  status: NodeStatus;
  output: string;
  error?: string;
  streamOutput: string; // 流式输出中间结果
}

export interface OutputNodeData {
  type: NodeType.OUTPUT;
  label: string;
  format: OutputFormat;
  status: NodeStatus;
  output: string;
  error?: string;
  /** 仅 format='tencentDocs' 时使用：导出后腾讯文档的链接 + fileId */
  tencentDocs?: {
    title?: string;       // 用户自定义标题（默认用画布名 + 时间）
    token?: string;        // 用户的 MCP token（用户输入；存在 store 里）
    lastUrl?: string;
    lastFileId?: string;
    lastExportedAt?: string;
  };
}

/** v1.5.2 新增：Web 链接节点（wiki / 在线文档 / 新闻外部源） */
export interface WebLinkNodeData {
  type: NodeType.WEB_LINK;
  label: string;
  /** 用户输入的 URL */
  url: string;
  /**
   * 仅 URL 是 docs.qq.com 时用：腾讯文档 MCP token（v1.5.3 起）
   * server 会优先用这个，没有则回退到 server/.env 的 TENCENT_DOCS_TOKEN。
   * 注意：token 会跟随画布持久化到 IDB，介意可留空让 server 用环境变量。
   */
  tencentDocsToken?: string;
  /** 抓取后的元信息（运行时填） */
  fetchedTitle?: string;
  fetchedFinalUrl?: string;
  fetchedAt?: string;     // ISO 时间
  /** 抓取来源：http | mcp:get_content | mcp:smartcanvas.read（v1.5.3 起） */
  fetchedSource?: string;
  /** 抓取后的纯文本（最大 32KB；运行时填，下游 LLM 消费它） */
  fetchedText?: string;
  status: NodeStatus;
  error?: string;
}

export type CustomNodeData =
  | FileUploadNodeData
  | TextPromptNodeData
  | LLMNodeData
  | OutputNodeData
  | WebLinkNodeData;

// 打包（常用功能）
export interface NodePackage {
  id: string;
  name: string;
  description?: string;
  group?: string;       // 分组名，空 = 默认（未分组）
  nodes: any[];         // React Flow nodes
  edges: any[];         // React Flow edges
  createdAt: string;
  updatedAt: string;
}

// 常用功能分组
export interface PackageGroup {
  id: string;
  name: string;
  collapsed?: boolean;  // 侧边栏中是否折叠
  createdAt: string;
}
