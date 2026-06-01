/**
 * server/src/routes/events.js · v2.0-α Phase A 步 2
 * ----------------------------------------------------------------
 * 统一 SSE 事件总线：支持多 channel（inbox / presence / system）。
 *
 * 路由：GET /api/events?channel=inbox&since=<ts>
 *   - inbox：新消息到达时推送 { event: 'inbox', item }
 *   - presence：用户上线/下线心跳（v2.0-α 暂用轮询，SSE placeholder）
 *   - system：server 广播（维护通知等）
 *
 * 鉴权：需 JWT（requireAuth）。
 */
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { countUnread } from '../auth/inboxStore.js';

const router = Router();

// 内存级 inbox 变更 emitter（轻量，进程内；未来可换 Redis PubSub）
const inboxEmitters = new Map(); // userId -> Set<res>

export function broadcastInbox(userId, item) {
  const set = inboxEmitters.get(userId);
  if (!set) return;
  const payload = JSON.stringify({ event: 'inbox', item, unreadCount: countUnread(userId) });
  for (const res of set) {
    try {
      res.write(`event: inbox\n`);
      res.write(`data: ${payload}\n\n`);
    } catch {
      /* 客户端已断 */
    }
  }
}

router.get('/', requireAuth, (req, res) => {
  const channel = req.query.channel || 'inbox';
  const userId = req.user.id;

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  // 初始快照
  if (channel === 'inbox') {
    send('snapshot', { unreadCount: countUnread(userId) });
    // 注册 emitter
    if (!inboxEmitters.has(userId)) inboxEmitters.set(userId, new Set());
    inboxEmitters.get(userId).add(res);
  } else if (channel === 'presence') {
    send('snapshot', { users: [] }); // v2.0-α placeholder
  } else if (channel === 'system') {
    send('snapshot', { message: 'connected' });
  }

  // 心跳
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch { /* ignore */ }
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    if (channel === 'inbox') {
      const set = inboxEmitters.get(userId);
      if (set) {
        set.delete(res);
        if (set.size === 0) inboxEmitters.delete(userId);
      }
    }
  });
});

export default router;
