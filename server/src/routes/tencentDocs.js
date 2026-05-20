/**
 * server/src/routes/tencentDocs.js · 腾讯文档导出路由（v1.5.2 起，2026-05-20 修正）
 * ---------------------------------------------------------------
 * 给前端 OutputNode 的"输出到腾讯文档"格式用：把画布产物（Markdown / MDX）
 * 通过腾讯文档 OpenAPI MCP 创建一份新文档，并返回链接。
 *
 * 真实 MCP 协议（已实测通）：
 *   POST https://docs.qq.com/openapi/mcp
 *   Authorization: <token>          ← 直接是 token 字符串，不带 Bearer
 *   Content-Type: application/json
 *   Accept: application/json, text/event-stream
 *
 *   Body 是 JSON-RPC 2.0：
 *   {
 *     "jsonrpc": "2.0",
 *     "id": <number>,
 *     "method": "tools/call",
 *     "params": {
 *       "name": "create_smartcanvas_by_mdx",
 *       "arguments": { "title": "...", "mdx": "..." }   ← 注意是 mdx 不是 content
 *     }
 *   }
 *
 *   返回：
 *   {
 *     "jsonrpc": "2.0",
 *     "id": <number>,
 *     "result": {
 *       "content": [{ "type": "text", "text": "<json string>" }],
 *       "structuredContent": { "file_id": "...", "url": "//docs.qq.com/...", "trace_id": "..." }
 *     }
 *   }
 *   或错误：
 *   {
 *     "jsonrpc": "2.0",
 *     "id": <number>,
 *     "error": { "code": -32602, "message": "..." }
 *   }
 *
 * Token 优先级：
 *   1) 请求 body 携带 token（一次性使用，不入库）
 *   2) 环境变量 TENCENT_DOCS_TOKEN
 */
import { Router } from 'express';
import axios from 'axios';

const router = Router();

const MCP_ENDPOINT = process.env.TENCENT_DOCS_MCP_URL || 'https://docs.qq.com/openapi/mcp';

let rpcId = 1;

/**
 * POST /api/tencent-docs/export
 *   body: { title: string, content: string, format?: 'mdx' | 'md', token?: string }
 *   返回: { ok, url, fileId, traceId }
 */
router.post('/export', async (req, res) => {
  const { title, content, token: bodyToken } = req.body || {};
  if (!title || typeof title !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'title is required' });
  }
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'bad_request', message: 'content is required' });
  }

  const token = (bodyToken || process.env.TENCENT_DOCS_TOKEN || '').trim();
  if (!token) {
    return res.status(400).json({
      error: 'no_token',
      message: '腾讯文档 MCP token 未配置。请在节点上输入 token 或设置 server/.env 的 TENCENT_DOCS_TOKEN。',
    });
  }

  try {
    const resp = await axios.post(
      MCP_ENDPOINT,
      {
        jsonrpc: '2.0',
        id: rpcId++,
        method: 'tools/call',
        params: {
          name: 'create_smartcanvas_by_mdx',
          arguments: {
            title,
            // 真实参数名是 mdx，不是 content
            mdx: content,
          },
        },
      },
      {
        headers: {
          Authorization: token, // 注意：MCP 这里的 Authorization 直接是 token，不带 Bearer 前缀
          'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream',
        },
        timeout: 30_000,
        validateStatus: () => true,
      }
    );

    if (resp.status >= 400) {
      return res.status(502).json({
        error: 'mcp_http_error',
        status: resp.status,
        body: resp.data,
        message: 'MCP 端点返回 HTTP ' + resp.status,
      });
    }

    const data = resp.data || {};
    if (data.error) {
      return res.status(502).json({
        error: 'mcp_rpc_error',
        message: data.error.message || 'MCP 返回 RPC 错误',
        rpcCode: data.error.code,
        raw: data,
      });
    }

    // 解析 result —— 优先 structuredContent，回退到 content[].text 里的 JSON
    let inner = data.result?.structuredContent;
    if (!inner && Array.isArray(data.result?.content)) {
      const txt = data.result.content.find((x) => x?.type === 'text')?.text;
      if (txt) {
        try {
          inner = JSON.parse(txt);
        } catch {
          /* swallow */
        }
      }
    }

    const fileId = inner?.file_id || inner?.fileId || null;
    let rawUrl = inner?.url || null;
    // 腾讯文档返回的 url 可能是 //docs.qq.com/... 协议相对，补成 https
    if (rawUrl && rawUrl.startsWith('//')) rawUrl = 'https:' + rawUrl;
    // 加 _fid 参数（约定俗成，方便客户端打开）
    let url = rawUrl;
    if (url && fileId && !/[?&]_fid=/.test(url)) {
      url += (url.includes('?') ? '&' : '?') + '_fid=' + encodeURIComponent(fileId);
    }
    if (!url && fileId) {
      url = `https://docs.qq.com/aio/${fileId}?_fid=${fileId}`;
    }

    return res.json({
      ok: true,
      url,
      fileId,
      traceId: inner?.trace_id || null,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'export_failed',
      message: err.message || String(err),
    });
  }
});

export default router;
