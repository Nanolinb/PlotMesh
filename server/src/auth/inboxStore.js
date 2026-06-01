/**
 * server/src/auth/inboxStore.js · v2.0-α Phase A 步 2
 * ----------------------------------------------------------------
 * per-user 收件箱（轻量 JSON-store）。
 *
 * 文件布局：
 *   <DATA_DIR>/inbox/<userId>.json
 *
 * 数据结构（每用户一个数组）：
 *   [{
 *     id: 'inbox-xxx',
 *     kind: 'execution' | 'mention' | 'daily' | 'suggestion' | 'reference',
 *     title: '运行失败',
 *     body: '节点 X 在画布 Y 中运行失败',
 *     from: { userId: 'system', name: 'AI PM' },
 *     target: { canvasId, nodeId },
 *     actions: [{ label: '重试', action: 'retry', payload: { nodeId } }],
 *     readAt: null,
 *     createdAt: 1234567890,
 *   }]
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../utils/storePath.js';

function getInboxDir() {
  const dir = path.join(getDataDir(), 'inbox');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getInboxFile(userId) {
  return path.join(getInboxDir(), `${userId}.json`);
}

function readInbox(userId) {
  const fp = getInboxFile(userId);
  if (!fs.existsSync(fp)) return [];
  try {
    const raw = fs.readFileSync(fp, 'utf8');
    if (!raw.trim()) return [];
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function writeInbox(userId, items) {
  const fp = getInboxFile(userId);
  const tmp = fp + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8');
  fs.renameSync(tmp, fp);
}

export function listInbox(userId, { unreadOnly = false, limit = 100 } = {}) {
  let items = readInbox(userId);
  if (unreadOnly) items = items.filter((x) => !x.readAt);
  items.sort((a, b) => b.createdAt - a.createdAt);
  if (limit > 0) items = items.slice(0, limit);
  return items;
}

export function countUnread(userId) {
  return readInbox(userId).filter((x) => !x.readAt).length;
}

export function addInboxItem(userId, item) {
  const items = readInbox(userId);
  const now = Date.now();
  const entry = {
    id: `inbox-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    kind: item.kind || 'system',
    title: item.title || '通知',
    body: item.body || '',
    from: item.from || { userId: 'system', name: 'PlotMesh' },
    target: item.target || null,
    actions: item.actions || [],
    readAt: null,
    createdAt: now,
  };
  items.push(entry);
  writeInbox(userId, items);
  return entry;
}

export function markRead(userId, inboxId) {
  const items = readInbox(userId);
  const it = items.find((x) => x.id === inboxId);
  if (!it) return null;
  it.readAt = Date.now();
  writeInbox(userId, items);
  return it;
}

export function markAllRead(userId) {
  const items = readInbox(userId);
  const now = Date.now();
  let changed = false;
  for (const it of items) {
    if (!it.readAt) {
      it.readAt = now;
      changed = true;
    }
  }
  if (changed) writeInbox(userId, items);
  return changed;
}

export function deleteInboxItem(userId, inboxId) {
  const items = readInbox(userId);
  const idx = items.findIndex((x) => x.id === inboxId);
  if (idx === -1) return false;
  items.splice(idx, 1);
  writeInbox(userId, items);
  return true;
}
