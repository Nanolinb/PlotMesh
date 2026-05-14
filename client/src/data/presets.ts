/**
 * 预制示例案例库
 *
 * 当用户首次打开 PlotMesh（localStorage 中尚无任何常用功能）时，会自动注入这里定义的
 * 示例分组与模板。让新用户立刻看到"画布上能干啥"，并且可以拖到画布即用。
 *
 * 已经动过手的用户（localStorage 已经存过 packages）不会被覆盖。
 *
 * 想新增示例：
 * 1. 在 SAMPLE_GROUPS 里加一个分组（或复用现有的）
 * 2. 在 SAMPLE_PACKAGES 里加一个 NodePackage：自填 nodes / edges 数组
 * 3. 重启或者清空 localStorage 后即可看到
 */
import type { NodePackage, PackageGroup } from '../types/nodes';

export const SAMPLE_GROUP_NAME = '🎓 示例案例';

export const SAMPLE_GROUPS: PackageGroup[] = [
  {
    id: 'grp-sample-default',
    name: SAMPLE_GROUP_NAME,
    collapsed: false,
    createdAt: new Date('2026-05-14T00:00:00Z').toISOString(),
  },
];

/**
 * 示例 1：文档改写助手
 *
 * 拖到画布后默认折叠成一个"黑盒"，4 个节点串成：
 *   ✏️ 编辑指令（提示词） → 📁 文件上传 → 🤖 大模型 → 📤 Markdown 输出
 *
 * 用户只需要：
 *   1) 双击展开
 *   2) 在文件上传节点拖入要改的 .md / .docx / .txt
 *   3) 改一下提示词措辞（比如把"修订错别字"换成"翻译成英文"）
 *   4) ▶️ 运行
 */
const docRewritePackage: NodePackage = {
  id: 'pkg-sample-doc-rewrite',
  name: '📝 文档改写助手',
  description: '上传文档 + 写改写指令，LLM 输出修改后的 Markdown 版本。可以改成翻译/润色/缩写等任意场景。',
  group: SAMPLE_GROUP_NAME,
  createdAt: new Date('2026-05-14T00:00:00Z').toISOString(),
  updatedAt: new Date('2026-05-14T00:00:00Z').toISOString(),
  nodes: [
    {
      id: 'sample-doc-prompt',
      type: 'textPrompt',
      position: { x: 0, y: 60 },
      data: {
        type: 'textPrompt',
        label: '编辑指令',
        text: '你是一位专业的中文编辑。\n请对下面的文档做以下处理：\n1. 修订所有错别字与病句\n2. 让段落语气更专业、更精炼\n3. 保留原有标题层级与列表结构\n4. 在文末加一段「修改说明」概述你做了哪些改动\n\n请直接输出修改后的完整 Markdown，不要包裹代码块。',
        promptNumber: 1,
        status: 'idle',
      },
    },
    {
      id: 'sample-doc-file',
      type: 'fileUpload',
      position: { x: 220, y: 60 },
      data: {
        type: 'fileUpload',
        label: '原文档',
        files: [],
        status: 'idle',
      },
    },
    {
      id: 'sample-doc-llm',
      type: 'llm',
      position: { x: 440, y: 60 },
      data: {
        type: 'llm',
        label: '改写引擎',
        model: 'deepseek',
        systemPrompt: '你是 PlotMesh 内置的中文写作教练，擅长在保留作者原意的前提下让文字更地道、更精炼。',
        temperature: 0.4,
        status: 'idle',
        output: '',
        streamOutput: '',
      },
    },
    {
      id: 'sample-doc-output',
      type: 'output',
      position: { x: 660, y: 60 },
      data: {
        type: 'output',
        label: '修订版',
        format: 'markdown',
        status: 'idle',
        output: '',
      },
    },
  ],
  edges: [
    { id: 'sample-doc-e1', source: 'sample-doc-prompt', target: 'sample-doc-file' },
    { id: 'sample-doc-e2', source: 'sample-doc-file', target: 'sample-doc-llm' },
    { id: 'sample-doc-e3', source: 'sample-doc-llm', target: 'sample-doc-output' },
  ],
};

/**
 * 示例 2：极简对话（最小可运行示例）
 *
 *   ✏️ 提示词 → 🤖 大模型 → 📤 输出
 */
const minimalChatPackage: NodePackage = {
  id: 'pkg-sample-minimal-chat',
  name: '💬 极简对话',
  description: '最简单的 LLM 调用示例：写一句话提示词，模型直接回答。',
  group: SAMPLE_GROUP_NAME,
  createdAt: new Date('2026-05-14T00:00:00Z').toISOString(),
  updatedAt: new Date('2026-05-14T00:00:00Z').toISOString(),
  nodes: [
    {
      id: 'sample-min-prompt',
      type: 'textPrompt',
      position: { x: 0, y: 60 },
      data: {
        type: 'textPrompt',
        label: '我的问题',
        text: '请用三句话解释什么是量子纠缠。',
        promptNumber: 1,
        status: 'idle',
      },
    },
    {
      id: 'sample-min-llm',
      type: 'llm',
      position: { x: 220, y: 60 },
      data: {
        type: 'llm',
        label: '大模型',
        model: 'deepseek',
        systemPrompt: '',
        temperature: 0.7,
        status: 'idle',
        output: '',
        streamOutput: '',
      },
    },
    {
      id: 'sample-min-output',
      type: 'output',
      position: { x: 440, y: 60 },
      data: {
        type: 'output',
        label: '回答',
        format: 'markdown',
        status: 'idle',
        output: '',
      },
    },
  ],
  edges: [
    { id: 'sample-min-e1', source: 'sample-min-prompt', target: 'sample-min-llm' },
    { id: 'sample-min-e2', source: 'sample-min-llm', target: 'sample-min-output' },
  ],
};

/**
 * 示例 3：JSON 提取 + 条件分流（演示文本处理 + 条件分支）
 *
 *   ✏️ 让 LLM 输出带 JSON 的内容
 *      → 🤖 大模型
 *      → 🔤 提取 JSON 代码块
 *      → 🔀 是否包含 "score"
 *           ├─ 匹配 → 📤 保存为 result.json
 *           └─ 不匹配 → 📤 保存为 raw.txt
 */
const jsonExtractPackage: NodePackage = {
  id: 'pkg-sample-json-extract',
  name: '🧪 JSON 提取 & 分流',
  description: '让 LLM 输出 JSON、自动提取代码块、按字段分两路输出。展示 文本处理 + 条件分支 的组合用法。',
  group: SAMPLE_GROUP_NAME,
  createdAt: new Date('2026-05-14T00:00:00Z').toISOString(),
  updatedAt: new Date('2026-05-14T00:00:00Z').toISOString(),
  nodes: [
    {
      id: 'sample-json-prompt',
      type: 'textPrompt',
      position: { x: 0, y: 100 },
      data: {
        type: 'textPrompt',
        label: '评分指令',
        text: '请对这段文本评分（0-100）：\n"PlotMesh 是一个把人和 AI 编织在同一画布上的协同工作台。"\n\n输出严格 JSON 格式，包裹在 ```json ... ``` 代码块中：\n{ "score": 数字, "reason": "评分理由" }',
        promptNumber: 1,
        status: 'idle',
      },
    },
    {
      id: 'sample-json-llm',
      type: 'llm',
      position: { x: 220, y: 100 },
      data: {
        type: 'llm',
        label: '评分模型',
        model: 'deepseek',
        systemPrompt: '严格按用户指定格式输出，不要多余解释。',
        temperature: 0,
        status: 'idle',
        output: '',
        streamOutput: '',
      },
    },
    {
      id: 'sample-json-extract',
      type: 'textTransform',
      position: { x: 440, y: 100 },
      data: {
        type: 'textTransform',
        label: '提取 JSON',
        transform: 'extract-json',
        param: '',
        param2: '',
        status: 'idle',
        output: '',
      },
    },
    {
      id: 'sample-json-cond',
      type: 'condition',
      position: { x: 640, y: 100 },
      data: {
        type: 'condition',
        label: '含 score?',
        mode: 'contains',
        keyword: 'score',
        status: 'idle',
      },
    },
    {
      id: 'sample-json-out-ok',
      type: 'output',
      position: { x: 860, y: 30 },
      data: {
        type: 'output',
        label: '✅ 结果 JSON',
        format: 'text',
        status: 'idle',
        output: '',
      },
    },
    {
      id: 'sample-json-out-fail',
      type: 'output',
      position: { x: 860, y: 180 },
      data: {
        type: 'output',
        label: '❌ 原始文本',
        format: 'text',
        status: 'idle',
        output: '',
      },
    },
  ],
  edges: [
    { id: 'sample-json-e1', source: 'sample-json-prompt', target: 'sample-json-llm' },
    { id: 'sample-json-e2', source: 'sample-json-llm', target: 'sample-json-extract' },
    { id: 'sample-json-e3', source: 'sample-json-extract', target: 'sample-json-cond' },
    { id: 'sample-json-e4', source: 'sample-json-cond', sourceHandle: 'true', target: 'sample-json-out-ok' },
    { id: 'sample-json-e5', source: 'sample-json-cond', sourceHandle: 'false', target: 'sample-json-out-fail' },
  ],
};

export const SAMPLE_PACKAGES: NodePackage[] = [
  docRewritePackage,
  minimalChatPackage,
  jsonExtractPackage,
];
