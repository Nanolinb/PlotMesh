/**
 * server/src/routes/webFetch.js · 抓取 web 链接的纯文本（v1.5.2 → v1.5.3 增强）
 * ---------------------------------------------------------------
 * 给前端 WebLinkNode 用：传入一个 URL，server 端拉纯文本，回传给画布。
 *
 * 双通道策略：
 *   1) 腾讯文档（docs.qq.com）→ 走 MCP `get_content` / `smartcanvas.read`
 *      - 因为腾讯文档是 SPA，axios.get 只能拿到 HTML 骨架（几百字节）
 *      - MCP 用 token 鉴权后能拿到真实文本（MDX）
 *      - 需要前端在节点上配置 token，或 server/.env 里设 TENCENT_DOCS_TOKEN
 *   2) 其它站点 → 老的 axios.get + 正则脱标签流程
 *
 * 设计：
 *   - 不引入 cheerio / readability，依赖保持轻
 *   - 简单去除 <script> / <style> 块 + 标签 → 留下纯文本
 *   - 默认 UA 设为常规浏览器
 *   - 超时 15 秒，redirect 跟 5 跳
 *
 * 安全：
 *   - server 端代理；不暴露给非画布场景
 *   - 不做 SSRF 防护（v1.5.x 假设是单机本地服务）；上线前应加内网 IP block 列表
 */
import { Router } from 'express';
import crypto from 'crypto';
import axios from 'axios';

const router = Router();

const DEFAULT_CAPTURE_CHARS = 32 * 1024;
const MAX_CAPTURE_CHARS = 128 * 1024;
const TIMEOUT_MS = 15_000;
const MCP_ENDPOINT = process.env.TENCENT_DOCS_MCP_URL || 'https://docs.qq.com/openapi/mcp';

let rpcId = 1;

/**
 * 从腾讯文档 URL 里提取 file_id
 *
 * 支持：
 *   - https://docs.qq.com/doc/DXXXX
 *   - https://docs.qq.com/sheet/DXXXX
 *   - https://docs.qq.com/aio/XXXX?_fid=XXXX
 *   - https://docs.qq.com/aio/sharepage/XXXX
 *   - https://docs.qq.com/aio/p/XXXX
 *
 * 优先级：
 *   1) ?_fid=xxx 参数
 *   2) path 最后一段
 */
function extractTencentDocsFileId(urlObj) {
  const fid = urlObj.searchParams.get('_fid');
  if (fid) return fid.trim();
  // path 最后一段
  const segments = urlObj.pathname.split('/').filter(Boolean);
  if (!segments.length) return null;
  return segments[segments.length - 1];
}

/**
 * 调一次 MCP 工具
 * @returns 解析后的 result 对象（已自动从 content[].text JSON.parse），失败抛错
 */
async function callMcpTool(token, toolName, args) {
  const resp = await axios.post(
    MCP_ENDPOINT,
    {
      jsonrpc: '2.0',
      id: rpcId++,
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    },
    {
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      timeout: 30_000,
      validateStatus: () => true,
    }
  );

  if (resp.status >= 400) {
    throw new Error(`MCP HTTP ${resp.status}: ${JSON.stringify(resp.data).slice(0, 200)}`);
  }
  const data = resp.data || {};
  if (data.error) {
    throw new Error(`MCP RPC error [${data.error.code}] ${data.error.message}`);
  }
  // 优先 structuredContent
  let inner = data.result?.structuredContent;
  if (!inner && Array.isArray(data.result?.content)) {
    const txt = data.result.content.find((x) => x?.type === 'text')?.text;
    if (txt) {
      try { inner = JSON.parse(txt); } catch { inner = { _raw: txt }; }
    }
  }
  return inner || data.result || {};
}

/**
 * 抓取腾讯文档（走 MCP）
 * 策略：
 *   1) get_content 通用读取（覆盖普通 doc / sheet 等）
 *   2) 失败回退到 smartcanvas.read（智能文档分页读取）
 */
async function fetchTencentDocs(urlObj, token) {
  const fileId = extractTencentDocsFileId(urlObj);
  if (!fileId) {
    throw new Error('无法从 URL 解析出 file_id');
  }

  // 先尝试 get_content
  try {
    const r = await callMcpTool(token, 'get_content', { file_id: fileId });
    // get_content 返回字段名可能是 content / text / body
    const text =
      r.content || r.text || r.body || r.data || r._raw || '';
    if (text && typeof text === 'string' && text.trim().length > 0) {
      return {
        title: r.title || '',
        text: String(text),
        finalUrl: urlObj.toString(),
        source: 'mcp:get_content',
        fileId,
      };
    }
  } catch (e) {
    // 落到 smartcanvas.read
  }

  // 智能文档分页读取
  try {
    let allText = '';
    let nextToken = '';
    let pages = 0;
    do {
      const r = await callMcpTool(token, 'smartcanvas.read', {
        file_id: fileId,
        size: 20,
        ...(nextToken ? { next_token: nextToken } : {}),
      });
      const piece = r.content || r._raw || '';
      if (piece) allText += (allText ? '\n\n' : '') + String(piece);
      nextToken = r.next_token || '';
      pages++;
      if (allText.length >= MAX_CAPTURE_CHARS) break;
      if (pages >= 20) break; // 最多 20 页保险
    } while (nextToken);
    if (!allText.trim()) {
      throw new Error('MCP 返回空内容');
    }
    return {
      title: '',
      text: allText,
      finalUrl: urlObj.toString(),
      source: 'mcp:smartcanvas.read',
      fileId,
    };
  } catch (e) {
    throw new Error(`MCP 读取失败：${e.message || e}`);
  }
}

function extractHtmlScope(html, mode) {
  if (mode === 'full') return html;
  const article = /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1];
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1];
  const body = /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1];
  return article || main || body || html;
}

/** axios.get 抓取流程（非腾讯文档） */
async function fetchGeneric(url, extractionMode = 'article') {
  const resp = await axios.get(url, {
    timeout: TIMEOUT_MS,
    maxRedirects: 5,
    responseType: 'text',
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    },
    validateStatus: () => true,
  });

  const contentType = String(resp.headers['content-type'] || 'text/html');
  const html = String(resp.data || '');

  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const title = titleMatch ? decodeEntities(stripTags(titleMatch[1])).trim() : '';

  const scopedHtml = extractHtmlScope(html, extractionMode);
  let cleaned = scopedHtml
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ');
  if (extractionMode !== 'full') {
    cleaned = cleaned.replace(/<(nav|header|footer|aside|form)\b[\s\S]*?<\/\1>/gi, ' ');
  }
  let text = stripTags(cleaned);
  text = decodeEntities(text)
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s*\n\s*/g, '\n\n')
    .trim();

  return {
    finalUrl: resp.request?.res?.responseUrl || url,
    status: resp.status,
    contentType,
    title,
    text,
    source: 'http',
  };
}

/**
 * GET /api/web-fetch?url=<encoded>&token=<optional>
 * POST /api/web-fetch  body: { url, token? }
 *
 * 返回 { url, finalUrl, status, contentType, title, text, source, fileId? }
 *
 * token 优先级：query > body > 环境变量 TENCENT_DOCS_TOKEN
 */
function clampCaptureLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_CAPTURE_CHARS;
  return Math.max(1000, Math.min(MAX_CAPTURE_CHARS, Math.floor(n)));
}

function captureSnapshot(text, limit) {
  const source = String(text || '');
  const captured = source.slice(0, limit);
  return {
    text: captured,
    originalChars: source.length,
    capturedChars: captured.length,
    truncated: source.length > captured.length,
    contentHash: crypto.createHash('sha256').update(captured).digest('hex').slice(0, 16),
  };
}

async function handle(req, res) {
  const url = String(req.query.url || req.body?.url || '').trim();
  const tokenIn = String(req.query.token || req.body?.token || '').trim();
  const extractionMode = String(req.query.extractionMode || req.body?.extractionMode || 'article') === 'full' ? 'full' : 'article';
  const captureLimit = clampCaptureLimit(req.query.captureLimit || req.body?.captureLimit);

  if (!url) {
    return res.status(400).json({ error: 'bad_request', message: 'url is required' });
  }
  let urlObj;
  try {
    urlObj = new URL(url);
  } catch {
    return res.status(400).json({ error: 'bad_request', message: 'invalid url' });
  }

  // 腾讯文档分支
  if (urlObj.hostname === 'docs.qq.com') {
    const token = tokenIn || process.env.TENCENT_DOCS_TOKEN || '';
    if (!token) {
      return res.status(400).json({
        error: 'no_tencent_docs_token',
        message:
          '检测到腾讯文档链接，但未提供 MCP token。请在节点上输入 token，或设置 server/.env 中的 TENCENT_DOCS_TOKEN。',
      });
    }
    try {
      const r = await fetchTencentDocs(urlObj, token);
      const snapshot = captureSnapshot(r.text, captureLimit);
      return res.json({
        url,
        finalUrl: r.finalUrl,
        status: 200,
        contentType: 'text/markdown',
        title: r.title,
        ...snapshot,
        extractionMode: 'full',
        source: r.source,
        fileId: r.fileId,
      });
    } catch (err) {
      return res.status(502).json({
        error: 'tencent_docs_fetch_failed',
        message: err.message || String(err),
      });
    }
  }

  // 非腾讯文档：老路径
  try {
    const r = await fetchGeneric(url, extractionMode);
    const snapshot = captureSnapshot(r.text, captureLimit);
    return res.json({
      url,
      finalUrl: r.finalUrl,
      status: r.status,
      contentType: r.contentType,
      title: r.title,
      ...snapshot,
      extractionMode,
      source: r.source,
    });
  } catch (err) {
    return res.status(500).json({
      error: 'fetch_failed',
      message: err.message || String(err),
    });
  }
}

router.get('/', handle);
router.post('/', handle);

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, ' ');
}

function decodeEntities(s) {
  return String(s)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

export default router;
