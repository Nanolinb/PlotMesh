/**
 * server/src/runner/runCanvas.js · v1.7 P1
 * ----------------------------------------------------------------
 * 拓扑排序 + 调度 nodeRunners 跑完整画布。
 * 对应前端 Canvas.tsx:executeFlow 的"调度部分"（节点执行委托给 nodeRunners）。
 *
 * 输入：canvas { nodes, edges } + ctx { onLog, onNodeStatus, onNodeData }
 * 输出：{ ok, results: Map<nodeId, output>, errors }
 *
 * 折叠 group 处理、condition 分支跳过、splitter 端口结果分发逻辑，
 * 必须跟前端 executeFlow 1:1 对齐。
 */
import { runNode } from './nodeRunners.js';

const FILE_PREFIX = '__PM_FILE__\n';

function parsePort(id) {
  if (!id || typeof id !== 'string') return null;
  const parts = id.split('__');
  if (parts.length < 3) return null;
  const role = parts[0] === 'in' ? 'in' : parts[0] === 'out' ? 'out' : null;
  if (!role) return null;
  const handle = parts[parts.length - 1];
  const childId = parts.slice(1, -1).join('__');
  return { role, childId, handle: handle || null };
}

/**
 * @param {{nodes:any[], edges:any[]}} canvas
 * @param {{
 *   onLog?: (msg:string)=>void,
 *   onNodeStatus?: (nodeId:string, status:string, dataPatch?:any) => void,
 *   onNodeData?: (nodeId:string, dataPatch:any) => void,
 *   subsetIds?: Set<string>,
 *   ctx?: any
 * }} options
 */
export async function runCanvas(canvas, options = {}) {
  const log = options.onLog || (() => {});
  const setStatus = options.onNodeStatus || (() => {});
  const setData = options.onNodeData || (() => {});
  const subsetIds = options.subsetIds;
  const ctx = options.ctx || {};

  const allNodesRaw = canvas.nodes || [];
  const allEdgesRaw = canvas.edges || [];

  // 折叠 group 处理（同前端 executeFlow）
  const collapsedGroups = new Set(
    allNodesRaw.filter((n) => n.type === 'group' && n.data?.collapsed).map((n) => n.id),
  );
  const allEdges = allEdgesRaw.map((e) => {
    let next = { ...e };
    if (collapsedGroups.has(e.target)) {
      const p = parsePort(e.targetHandle);
      if (p && p.role === 'in') {
        next.target = p.childId;
        next.targetHandle = p.handle;
      }
    }
    if (collapsedGroups.has(e.source)) {
      const p = parsePort(e.sourceHandle);
      if (p && p.role === 'out') {
        next.source = p.childId;
        next.sourceHandle = p.handle;
      }
    }
    return next;
  });
  const allNodesPostCollapse = allNodesRaw.filter(
    (n) => !(n.type === 'group' && n.data?.collapsed),
  );
  const allNodes = subsetIds
    ? allNodesPostCollapse.filter((n) => subsetIds.has(n.id))
    : allNodesPostCollapse;
  const filteredEdges = subsetIds
    ? allEdges.filter((e) => subsetIds.has(e.source) && subsetIds.has(e.target))
    : allEdges;

  log(`开始执行：${allNodes.length} 个节点 / ${filteredEdges.length} 条边`);

  // 拓扑
  const adj = new Map();
  const inDegree = new Map();
  allNodes.forEach((n) => {
    adj.set(n.id, []);
    inDegree.set(n.id, 0);
  });
  filteredEdges.forEach((e) => {
    if (adj.has(e.source)) adj.get(e.source).push(e.target);
    inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
  });
  const queue = [];
  allNodes.forEach((n) => {
    if ((inDegree.get(n.id) || 0) === 0) queue.push(n.id);
  });

  const results = new Map();
  // 对 splitter 端口结果：results.set(`${nodeId}__out__${idx}`, seg)
  const readResultForEdge = (e) => {
    if (e.sourceHandle) {
      const k = `${e.source}__${e.sourceHandle}`;
      const v = results.get(k);
      if (v !== undefined) return v;
    }
    return results.get(e.source);
  };

  const conditionMatched = new Map(); // nodeId → bool

  // 给 LLM 节点检测下游 output 的 format
  const computeDownstreamHints = (nodeId) => {
    const hints = {};
    const downstream = filteredEdges
      .filter((e) => e.source === nodeId)
      .map((e) => allNodes.find((n) => n.id === e.target))
      .filter((n) => n && n.data?.type === 'output');
    if (downstream.find((n) => n.data?.format === 'xlsx')) hints.xlsx = true;
    if (downstream.find((n) => n.data?.format === 'web')) hints.web = true;
    return hints;
  };

  const errors = [];
  let head = 0;
  while (head < queue.length) {
    const nodeId = queue[head];
    head++;
    const node = allNodes.find((n) => n.id === nodeId);
    if (!node) continue;
    const data = node.data;
    const label = data?.label || node.type;
    log(`处理：${label}`);

    // 收集所有上游
    const upstreamList = [];
    filteredEdges.forEach((e) => {
      if (e.target === nodeId) {
        const v = readResultForEdge(e);
        if (v !== undefined) upstreamList.push(v);
      }
    });

    setStatus(nodeId, 'running');

    try {
      const r = await runNode(node, upstreamList, {
        ...ctx,
        downstreamHints: data?.type === 'llm' ? computeDownstreamHints(nodeId) : undefined,
      });

      if (r.status === 'error') {
        errors.push({ nodeId, error: r.error });
        log(`  ❌ ${r.error}`);
        setStatus(nodeId, 'error', { error: r.error });
        results.set(nodeId, '');
      } else {
        // splitter：分发 segments 到端口
        if (r.segments) {
          const portCount = r.portCount || r.segments.length;
          for (let i = 0; i < portCount; i++) {
            results.set(`${nodeId}__out__${i}`, r.segments[i] ?? '');
          }
        }
        results.set(nodeId, r.output ?? '');
        if (data?.type === 'condition') {
          conditionMatched.set(nodeId, !!r.matched);
          log(`  🔀 ${r.matched ? '匹配' : '未匹配'}`);
        }
        setStatus(nodeId, r.status, r.dataPatch);
        if (r.dataPatch) setData(nodeId, r.dataPatch);
        log(`  ✅ ${typeof r.output === 'string' ? `${r.output.length} 字符` : 'ok'}`);
      }
    } catch (e) {
      errors.push({ nodeId, error: e.message });
      log(`  ❌ ${e.message}`);
      setStatus(nodeId, 'error', { error: e.message });
      results.set(nodeId, '');
    }

    // 推进下游：condition 节点要按 sourceHandle 过滤
    (adj.get(nodeId) || []).forEach((tid) => {
      if (data?.type === 'condition') {
        const matched = conditionMatched.get(nodeId);
        const outEdge = filteredEdges.find((e) => e.source === nodeId && e.target === tid);
        const handleId = outEdge?.sourceHandle;
        if (handleId === 'true' && !matched) {
          inDegree.set(tid, (inDegree.get(tid) || 0) - 1);
          return;
        }
        if (handleId === 'false' && matched) {
          inDegree.set(tid, (inDegree.get(tid) || 0) - 1);
          return;
        }
      }
      inDegree.set(tid, (inDegree.get(tid) || 0) - 1);
      if (inDegree.get(tid) === 0) queue.push(tid);
    });
  }

  log(errors.length === 0 ? '✅ 全部执行完成' : `⚠️ 完成（${errors.length} 个错误）`);
  return {
    ok: errors.length === 0,
    results: Object.fromEntries(results.entries()),
    errors,
  };
}
