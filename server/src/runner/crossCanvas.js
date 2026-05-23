/**
 * server/src/runner/crossCanvas.js · v1.7 P2-A
 * ---------------------------------------------------------------
 * 跨画布引用 (Cross-Canvas Reference)：
 *   crossOutput 节点 → 远端画布的 crossInput 节点
 *
 * 数据模型：
 *   - 关联存在 store.json 的 payload.connections 数组里
 *     { id, srcCanvasId, srcNodeId, dstCanvasId, dstNodeId, createdAt }
 *   - 每条关联都是 1 对 1（跨画布层面）
 *   - 多对多场景靠用户在画布内连边实现
 *
 * 行为：
 *   1. 用户配 crossOutput X → 选目标画布 B + 自动 create crossInput Y
 *   2. 跑画布到 X → 写 X.data.output → server 把 output 投到 B.Y.text
 *   3. 如果 A 画布内 X → A.crossInput Z 有连线（"我在等"）
 *      → 写完 B.Y 后自动 POST B 的 run（trigger='cross-cascade'）
 *      → B 跑完，B 的某个 crossOutput 写到 A.Z.text
 *      → 触发 A 从 Z 往下重新跑
 *   4. 循环检测：traceId 跟随每次触发，深度 > 10 就停
 */
import { mutateStore, readPayload } from '../utils/storeIO.js';

/**
 * 在 store.json 上 ensure connections 字段
 * @param {*} payload
 */
function ensureConnections(payload) {
  if (!Array.isArray(payload.connections)) payload.connections = [];
}

/**
 * 列出某画布的所有 connection（作为 src 或 dst）
 */
export function listConnections(canvasId) {
  const p = readPayload();
  const conns = p.connections || [];
  return {
    asSrc: conns.filter((c) => c.srcCanvasId === canvasId),
    asDst: conns.filter((c) => c.dstCanvasId === canvasId),
  };
}

/**
 * 查询一个 src 节点目前是否已建立 connection
 */
export function findConnectionBySrc(srcCanvasId, srcNodeId) {
  const p = readPayload();
  return (p.connections || []).find(
    (c) => c.srcCanvasId === srcCanvasId && c.srcNodeId === srcNodeId,
  );
}

/**
 * 查询一个 dst 节点目前是否已建立 connection
 */
export function findConnectionByDst(dstCanvasId, dstNodeId) {
  const p = readPayload();
  return (p.connections || []).find(
    (c) => c.dstCanvasId === dstCanvasId && c.dstNodeId === dstNodeId,
  );
}

/**
 * 建立一条新关联。如果 dst 节点不存在 → 在 dst 画布自动 create 一个 crossInput
 *
 * @param {string} srcCanvasId
 * @param {string} srcNodeId
 * @param {string} dstCanvasId
 * @param {string|null} dstNodeId  传 null 则自动创建
 * @returns {{connection, createdNode?: any}}
 */
export function createConnection(srcCanvasId, srcNodeId, dstCanvasId, dstNodeId = null) {
  let createdNode = null;
  let conn = null;
  mutateStore((payload) => {
    ensureConnections(payload);
    const dstCanvas = (payload.canvases || []).find((c) => c.id === dstCanvasId && !c.deleted);
    if (!dstCanvas) throw new Error(`dst_canvas_not_found: ${dstCanvasId}`);
    const srcCanvas = (payload.canvases || []).find((c) => c.id === srcCanvasId && !c.deleted);
    if (!srcCanvas) throw new Error(`src_canvas_not_found: ${srcCanvasId}`);
    const srcNode = (srcCanvas.nodes || []).find((n) => n.id === srcNodeId);
    if (!srcNode) throw new Error(`src_node_not_found: ${srcNodeId}`);
    if ((srcNode.data?.type || srcNode.type) !== 'crossOutput') {
      throw new Error(`src_node_must_be_crossOutput`);
    }

    // 如果没指定 dstNodeId，自动 create crossInput
    if (!dstNodeId) {
      const newId = `crossInput-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      // 找一个不重叠的位置：dst 画布最右边节点 + 200
      const xs = (dstCanvas.nodes || []).map((n) => (n.position?.x || 0) + 250);
      const newX = xs.length ? Math.max(...xs) + 50 : 100;
      const newNode = {
        id: newId,
        type: 'crossInput',
        position: { x: newX, y: 100 },
        data: {
          type: 'crossInput',
          label: `🌐 ← ${srcCanvas.name || srcCanvasId}`,
          sourceCanvasId: srcCanvasId,
          sourceCanvasName: srcCanvas.name || srcCanvasId,
          sourceNodeId: srcNodeId,
          sourceNodeLabel: srcNode.data?.label || 'crossOutput',
          text: '',
          status: 'waiting',
          receivedAt: null,
        },
      };
      dstCanvas.nodes = dstCanvas.nodes || [];
      dstCanvas.nodes.push(newNode);
      dstCanvas.updatedAt = Date.now();
      createdNode = newNode;
      dstNodeId = newId;
    } else {
      // 验证 dst 节点存在且是 crossInput
      const dstNode = (dstCanvas.nodes || []).find((n) => n.id === dstNodeId);
      if (!dstNode) throw new Error(`dst_node_not_found: ${dstNodeId}`);
      if ((dstNode.data?.type || dstNode.type) !== 'crossInput') {
        throw new Error(`dst_node_must_be_crossInput`);
      }
      // 把 source 信息写到 dst 节点
      const idx = dstCanvas.nodes.findIndex((n) => n.id === dstNodeId);
      dstCanvas.nodes[idx] = {
        ...dstCanvas.nodes[idx],
        data: {
          ...dstCanvas.nodes[idx].data,
          sourceCanvasId: srcCanvasId,
          sourceCanvasName: srcCanvas.name || srcCanvasId,
          sourceNodeId: srcNodeId,
          sourceNodeLabel: srcNode.data?.label || 'crossOutput',
        },
      };
      dstCanvas.updatedAt = Date.now();
    }

    // 同时把 target 信息写回 src 节点
    const srcIdx = srcCanvas.nodes.findIndex((n) => n.id === srcNodeId);
    srcCanvas.nodes[srcIdx] = {
      ...srcCanvas.nodes[srcIdx],
      data: {
        ...srcCanvas.nodes[srcIdx].data,
        targetCanvasId: dstCanvasId,
        targetCanvasName: dstCanvas.name || dstCanvasId,
        targetNodeId: dstNodeId,
      },
    };
    srcCanvas.updatedAt = Date.now();

    // 删除任何旧的同 src 关联（一个 crossOutput 只能有一个目标）
    payload.connections = payload.connections.filter(
      (c) => !(c.srcCanvasId === srcCanvasId && c.srcNodeId === srcNodeId),
    );

    // 建新关联
    conn = {
      id: `conn-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      srcCanvasId,
      srcNodeId,
      dstCanvasId,
      dstNodeId,
      createdAt: Date.now(),
    };
    payload.connections.push(conn);
  });
  return { connection: conn, createdNode };
}

/**
 * 解除一条关联（双向清空 src/dst 节点上的链接信息）
 */
export function deleteConnection(connId) {
  let removed = null;
  mutateStore((payload) => {
    ensureConnections(payload);
    const idx = payload.connections.findIndex((c) => c.id === connId);
    if (idx < 0) throw new Error(`connection_not_found: ${connId}`);
    removed = payload.connections[idx];
    payload.connections.splice(idx, 1);

    // 清 src 节点的 target 字段
    const srcCanvas = (payload.canvases || []).find((c) => c.id === removed.srcCanvasId);
    if (srcCanvas?.nodes) {
      const i = srcCanvas.nodes.findIndex((n) => n.id === removed.srcNodeId);
      if (i >= 0) {
        const { targetCanvasId, targetCanvasName, targetNodeId, ...rest } = srcCanvas.nodes[i].data || {};
        srcCanvas.nodes[i] = { ...srcCanvas.nodes[i], data: rest };
        srcCanvas.updatedAt = Date.now();
      }
    }

    // 清 dst 节点的 source 字段
    const dstCanvas = (payload.canvases || []).find((c) => c.id === removed.dstCanvasId);
    if (dstCanvas?.nodes) {
      const i = dstCanvas.nodes.findIndex((n) => n.id === removed.dstNodeId);
      if (i >= 0) {
        const data = dstCanvas.nodes[i].data || {};
        dstCanvas.nodes[i] = {
          ...dstCanvas.nodes[i],
          data: {
            ...data,
            sourceCanvasId: null,
            sourceCanvasName: null,
            sourceNodeId: null,
            sourceNodeLabel: null,
            status: 'waiting',
          },
        };
        dstCanvas.updatedAt = Date.now();
      }
    }
  });
  return removed;
}

/**
 * 把 src 节点的 output 写到 dst 节点的 text，并更新 status
 * @param {string} srcCanvasId
 * @param {string} srcNodeId
 * @param {string} content
 * @returns {{ connection, dstCanvasId, dstNodeId, hasInternalWaitEdge }} hasInternalWaitEdge：src 画布内 crossOutput 是否有边连到一个 crossInput（"我在等"信号）
 */
export function deliverOutput(srcCanvasId, srcNodeId, content) {
  let result = null;
  mutateStore((payload) => {
    ensureConnections(payload);
    const conn = payload.connections.find(
      (c) => c.srcCanvasId === srcCanvasId && c.srcNodeId === srcNodeId,
    );
    if (!conn) {
      result = { delivered: false, reason: 'no_connection' };
      return;
    }
    const dstCanvas = (payload.canvases || []).find((c) => c.id === conn.dstCanvasId && !c.deleted);
    if (!dstCanvas) {
      result = { delivered: false, reason: 'dst_canvas_missing' };
      return;
    }
    const i = (dstCanvas.nodes || []).findIndex((n) => n.id === conn.dstNodeId);
    if (i < 0) {
      result = { delivered: false, reason: 'dst_node_missing' };
      return;
    }
    dstCanvas.nodes[i] = {
      ...dstCanvas.nodes[i],
      data: {
        ...dstCanvas.nodes[i].data,
        text: content,
        status: 'received',
        receivedAt: Date.now(),
      },
    };
    dstCanvas.updatedAt = Date.now();

    // 检测 src 画布上是否有 crossOutput → 同画布 crossInput 的连线（"我在等"）
    const srcCanvas = (payload.canvases || []).find((c) => c.id === srcCanvasId);
    let hasInternalWaitEdge = false;
    if (srcCanvas) {
      const edges = srcCanvas.edges || [];
      // 看 srcNodeId 出去的边的 target，如果 target 是个 crossInput 节点 → 是"我在等"
      hasInternalWaitEdge = edges.some((e) => {
        if (e.source !== srcNodeId) return false;
        const tgt = (srcCanvas.nodes || []).find((n) => n.id === e.target);
        return tgt && (tgt.data?.type || tgt.type) === 'crossInput';
      });
    }

    result = {
      delivered: true,
      connection: conn,
      dstCanvasId: conn.dstCanvasId,
      dstNodeId: conn.dstNodeId,
      hasInternalWaitEdge,
    };
  });
  return result;
}
