/**
 * server/src/runner/pmDigestScheduler.js · v2.0 Phase C 步 7（AI PM L2）
 * ---------------------------------------------------------------
 * 每日定点对"所有有主画布"生成日报并投递给各自 owner 的 inbox。
 *
 * 不引第三方 cron：自己维护一个每 N 分钟扫描的 setInterval，
 * 记录"上次发日报的日期"，跨过设定时刻（默认每天 09:00 本地）就触发一轮。
 *
 * LLM 调用走本机 /api/llm/chat（复用现有通道）；失败时 pmNotify 有兜底 summary。
 * 持久化：<DATA_DIR>/pm-digest-state.json { lastDigestDate: 'YYYY-MM-DD' }
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../utils/storePath.js';
import { readPayload } from '../utils/storeIO.js';
import { listRuns } from './runStore.js';
import { notifyDailyDigest } from './pmNotify.js';
import { runSuggestRound } from './pmSuggest.js';

let _intervalId = null;
let _digestHour = 9;   // 默认每天 09:00 发日报
let _scanMs = 5 * 60 * 1000; // 每 5 分钟扫一次

function statePath() {
  return path.join(getDataDir(), 'pm-digest-state.json');
}
function loadState() {
  try {
    const fp = statePath();
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch { /* ignore */ }
  return { lastDigestDate: null };
}
function saveState(s) {
  try { fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), 'utf8'); } catch { /* ignore */ }
}

function todayStr(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** server 端调本机 LLM（返回总结文本，失败抛错由 pmNotify 兜底） */
async function serverLlmCall(messages) {
  const url = `http://localhost:${process.env.PORT || 3001}/api/llm/chat`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'deepseek', messages, temperature: 0.4, stream: false }),
  });
  if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);
  const json = await resp.json();
  return json?.choices?.[0]?.message?.content || json?.content?.[0]?.text || json?.output || '';
}

/** 跑一轮日报：对所有有主画布生成 digest */
async function runDigestRound() {
  const payload = readPayload();
  const owned = (payload.canvases || []).filter((c) => !c.deleted && c.ownerId);
  let sent = 0;
  for (const c of owned) {
    try {
      const runs = listRuns(c.id, 50);
      const r = await notifyDailyDigest(c.id, serverLlmCall, { runs });
      if (r) sent += 1;
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[pmDigest] 画布 ${c.id} 日报失败：`, e.message);
    }
  }
  // eslint-disable-next-line no-console
  console.log(`✓ AI PM 日报完成：${sent}/${owned.length} 张有主画布`);

  // L4 主动建议：同一轮顺带跑结构分析（去重窗口内不重复打扰）
  try {
    await runSuggestRound(serverLlmCall);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[pmDigest] 主动建议轮失败：', e.message);
  }
  return sent;
}

async function tick() {
  const now = new Date();
  const state = loadState();
  const today = todayStr(now);
  // 今天已发过 → 跳过
  if (state.lastDigestDate === today) return;
  // 还没到设定时刻 → 等
  if (now.getHours() < _digestHour) return;
  // 到点且今天没发 → 发一轮
  state.lastDigestDate = today;
  saveState(state);
  await runDigestRound().catch(() => {});
}

/**
 * 启动 PM 日报调度。
 * @param {{ digestHour?: number, scanMs?: number }} options
 */
export function startPmDigest(options = {}) {
  if (typeof options.digestHour === 'number') _digestHour = options.digestHour;
  if (typeof options.scanMs === 'number') _scanMs = options.scanMs;
  if (_intervalId) clearInterval(_intervalId);
  _intervalId = setInterval(() => { tick().catch(() => {}); }, _scanMs);
  tick().catch(() => {});
  // eslint-disable-next-line no-console
  console.log(`✓ AI PM 日报调度已启动（每天 ${_digestHour}:00，扫描间隔 ${Math.round(_scanMs / 60000)}min）`);
}

export function stopPmDigest() {
  if (_intervalId) { clearInterval(_intervalId); _intervalId = null; }
}

/** 手动触发一轮（测试/调试用），返回发出条数 */
export async function triggerDigestNow() {
  return runDigestRound();
}
