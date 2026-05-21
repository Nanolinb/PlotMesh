# PlotMesh MCP Server 接入指南

让外部 AI 客户端（Codex / Kimi / Claude Desktop / 任何支持 MCP 的客户端）通过自然语言操作 PlotMesh 画布。

---

## 工作原理

```
[AI 客户端] ←─stdio JSON-RPC─→ [server/mcp/index.js (本进程)] ←─HTTP─→ [server/src/index.js (3001 主服务)]
```

- AI 客户端按 MCP 协议自动发现 11 个工具（list_canvases / create_node / delete_edge ...）
- AI 调工具 → 本 MCP 进程内部通过 fetch 调 `/api/canvas/*` REST API
- 数据落地到 `~/.plotmesh/store.json` → 前端 sync 拉到 → 用户刷新看到

**前提：**
1. PlotMesh server 在 3001 端口运行（`cd server && npm start`）
2. 找到 server 启动时打印的 API token（或自己写到 `server/.env` 的 `PLOTMESH_API_TOKEN`）

---

## 客户端配置

### Codex CLI（`~/.codex/config.toml`）

```toml
[mcp_servers.plotmesh]
command = "/Users/shaunlin/.workbuddy/binaries/node/versions/22.12.0/bin/node"
args = ["/Users/shaunlin/WorkBuddy/20260425211359/server/mcp/index.js"]

[mcp_servers.plotmesh.env]
PLOTMESH_API_BASE = "http://localhost:3001"
PLOTMESH_API_TOKEN = "f34938f5994830c81a458a4ab0c12768"
```

> 把 token 换成你 server 启动时打印的实际值。如果只在本机用，token 可省略（localhost 默认豁免）。

启动 codex 后会自动看到 `plotmesh.list_canvases` 等工具。直接用自然语言："帮我在 PlotMesh 里建一个新画布，加 3 个文本节点和 1 个 LLM 节点" 即可。

---

### Kimi 客户端（macOS app `mcp.json` 或类似）

```json
{
  "mcpServers": {
    "plotmesh": {
      "command": "/Users/shaunlin/.workbuddy/binaries/node/versions/22.12.0/bin/node",
      "args": [
        "/Users/shaunlin/WorkBuddy/20260425211359/server/mcp/index.js"
      ],
      "env": {
        "PLOTMESH_API_BASE": "http://localhost:3001",
        "PLOTMESH_API_TOKEN": "f34938f5994830c81a458a4ab0c12768"
      }
    }
  }
}
```

---

### Claude Desktop（`~/Library/Application Support/Claude/claude_desktop_config.json`）

```json
{
  "mcpServers": {
    "plotmesh": {
      "command": "node",
      "args": [
        "/Users/shaunlin/WorkBuddy/20260425211359/server/mcp/index.js"
      ],
      "env": {
        "PLOTMESH_API_BASE": "http://localhost:3001",
        "PLOTMESH_API_TOKEN": "f34938f5994830c81a458a4ab0c12768"
      }
    }
  }
}
```

> Claude Desktop 用 `node` 命令需要在系统 PATH 里有 node。如果没有就用绝对路径（同 codex/kimi 那样）。

---

## 11 + 3 个 MCP 工具

### 画布 CRUD（切片 1）
| 工具名 | 作用 |
|---|---|
| `list_canvases` | 列出所有画布 |
| `canvas_types` | 获取所有节点类型的默认 data schema |
| `get_canvas` | 读画布全量（节点 + 边） |
| `get_nodes` / `get_node` | 读节点列表 / 单个节点 |
| `create_canvas` | 新建画布 |
| `create_node` | 加节点（指定 type / position / data，会自动从 schema 合默认值） |
| `update_node` | 改节点（partial：position / data / label / parentId / extent / className / 尺寸） |
| `delete_node` | 删节点（自动清相关边） |
| `create_edge` | 连边（含 sourceHandle 用于 splitter 的 `out__<i>`） |
| `delete_edge` | 删边 |

### 触发运行（切片 3）
| 工具名 | 作用 |
|---|---|
| `run_canvas` | 触发画布执行（异步），立即返回 jobId；前端 worker 5s 内接管 |
| `get_run_status` | 查 jobId 状态：pending / running / succeeded / failed + log + results |
| `list_runs` | 列出该画布所有 job 历史（debug 用） |

> ⚠ **关键约束**：触发执行需要 PlotMesh 浏览器开着。worker 会自动切到目标画布并调用 executeFlow。

---

## 一个端到端示例（通过 AI 自然语言）

**你对 AI 说：**
> 帮我在 PlotMesh 新建一个画布叫"AI 玩具方案"。然后加 3 个文本提示词节点（A/B/C 不同方案），各自连一个 LLM 节点（用 deepseek-reasoner）做分析，最后每个 LLM 都连到一个 Output 节点。

**AI 实际会做的：**
1. `canvas_types` → 看节点类型 schema
2. `create_canvas { name: "AI 玩具方案" }` → 拿到 canvasId
3. 循环 3 次 `create_node { type: "textPrompt", data: {...} }` → 拿到 3 个 tpId
4. 循环 3 次 `create_node { type: "llm", data: { model: "deepseek", customModelName: "deepseek-reasoner" } }` → 拿到 3 个 llmId
5. 循环 3 次 `create_node { type: "output" }` → 拿到 3 个 outputId
6. 6 次 `create_edge` → tp→llm 和 llm→output

刷新 PlotMesh 浏览器就能看到这个完整工作流。

---

## 安全提示

- **生产环境**：在 `server/.env` 写死 `PLOTMESH_API_TOKEN`，重启不丢
- **强制本机鉴权**：如果担心同机其他进程乱调，设 `PLOTMESH_API_REQUIRE_TOKEN_LOCALHOST=true`
- **远程访问**：CORS 没限制，远程客户端必须带 token；建议外网访问走 SSH tunnel 或反向代理而不是直接暴露 3001

---

## 调试

stdio MCP 不能 console.log（会污染 JSON-RPC），日志都走 stderr：

```bash
node server/mcp/index.js 2>/tmp/plotmesh-mcp.log
```

或者直接拿手写 JSON-RPC 测试：

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"t","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized","params":{}}
{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}' | node server/mcp/index.js
```
