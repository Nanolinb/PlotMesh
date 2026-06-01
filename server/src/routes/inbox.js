/**
 * server/src/routes/inbox.js · v2.0-α Phase A 步 2
 * ----------------------------------------------------------------
 * Inbox REST API（需 JWT 鉴权）。
 */
import { Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import {
  listInbox,
  countUnread,
  addInboxItem,
  markRead,
  markAllRead,
  deleteInboxItem,
} from '../auth/inboxStore.js';

const router = Router();

// 全部需要登录
router.use(requireAuth);

// GET /api/inbox?unread=1&limit=50
router.get('/', (req, res) => {
  const userId = req.user.id;
  const unreadOnly = req.query.unread === '1' || req.query.unread === 'true';
  const limit = parseInt(req.query.limit, 10) || 100;
  const items = listInbox(userId, { unreadOnly, limit });
  res.json({ items, unreadCount: countUnread(userId) });
});

// GET /api/inbox/count
router.get('/count', (req, res) => {
  const userId = req.user.id;
  res.json({ unreadCount: countUnread(userId) });
});

// POST /api/inbox（server 端内部也调；前端只在特殊场景用）
router.post('/', (req, res) => {
  const userId = req.user.id;
  const { kind, title, body, target, actions } = req.body || {};
  if (!title) return res.status(400).json({ error: 'missing_title' });
  const item = addInboxItem(userId, { kind, title, body, target, actions });
  res.status(201).json(item);
});

// PATCH /api/inbox/:id/read
router.patch('/:id/read', (req, res) => {
  const userId = req.user.id;
  const updated = markRead(userId, req.params.id);
  if (!updated) return res.status(404).json({ error: 'not_found' });
  res.json(updated);
});

// PATCH /api/inbox/read-all
router.patch('/read-all', (req, res) => {
  const userId = req.user.id;
  const changed = markAllRead(userId);
  res.json({ ok: true, changed, unreadCount: countUnread(userId) });
});

// DELETE /api/inbox/:id
router.delete('/:id', (req, res) => {
  const userId = req.user.id;
  const ok = deleteInboxItem(userId, req.params.id);
  if (!ok) return res.status(404).json({ error: 'not_found' });
  res.json({ ok: true });
});

export default router;
