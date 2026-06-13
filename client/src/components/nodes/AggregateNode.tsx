/**
 * AggregateNode · 成品聚合节点（v2.0 Phase B 步 4）
 * ---------------------------------------------------------------
 * 把多个上游节点的输出按"章节"聚合成一份成品并导出：
 *   - PPTX：每章一页幻灯（标题 + 要点）
 *   - PDF ：每章一页
 *   - DOCX / Markdown / Web：每章一个标题段
 *
 * 多上游聚合顺序：executeFlow 用 collectUpstream 按 promptNumber 升序拼接，
 * 各上游之间插入 SECTION_DELIM；本节点导出时用 parseSections 还原成章节。
 *
 * 设计原则：导出逻辑全部走 utils/exporters.ts（动态 import，不进主包）。
 */
import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';
import { pullUpstreamChunks } from '../../utils/pullUpstream';
import {
  AGGREGATE_FORMAT_OPTIONS,
  type AggregateFormat,
  type AggregateNodeData,
} from '../../types/nodes';

/** 与 executeFlow aggregate 分支一致的章节分隔符 */
const SECTION_DELIM = '\n\n<<<PLOTMESH_SECTION>>>\n\n';
/** 剥上游文件前缀（__PM_IMAGES__ / __PM_FILE__），与 Canvas.stripFilePrefix 等价 */
function stripFilePrefix(s: string): string {
  let out = s;
  const imgMatch = out.match(/^__PM_IMAGES__\n[^\n]*\n/);
  if (imgMatch) out = out.slice(imgMatch[0].length);
  if (out.startsWith('__PM_FILE__\n')) out = out.replace(/^__PM_FILE__\n/, '');
  return out;
}

type Props = {
  id: string;
  data: AggregateNodeData;
  selected?: boolean;
  [key: string]: any;
};

function AggregateNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '成品汇总');
  const [localFormat, setLocalFormat] = useState<AggregateFormat>(data.format || 'pptx');
  const [busy, setBusy] = useState(false);

  useEffect(() => { setLocalFormat(data.format || 'pptx'); }, [data.format]);
  useEffect(() => { setLocalTitle(data.label || '成品汇总'); }, [data.label]);

  const handleFormatChange = useCallback((value: AggregateFormat) => {
    setLocalFormat(value);
    updateNodeData(id, { format: value } as any);
  }, [id, updateNodeData]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = localTitle.trim();
    if (v) updateNodeData(id, { label: v } as any);
    else setLocalTitle(data.label || '成品汇总');
  }, [id, localTitle, updateNodeData, data.label]);

  /**
   * 主动抓取上游：不跑整画布，直接读上游节点已缓存的输出，按 promptNumber 升序
   * 聚成章节（每上游=1 章节，用上游 label 作章节标题），写入 output + sectionCount。
   * 与 executeFlow 的 aggregate 分支逻辑一致。
   */
  const handlePull = useCallback(() => {
    const chunks = pullUpstreamChunks(id);
    if (chunks.length === 0) {
      updateNodeData(id, { status: 'error', error: '上游暂无内容（请先运行上游或检查连线）', output: '', sectionCount: 0 } as any);
      return;
    }
    const orderedChunks = chunks.map((c) => {
      const v = stripFilePrefix(c.text);
      const hasHeading = /^#{1,6}\s/.test(v) || /^[^\n:：]{1,24}[:：]\s*$/.test(v.split('\n')[0] || '');
      return c.label && !hasHeading ? `# ${c.label}\n${v}` : v;
    }).filter((s) => s.trim());
    const merged = orderedChunks.join(SECTION_DELIM);
    updateNodeData(id, { status: 'success', output: merged, sectionCount: orderedChunks.length, error: '' } as any);
  }, [id, updateNodeData]);

  const handleExport = useCallback(async () => {
    if (!data.output || busy) return;
    setBusy(true);
    const ts = new Date().toISOString().replace(/[:T.]/g, '-').substring(0, 19);
    const title = (data.docTitle || data.label || '成品汇总').trim();
    try {
      const ex = await import('../../utils/exporters');
      const sections = ex.parseSections(data.output, '章节');
      if (sections.length === 0) {
        alert('没有可导出的内容（上游为空）');
        return;
      }
      if (localFormat === 'pptx') {
        await ex.exportAsPptx(sections, { filename: `${title}-${ts}.pptx`, title });
      } else if (localFormat === 'pdf') {
        ex.exportSectionsAsPdf(sections, { filename: `${title}-${ts}.pdf`, title });
      } else if (localFormat === 'docx') {
        await ex.exportSectionsAsDocx(sections, { filename: `${title}-${ts}.docx`, title });
      } else if (localFormat === 'markdown') {
        const md = ex.sectionsToMarkdown(sections, title);
        const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${title}-${ts}.md`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(url);
      } else if (localFormat === 'web') {
        const md = ex.sectionsToMarkdown(sections, title);
        ex.openAsWeb(md, { title });
      }
    } catch (e: any) {
      alert('导出失败：' + (e?.message || '未知错误'));
    } finally {
      setBusy(false);
    }
  }, [data.output, data.docTitle, data.label, localFormat, busy]);

  const sectionCount = data.sectionCount ?? 0;

  return (
    <div className={`node-card ${selected ? 'selected' : ''}`} data-status={data.status || 'idle'} style={{ minWidth: 240, borderLeft: '3px solid #0ea5e9' }}>
      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #0284c7, #38bdf8)' }}>
        <span className="node-icon">📦</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || '成品汇总'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: 6, color: 'white', padding: '2px 6px', fontSize: 13, outline: 'none' }}
          />
        ) : (
          <span className="node-title" onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }} title="双击重命名" style={{ flex: 1, cursor: 'text' }}>
            {data.label || '成品汇总'}
          </span>
        )}
      </div>

      <div className="node-body" style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
          聚合多个上游 → 每个上游一个章节 → 导出成品
        </div>

        <div className="field">
          <label style={{ fontSize: 11, color: 'var(--text-secondary)', display: 'block', marginBottom: 4 }}>导出格式</label>
          <select
            className="nodrag"
            value={localFormat}
            onChange={(e) => handleFormatChange(e.target.value as AggregateFormat)}
            onClick={(e) => e.stopPropagation()}
            style={{ width: '100%', padding: '4px 8px', borderRadius: 6, border: '1px solid var(--border-color)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12 }}
          >
            {AGGREGATE_FORMAT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* 主动抓取上游：不跑整画布，直接读上游缓存聚合 */}
        <button
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); handlePull(); }}
          title="主动抓取上游各节点已生成的内容并聚合（无需运行整个画布）"
          style={{
            width: '100%', fontSize: 12, padding: '5px 8px', borderRadius: 6, cursor: 'pointer',
            border: '1px solid var(--accent)', background: 'var(--accent-bg)', color: 'var(--accent)', fontWeight: 600,
          }}
        >
          ↯ 抓取上游并聚合
        </button>

        {data.output ? (
          <>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)' }}>
              已聚合 <strong style={{ color: 'var(--accent)' }}>{sectionCount}</strong> 个章节
            </div>
            <div style={{ background: 'var(--bg-card-body)', borderRadius: 6, padding: 8, fontSize: 11, maxHeight: 90, overflow: 'auto', color: 'var(--text-secondary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {data.output.substring(0, 220)}{data.output.length > 220 ? '…' : ''}
            </div>
            <button
              className="node-action-btn nodrag"
              onClick={(e) => { e.stopPropagation(); handleExport(); }}
              disabled={busy}
              style={{ width: '100%', fontSize: 12, padding: '5px 8px', fontWeight: 600 }}
            >
              {busy ? '⏳ 生成中…' : localFormat === 'web' ? '🌐 浏览器打开' : '⬇️ 导出成品'}
            </button>
          </>
        ) : (
          <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic', padding: '8px 0', textAlign: 'center' }}>
            点「↯ 抓取上游并聚合」，或运行整个画布
          </div>
        )}

        {data.status === 'error' && data.error && (
          <div style={{ fontSize: 11, color: '#ef4444' }}>❌ {String(data.error).slice(0, 100)}</div>
        )}
      </div>
    </div>
  );
}

export default AggregateNode;
