/**
 * client/src/store/runWorker.ts · v1.6 切片 3 · 前端运行调度 Worker
 * ---------------------------------------------------------------
 * 让外部 AI（通过 MCP/REST 触发的 POST /api/canvas/:id/run）能让画布自己跑起来。
 *
 * 工作循环（5s 一次）：
 *   1. fetch GET /api/canvas/_runs/pending —— 拿所有 pending 任务
 *   2. 找一个 canvasId 与"当前活动画布"匹配的；其他画布的任务**让别人/未来切到那画布时再处理**
 *   3. POST /api/canvas/_runs/:jobId/claim 抢锁；抢到了再继续
 *   4. 调外部传入的 runner(canvasId, jobId, hooks) —— 这是真正的执行器（Canvas.tsx 的 executeFlow）
 *      hooks: { log(...lines), updateResults(map), succeed(), fail(err) }
 *   5. 跑完后再次 PATCH 写 succeeded/failed
 *
 * 多浏览器协调：
 *   - 启动时生成本地 leaderId（uuid），每次 claim/patch 带上
 *   - server 看到 status=running 且心跳新（<30s）→ 拒绝其它 leader claim
 *   - worker 跑期间每 10s heartbeat 一次（用空 PATCH 更新 leaderHeartbeat）
 *
 * 失败 / 网络错：跳过本轮，下次循环再说。
 */

const POLL_INTERVAL = 5000;
const HEARTBEAT_INTERVAL = 10000;

export type RunHooks = {
  log: (...lines: string[]) => void;
  updateResults: (map: Record<string, { output?: string; error?: string }>) => void;
  succeed: () => void;
  fail: (err: string) => void;
};

export type CanvasRunner = (canvasId: string, jobId: string, hooks: RunHooks) => Promise<void>;

let timer: number | null = null;
let active = false;
let busy = false; // 正在跑某个 job（避免并发抢）
let currentRunner: CanvasRunner | null = null;
let getActiveCanvasId: (() => string | null) | null = null;
const leaderId = `leader-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  try {
    const res = await fetch(url, init);
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`HTTP ${res.status}: ${t.slice(0, 120)}`);
    }
    return await res.json();
  } catch (e: any) {
    throw e;
  }
}

async function patchJob(jobId: string, body: any): Promise<void> {
  await fetchJson(`/api/canvas/_runs/${encodeURIComponent(jobId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leaderId, ...body }),
  });
}

async function tickOnce(): Promise<void> {
  if (busy) return;
  if (!currentRunner) return;
  const activeCanvasId = getActiveCanvasId?.() || null;
  let pending: { jobs: any[] };
  try {
    pending = await fetchJson('/api/canvas/_runs/pending');
  } catch {
    return; // server 没起 / 没网，下次再试
  }
  const jobs = pending.jobs || [];
  if (jobs.length === 0) return;

  // 优先挑当前活动画布的任务（用户能看着跑）
  let job = jobs.find((j) => j.canvasId === activeCanvasId && j.status === 'pending');
  // 没有？挑任何 pending（用户切画布了下次再亮起来）
  if (!job) job = jobs.find((j) => j.status === 'pending');
  if (!job) return; // 都是别人在跑（running 心跳新）

  // 抢锁
  busy = true;
  let claimed: any = null;
  try {
    const r = await fetchJson(`/api/canvas/_runs/${encodeURIComponent(job.jobId)}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leaderId }),
    });
    claimed = r.job;
  } catch {
    busy = false;
    return; // 别人抢到了，下次再说
  }

  // 心跳定时器
  let heartbeat: number | null = window.setInterval(() => {
    patchJob(job.jobId, {}).catch(() => {});
  }, HEARTBEAT_INTERVAL);

  const logBuffer: string[] = [];
  const flushLog = (force = false) => {
    if (logBuffer.length === 0) return;
    if (!force && logBuffer.length < 5) return;
    const lines = logBuffer.splice(0, logBuffer.length);
    patchJob(job.jobId, { log: lines }).catch(() => {});
  };

  const hooks: RunHooks = {
    log: (...lines) => {
      logBuffer.push(...lines);
      flushLog(false);
    },
    updateResults: (map) => {
      patchJob(job.jobId, { results: map }).catch(() => {});
    },
    succeed: () => {
      flushLog(true);
      patchJob(job.jobId, { status: 'succeeded' }).catch(() => {});
    },
    fail: (err) => {
      flushLog(true);
      patchJob(job.jobId, { status: 'failed', error: err }).catch(() => {});
    },
  };

  try {
    await currentRunner(claimed.canvasId, claimed.jobId, hooks);
    // runner 自己应该在结束时调 succeed()/fail()；兜底再 succeed 一次（幂等：server 已 finished 会 409 但被 catch 吞）
    flushLog(true);
  } catch (e: any) {
    hooks.fail(e?.message || String(e));
  } finally {
    if (heartbeat != null) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    busy = false;
  }
}

/**
 * 启动 worker（在 App.tsx mount 时调一次）
 * runner = 真正跑画布的函数（用 Canvas.tsx 的 executeFlow + 切换 active canvas）
 * activeCanvasIdGetter = 拿当前活动画布 id（让 worker 优先选用户能看着的）
 */
export function startRunWorker(runner: CanvasRunner, activeCanvasIdGetter: () => string | null): void {
  if (active) return;
  active = true;
  currentRunner = runner;
  getActiveCanvasId = activeCanvasIdGetter;
  // 立即跑一次，再按周期跑
  tickOnce().catch(() => {});
  timer = window.setInterval(() => {
    tickOnce().catch(() => {});
  }, POLL_INTERVAL);
}

export function stopRunWorker(): void {
  active = false;
  if (timer != null) {
    clearInterval(timer);
    timer = null;
  }
  currentRunner = null;
  getActiveCanvasId = null;
}

export function getLeaderId(): string {
  return leaderId;
}
