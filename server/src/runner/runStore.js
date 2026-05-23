/**
 * server/src/runner/runStore.js · v1.7 P1
 * ----------------------------------------------------------------
 * 运行历史持久化：写到 ~/.plotmesh/runs/<jobId>.json，LRU 100 条。
 * 内存里也维护一份 Map<jobId, run> 提速最近查询。
 *
 * run 结构：
 * {
 *   jobId, canvasId,
 *   status: 'pending' | 'running' | 'succeeded' | 'failed' | 'cancelled',
 *   trigger: 'manual' | 'mcp' | 'cron' | 'api',
 *   requestedAt, startedAt?, completedAt?,
 *   logs: string[],
 *   results: { [nodeId]: string },
 *   errors: { nodeId, error }[],
 * }
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../utils/storePath.js';

const MAX_RUNS_KEEP = 100;

function getRunsDir() {
  const dir = path.join(getDataDir(), 'runs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

const memCache = new Map(); // jobId → run

export function saveRun(run) {
  if (!run || !run.jobId) return;
  memCache.set(run.jobId, run);
  try {
    const fp = path.join(getRunsDir(), `${run.jobId}.json`);
    fs.writeFileSync(fp, JSON.stringify(run, null, 2), 'utf8');
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  runStore.saveRun 失败：', e.message);
  }
  pruneOldRuns();
}

export function getRun(jobId) {
  if (memCache.has(jobId)) return memCache.get(jobId);
  try {
    const fp = path.join(getRunsDir(), `${jobId}.json`);
    if (fs.existsSync(fp)) {
      const json = JSON.parse(fs.readFileSync(fp, 'utf8'));
      memCache.set(jobId, json);
      return json;
    }
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('⚠️  runStore.getRun 失败：', e.message);
  }
  return null;
}

export function listRuns(canvasId, limit = 20) {
  const dir = getRunsDir();
  let files = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  } catch {
    return [];
  }
  // 按 mtime 倒序
  files.sort((a, b) => {
    const sa = fs.statSync(path.join(dir, a)).mtimeMs;
    const sb = fs.statSync(path.join(dir, b)).mtimeMs;
    return sb - sa;
  });
  const result = [];
  for (const f of files) {
    if (result.length >= limit) break;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (!canvasId || r.canvasId === canvasId) {
        // 列表只返回元数据
        result.push({
          jobId: r.jobId,
          canvasId: r.canvasId,
          status: r.status,
          trigger: r.trigger,
          requestedAt: r.requestedAt,
          startedAt: r.startedAt,
          completedAt: r.completedAt,
          errorCount: (r.errors || []).length,
        });
      }
    } catch {
      /* 损坏文件，忽略 */
    }
  }
  return result;
}

/**
 * LRU 100：超过的最老文件删掉
 */
function pruneOldRuns() {
  const dir = getRunsDir();
  try {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    if (files.length <= MAX_RUNS_KEEP) return;
    files.sort((a, b) => {
      const sa = fs.statSync(path.join(dir, a)).mtimeMs;
      const sb = fs.statSync(path.join(dir, b)).mtimeMs;
      return sa - sb; // 老在前
    });
    const toDelete = files.slice(0, files.length - MAX_RUNS_KEEP);
    for (const f of toDelete) {
      try {
        fs.unlinkSync(path.join(dir, f));
        const jobId = f.replace(/\.json$/, '');
        memCache.delete(jobId);
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}
