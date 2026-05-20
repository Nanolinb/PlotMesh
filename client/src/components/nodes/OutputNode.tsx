/**
 * OutputNode · 输出节点（终点）
 * ---------------------------------------------------------------
 * 工作流的最终落地：把上游文本以指定格式渲染并允许下载/复制。
 *
 * 支持格式（OUTPUT_FORMAT_OPTIONS）：
 *   text / markdown / json / docx / xlsx / pdf / png
 *
 * 实现要点：
 *  - 文本类格式直接 Blob 触发下载
 *  - docx / xlsx / pdf / png 走 utils/exporters.ts 的真实格式生成（不是改后缀）
 *  - 内置预览 + 一键复制纯文本
 */
import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';
import { OUTPUT_FORMAT_OPTIONS, type OutputFormat, type OutputNodeData } from '../../types/nodes';

type Props = {
  id: string;
  data: OutputNodeData;
  selected?: boolean;
  [key: string]: any;
};

function OutputNode({ id, data, selected }: Props) {
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '输出');
  const [localFormat, setLocalFormat] = useState<OutputFormat>(data.format || 'text');
  const updateNodeData = useNodeStore((s) => s.updateNodeData);

  useEffect(() => { setLocalFormat(data.format || 'text'); }, [data.format]);
  useEffect(() => { setLocalTitle(data.label || '输出'); }, [data.label]);

  const handleFormatChange = useCallback((value: OutputFormat) => {
    setLocalFormat(value);
    updateNodeData(id, { format: value });
  }, [id, updateNodeData]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = localTitle.trim();
    if (v) updateNodeData(id, { label: v } as any);
    else setLocalTitle(data.label || '输出');
  }, [id, localTitle, updateNodeData, data.label]);

  // 根据选中的格式决定下载扩展名
  const getDownloadExt = (): string => {
    switch (localFormat) {
      case 'markdown': return 'md';
      case 'docx': return 'docx';
      case 'xlsx': return 'xlsx';
      case 'pdf': return 'pdf';
      case 'image': return 'png';
      default: return 'txt';
    }
  };

  const handleDownload = useCallback(async () => {
    if (!data.output) return;
    const ext = getDownloadExt();
    const ts = new Date().toISOString().replace(/[:T.]/g, '-').substring(0, 19);
    const filename = `${data.label || 'output'}-${ts}.${ext}`;
    try {
      if (localFormat === 'web') {
        // web 格式不下载，直接在新标签页打开
        const { openAsWeb } = await import('../../utils/exporters');
        openAsWeb(data.output, { title: data.label || '网页输出' });
        return;
      }
      if (localFormat === 'tencentDocs') {
        // 输出到腾讯文档：调 server 转发到 MCP 创建文档
        const td = (data as any).tencentDocs || {};
        let token = td.token;
        if (!token) {
          token = prompt('请输入腾讯文档 MCP token（首次使用需配置；之后会保留在此节点）：');
          if (!token) return;
          token = token.trim();
        }
        const title = td.title || `${data.label || '输出'}-${ts}`;
        updateNodeData(id, {
          status: 'running',
          tencentDocs: { ...td, token, title },
        } as any);
        try {
          const r = await fetch('/api/tencent-docs/export', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title, content: data.output, format: 'mdx', token }),
          });
          const body = await r.json();
          if (!r.ok || !body.ok) {
            throw new Error(body?.message || `HTTP ${r.status}`);
          }
          updateNodeData(id, {
            status: 'success',
            tencentDocs: {
              ...td,
              token,
              title,
              lastUrl: body.url,
              lastFileId: body.fileId,
              lastExportedAt: new Date().toISOString(),
            },
          } as any);
          if (body.url) {
            window.open(body.url, '_blank');
          } else {
            alert('已创建腾讯文档，但未返回链接：\n' + JSON.stringify(body.raw || body, null, 2));
          }
        } catch (e: any) {
          updateNodeData(id, {
            status: 'error',
            error: e?.message || '腾讯文档导出失败',
          } as any);
          alert('腾讯文档导出失败：' + (e?.message || '未知错误'));
        }
        return;
      }
      if (localFormat === 'docx') {
        const { exportAsDocx } = await import('../../utils/exporters');
        await exportAsDocx(data.output, { filename });
      } else if (localFormat === 'xlsx') {
        const { exportAsXlsx } = await import('../../utils/exporters');
        exportAsXlsx(data.output, { filename });
      } else if (localFormat === 'pdf') {
        const { exportAsPdf } = await import('../../utils/exporters');
        exportAsPdf(data.output, { filename });
      } else if (localFormat === 'image') {
        const { exportAsImage } = await import('../../utils/exporters');
        await exportAsImage(data.output, { filename });
      } else {
        // 纯文本 / Markdown：直接写 blob
        const mime = localFormat === 'markdown' ? 'text/markdown' : 'text/plain';
        const blob = new Blob([data.output], { type: mime + ';charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      alert((localFormat === 'web' ? '打开失败：' : '导出失败：') + (e?.message || '未知错误'));
    }
  }, [data, id, localFormat, updateNodeData]);

  const handleCopy = useCallback(async () => {
    if (!data.output) return;
    try {
      await navigator.clipboard.writeText(data.output);
      // 简单视觉反馈：临时 label 变化
      updateNodeData(id, { status: 'success' } as any);
    } catch {
      // 兜底：使用传统 execCommand
      const ta = document.createElement('textarea');
      ta.value = data.output;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      document.body.removeChild(ta);
    }
  }, [data.output, id, updateNodeData]);

  const handleClear = useCallback(() => {
    updateNodeData(id, { output: '', status: 'idle' } as any);
  }, [id, updateNodeData]);

  return (
    <div className={`node-card output-node ${selected ? 'selected' : ''}`} data-status={data.status || 'idle'}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #8b5cf6, #a78bfa)' }}>
        <span className="node-icon">📤</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || '输出'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: '6px', color: 'white', padding: '2px 6px', fontSize: '13px', outline: 'none' }}
          />
        ) : (
          <span className="node-title" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }} title="双击重命名" style={{ flex: 1, cursor: 'text' }}>
            {data.label || '输出'}
          </span>
        )}
      </div>

      <div className="node-body">
        <div className="field" style={{ marginBottom: '8px' }}>
          <label style={{ fontSize: '11px', color: '#64748b', display: 'block', marginBottom: '4px' }}>输出格式</label>
          <select
            className="nodrag"
            value={localFormat}
            onChange={(e) => handleFormatChange(e.target.value as OutputFormat)}
            style={{ width: '100%', padding: '4px 8px', borderRadius: '6px', border: '1px solid #d1d5db', fontSize: '12px' }}
          >
            {OUTPUT_FORMAT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {data.output ? (
          <>
            <div style={{ background: '#faf5ff', borderRadius: '6px', padding: '8px', fontSize: '12px', maxHeight: '120px', overflow: 'auto', color: '#374151', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {data.output.substring(0, 300)}
              {data.output.length > 300 ? '...' : ''}
            </div>
            <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
              <button
                className="nodrag"
                onClick={(e) => { e.stopPropagation(); handleDownload(); }}
                style={{ flex: 1, padding: '3px 6px', fontSize: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-card-body)', color: 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer' }}
                title={
                  localFormat === 'web'
                    ? '在浏览器新标签页打开渲染后的网页'
                    : localFormat === 'tencentDocs'
                    ? '导出到腾讯文档（首次需输入 MCP token）'
                    : '下载为文件'
                }
              >{
                localFormat === 'web'
                  ? '🌐 浏览器打开'
                  : localFormat === 'tencentDocs'
                  ? '☁️ 导出腾讯文档'
                  : '⬇️ 下载'
              }</button>
              <button
                className="nodrag"
                onClick={(e) => { e.stopPropagation(); handleCopy(); }}
                style={{ flex: 1, padding: '3px 6px', fontSize: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-card-body)', color: 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer' }}
                title="复制到剪贴板"
              >📋 复制</button>
              <button
                className="nodrag"
                onClick={(e) => { e.stopPropagation(); handleClear(); }}
                style={{ padding: '3px 6px', fontSize: '10px', border: '1px solid var(--border-color)', background: 'var(--bg-card-body)', color: 'var(--text-primary)', borderRadius: '4px', cursor: 'pointer' }}
                title="清空输出"
              >🗑</button>
            </div>
            {localFormat === 'tencentDocs' && (data as any).tencentDocs?.lastUrl && (
              <div style={{ marginTop: 6, fontSize: 11 }}>
                <a
                  href={(data as any).tencentDocs.lastUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="nodrag"
                  onClick={(e) => e.stopPropagation()}
                  style={{ color: 'var(--accent)', wordBreak: 'break-all' }}
                >
                  ☁️ 上次导出 · 点击打开
                </a>
              </div>
            )}
          </>
        ) : null}

        {data.status === 'running' && (
          <div style={{ fontSize: '11px', color: '#3b82f6', marginTop: '4px' }}>⏳ 生成中...</div>
        )}
        {data.status === 'success' && (
          <div style={{ fontSize: '11px', color: '#10b981', marginTop: '4px' }}>✅ 输出完成</div>
        )}
        {data.status === 'error' && (
          <div style={{ fontSize: '11px', color: '#ef4444', marginTop: '4px' }}>
            ❌ {(data.error || '未知错误').toString().substring(0, 30)}
          </div>
        )}
      </div>
    </div>
  );
}

export default OutputNode;
