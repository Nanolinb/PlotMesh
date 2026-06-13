/**
 * utils/pullUpstream.ts · 节点"主动抓取上游"共享工具（v2.0）
 * ---------------------------------------------------------------
 * 给「成品汇总 / 仪表盘」等汇聚型节点用：不触发整画布运行，直接读 store 里
 * 上游节点已有的输出/缓存，按 promptNumber 升序合并（与 executeFlow 的
 * collectUpstream 行为一致）。
 *
 * 适用场景：上游节点之前已经跑过（有 output / text 缓存），用户只想刷新本节点
 * 的聚合结果，不愿再跑一遍整个流程。
 *
 * 抽取自 SplitterNode.pullUpstream，统一多节点的抓取逻辑。
 */
import { useNodeStore } from '../store/nodes';

/** 读单个上游节点已缓存的输出文本（按节点类型取对应字段） */
export function readNodeCachedOutput(srcData: any, edge: any): string {
  const sd = srcData || {};
  switch (sd.type) {
    case 'textPrompt':
      return sd.text || '';
    case 'llm':
      return sd.output || sd.streamOutput || '';
    case 'textTransform':
    case 'extract':
    case 'output':
    case 'aggregate':
    case 'dashboard':
      return sd.output || '';
    case 'splitter': {
      // 若边指定了 out__<i>，取对应段；否则取整段 upstreamText
      const text = sd.upstreamText || '';
      if (edge?.sourceHandle && /^out__\d+$/.test(edge.sourceHandle)) {
        // 简单按双换行/段落切（与 splitText auto 的段落兜底一致，避免循环依赖）
        const segs = text.split(/\n\s*\n/).map((s: string) => s.trim()).filter(Boolean);
        const idx = parseInt(edge.sourceHandle.replace('out__', ''), 10);
        return segs[idx] || text;
      }
      return text;
    }
    case 'condition':
    case 'timeline':
      return sd.upstreamText || '';
    case 'webLink':
      return sd.fetchedText || '';
    case 'fileUpload': {
      const files = (sd.files || []).filter((f: any) => !f.error && !f.uploading);
      if (!files.length) return '';
      const parts = files.map((f: any) => {
        const filenameAttr = (f.name || f.originalName || '').replace(/"/g, '&quot;');
        const body = f.content || '[文件内容暂未解析]';
        return `<document filename="${filenameAttr}">\n${body}\n</document>`;
      });
      return `<documents>\n${parts.join('\n')}\n</documents>`;
    }
    default:
      return sd.output || sd.text || sd.upstreamText || '';
  }
}

export interface UpstreamChunk {
  /** 上游节点 id */
  sourceId: string;
  /** 上游节点 label（可作章节标题） */
  label: string;
  /** 上游节点 promptNumber（未编号为 undefined） */
  promptNumber?: number;
  /** 已缓存的输出文本 */
  text: string;
}

/**
 * 抓取指向 targetId 的所有上游节点的已缓存输出，按 promptNumber 升序返回。
 * 仅返回有内容的 chunk。不触发执行。
 */
export function pullUpstreamChunks(targetId: string): UpstreamChunk[] {
  const state = useNodeStore.getState();
  const allNodes = state.nodes as any[];
  const allEdges = state.edges as any[];

  return allEdges
    .filter((e) => e.target === targetId)
    .map((e: any, idx: number) => {
      const src = allNodes.find((n: any) => n.id === e.source);
      const sd = src?.data || {};
      const pn = sd.promptNumber;
      return {
        edge: e,
        src,
        sourceId: e.source,
        label: (sd.label || '').trim(),
        promptNumber: typeof pn === 'number' ? pn : undefined,
        sortKey: typeof pn === 'number' ? pn : Number.MAX_SAFE_INTEGER,
        tieBreak: idx,
      };
    })
    .sort((a, b) => (a.sortKey - b.sortKey) || (a.tieBreak - b.tieBreak))
    .map(({ edge, src, sourceId, label, promptNumber }) => ({
      sourceId,
      label,
      promptNumber,
      text: src ? readNodeCachedOutput(src.data, edge) : '',
    }))
    .filter((c) => c.text.trim());
}
