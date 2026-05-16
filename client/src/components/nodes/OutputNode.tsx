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
      alert('导出失败：' + (e?.message || '未知错误'));
    }
  }, [data.output, data.label, localFormat]);

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
                title="下载为文件"
              >⬇️ 下载</button>
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
