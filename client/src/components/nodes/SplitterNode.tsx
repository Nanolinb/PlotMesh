/**
 * SplitterNode · 分叉节点
 * ---------------------------------------------------------------
 * 把上游一段文本切成 N 段，每段对应一个独立的右侧输出端子。
 * 典型用法：LLM 返回了「3 个候选方案」，分叉节点把这 3 段分别给到 3 条独立的下游链路。
 *
 * 切分模式（splitMode）：
 *   - 'auto'         自动（按内容里识别到的结构选 json-array / numbered / list / 段落）
 *   - 'json-array'   ["a", "b", "c"] 或 [{...}, {...}]
 *   - 'numbered'     "1. xxx\n2. yyy\n3. zzz"
 *   - 'list'         "- xxx\n- yyy" / "* xxx"
 *   - 'delimiter'    自定义分隔符（如 "---" / "===" / "\n\n"）
 *   - 'regex'        正则分隔
 *
 * 端子模式（portMode）：
 *   - 'auto'   按切出来的段数动态生成端子（每段一个 source）
 *   - 'manual' 用户固定 N 个端子；切出更多段则丢弃，少了给空段并显示警告
 *
 * 节点 UI 上每个端子右侧显示该段的前 20 字预览，方便连线时知道哪条线送哪段。
 *
 * 数据契约：
 *   - 上游：左侧 1 个 target handle（id="in"）
 *   - 下游：N 个 source handle，id 形如 "out__<idx>"，竖排均匀分布
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { useNodeStore } from '../../store/nodes';
import { NodeType, type OutputFormat } from '../../types/nodes';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

type SplitMode = 'auto' | 'json-array' | 'numbered' | 'list' | 'delimiter' | 'regex';

/**
 * 通用切分实现（被节点 UI 预览和执行器都用）
 * 返回的字符串数组每个元素就是一个端子要送出的内容
 */
export function splitText(
  text: string,
  mode: SplitMode,
  delimiter: string,
  regex: string,
): string[] {
  const t = (text || '').trim();
  if (!t) return [];

  // 自动模式：按可信度从高到低尝试 json → numbered → list → 段落
  if (mode === 'auto') {
    // 剥外层 markdown 代码块
    let inner = t;
    const fence = inner.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/);
    if (fence) inner = fence[1].trim();

    // 1) JSON 数组
    try {
      const data = JSON.parse(inner);
      if (Array.isArray(data) && data.length > 0) {
        return data.map((x) =>
          typeof x === 'string' ? x : JSON.stringify(x, null, 2)
        );
      }
    } catch {
      /* not json */
    }
    // 2) 编号列表 1. / 2. / 3.
    const numbered = inner.match(/(?:^|\n)\s*\d+[.、)]\s+[\s\S]*?(?=\n\s*\d+[.、)]\s+|$)/g);
    if (numbered && numbered.length >= 2) {
      return numbered.map((s) => s.replace(/^\s*\d+[.、)]\s+/, '').trim());
    }
    // 3) 无序列表 - / *
    const bullets = inner.match(/(?:^|\n)\s*[-*]\s+[\s\S]*?(?=\n\s*[-*]\s+|$)/g);
    if (bullets && bullets.length >= 2) {
      return bullets.map((s) => s.replace(/^\s*[-*]\s+/, '').trim());
    }
    // 4) 段落（双换行）
    const paras = inner.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    if (paras.length >= 2) return paras;
    // 兜底：整段当一项
    return [inner];
  }

  if (mode === 'json-array') {
    // 兼容外层代码块包裹
    let inner = t;
    const fence = inner.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/);
    if (fence) inner = fence[1].trim();
    try {
      const data = JSON.parse(inner);
      if (Array.isArray(data)) {
        return data.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 2)));
      }
      return [];
    } catch {
      return [];
    }
  }

  if (mode === 'numbered') {
    const m = t.match(/(?:^|\n)\s*\d+[.、)]\s+[\s\S]*?(?=\n\s*\d+[.、)]\s+|$)/g);
    if (!m) return [t];
    return m.map((s) => s.replace(/^\s*\d+[.、)]\s+/, '').trim());
  }

  if (mode === 'list') {
    const m = t.match(/(?:^|\n)\s*[-*]\s+[\s\S]*?(?=\n\s*[-*]\s+|$)/g);
    if (!m) return [t];
    return m.map((s) => s.replace(/^\s*[-*]\s+/, '').trim());
  }

  if (mode === 'delimiter') {
    const sep = delimiter || '---';
    return t.split(sep).map((s) => s.trim()).filter(Boolean);
  }

  if (mode === 'regex') {
    try {
      const re = new RegExp(regex || '\\n\\n');
      return t.split(re).map((s) => s.trim()).filter(Boolean);
    } catch {
      return [t];
    }
  }

  return [t];
}

function SplitterNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  // 当端子数变化时通知 React Flow 重新计算 handle 位置（否则连线会连到旧位置）
  const updateNodeInternals = useUpdateNodeInternals();

  const splitMode: SplitMode = (data.splitMode as SplitMode) || 'auto';
  const portMode: 'auto' | 'manual' = data.portMode || 'auto';
  const manualCount: number = Math.max(1, Math.min(20, data.manualCount ?? 3));
  const delimiter: string = data.delimiter ?? '---';
  const regex: string = data.regex ?? '\\n\\n';
  const upstreamText: string = data.upstreamText || '';
  // 「自动模式」下用户点过"生成"按钮后定下来的端子数。
  // 不跟着 segments.length 实时变，避免 LLM 输出抖动时下游边乱接。
  // segments.length 与它不一致时按钮显示 ↻ 提示重新生成。
  const autoCommittedCount: number | undefined = data.autoCommittedCount;
  // 预览框高度（用户拉伸后的持久化值）
  const previewHeight: number = data.previewHeight || 120;

  // 标题编辑
  const [editingTitle, setEditingTitle] = useState(false);
  const [localLabel, setLocalLabel] = useState(data.label || '分叉');
  useEffect(() => { setLocalLabel(data.label || '分叉'); }, [data.label]);
  const commitLabel = useCallback(() => {
    setEditingTitle(false);
    if (localLabel.trim()) updateNodeData(id, { label: localLabel.trim() } as any);
    else setLocalLabel(data.label || '分叉');
  }, [id, localLabel, updateNodeData, data.label]);

  // 当前预览到的切分结果（用上游最近一次的文本算）
  const segments = useMemo(() => splitText(upstreamText, splitMode, delimiter, regex), [upstreamText, splitMode, delimiter, regex]);

  /**
   * 主动从上游"抓取"一次内容并刷新 upstreamText / autoCommittedCount。
   * 不触发整画布执行 —— 直接读 store 里上游节点已有的输出/文本。
   * 适用场景：上游 textPrompt 被改过、或 LLM 节点之前已经跑过有 output，
   * 用户只想刷新分叉节点端子数，不愿意再跑一遍整个流程。
   *
   * 读取规则（按节点类型）：
   *   textPrompt   → data.text
   *   llm          → data.output 或 data.streamOutput
   *   textTransform → data.output
   *   splitter     → 若边有 sourceHandle=out__<i>，按段索引取该段；否则取 segments[0]
   *   timeline     → 节点已渲染的 lines 没保存，回退取 data.upstreamText
   *   condition    → data.upstreamText（透传）
   *   fileUpload   → 把 data.files[].content 拼起来（带 <documents> 包装）
   *   group/output → 不直接抓（取它们的 data.output 兜底）
   *
   * 多条上游边：取最后一条非空的（与执行器行为一致）。
   */
  const pullUpstream = useCallback(() => {
    const state = useNodeStore.getState();
    const allNodes = state.nodes as any[];
    const allEdges = state.edges as any[];
    // 找所有指向本节点的边。
    // ⚠ v2.0 修复：按源节点 data.promptNumber 升序排序（与 executeFlow 的 collectUpstream 一致）。
    //   之前用原始边数组顺序 → 用户只改文本节点编号、内容不变时，combined 结果完全相同，
    //   导致"改了编号却抓不出新顺序"。现在编号决定合并顺序，改编号后再抓取即生效。
    const incoming = allEdges
      .filter((e) => e.target === id)
      .map((e: any, idx: number) => {
        const src = allNodes.find((n: any) => n.id === e.source);
        const pn = src?.data?.promptNumber;
        return { e, src, sortKey: typeof pn === 'number' ? pn : Number.MAX_SAFE_INTEGER, tieBreak: idx };
      })
      .sort((a, b) => (a.sortKey - b.sortKey) || (a.tieBreak - b.tieBreak));
    let combined = '';
    incoming.forEach(({ e, src }) => {
      if (!src) return;
      const sd: any = src.data || {};
      let val = '';
      switch (sd.type) {
        case 'textPrompt':
          val = sd.text || '';
          break;
        case 'llm':
          val = sd.output || sd.streamOutput || '';
          break;
        case 'textTransform':
          val = sd.output || '';
          break;
        case 'splitter': {
          // 如果边指定了 sourceHandle out__<i>，取该段；否则用整段 upstreamText 的第 0 段
          const segs = splitText(
            sd.upstreamText || '',
            (sd.splitMode as SplitMode) || 'auto',
            sd.delimiter || '---',
            sd.regex || '\\n\\n'
          );
          if (e.sourceHandle && /^out__\d+$/.test(e.sourceHandle)) {
            const idx = parseInt(e.sourceHandle.replace('out__', ''), 10);
            val = segs[idx] || '';
          } else {
            val = segs[0] || '';
          }
          break;
        }
        case 'condition':
        case 'timeline':
          val = sd.upstreamText || '';
          break;
        case 'fileUpload': {
          const files = (sd.files || []).filter((f: any) => !f.error && !f.uploading);
          if (files.length) {
            const parts = files.map((f: any) => {
              const filenameAttr = (f.name || f.originalName || '').replace(/"/g, '&quot;');
              const body = f.content || '[文件内容暂未解析]';
              return `<document filename="${filenameAttr}">\n${body}\n</document>`;
            });
            val = `<documents>\n${parts.join('\n')}\n</documents>`;
          }
          break;
        }
        default:
          val = sd.output || sd.text || sd.upstreamText || '';
      }
      if (val) combined = combined ? `${combined}\n${val}` : val;
    });

    // 写回 upstreamText 并固化端子数（按当前切出的段数）
    const segs = splitText(combined, splitMode, delimiter, regex);
    const next = Math.max(1, Math.min(20, segs.length || 1));

    // ─── v1.6.0-β12 自动派生 OutputNode（增量补齐 / 删多余） ───────────────────
    // autoOutputs 关 → 只更新 splitter 自己；
    // autoOutputs 开 → 在 setNodes 里同步：
    //   - 已派生 ≥ N：删除多出来的（含相关 edge）
    //   - 已派生 < N：补齐缺的（带默认布局 + 自动连边 splitter#out__i → output#i）
    //   - 已派生 ≤ N 但有的节点被用户删了：跳过缺失项，正常补齐到 N
    const autoOutputs: boolean = data.autoOutputs !== false; // 默认开
    const layout: 'right-vertical' | 'bottom-horizontal' = data.outputLayout || 'right-vertical';
    const labelMode: 'index' | 'preview' = data.outputLabelMode || 'index';
    const prevDerived: string[] = Array.isArray(data.derivedOutputIds) ? data.derivedOutputIds : [];

    if (!autoOutputs) {
      updateNodeData(id, {
        upstreamText: combined,
        autoCommittedCount: next,
      } as any);
      return;
    }

    // 计算新派生节点位置：splitter 自身位置 + 偏移
    // ⚠ React Flow v12：普通节点的 store 顶层 width/height 一般是 undefined（只有 group 节点
    //   会主动写）；真实尺寸在 n.measured.{width,height} 里。这里优先取 measured，
    //   兜底给 splitter 一个偏大的估值（含预览框 + 控件，约 320px 高）。
    const splitterNode = allNodes.find((n: any) => n.id === id);
    const baseX = splitterNode?.position?.x ?? 0;
    const baseY = splitterNode?.position?.y ?? 0;
    const splitterW =
      (typeof splitterNode?.width === 'number' ? splitterNode.width : null)
      ?? splitterNode?.measured?.width
      ?? 240;
    const splitterH =
      (typeof splitterNode?.height === 'number' ? splitterNode.height : null)
      ?? splitterNode?.measured?.height
      ?? 320;

    // 派生节点位置（v1.6.0-β13 修正）：
    //   核心目标 = "互不遮挡 + 尽量靠近"。
    //   - 右侧纵向：节点间最小间距 OUTPUT_H + GAP（不重叠），整体堆叠**居中对齐 splitter 中心**
    //     不再死磕 "y 中心对齐 source handle 中心"——N>4 时 handle 间距 < OUTPUT_H 必然重叠
    //   - 底部横向：节点间距固定 OUTPUT_W + GAP，整体水平居中对齐 splitter 中心
    //   x/y 对齐策略让连线呈"扇形"分布，视觉自然
    const OUTPUT_W = 224;     // OutputNode 大致宽度（实测 ~220，留点余量）
    const OUTPUT_H = 218;     // OutputNode 大致高度（实测 ~213）
    const GAP = 10;           // 节点间视觉缝（很小，让堆叠紧凑）
    const computePos = (idx: number, total: number): { x: number; y: number } => {
      const n = Math.max(1, total);
      if (layout === 'bottom-horizontal') {
        // 整体水平居中：起点 x = splitter 中心 - 总宽/2
        const totalW = n * OUTPUT_W + (n - 1) * GAP;
        const splitterCenterX = baseX + splitterW / 2;
        const startX = splitterCenterX - totalW / 2;
        return {
          x: Math.round(startX + idx * (OUTPUT_W + GAP)),
          y: baseY + splitterH + 24,
        };
      }
      // right-vertical：整体垂直居中堆叠
      const totalH = n * OUTPUT_H + (n - 1) * GAP;
      const splitterCenterY = baseY + splitterH / 2;
      const startY = splitterCenterY - totalH / 2;
      return {
        x: baseX + splitterW + 24,
        y: Math.round(startY + idx * (OUTPUT_H + GAP)),
      };
    };

    const labelOf = (segIdx: number, seg: string | undefined): string => {
      if (labelMode === 'preview' && seg) {
        const head = seg.replace(/\s+/g, ' ').trim().slice(0, 8);
        return head ? `📤 ${head}` : `📤 输出 #${segIdx + 1}`;
      }
      return `📤 输出 #${segIdx + 1}`;
    };

    // 现存于画布的派生节点 id 子集（可能用户删过几个）
    const stillExist = prevDerived.filter((nid) => allNodes.some((n: any) => n.id === nid));

    // 1) 多出来的派生节点：删除节点 + 相关 edge
    const toDelete = stillExist.slice(next);
    const toKeep = stillExist.slice(0, next);

    // 2) 不够的：补齐到 next 个
    const newIds: string[] = [];
    while (toKeep.length + newIds.length < next) {
      const idx = toKeep.length + newIds.length;
      newIds.push(`output-${Date.now().toString(36)}-${idx}-${Math.random().toString(36).slice(2, 6)}`);
    }

    // 3) 计算最终派生 id 列表
    const finalDerived = [...toKeep, ...newIds];

    // 一次性 setState：原子更新 nodes / edges / splitter data
    useNodeStore.setState((s: any) => {
      // 删除多余 output + 清掉指向它们的 edges
      const nodesAfterDelete = s.nodes.filter((n: any) => !toDelete.includes(n.id));
      const edgesAfterDelete = s.edges.filter((e: any) => !toDelete.includes(e.target) && !toDelete.includes(e.source));

      // 创建新 output 节点
      const createdOutputs = newIds.map((nid, i) => {
        const segIdx = toKeep.length + i;
        const seg = segs[segIdx];
        const pos = computePos(segIdx, next);
        return {
          id: nid,
          type: 'output',
          position: pos,
          data: {
            type: NodeType.OUTPUT,
            label: labelOf(segIdx, seg),
            format: 'markdown' as OutputFormat,
            status: 'idle',
            output: seg || '',
          },
        } as any;
      });

      // 给所有 finalDerived 重新写一遍 label + output（用户改过段数后要刷新 label 和段内容）
      // 注意：OutputNode 的 output 字段在画布执行时会被覆盖，这里只是\"抓取生成\"时同步把当前段写进去，
      // 让用户立刻能看到该 output 节点对应哪段内容（不需要再跑一遍画布）。
      // 同时**重新布局位置** —— 用户可能切换了 outputLayout（右侧纵向 ↔ 底部横向），
      // 复用的现存节点也应该按新布局重排，否则一切就乱。
      const nodesAfterLabel = nodesAfterDelete.map((n: any) => {
        const idx = finalDerived.indexOf(n.id);
        if (idx < 0) return n;
        const newLabel = labelOf(idx, segs[idx]);
        const newOutput = segs[idx] || '';
        const newPos = computePos(idx, next);
        const labelEqual = n.data?.label === newLabel;
        const outputEqual = n.data?.output === newOutput;
        const posEqual = n.position?.x === newPos.x && n.position?.y === newPos.y;
        if (labelEqual && outputEqual && posEqual) return n;
        return {
          ...n,
          position: newPos,
          data: { ...n.data, label: newLabel, output: newOutput },
        };
      });

      // 边：每个 finalDerived[i] 应该有边 splitter#out__i -> output#in
      const edgeIdOf = (oi: string, idx: number) => `e-split-${id}-${idx}-${oi}`;
      // 先剔除\"指向 finalDerived 但 sourceHandle 不对\"的旧边（避免重复）
      const filteredEdges = edgesAfterDelete.filter((e: any) => {
        if (!finalDerived.includes(e.target)) return true;
        if (e.source !== id) return true;
        // 同 splitter → finalDerived，但 sourceHandle/target 错位的统统重建
        return false;
      });
      // ⚠ 不传 targetHandle：OutputNode 的 target Handle 没有显式 id（OutputNode.tsx 里就是
      //   `<Handle type=\"target\" position={Position.Left} />`），React Flow v12 对未指定 id
      //   的 handle 用 null 当 key，传字符串 \"in\" 反而匹配不上 → 边创建后不渲染连线。
      //   省略 targetHandle 让 RF 自动落在节点的默认 target handle 上。
      const newEdges = finalDerived.map((oid, idx) => ({
        id: edgeIdOf(oid, idx),
        source: id,
        sourceHandle: `out__${idx}`,
        target: oid,
      } as any));

      // 更新 splitter 自己的 data
      const finalNodes = [...nodesAfterLabel, ...createdOutputs].map((n: any) => {
        if (n.id !== id) return n;
        return {
          ...n,
          data: {
            ...n.data,
            upstreamText: combined,
            autoCommittedCount: next,
            derivedOutputIds: finalDerived,
          },
        };
      });

      return {
        nodes: finalNodes,
        edges: [...filteredEdges, ...newEdges],
      };
    });
  }, [id, updateNodeData, splitMode, delimiter, regex, data.autoOutputs, data.outputLayout, data.outputLabelMode, data.derivedOutputIds]);

  /**
   * 重置分叉节点：清空已抓取的上游缓存 + 端子数，并删除自动派生的 OutputNode 及连边。
   * 适用场景：
   *   - 上游结构/编号大改后想从干净状态重抓
   *   - 自动派生的输出节点连乱了想清掉重来
   * 不影响上游节点本身，只清本分叉的"抓取产物"。
   */
  const resetSplitter = useCallback(() => {
    const prevDerived: string[] = Array.isArray(data.derivedOutputIds) ? data.derivedOutputIds : [];
    useNodeStore.setState((s: any) => {
      // 删掉派生的 output 节点 + 任何与之相连的边
      const nodesAfter = s.nodes.filter((n: any) => !prevDerived.includes(n.id));
      const edgesAfter = s.edges.filter(
        (e: any) => !prevDerived.includes(e.target) && !prevDerived.includes(e.source)
      );
      // 清空 splitter 自己的抓取缓存
      const finalNodes = nodesAfter.map((n: any) => {
        if (n.id !== id) return n;
        return {
          ...n,
          data: {
            ...n.data,
            upstreamText: '',
            autoCommittedCount: 0,
            derivedOutputIds: [],
            status: 'idle',
          },
        };
      });
      return { nodes: finalNodes, edges: edgesAfter };
    });
  }, [id, data.derivedOutputIds]);

  // 实际渲染的端子数：
  //   manual → 用户固定 N
  //   auto   → 用户点过"生成"按钮的 autoCommittedCount；没点过时给 1（占位）
  const portCount = portMode === 'manual'
    ? manualCount
    : (autoCommittedCount && autoCommittedCount > 0 ? autoCommittedCount : 1);

  // 是否已有"抓取产物"（缓存文本 / 已固化端子数 / 派生节点）→ 决定是否显示重置按钮
  const hasCapture = !!(data.upstreamText || (autoCommittedCount && autoCommittedCount > 0)
    || (Array.isArray(data.derivedOutputIds) && data.derivedOutputIds.length > 0));

  // 端子数 / 布局变化 → 通知 React Flow 重新读取 handle DOM 位置。
  // 不加这一步的话，刚增/减出来的 handle 或 Position 切换（Right ↔ Bottom）会有
  // "视觉位置 ≠ 真实连线锚点"的错位。
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, portCount, data.outputLayout, updateNodeInternals]);

  // auto 模式下：当前切出的段数和已生成的端子数不一致 → 提示用户点 ↻ 重新生成
  const autoNeedsRegen = portMode === 'auto'
    && segments.length > 0
    && segments.length !== autoCommittedCount;

  // 警告：手动模式下段数 ≠ 端子数
  const warning = portMode === 'manual' && segments.length > 0 && segments.length !== manualCount
    ? `切出 ${segments.length} 段 / ${manualCount} 个端子`
    : '';

  return (
    <div
      className={`node-card splitter-node ${selected ? 'selected' : ''}`}
      data-status={data.status || 'idle'}
      style={{ minWidth: 240 }}
    >
      <Handle type="target" position={Position.Left} id="in" />
      {/*
        v1.6.0-β14：source handle 位置随 outputLayout 切换
        - right-vertical（默认）→ 右边竖排（Position.Right + top: %）
        - bottom-horizontal     → 底部横排（Position.Bottom + left: %）
        让派生的 OutputNode 与 splitter 的 source handle 在同一边，连线更顺。
      */}
      {Array.from({ length: portCount }).map((_, idx) => {
        const isBottom = (data.outputLayout || 'right-vertical') === 'bottom-horizontal';
        const pct = ((idx + 1) / (portCount + 1)) * 100;
        return (
          <Handle
            key={`out-${idx}`}
            type="source"
            position={isBottom ? Position.Bottom : Position.Right}
            id={`out__${idx}`}
            style={isBottom ? { left: `${pct}%` } : { top: `${pct}%` }}
            title={`第 ${idx + 1} 段：${(segments[idx] || '').slice(0, 50)}${(segments[idx] || '').length > 50 ? '…' : ''}`}
          />
        );
      })}

      {/* 标题栏 */}
      <div
        className="node-header"
        style={{ background: 'linear-gradient(135deg, #ec4899, #f472b6)' }}
      >
        <span className="node-icon">🔀</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLabel();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalLabel(data.label || '分叉'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: 6, color: 'white', padding: '2px 6px', fontSize: 13 }}
          />
        ) : (
          <span
            className="node-title"
            onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
            title="双击重命名"
            style={{ flex: 1, cursor: 'text' }}
          >
            {data.label || '分叉'}
          </span>
        )}
      </div>

      <div className="node-body">
        {/* 切分模式 */}
        <div className="field" style={{ marginBottom: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', display: 'block', marginBottom: 3 }}>切分模式</label>
          <select
            className="nodrag"
            value={splitMode}
            onChange={(e) => updateNodeData(id, { splitMode: e.target.value } as any)}
            style={{ width: '100%', padding: '3px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}
          >
            <option value="auto">自动（识别 JSON / 编号 / 列表 / 段落）</option>
            <option value="json-array">JSON 数组</option>
            <option value="numbered">编号列表（1. 2. 3.）</option>
            <option value="list">无序列表（- / *）</option>
            <option value="delimiter">自定义分隔符</option>
            <option value="regex">正则分隔</option>
          </select>
        </div>

        {/* 自定义分隔符 / 正则的输入框 */}
        {splitMode === 'delimiter' && (
          <div className="field" style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', display: 'block', marginBottom: 3 }}>分隔符（如 ---、===、||）</label>
            <input
              className="nodrag"
              value={delimiter}
              onChange={(e) => updateNodeData(id, { delimiter: e.target.value } as any)}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              style={{ width: '100%', padding: '3px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}
            />
          </div>
        )}
        {splitMode === 'regex' && (
          <div className="field" style={{ marginBottom: 6 }}>
            <label style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', display: 'block', marginBottom: 3 }}>正则（默认按双换行）</label>
            <input
              className="nodrag"
              value={regex}
              onChange={(e) => updateNodeData(id, { regex: e.target.value } as any)}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              placeholder="\\n\\n"
              style={{ width: '100%', padding: '3px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, fontFamily: 'monospace' }}
            />
          </div>
        )}

        {/* 输出端子数量 — 排版与"切分模式"一致：label 在上，模式选择 + 数字/按钮在下一行 */}
        <div className="field" style={{ marginBottom: 6 }}>
          <label style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', display: 'block', marginBottom: 3 }}>输出端子数量</label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <select
              className="nodrag"
              value={portMode}
              onChange={(e) => updateNodeData(id, { portMode: e.target.value } as any)}
              style={{ flex: 1, padding: '3px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}
            >
              <option value="auto">自动（按段数）</option>
              <option value="manual">手动（固定 N）</option>
            </select>
            {portMode === 'manual' ? (
              <input
                className="nodrag"
                type="number"
                min={1}
                max={20}
                value={manualCount}
                onChange={(e) => updateNodeData(id, { manualCount: parseInt(e.target.value || '3', 10) } as any)}
                onKeyDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
                style={{ width: 56, padding: '3px 6px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12 }}
              />
            ) : (
              <button
                className="nodrag"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  // 主动抓取一次上游内容并用当前段数刷新端子数。
                  // 不需要触发画布全量运行——直接读 store 里上游节点已有的 output / text。
                  pullUpstream();
                }}
                title={
                  autoNeedsRegen
                    ? `切出 ${segments.length} 段，但当前是 ${autoCommittedCount ?? 0} 个端子。点击重新抓取上游并生成。`
                    : `主动抓取上游内容并按段数生成端子（当前 ${segments.length} 段）`
                }
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 6,
                  border: '1px solid ' + (autoNeedsRegen ? '#f59e0b' : '#d1d5db'),
                  background: autoNeedsRegen ? '#fef3c7' : 'var(--bg-card-body, #fff)',
                  color: autoNeedsRegen ? '#92400e' : 'var(--text-primary, #1f2937)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {autoNeedsRegen ? `↻ 重新抓取 (${segments.length})` : `▶ 抓取并生成 (${segments.length || 0})`}
              </button>
            )}
            {/* 重置：清空抓取缓存 + 删除自动派生的输出节点（两种端子模式下都可用） */}
            {hasCapture && (
              <button
                className="nodrag"
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (confirm('重置分叉节点？\n将清空已抓取的上游内容、端子数，并删除自动派生的输出节点（上游节点不受影响）。')) {
                    resetSplitter();
                  }
                }}
                title="重置：清空抓取缓存 + 删除自动派生的输出节点"
                style={{
                  fontSize: 11,
                  padding: '3px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-color, #d1d5db)',
                  background: 'var(--bg-card-body, #fff)',
                  color: 'var(--text-secondary, #64748b)',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                ⟲ 重置
              </button>
            )}
          </div>
        </div>

        {/* v1.6.0-β12 自动派生 OutputNode 配置行 */}
        <div
          className="nodrag"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginTop: 6,
            padding: '6px 8px',
            background: 'rgba(99,102,241,0.06)',
            border: '1px dashed rgba(99,102,241,0.35)',
            borderRadius: 6,
            fontSize: 11,
            color: 'var(--text-secondary, #475569)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <label
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
            title="开启后：每次「抓取并生成」按钮按下时自动派生 N 个 OutputNode 并连边。&#10;增量补齐 / 段数变少自动删多余。"
          >
            <input
              type="checkbox"
              checked={data.autoOutputs !== false}
              onChange={(e) => updateNodeData(id, { autoOutputs: e.target.checked } as any)}
              style={{ margin: 0 }}
            />
            <span>自动接输出节点</span>
          </label>

          {data.autoOutputs !== false && (
            <>
              <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title="输出节点的排列方向">
                布局
                <select
                  value={data.outputLayout || 'right-vertical'}
                  onChange={(e) => updateNodeData(id, { outputLayout: e.target.value } as any)}
                  style={{ fontSize: 11, padding: '0 2px' }}
                >
                  <option value="right-vertical">右侧纵向</option>
                  <option value="bottom-horizontal">底部横向</option>
                </select>
              </label>

              <label
                style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
                title="标题策略：&#10;· 编号 = 固定显示『输出 #1 / #2』整齐&#10;· 前 8 字 = 自动取该段开头 8 个字（适合每段开头有明确小标题时使用）"
              >
                标题
                <select
                  value={data.outputLabelMode || 'index'}
                  onChange={(e) => updateNodeData(id, { outputLabelMode: e.target.value } as any)}
                  style={{ fontSize: 11, padding: '0 2px' }}
                >
                  <option value="index">编号</option>
                  <option value="preview">前 8 字</option>
                </select>
              </label>
            </>
          )}
        </div>

        {/* 预览 + 警告（外层 div 支持垂直拖拽 resize；高度持久化到 data.previewHeight） */}
        <div
          className="nodrag nowheel"
          style={{
            background: '#fdf2f8',
            borderRadius: 6,
            padding: '6px 8px',
            fontSize: 11,
            color: '#9d174d',
            marginTop: 4,
            height: previewHeight,
            minHeight: 60,
            maxHeight: 600,
            resize: 'vertical',
            overflow: 'auto',
            // 用户停止拖拽（mouseup）时把高度写回 store
          }}
          onMouseUp={(e) => {
            // offsetHeight 不受 React Flow viewport 的 transform 缩放影响（getBoundingClientRect 会受影响）
            const h = (e.currentTarget as HTMLDivElement).offsetHeight;
            const rounded = Math.max(60, Math.min(600, Math.round(h)));
            if (rounded !== previewHeight) {
              updateNodeData(id, { previewHeight: rounded } as any);
            }
          }}
        >
          {segments.length === 0 ? (
            <em style={{ color: '#94a3b8' }}>等待上游输入…</em>
          ) : (
            <>
              <div style={{ marginBottom: 4 }}>
                共 {segments.length} 段 · {portCount} 个端子
                {warning && <span style={{ color: '#dc2626', marginLeft: 6 }}>⚠ {warning}</span>}
              </div>
              {segments.map((seg, i) => (
                <div key={i} style={{ marginTop: 2, lineHeight: 1.4, display: 'flex', gap: 4 }}>
                  <span style={{ color: '#be185d', fontWeight: 600, minWidth: 16 }}>{i + 1}.</span>
                  <span
                    style={{
                      // 拉高时显示完整内容（保留换行）；只在单行时省略
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      flex: 1,
                    }}
                  >
                    {seg}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>

        {data.status === 'running' && (
          <div style={{ fontSize: 11, color: '#3b82f6', marginTop: 4 }}>⏳ 切分中...</div>
        )}
        {data.status === 'error' && (
          <div style={{ fontSize: 11, color: '#ef4444', marginTop: 4 }}>❌ {(data.error || '').toString().slice(0, 30)}</div>
        )}
      </div>
    </div>
  );
}

export default SplitterNode;
