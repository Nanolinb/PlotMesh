// 节点类型枚举
export enum NodeType {
  FILE_UPLOAD = 'fileUpload',
  TEXT_PROMPT = 'textPrompt',
  LLM = 'llm',
  OUTPUT = 'output',
}

// 模型类型
export type ModelType = 'hunyuan' | 'deepseek' | 'glm' | 'gpt' | 'claude';

export const MODEL_OPTIONS: { value: ModelType; label: string }[] = [
  { value: 'hunyuan', label: '腾讯混元' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'glm', label: '智谱 GLM' },
  { value: 'gpt', label: 'OpenAI GPT' },
  { value: 'claude', label: 'Claude' },
];

// 输出格式类型
export type OutputFormat = 'text' | 'markdown' | 'docx' | 'xlsx' | 'pdf' | 'image';

export const OUTPUT_FORMAT_OPTIONS: { value: OutputFormat; label: string }[] = [
  { value: 'text', label: '纯文本 (.txt)' },
  { value: 'markdown', label: 'Markdown (.md)' },
  { value: 'docx', label: 'Word 文档 (.docx)' },
  { value: 'xlsx', label: 'Excel 表格 (.xlsx)' },
  { value: 'pdf', label: 'PDF 文档 (.pdf)' },
  { value: 'image', label: '图片 (.png)' },
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
}

export type CustomNodeData =
  | FileUploadNodeData
  | TextPromptNodeData
  | LLMNodeData
  | OutputNodeData;

// 打包（常用功能）
export interface NodePackage {
  id: string;
  name: string;
  description?: string;
  nodes: any[]; // React Flow nodes
  edges: any[]; // React Flow edges
  createdAt: string;
  updatedAt: string;
}
