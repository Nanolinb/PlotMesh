/**
 * server/src/runner/runEvents.js · v1.7 alpha
 * ----------------------------------------------------------------
 * 给运行中的 run 推 SSE 事件用的小型 EventEmitter 总线（按 jobId 隔离）。
 *
 * 写者：runCanvasJob 每打一条 log / 节点状态变化时调 emitRunEvent
 * 读者：GET /api/canvas/:id/runs/:jobId/stream 订阅，把事件推给客户端
 *
 * 事件类型：
 *   - 'log'    { ts, msg }
 *   - 'node'   { nodeId, status, dataPatch? }
 *   - 'status' { status: 'running' | 'succeeded' | 'failed' | 'cancelled' }
 *   - 'cascade'{ canvasId, jobId, status }
 */
import { EventEmitter } from 'events';

// 按 jobId 各自一个 emitter，避免 run 过多时单 emitter 监听过载
const buses = new Map(); // jobId -> EventEmitter

function getBus(jobId) {
  if (!buses.has(jobId)) {
    const e = new EventEmitter();
    e.setMaxListeners(20);
    buses.set(jobId, e);
  }
  return buses.get(jobId);
}

export function emitRunEvent(jobId, type, payload) {
  if (!jobId) return;
  const bus = getBus(jobId);
  bus.emit(type, payload);
  bus.emit('*', { type, payload });
}

export function subscribeRun(jobId, handler) {
  const bus = getBus(jobId);
  bus.on('*', handler);
  return () => bus.off('*', handler);
}

/** run 结束（succeeded/failed/cancelled）后清理 emitter，避免内存泄漏 */
export function disposeRunBus(jobId) {
  const bus = buses.get(jobId);
  if (bus) {
    bus.removeAllListeners();
    buses.delete(jobId);
  }
}
