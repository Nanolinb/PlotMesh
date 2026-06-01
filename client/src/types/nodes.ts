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

/**
 * 各厂商常见的模型版本号备选清单（v1.6.0-β10 起）
 * ---------------------------------------------------------------
 * 用于 LLMNode「版本号」字段的 datalist 下拉提示。每家第一个为默认版本（留空时 server 用它）。
 * 用户也可以**直接输入**列表外的新版本（厂商出新版无需改这里），所以做成 datalist 而不是 select。
 *
 * 维护时机：当厂商发布新模型时，把它追加到对应数组里就行；老版本保留供历史画布兼容。
 * 如果用户填了列表中没有的字符串，server 会原样发给厂商 API（不存在则厂商报错，便于排查）。
 */
export const MODEL_VERSION_OPTIONS: Record<ModelType, { value: string; label: string }[]> = {
  deepseek: [
    { value: 'deepseek-chat', label: 'deepseek-chat（默认 · 通用对话）' },
    { value: 'deepseek-reasoner', label: 'deepseek-reasoner（深度推理）' },
    { value: 'deepseek-v4-pro', label: 'deepseek-v4-pro（V4 旗舰）' },
    { value: 'deepseek-v4-flash', label: 'deepseek-v4-flash（V4 快速）' },
  ],
  qwen: [
    { value: 'qwen-plus', label: 'qwen-plus（默认 · 平衡）' },
    { value: 'qwen-turbo', label: 'qwen-turbo（极速）' },
    { value: 'qwen-max', label: 'qwen-max（最强）' },
    { value: 'qwen-long', label: 'qwen-long（长上下文 1M）' },
    { value: 'qwen3-coder-plus', label: 'qwen3-coder-plus（代码）' },
  ],
  kimi: [
    { value: 'moonshot-v1-8k', label: 'moonshot-v1-8k（默认 · 8K）' },
    { value: 'moonshot-v1-32k', label: 'moonshot-v1-32k（32K）' },
    { value: 'moonshot-v1-128k', label: 'moonshot-v1-128k（128K）' },
    { value: 'kimi-k2-0905-preview', label: 'kimi-k2-0905-preview（K2 预览）' },
  ],
  hunyuan: [
    { value: 'hunyuan-turbo', label: 'hunyuan-turbo（默认 · Turbo）' },
    { value: 'hunyuan-pro', label: 'hunyuan-pro（Pro）' },
    { value: 'hunyuan-standard', label: 'hunyuan-standard（标准）' },
    { value: 'hunyuan-lite', label: 'hunyuan-lite（轻量）' },
  ],
  glm: [
    { value: 'glm-4', label: 'glm-4（默认）' },
    { value: 'glm-4-plus', label: 'glm-4-plus（增强）' },
    { value: 'glm-4-flash', label: 'glm-4-flash（极速）' },
    { value: 'glm-4-air', label: 'glm-4-air（轻量）' },
  ],
  gpt: [
    { value: 'gpt-4o', label: 'gpt-4o（默认）' },
    { value: 'gpt-4o-mini', label: 'gpt-4o-mini（轻量）' },
    { value: 'gpt-4-turbo', label: 'gpt-4-turbo' },
    { value: 'gpt-3.5-turbo', label: 'gpt-3.5-turbo' },
  ],
  claude: [
    { value: 'claude-3-5-sonnet-20241022', label: 'claude-3-5-sonnet-20241022（默认）' },
    { value: 'claude-3-5-haiku-20241022', label: 'claude-3-5-haiku-20241022（轻量）' },
    { value: 'claude-3-opus-20240229', label: 'claude-3-opus-20240229（旗舰）' },
  ],
};

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
export type NodeStatus = 'idle' | 'running' | 'success' | 'error' | 'received' | 'waiting';

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

/**
 * v1.6.0-β SwimlaneNode 数据形态（独立类型，故意不进 NodeType enum）
 * ---------------------------------------------------------------
 * 设计意图：v1.6 把"时间维度的节点编排"做成可与 TimelineNode 并存的另一种形态。
 *   - TimelineNode（v1.4 起）：单条横轴 + cut 切换点 → 视频/动画镜头编排
 *   - SwimlaneNode（v1.6.0-β 起）：横向 group + 多 lane → 项目时序编排（有泳道行）
 * 两者**不互相依赖**。SwimlaneNode 的所有字段、文件、组件全部独立，方便后续如果
 * 决定弃用任意一个直接整体拿掉（删 1 个文件 + 删 Sidebar/Canvas 各 1 行注册即可）。
 *
 * 软驱动语义（方案 Z）：lane 容器只负责给一个**横向时间坐标系**和**视觉泳道行**，
 *   - 子节点 parentId 指向 swimlane → 拖动时局部坐标即时间位置（仅显示用，不强吸附）
 *   - 子节点的 y 坐标决定它属于哪条 lane（按 lane 的 y 范围反推）
 *   - 软驱动 = 不强制对齐、不修改子节点拓扑、不参与执行
 *
 * 注意：因为本节点不参与拓扑执行（和 TimelineNode 一样），React Flow Node 的 type
 *      字段直接用字符串 'swimlane'，不出现在 NodeType enum 里。
 */
export interface SwimlaneNodeData {
  type: 'swimlane';
  label: string;
  /** 时间总长（按 unit 计）。默认 7（天）/24（小时）/15（秒）等 */
  durationValue: number;
  /** 时间单位 */
  unit: 'seconds' | 'hours' | 'days';
  /** 起始时间 ISO，仅 unit ∈ {hours, days} 时有意义；秒模式忽略 */
  startISO?: string;
  /** 每"单位时间"占多少像素（与 TimelineNode 的 px/s 同一思路），默认 60 */
  pixelsPerUnit: number;
  /** 泳道行配置 */
  lanes: SwimlaneRow[];
  /** 顶部刻度行高度，默认 36 */
  rulerHeight?: number;
  /** 容器内边距 */
  paddingLeft?: number;
}

export interface SwimlaneRow {
  /** 唯一 id（生成时确定，不复用 label） */
  id: string;
  /** 显示名（用户可双击改） */
  label: string;
  /** 行高（px），默认 80；用户可拖分隔条调整（v1.6.0-β 先固定，β2 再加拖） */
  height: number;
  /** 主题色（用于 lane label 左标签条），默认根据 idx 自动给 */
  color?: string;
}

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
