/**
 * server/src/runner/pmNotify.js · v2.0 Phase C 步 7（AI PM L1/L2）
 * ---------------------------------------------------------------
 * 把"画布运行事件"翻译成"投递给画布 owner 的 inbox 消息"。
 *
 * L1 监听层：runCanvasJob 跑完，若失败 → 给 owner 投 kind=execution，
 *            带「重试」action，并通过 SSE 实时推送。
 * L2 摘要层：定时任务调 LLM 把画布近期 run 总结成日报 → 投 kind=daily。
 *
 * 设计原则：
 *   - 只给"有主画布"的 owner 发（离线/无主画布不发，避免噪音）
 *   - 失败才发 L1（成功不打扰）；可配 stuck（长时间 running）后续扩展
 *   - 通知失败不能影响主流程（全部 try/catch 吞掉）
 */
import { addInboxItem } from '../auth/inboxStore.js';
import { readPayload, mutateStore } from '../utils/storeIO.js';

// broadcastInbox 来自 routes/events.js，运行期注入避免循环依赖
let _broadcast = null;
export function setPmBroadcaster(fn) { _broadcast = fn; }

function notify(userId, item) {
  if (!userId) return null;
  try {
    const entry = addInboxItem(userId, item);
    if (_broadcast) _broadcast(userId, entry);
    return entry;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[pmNotify] 投递失败：', e.message);
    return null;
  }
}

/** 取画布 owner（无主返回 null） */
function getCanvasOwner(canvasId) {
  const payload = readPayload();
  const c = (payload.canvases || []).find((x) => x.id === canvasId && !x.deleted);
  return { ownerId: c?.ownerId || null, name: c?.name || canvasId };
}

/**
 * L1：一次 run 结束后调用。失败则给 owner 投 execution 消息。
 * @param {{ canvasId, jobId, status, errors }} run
 */
export function notifyRunResult(run) {
  if (!run || run.status !== 'failed') return; // 只在失败时打扰
  const { ownerId, name } = getCanvasOwner(run.canvasId);
  if (!ownerId) return; // 无主画布（离线/单机）不发

  const errs = Array.isArray(run.errors) ? run.errors : [];
  const firstErr = errs[0];
  const errNodeId = firstErr?.nodeId || null;
  const errMsg = firstErr?.error || '未知错误';
  const count = errs.length;

  notify(ownerId, {
    kind: 'execution',
    title: `画布「${name}」运行失败`,
    body: count > 1
      ? `有 ${count} 个节点出错，首个：${String(errMsg).slice(0, 120)}`
      : `节点运行失败：${String(errMsg).slice(0, 140)}`,
    from: { userId: 'system', name: 'AI PM' },
    target: { canvasId: run.canvasId, nodeId: errNodeId, jobId: run.jobId },
    actions: [
      { label: '重试运行', action: 'retry-canvas', payload: { canvasId: run.canvasId } },
    ],
  });
}

/**
 * L2：生成某画布的日报并投递给 owner。
 * @param {string} canvasId
 * @param {(messages:any[])=>Promise<string>} llmCall  注入的 LLM 调用（返回总结文本）
 * @param {{ runs?: any[] }} ctx  近期 run 列表（已按时间倒序）
 */
export async function notifyDailyDigest(canvasId, llmCall, ctx = {}) {
  const { ownerId, name } = getCanvasOwner(canvasId);
  if (!ownerId) return null;

  const runs = Array.isArray(ctx.runs) ? ctx.runs : [];
  const recent = runs.slice(0, 20);
  const succeeded = recent.filter((r) => r.status === 'succeeded').length;
  const failed = recent.filter((r) => r.status === 'failed').length;

  // 无变更不发日报（避免噪音）
  if (recent.length === 0) return null;

  let summary = `近 24h：运行 ${recent.length} 次（成功 ${succeeded} / 失败 ${failed}）`;
  // 有 LLM 则生成更自然的总结
  if (typeof llmCall === 'function') {
    try {
      const brief = recent.map((r) =>
        `- ${new Date(r.completedAt || r.requestedAt).toLocaleString('zh-CN')} ${r.status} 触发=${r.trigger} 错误=${r.errorCount || 0}`,
      ).join('\n');
      const text = await llmCall([
        { role: 'system', content: '你是项目管理助手。用 2-3 句中文简报概括这张画布近期的运行情况，点出是否有需要关注的失败或卡点。只输出简报正文，不要客套。' },
        { role: 'user', content: `画布「${name}」近期运行记录：\n${brief}` },
      ]);
      if (text && text.trim()) summary = text.trim();
    } catch (e) {
      // LLM 失败用兜底 summary
      // eslint-disable-next-line no-console
      console.warn('[pmNotify] 日报 LLM 失败，用兜底：', e.message);
    }
  }

  return notify(ownerId, {
    kind: 'daily',
    title: `📊 画布「${name}」日报`,
    body: summary,
    from: { userId: 'system', name: 'AI PM' },
    target: { canvasId },
    actions: [{ label: '打开画布', action: 'open-canvas', payload: { canvasId } }],
  });
}

/**
 * L3 派发层：@某成员卷入项目协作。
 * 1) 若该画布还没 share 给对方，自动加进 sharedWith（授予查看权限）
 * 2) 给对方投 kind=mention inbox（带「跳转到画布/节点」action）+ SSE 推送
 *
 * @param {{ canvasId, nodeId?, fromUser:{userId,name}, toUserId, message? }} opts
 * @returns {{ ok, autoShared, entry } | { ok:false, error }}
 */
export function notifyMention(opts) {
  const { canvasId, nodeId = null, fromUser, toUserId, message = '' } = opts || {};
  if (!canvasId || !toUserId || !fromUser) return { ok: false, error: 'missing_fields' };

  // 取画布名 + 自动 share
  let canvasName = canvasId;
  let autoShared = false;
  try {
    mutateStore((payload) => {
      const c = (payload.canvases || []).find((x) => x.id === canvasId && !x.deleted);
      if (!c) return;
      canvasName = c.name || canvasId;
      // 不给 owner 自己重复 share；对方非 owner 且未在 sharedWith → 自动加
      if (c.ownerId !== toUserId) {
        const list = Array.isArray(c.sharedWith) ? c.sharedWith : [];
        if (!list.includes(toUserId)) {
          c.sharedWith = [...list, toUserId];
          autoShared = true;
        }
      }
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[pmNotify] mention 自动 share 失败：', e.message);
  }

  const entry = notify(toUserId, {
    kind: 'mention',
    title: `${fromUser.name} 在「${canvasName}」@了你`,
    body: message
      ? message
      : (nodeId ? `请看画布「${canvasName}」中的某个节点` : `请关注画布「${canvasName}」`),
    from: { userId: fromUser.userId || 'system', name: fromUser.name },
    target: { canvasId, nodeId },
    actions: [{ label: '跳转查看', action: 'open-canvas', payload: { canvasId, nodeId } }],
  });

  return { ok: true, autoShared, entry };
}
