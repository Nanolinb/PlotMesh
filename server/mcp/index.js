/**
 * server/mcp/index.js · PlotMesh MCP server（v1.6 切片 2，stdio 协议）
 * ---------------------------------------------------------------
 * 把 server/src/routes/canvas.js 的 REST API 包装成 MCP tools，
 * 让 Codex / Kimi 客户端 / Claude Desktop 等支持 MCP 的 AI 客户端能
 * 自动发现并调用这些工具，无须手写 curl。
 *
 * 用法（codex 风格 ~/.codex/config.toml 或类似）：
 *   [[mcp_servers]]
 *   command = "node"
 *   args = ["/Users/<you>/WorkBuddy/.../server/mcp/index.js"]
 *   env = { PLOTMESH_API_BASE = "http://localhost:3001", PLOTMESH_API_TOKEN = "<your-token>" }
 *
 * 用法（Kimi/Claude Desktop 风格 mcp.json）：
 *   {
 *     "mcpServers": {
 *       "plotmesh": {
 *         "command": "node",
 *         "args": ["/path/to/server/mcp/index.js"],
 *         "env": { "PLOTMESH_API_BASE": "http://localhost:3001", "PLOTMESH_API_TOKEN": "<token>" }
 *       }
 *     }
 *   }
 *
 * 这是 stdio MCP server：父进程（AI 客户端）通过 stdin/stdout JSON-RPC 与本进程通信。
 * 不直接监听端口，不抢 3001。本进程内部用 fetch 调 http://localhost:3001/api/canvas/*。
 *
 * 设计原则：
 *   - 一对一映射 REST 路由到 MCP tool（11 个工具）
 *   - 每个 tool 返回 JSON.stringify 后的内容（让 AI 看清楚响应原文）
 *   - Token：从 env PLOTMESH_API_TOKEN 读取；本机调用 localhost 默认豁免，但带上更稳
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const API_BASE = (process.env.PLOTMESH_API_BASE || 'http://localhost:3001').replace(/\/+$/, '');
const API_TOKEN = process.env.PLOTMESH_API_TOKEN || '';

/** 通用 fetch 包装：带 token，统一错误处理 */
async function callApi(method, pathname, body) {
  const url = `${API_BASE}${pathname}`;
  const headers = { 'Content-Type': 'application/json' };
  if (API_TOKEN) headers.Authorization = `Bearer ${API_TOKEN}`;
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(url, init);
  const text = await res.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!res.ok) {
    return { ok: false, status: res.status, body: parsed };
  }
  return { ok: true, status: res.status, body: parsed };
}

/** 把 API 响应包成 MCP tool 的标准返回格式 */
function asToolResult(result) {
  return {
    content: [
      {
        type: 'text',
        text: JSON.stringify(result.body, null, 2),
      },
    ],
    isError: !result.ok,
  };
}

// 创建 MCP server 实例
const mcp = new McpServer(
  { name: 'plotmesh', version: '1.6.0' },
  {
    capabilities: { tools: {} },
    instructions:
      'PlotMesh canvas operations. Use these tools to create, read, update and delete canvas nodes/edges. ' +
      'Each canvas has nodes (typed: textPrompt/llm/output/splitter/timeline/swimlane/webLink/group/...) and edges. ' +
      'Start by calling list_canvases to see existing canvases, or canvas_types to learn what node types are available.',
  }
);

// ─── 工具 1: list_canvases ─────────────────────────────────────────────
mcp.registerTool(
  'list_canvases',
  {
    description: 'List all canvases (with id, name, nodeCount, edgeCount, updatedAt). No params needed.',
    inputSchema: {},
  },
  async () => asToolResult(await callApi('GET', '/api/canvas/list'))
);

// ─── 工具 2: canvas_types ──────────────────────────────────────────────
mcp.registerTool(
  'canvas_types',
  {
    description:
      'Get the schema (default data + notes) of all available node types. ' +
      'Call this first to know what to put in `data` field when creating nodes.',
    inputSchema: {},
  },
  async () => asToolResult(await callApi('GET', '/api/canvas/types'))
);

// ─── 工具 3: get_canvas ────────────────────────────────────────────────
mcp.registerTool(
  'get_canvas',
  {
    description: 'Read a canvas full content (nodes + edges + metadata).',
    inputSchema: {
      canvasId: z.string().describe('Canvas id, e.g. "canvas-mpfozft1-md8p"'),
    },
  },
  async ({ canvasId }) => asToolResult(await callApi('GET', `/api/canvas/${encodeURIComponent(canvasId)}`))
);

// ─── 工具 4: get_nodes ─────────────────────────────────────────────────
mcp.registerTool(
  'get_nodes',
  {
    description: 'List nodes of a canvas (without edges).',
    inputSchema: {
      canvasId: z.string(),
    },
  },
  async ({ canvasId }) =>
    asToolResult(await callApi('GET', `/api/canvas/${encodeURIComponent(canvasId)}/nodes`))
);

// ─── 工具 5: get_node ──────────────────────────────────────────────────
mcp.registerTool(
  'get_node',
  {
    description: 'Read a single node by id.',
    inputSchema: {
      canvasId: z.string(),
      nodeId: z.string(),
    },
  },
  async ({ canvasId, nodeId }) =>
    asToolResult(
      await callApi('GET', `/api/canvas/${encodeURIComponent(canvasId)}/nodes/${encodeURIComponent(nodeId)}`)
    )
);

// ─── 工具 6: create_canvas ─────────────────────────────────────────────
mcp.registerTool(
  'create_canvas',
  {
    description: 'Create a new canvas. Returns { canvas, store }.',
    inputSchema: {
      name: z.string().optional().describe('Canvas display name. Default = current timestamp.'),
      projectId: z.string().optional().describe('Project id. Default "project-default".'),
      workspaceId: z.string().optional().describe('Workspace id. Default "workspace-default".'),
    },
  },
  async (args) => asToolResult(await callApi('POST', '/api/canvas', args || {}))
);

// ─── 工具 7: create_node ───────────────────────────────────────────────
mcp.registerTool(
  'create_node',
  {
    description:
      'Create a new node on a canvas. Default data is auto-merged from the type schema; ' +
      'pass a partial `data` to override fields (e.g. label, text, model). ' +
      'For LLM nodes, set data.model to one of: hunyuan/deepseek/glm/gpt/claude/kimi/qwen, ' +
      'and data.customModelName for specific version (e.g. "deepseek-reasoner").',
    inputSchema: {
      canvasId: z.string(),
      type: z.string().describe('One of: textPrompt, fileUpload, llm, output, textTransform, condition, splitter, timeline, swimlane, webLink, group'),
      position: z
        .object({ x: z.number(), y: z.number() })
        .optional()
        .describe('Flow coordinates. Default { x: 100, y: 100 }.'),
      data: z.record(z.any()).optional().describe('Partial data to merge with type defaults.'),
      parentId: z.string().optional().describe('Set if this node belongs to a group/swimlane.'),
      extent: z.string().optional().describe('Usually "parent" for group children.'),
      className: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
    },
  },
  async ({ canvasId, ...rest }) =>
    asToolResult(await callApi('POST', `/api/canvas/${encodeURIComponent(canvasId)}/nodes`, rest))
);

// ─── 工具 8: update_node ───────────────────────────────────────────────
mcp.registerTool(
  'update_node',
  {
    description:
      'Update a node (partial). Pass any of: position, data (merged), label (shortcut for data.label), ' +
      'className, width, height, parentId (null to detach), extent.',
    inputSchema: {
      canvasId: z.string(),
      nodeId: z.string(),
      position: z.object({ x: z.number(), y: z.number() }).optional(),
      data: z.record(z.any()).optional(),
      label: z.string().optional(),
      className: z.string().optional(),
      width: z.number().optional(),
      height: z.number().optional(),
      parentId: z.string().nullable().optional(),
      extent: z.string().nullable().optional(),
    },
  },
  async ({ canvasId, nodeId, ...rest }) =>
    asToolResult(
      await callApi(
        'PATCH',
        `/api/canvas/${encodeURIComponent(canvasId)}/nodes/${encodeURIComponent(nodeId)}`,
        rest
      )
    )
);

// ─── 工具 9: delete_node ───────────────────────────────────────────────
mcp.registerTool(
  'delete_node',
  {
    description: 'Delete a node and any edges connected to it.',
    inputSchema: {
      canvasId: z.string(),
      nodeId: z.string(),
    },
  },
  async ({ canvasId, nodeId }) =>
    asToolResult(
      await callApi(
        'DELETE',
        `/api/canvas/${encodeURIComponent(canvasId)}/nodes/${encodeURIComponent(nodeId)}`
      )
    )
);

// ─── 工具 10: create_edge ──────────────────────────────────────────────
mcp.registerTool(
  'create_edge',
  {
    description:
      'Connect two nodes with an edge. ' +
      'For splitter→output, sourceHandle should be "out__<idx>" (0-based). ' +
      'targetHandle is usually OK to leave empty (most node target Handles do not have an id).',
    inputSchema: {
      canvasId: z.string(),
      source: z.string().describe('Source node id'),
      target: z.string().describe('Target node id'),
      sourceHandle: z.string().optional(),
      targetHandle: z.string().optional(),
    },
  },
  async ({ canvasId, ...rest }) =>
    asToolResult(await callApi('POST', `/api/canvas/${encodeURIComponent(canvasId)}/edges`, rest))
);

// ─── 工具 11: delete_edge ──────────────────────────────────────────────
mcp.registerTool(
  'delete_edge',
  {
    description: 'Delete an edge by id.',
    inputSchema: {
      canvasId: z.string(),
      edgeId: z.string(),
    },
  },
  async ({ canvasId, edgeId }) =>
    asToolResult(
      await callApi(
        'DELETE',
        `/api/canvas/${encodeURIComponent(canvasId)}/edges/${encodeURIComponent(edgeId)}`
      )
    )
);

// ─── 工具 12: run_canvas ───────────────────────────────────────────────
mcp.registerTool(
  'run_canvas',
  {
    description:
      'Trigger execution of a canvas. Returns immediately with a jobId; the canvas is run by the ' +
      'frontend polling worker (~5s pickup latency). User\'s browser must be open on PlotMesh. ' +
      'Use get_run_status to poll for completion.',
    inputSchema: {
      canvasId: z.string(),
      reason: z.string().optional().describe('Optional reason logged with the job'),
    },
  },
  async ({ canvasId, reason }) =>
    asToolResult(await callApi('POST', `/api/canvas/${encodeURIComponent(canvasId)}/run`, reason ? { reason } : {}))
);

// ─── 工具 13: get_run_status ───────────────────────────────────────────
mcp.registerTool(
  'get_run_status',
  {
    description:
      'Poll the status of a run job. Returns { job: { status: pending|running|succeeded|failed, log, results, error?, ... } }. ' +
      'results is a map of nodeId → { output, error? }, mostly Output nodes. Poll every ~5s after run_canvas.',
    inputSchema: {
      canvasId: z.string(),
      jobId: z.string(),
    },
  },
  async ({ canvasId, jobId }) =>
    asToolResult(
      await callApi('GET', `/api/canvas/${encodeURIComponent(canvasId)}/runs/${encodeURIComponent(jobId)}`)
    )
);

// ─── 工具 14: list_runs ────────────────────────────────────────────────
mcp.registerTool(
  'list_runs',
  {
    description: 'List all run jobs for a canvas (most recent first), useful for debugging.',
    inputSchema: { canvasId: z.string() },
  },
  async ({ canvasId }) =>
    asToolResult(await callApi('GET', `/api/canvas/${encodeURIComponent(canvasId)}/runs`))
);

// ─── 启动 ──────────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await mcp.connect(transport);
  // stdio 模式不能 console.log 到 stdout（会干扰 JSON-RPC 协议），只能写 stderr
  process.stderr.write(
    `[plotmesh-mcp] connected. API_BASE=${API_BASE} TOKEN=${API_TOKEN ? '(set)' : '(not set, localhost only)'}\n`
  );
}

main().catch((err) => {
  process.stderr.write(`[plotmesh-mcp] fatal: ${err.stack || err.message}\n`);
  process.exit(1);
});
