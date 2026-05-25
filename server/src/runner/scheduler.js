/**
 * server/src/runner/scheduler.js · v1.7 alpha P1 第二刀
 * ----------------------------------------------------------------
 * 简单定时调度器：扫描 schedules.json 并按计划触发 runCanvasJob。
 *
 * 不引第三方（node-cron / croner）。支持的表达式：
 *   - 'every:60s'    每 60 秒
 *   - 'every:5m'     每 5 分钟
 *   - 'every:1h'     每 1 小时
 *   - 'daily:08:30'  每天 08:30（本地时间）
 *
 * 持久化 ~/.plotmesh/schedules.json，结构：
 * {
 *   schedules: [
 *     { id, canvasId, name, expr, enabled, createdAt, lastRunAt?, nextRunAt?, lastJobId?, lastStatus? }
 *   ]
 * }
 *
 * 启动时由 index.js 调 startScheduler() 注册 setInterval（10s 扫描一次），
 * 每次扫描遍历 schedules，到期就异步触发 runCanvasJob。
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../utils/storePath.js';

let _runner = null;       // 注入的 runCanvasJob，避免循环依赖
let _intervalId = null;
let _scanIntervalMs = 10 * 1000;

function getSchedulePath() {
  return path.join(getDataDir(), 'schedules.json');
}

function loadFile() {
  try {
    const fp = getSchedulePath();
    if (!fs.existsSync(fp)) return { schedules: [] };
    const raw = fs.readFileSync(fp, 'utf8');
    const json = JSON.parse(raw);
    if (!Array.isArray(json.schedules)) json.schedules = [];
    return json;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  scheduler.loadFile 失败：', e.message);
    return { schedules: [] };
  }
}

function saveFile(data) {
  try {
    fs.writeFileSync(getSchedulePath(), JSON.stringify(data, null, 2), 'utf8');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  scheduler.saveFile 失败：', e.message);
  }
}

/**
 * 解析表达式 → 给出基于 baseTs 的下一次触发时间（ms）。无效返回 null。
 *
 * @param {string} expr
 * @param {number} baseTs - 基准时间（用于 every:）；daily 不依赖 baseTs
 * @param {number} now - 当前时间（用于 daily）
 */
export function nextRunAt(expr, baseTs, now = Date.now()) {
  if (typeof expr !== 'string' || !expr) return null;
  const m1 = expr.match(/^every:(\d+)([smh])$/i);
  if (m1) {
    const n = parseInt(m1[1], 10);
    const unit = m1[2].toLowerCase();
    const ms = n * (unit === 's' ? 1000 : unit === 'm' ? 60000 : 3600000);
    if (!Number.isFinite(ms) || ms < 1000) return null;
    return baseTs + ms;
  }
  const m2 = expr.match(/^daily:(\d{1,2}):(\d{1,2})$/);
  if (m2) {
    const hh = parseInt(m2[1], 10);
    const mm = parseInt(m2[2], 10);
    if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
    const d = new Date(now);
    d.setHours(hh, mm, 0, 0);
    let t = d.getTime();
    if (t <= now) t += 86400 * 1000; // 今天的时刻已过，定到明天
    return t;
  }
  return null;
}

/** 描述表达式对应的人话 */
export function describeExpr(expr) {
  const m1 = expr?.match?.(/^every:(\d+)([smh])$/i);
  if (m1) {
    const u = { s: '秒', m: '分钟', h: '小时' }[m1[2].toLowerCase()] || m1[2];
    return `每 ${m1[1]} ${u}`;
  }
  const m2 = expr?.match?.(/^daily:(\d{1,2}):(\d{1,2})$/);
  if (m2) return `每天 ${m2[1].padStart(2, '0')}:${m2[2].padStart(2, '0')}`;
  return expr || '(无效)';
}

// ── CRUD ──

export function listSchedules() {
  return loadFile().schedules;
}

export function getSchedule(id) {
  return loadFile().schedules.find((s) => s.id === id) || null;
}

export function createSchedule({ canvasId, name, expr, enabled = true }) {
  if (!canvasId) throw new Error('canvasId required');
  if (!nextRunAt(expr, Date.now())) throw new Error(`invalid expr: ${expr}`);
  const data = loadFile();
  const id = `sched-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const now = Date.now();
  const sch = {
    id,
    canvasId,
    name: name || describeExpr(expr),
    expr,
    enabled: !!enabled,
    createdAt: now,
    lastRunAt: null,
    nextRunAt: nextRunAt(expr, now, now),
    lastJobId: null,
    lastStatus: null,
  };
  data.schedules.push(sch);
  saveFile(data);
  return sch;
}

export function updateSchedule(id, patch) {
  const data = loadFile();
  const idx = data.schedules.findIndex((s) => s.id === id);
  if (idx < 0) return null;
  const old = data.schedules[idx];
  const next = { ...old, ...patch };
  // 如果 expr 改了，重算 nextRunAt
  if (patch && patch.expr && patch.expr !== old.expr) {
    if (!nextRunAt(patch.expr, Date.now())) throw new Error(`invalid expr: ${patch.expr}`);
    next.nextRunAt = nextRunAt(patch.expr, Date.now(), Date.now());
  }
  // 如果从禁用变启用，重置 nextRunAt
  if (patch && patch.enabled && !old.enabled) {
    next.nextRunAt = nextRunAt(next.expr, Date.now(), Date.now());
  }
  data.schedules[idx] = next;
  saveFile(data);
  return next;
}

export function deleteSchedule(id) {
  const data = loadFile();
  const idx = data.schedules.findIndex((s) => s.id === id);
  if (idx < 0) return false;
  data.schedules.splice(idx, 1);
  saveFile(data);
  return true;
}

// ── 调度器主循环 ──

async function tick() {
  if (!_runner) return;
  const now = Date.now();
  const data = loadFile();
  let dirty = false;
  for (const s of data.schedules) {
    if (!s.enabled) continue;
    if (!s.nextRunAt || s.nextRunAt > now) continue;
    // 到期 —— 异步触发，不阻塞 tick
    s.lastRunAt = now;
    s.nextRunAt = nextRunAt(s.expr, now, now);
    dirty = true;
    try {
      const result = await _runner(s.canvasId, {
        trigger: 'cron',
        reason: `scheduled:${s.id} (${s.name})`,
      });
      s.lastJobId = result?.jobId || null;
      s.lastStatus = result?.status || null;
    } catch (e) {
      s.lastStatus = 'failed';
      // eslint-disable-next-line no-console
      console.warn(`⚠️  scheduler tick 触发 ${s.id} 失败：`, e.message);
    }
  }
  if (dirty) saveFile(data);
}

/**
 * 由 server/src/index.js 调用：注入 runCanvasJob 并启动定时扫描。
 * @param {(canvasId, opts) => Promise<{jobId,status,run}>} runner
 * @param {{ scanIntervalMs?: number }} options
 */
export function startScheduler(runner, options = {}) {
  _runner = runner;
  _scanIntervalMs = options.scanIntervalMs || 10000;
  if (_intervalId) clearInterval(_intervalId);
  _intervalId = setInterval(() => {
    tick().catch(() => {/* swallow */});
  }, _scanIntervalMs);
  // 启动时立即扫一次（处理重启过程中错过的）
  tick().catch(() => {});
  // eslint-disable-next-line no-console
  console.log(`✓ Scheduler started (scan every ${_scanIntervalMs}ms)`);
}

export function stopScheduler() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
  }
}
