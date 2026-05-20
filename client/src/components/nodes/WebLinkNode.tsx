/**
 * WebLinkNode · Web 链接输入节点（v1.5.2 起）
 * ---------------------------------------------------------------
 * 给画布添加"外部 URL"作为输入源：wiki、在线文档、新闻等。
 * 节点保存 URL；运行时由 store 的执行器调 server `/api/web-fetch`
 * 拉取纯文本，写到 data.fetchedText 后供下游 LLM / 文本处理消费。
 *
 * 节点形态参考 fileUpload：单 source handle，无 target（源节点）。
 * 用户可以双击标题改名，正文双击进入"编辑 URL"输入态。
 */
import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';
import type { WebLinkNodeData } from '../../types/nodes';

type Props = {
  id: string;
  data: WebLinkNodeData;
  selected?: boolean;
  [key: string]: any;
};

export default function WebLinkNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const [editing, setEditing] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [editingToken, setEditingToken] = useState(false);
  const [localUrl, setLocalUrl] = useState(data.url || '');
  const [localTitle, setLocalTitle] = useState(data.label || '🔗 Web 链接');
  const [localToken, setLocalToken] = useState(data.tencentDocsToken || '');
  const [fetching, setFetching] = useState(false);

  useEffect(() => { setLocalUrl(data.url || ''); }, [data.url]);
  useEffect(() => { setLocalTitle(data.label || '🔗 Web 链接'); }, [data.label]);
  useEffect(() => { setLocalToken(data.tencentDocsToken || ''); }, [data.tencentDocsToken]);

  /** URL 是否是腾讯文档（决定要不要露 token 输入框） */
  const isTencentDocs = (() => {
    try {
      const u = new URL(data.url || '');
      return u.hostname === 'docs.qq.com';
    } catch {
      return false;
    }
  })();

  const commitUrl = useCallback(() => {
    setEditing(false);
    const v = localUrl.trim();
    updateNodeData(id, { url: v });
  }, [id, localUrl, updateNodeData]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = localTitle.trim();
    if (v) updateNodeData(id, { label: v });
    else setLocalTitle(data.label || '🔗 Web 链接');
  }, [id, localTitle, updateNodeData, data.label]);

  const commitToken = useCallback(() => {
    setEditingToken(false);
    updateNodeData(id, { tencentDocsToken: localToken.trim() });
  }, [id, localToken, updateNodeData]);

  /** 立即抓取一次（不等执行器，方便用户预览） */
  const handleFetch = useCallback(async () => {
    const url = (data.url || '').trim();
    if (!url) {
      updateNodeData(id, { error: '请先填写 URL' });
      return;
    }
    setFetching(true);
    updateNodeData(id, { status: 'running', error: undefined });
    try {
      // 腾讯文档需要 token；POST 走 body 避免 token 进 URL 日志
      const r = await fetch('/api/web-fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          token: data.tencentDocsToken || undefined,
        }),
      });
      const body = await r.json();
      if (!r.ok) {
        updateNodeData(id, {
          status: 'error',
          error: body?.message || `HTTP ${r.status}`,
        });
      } else {
        updateNodeData(id, {
          status: 'success',
          fetchedTitle: body.title || '',
          fetchedFinalUrl: body.finalUrl || url,
          fetchedAt: new Date().toISOString(),
          fetchedText: body.text || '',
          fetchedSource: body.source || 'http',
          error: undefined,
        });
      }
    } catch (e: any) {
      updateNodeData(id, { status: 'error', error: e?.message || 'fetch 失败' });
    } finally {
      setFetching(false);
    }
  }, [id, data.url, data.tencentDocsToken, updateNodeData]);

  const fetched = !!data.fetchedText;
  const charCount = data.fetchedText ? data.fetchedText.length : 0;

  return (
    <div className={`node-card web-link-node ${selected ? 'selected' : ''}`} data-status={data.status || 'idle'}>
      <div className="node-header">
        {editingTitle ? (
          <input
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label); }
            }}
            autoFocus
            className="node-title-input"
          />
        ) : (
          <div
            className="node-title"
            onDoubleClick={() => setEditingTitle(true)}
            title="双击重命名"
          >
            {data.label || '🔗 Web 链接'}
          </div>
        )}
      </div>

      <div className="node-body">
        {editing ? (
          <input
            type="url"
            placeholder="https://..."
            value={localUrl}
            onChange={(e) => setLocalUrl(e.target.value)}
            onBlur={commitUrl}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitUrl();
              if (e.key === 'Escape') { setEditing(false); setLocalUrl(data.url || ''); }
            }}
            autoFocus
            className="web-link-url-input"
            style={{
              width: '100%',
              padding: '6px 8px',
              border: '1px solid var(--border-color)',
              borderRadius: 6,
              fontSize: 12,
              background: 'var(--bg-input)',
              color: 'var(--text-primary)',
              fontFamily: 'inherit',
            }}
          />
        ) : (
          <div
            className="web-link-url-preview"
            onDoubleClick={() => setEditing(true)}
            title="双击编辑"
            style={{
              fontSize: 12,
              color: data.url ? 'var(--accent)' : 'var(--text-muted)',
              wordBreak: 'break-all',
              padding: '4px 8px',
              border: '1px dashed var(--border-color)',
              borderRadius: 6,
              minHeight: 28,
              background: 'var(--bg-input)',
              cursor: 'text',
            }}
          >
            {data.url || '双击此处填写 URL（wiki / 在线文档 / 新闻等）'}
          </div>
        )}

        {isTencentDocs && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 10, color: '#1e40af', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>☁️ 腾讯文档 MCP token</span>
              <span
                title="腾讯文档是 SPA，普通抓取拿不到内容。需要 MCP token 走 OpenAPI 取真实正文。留空则用 server/.env 的 TENCENT_DOCS_TOKEN。"
                style={{ cursor: 'help', color: '#64748b' }}
              >
                ⓘ
              </span>
            </div>
            {editingToken ? (
              <input
                type="password"
                value={localToken}
                onChange={(e) => setLocalToken(e.target.value)}
                onBlur={commitToken}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitToken();
                  if (e.key === 'Escape') { setEditingToken(false); setLocalToken(data.tencentDocsToken || ''); }
                }}
                autoFocus
                placeholder="留空则用 server 环境变量"
                className="nodrag"
                style={{
                  width: '100%',
                  padding: '4px 8px',
                  border: '1px solid var(--border-color)',
                  borderRadius: 6,
                  fontSize: 11,
                  background: 'var(--bg-input)',
                  color: 'var(--text-primary)',
                  fontFamily: 'inherit',
                }}
              />
            ) : (
              <div
                onDoubleClick={() => setEditingToken(true)}
                title="双击编辑 token"
                style={{
                  fontSize: 11,
                  color: data.tencentDocsToken ? 'var(--text-primary)' : 'var(--text-muted)',
                  padding: '3px 8px',
                  border: '1px dashed var(--border-color)',
                  borderRadius: 6,
                  minHeight: 22,
                  background: 'var(--bg-input)',
                  cursor: 'text',
                  fontFamily: 'monospace',
                }}
              >
                {data.tencentDocsToken
                  ? `${data.tencentDocsToken.slice(0, 4)}****${data.tencentDocsToken.slice(-4)}`
                  : '(未设置 · 使用 server 环境变量)'}
              </div>
            )}
          </div>
        )}

        {fetched && (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6, lineHeight: 1.4 }}>
            <div style={{ color: 'var(--text-primary)', fontWeight: 600, fontSize: 12 }}>
              📄 {data.fetchedTitle || '(无标题)'}
            </div>
            <div>
              已抓取 {charCount.toLocaleString()} 字符 · {new Date(data.fetchedAt!).toLocaleString('zh-CN')}
              {data.fetchedSource && data.fetchedSource.startsWith('mcp:') && (
                <span style={{ marginLeft: 6, padding: '0 5px', borderRadius: 4, background: '#dbeafe', color: '#1e40af', fontSize: 10 }}>
                  MCP
                </span>
              )}
            </div>
          </div>
        )}

        {data.error && (
          <div style={{ fontSize: 11, color: 'var(--danger, #ef4444)', marginTop: 4 }}>
            ⚠️ {data.error}
          </div>
        )}

        <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
          <button
            onClick={handleFetch}
            disabled={!data.url || fetching}
            className="web-link-fetch-btn"
            style={{
              flex: 1,
              padding: '5px 10px',
              fontSize: 12,
              border: '1px solid var(--accent, #6366f1)',
              borderRadius: 6,
              background: fetched ? 'var(--accent-bg)' : 'var(--accent, #6366f1)',
              color: fetched ? 'var(--accent)' : '#fff',
              cursor: data.url && !fetching ? 'pointer' : 'not-allowed',
              opacity: data.url && !fetching ? 1 : 0.6,
            }}
          >
            {fetching ? '抓取中…' : fetched ? '🔄 重新抓取' : '⬇️ 抓取内容'}
          </button>
        </div>
      </div>

      <Handle type="source" position={Position.Right} />
    </div>
  );
}
