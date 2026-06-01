/**
 * server/src/runner/referenceContract.js · v2.0-β Phase B 步 3
 * ---------------------------------------------------------------
 * Reference 合约状态机 —— 跨用户跨画布引用的"双边握手 + 永久审计"。
 *
 * 背景：v1.7 的 crossCanvas.js 把跨画布引用做成"任何人即时建立"。
 * 单机/同人没问题，但 v2.0 多用户下，A 想引用 B 的画布输出，
 * **不能单方面生效** —— 必须 B 同意。撤销也要留痕，便于审计与纠纷追溯。
 *
 * ── 判定：什么时候需要握手 ──────────────────────────────
 *   - 同一用户（srcOwner === dstOwner）或任一画布无主（ownerId 为 null）
 *       → status='active'，即时生效（与 v1.7 行为完全一致，向后兼容）
 *   - 不同用户（srcOwner !== dstOwner，且都有主）
 *       → status='pending'，需 dst 画布 owner accept 后才 active
 *
 * ── 状态机 ──────────────────────────────────────────────
 *   active                         同人/无主，免握手，直接可投递
 *   pending  → accepted(=active)   跨人，dst owner 同意
 *            → rejected            dst owner 拒绝（连接作废，不投递）
 *   active/accepted → cancelled    任一方主动解除（写 CancellationRecord 审计）
 *
 * ── 投递门 ──────────────────────────────────────────────
 *   deliverOutput 只在 status ∈ {active, accepted} 时投递；
 *   pending/rejected/cancelled 一律拒投。
 *
 * ── 审计 ────────────────────────────────────────────────
 *   每条 connection 带 history[]：{ at, by, action, fromStatus, toStatus, reason? }
 *   cancelled 永久保留在 payload.connectionsArchive[]（不物理删除），可追溯。
 *
 * 数据模型（connection 扩展字段，全部可选，老数据缺省即 active）：
 *   status:       'active'|'pending'|'accepted'|'rejected'|'cancelled'
 *   requestedBy:  userId        发起引用的人（src owner）
 *   srcOwnerId:   userId|null   建立时快照
 *   dstOwnerId:   userId|null   建立时快照（= 审批人）
 *   history:      Array<HistoryEntry>
 *   decidedAt:    number|null   accept/reject 时间
 *   cancelledAt:  number|null
 */
import { mutateStore, readPayload } from '../utils/storeIO.js';

/** 需要走握手才算"待生效"的状态 */
const NEEDS_APPROVAL = 'pending';
/** 可投递的状态 */
const DELIVERABLE = new Set(['active', 'accepted']);

/**
 * 判断一条跨画布引用是否需要握手。
 * @returns {{ needsHandshake: boolean, srcOwnerId: string|null, dstOwnerId: string|null }}
 */
export function evaluateHandshake(payload, srcCanvasId, dstCanvasId) {
  const canvases = payload.canvases || [];
  const src = canvases.find((c) => c.id === srcCanvasId);
  const dst = canvases.find((c) => c.id === dstCanvasId);
  const srcOwnerId = src?.ownerId || null;
  const dstOwnerId = dst?.ownerId || null;
  // 任一无主 → 不握手（单机/legacy）；同人 → 不握手
  const needsHandshake =
    !!srcOwnerId && !!dstOwnerId && srcOwnerId !== dstOwnerId;
  return { needsHandshake, srcOwnerId, dstOwnerId };
}

/** 给一条 connection 补合约字段（在 mutate 内调用） */
function decorateContract(conn, { status, requestedBy, srcOwnerId, dstOwnerId }) {
  conn.status = status;
  conn.requestedBy = requestedBy || null;
  conn.srcOwnerId = srcOwnerId || null;
  conn.dstOwnerId = dstOwnerId || null;
  conn.decidedAt = null;
  conn.cancelledAt = null;
  conn.history = [
    {
      at: Date.now(),
      by: requestedBy || null,
      action: status === NEEDS_APPROVAL ? 'propose' : 'create',
      fromStatus: null,
      toStatus: status,
    },
  ];
  return conn;
}

/** 读取一条 connection（活跃池） */
export function getConnection(connId) {
  const p = readPayload();
  return (p.connections || []).find((c) => c.id === connId) || null;
}

/** 列出"待我审批"的 connection（我是 dstOwner 且 status=pending） */
export function listPendingForUser(userId) {
  const p = readPayload();
  return (p.connections || []).filter(
    (c) => c.status === NEEDS_APPROVAL && c.dstOwnerId === userId,
  );
}

/** 列出"我发起的、还在 pending"的 connection */
export function listProposedByUser(userId) {
  const p = readPayload();
  return (p.connections || []).filter(
    (c) => c.status === NEEDS_APPROVAL && c.requestedBy === userId,
  );
}

/**
 * 接受一条 pending connection。只有 dstOwner 能接受。
 * @returns {{ ok, connection?, error? }}
 */
export function acceptConnection(connId, userId) {
  let out = null;
  mutateStore((payload) => {
    const conn = (payload.connections || []).find((c) => c.id === connId);
    if (!conn) { out = { ok: false, error: 'connection_not_found' }; return; }
    if (conn.status !== NEEDS_APPROVAL) { out = { ok: false, error: 'not_pending' }; return; }
    if (conn.dstOwnerId && conn.dstOwnerId !== userId) { out = { ok: false, error: 'not_authorized' }; return; }
    conn.status = 'accepted';
    conn.decidedAt = Date.now();
    (conn.history = conn.history || []).push({
      at: Date.now(), by: userId, action: 'accept',
      fromStatus: NEEDS_APPROVAL, toStatus: 'accepted',
    });
    out = { ok: true, connection: conn };
  });
  return out;
}

/**
 * 拒绝一条 pending connection。只有 dstOwner 能拒绝。
 * 拒绝后 status=rejected，归档到 connectionsArchive，并从活跃池移除。
 */
export function rejectConnection(connId, userId, reason = '') {
  let out = null;
  mutateStore((payload) => {
    const list = payload.connections || [];
    const conn = list.find((c) => c.id === connId);
    if (!conn) { out = { ok: false, error: 'connection_not_found' }; return; }
    if (conn.status !== NEEDS_APPROVAL) { out = { ok: false, error: 'not_pending' }; return; }
    if (conn.dstOwnerId && conn.dstOwnerId !== userId) { out = { ok: false, error: 'not_authorized' }; return; }
    conn.status = 'rejected';
    conn.decidedAt = Date.now();
    (conn.history = conn.history || []).push({
      at: Date.now(), by: userId, action: 'reject',
      fromStatus: NEEDS_APPROVAL, toStatus: 'rejected', reason,
    });
    // 归档 + 从活跃池移除（pending 时尚未写节点链接字段，无需清理节点）
    if (!Array.isArray(payload.connectionsArchive)) payload.connectionsArchive = [];
    payload.connectionsArchive.push(conn);
    payload.connections = list.filter((c) => c.id !== connId);
    out = { ok: true, connection: conn };
  });
  return out;
}

/**
 * 取消一条已生效（active/accepted）的 connection。任一方（src/dst owner）可取消。
 * 写 CancellationRecord 审计，归档到 connectionsArchive，并清理节点上的链接字段。
 */
export function cancelConnection(connId, userId, reason = '') {
  let out = null;
  mutateStore((payload) => {
    const list = payload.connections || [];
    const conn = list.find((c) => c.id === connId);
    if (!conn) { out = { ok: false, error: 'connection_not_found' }; return; }
    const status = conn.status || 'active';
    if (status === 'cancelled' || status === 'rejected') {
      out = { ok: false, error: 'already_closed' }; return;
    }
    // 授权：src/dst owner 任一方可取消；无主连接（legacy）任何人可取消
    const authorized =
      !conn.srcOwnerId || !conn.dstOwnerId ||
      conn.srcOwnerId === userId || conn.dstOwnerId === userId;
    if (!authorized) { out = { ok: false, error: 'not_authorized' }; return; }

    const fromStatus = status;
    conn.status = 'cancelled';
    conn.cancelledAt = Date.now();
    (conn.history = conn.history || []).push({
      at: Date.now(), by: userId, action: 'cancel',
      fromStatus, toStatus: 'cancelled', reason,
    });

    // 清理 src 节点 target 字段
    const srcCanvas = (payload.canvases || []).find((c) => c.id === conn.srcCanvasId);
    if (srcCanvas?.nodes) {
      const i = srcCanvas.nodes.findIndex((n) => n.id === conn.srcNodeId);
      if (i >= 0) {
        const { targetCanvasId, targetCanvasName, targetNodeId, ...rest } = srcCanvas.nodes[i].data || {};
        srcCanvas.nodes[i] = { ...srcCanvas.nodes[i], data: rest };
        srcCanvas.updatedAt = Date.now();
      }
    }
    // 清理 dst 节点 source 字段
    const dstCanvas = (payload.canvases || []).find((c) => c.id === conn.dstCanvasId);
    if (dstCanvas?.nodes) {
      const i = dstCanvas.nodes.findIndex((n) => n.id === conn.dstNodeId);
      if (i >= 0) {
        const data = dstCanvas.nodes[i].data || {};
        dstCanvas.nodes[i] = {
          ...dstCanvas.nodes[i],
          data: {
            ...data,
            sourceCanvasId: null, sourceCanvasName: null,
            sourceNodeId: null, sourceNodeLabel: null,
            status: 'waiting',
          },
        };
        dstCanvas.updatedAt = Date.now();
      }
    }

    // 归档（永久审计）+ 从活跃池移除
    if (!Array.isArray(payload.connectionsArchive)) payload.connectionsArchive = [];
    payload.connectionsArchive.push(conn);
    payload.connections = list.filter((c) => c.id !== connId);
    out = { ok: true, connection: conn };
  });
  return out;
}

/** 一条 connection 是否可投递 output */
export function isDeliverable(conn) {
  if (!conn) return false;
  // 老数据无 status 字段 → 视为 active（向后兼容）
  const status = conn.status || 'active';
  return DELIVERABLE.has(status);
}

export { NEEDS_APPROVAL, DELIVERABLE, decorateContract };
