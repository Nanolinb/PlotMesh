/**
 * server/src/runner/pmSuggest.js · v2.0 Phase C 步 7（AI PM L4 主动建议）
 * ---------------------------------------------------------------
 * server 端定期分析有主画布的"结构"，发现可改进点 → 投 kind=suggestion inbox。
 *
 * L4 与 L1/L2 的区别：
 *   L1 失败检测（被动，运行出错才报）
 *   L2 日报（周期性运行情况摘要）
 *   L4 主动建议（看结构本身，即使没运行也能提"这里建议加个重试/缓存"）
 *
 * 实现策略：规则启发式 + 可选 LLM 润色。
 *   - 规则检测明显结构问题（零成本、稳定）：孤立节点 / LLM 无下游输出 /
 *     crossOutput 未配目标 / 长链路无分支 等
 *   - 有 LLM 时，把检测结果交给 LLM 生成更自然的一句话建议（失败用规则文案兜底）
 *   - 建议不自动落盘，纯提示；带可选「让 AI 构建器执行」action（前端引导用户用 ai-builder）
 *
 * 防噪音：每条建议带指纹（canvasId+ruleId），同指纹 7 天内不重复投。
 * 状态持久化：<DATA_DIR>/pm-suggest-state.json { sent: { '<fingerprint>': ts } }
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../utils/storePath.js';
import { readPayload } from '../utils/storeIO.js';
import { addInboxItem } from '../auth/inboxStore.js';

let _broadcast = null;
export function setSuggestBroadcaster(fn) { _broadcast = fn; }

const DEDUP_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 同建议 7 天不重复

function statePath() { return path.join(getDataDir(), 'pm-suggest-state.json'); }
function loadState() {
  try {
    const fp = statePath();
    if (fs.existsSync(fp)) return JSON.parse(fs.readFileSync(fp, 'utf8'));
  } catch { /* ignore */ }
  return { sent: {} };
}
function saveState(s) {
  try { fs.writeFileSync(statePath(), JSON.stringify(s, null, 2), 'utf8'); } catch { /* ignore */ }
}

/**
 * 规则检测：返回该画布的建议数组 [{ ruleId, text, nodeId? }]
 * 纯启发式，零成本。
 */
export function analyzeCanvasStructure(canvas) {
  const nodes = (canvas.nodes || []).filter((n) => n.type !== 'group');
  const edges = canvas.edges || [];
  const out = [];
  if (nodes.length === 0) return out;

  const hasOutgoing = new Set(edges.map((e) => e.source));
  const hasIncoming = new Set(edges.map((e) => e.target));

  // 规则1：LLM 节点没有下游（结果没人接，可能漏接 output）
  for (const n of nodes) {
    const t = n.data?.type || n.type;
    if (t === 'llm' && !hasOutgoing.has(n.id)) {
      out.push({ ruleId: 'llm-no-downstream', nodeId: n.id,
        text: `大模型节点「${n.data?.label || n.id}」没有下游节点，生成的结果没有被使用，建议接一个输出节点。` });
    }
  }

  // 规则2：crossOutput 没配目标画布
  for (const n of nodes) {
    const t = n.data?.type || n.type;
    if (t === 'crossOutput' && !n.data?.targetCanvasId) {
      out.push({ ruleId: 'crossoutput-no-target', nodeId: n.id,
        text: `跨画布输出节点「${n.data?.label || n.id}」还没配置目标画布，不会投递到任何地方。` });
    }
  }

  // 规则3：孤立节点（既无上游也无下游，且不是源/主题类）
  const sourceLike = new Set(['fileUpload', 'webLink', 'textPrompt', 'themeNode', 'aiBuilder', 'crossInput']);
  for (const n of nodes) {
    const t = n.data?.type || n.type;
    if (sourceLike.has(t)) continue;
    if (!hasOutgoing.has(n.id) && !hasIncoming.has(n.id)) {
      out.push({ ruleId: 'isolated-node', nodeId: n.id,
        text: `节点「${n.data?.label || n.id}」是孤立的（没有任何连线），可能忘了连接。` });
    }
  }

  // 规则4：画布很大但没有任何输出节点（产出可能没落地）
  if (nodes.length >= 4 && !nodes.some((n) => (n.data?.type || n.type) === 'output')) {
    out.push({ ruleId: 'no-output-node', nodeId: null,
      text: `这张画布有 ${nodes.length} 个节点但没有输出节点，跑完的结果不会被导出或保存。` });
  }

  return out;
}

/**
 * 对一张画布生成 + 投递建议（去重）。
 * @param {object} canvas  含 id/name/ownerId/nodes/edges
 * @param {(messages:any[])=>Promise<string>} [llmCall]  可选，润色建议文案
 * @param {object} state   dedup 状态（外部传入，批量时共用）
 * @returns {Promise<number>} 实际投出的建议数
 */
export async function suggestForCanvas(canvas, llmCall, state) {
  const ownerId = canvas.ownerId;
  if (!ownerId) return 0;
  const found = analyzeCanvasStructure(canvas);
  if (found.length === 0) return 0;

  const now = Date.now();
  let sent = 0;
  for (const sug of found) {
    const fp = `${canvas.id}::${sug.ruleId}::${sug.nodeId || ''}`;
    const last = state.sent[fp];
    if (last && now - last < DEDUP_WINDOW_MS) continue; // 去重窗口内跳过

    let body = sug.text;
    // 可选 LLM 润色（失败用规则文案）
    if (typeof llmCall === 'function') {
      try {
        const text = await llmCall([
          { role: 'system', content: '你是项目管理助手。把下面这条画布结构问题改写成一句友好、口语化的中文建议，不超过 40 字。只输出建议本身。' },
          { role: 'user', content: sug.text },
        ]);
        if (text && text.trim()) body = text.trim();
      } catch { /* 用规则文案 */ }
    }

    const entry = addInboxItem(ownerId, {
      kind: 'suggestion',
      title: `💡 画布「${canvas.name || canvas.id}」改进建议`,
      body,
      from: { userId: 'system', name: 'AI PM' },
      target: { canvasId: canvas.id, nodeId: sug.nodeId },
      actions: [
        { label: '查看节点', action: 'open-canvas', payload: { canvasId: canvas.id, nodeId: sug.nodeId } },
      ],
    });
    if (_broadcast) { try { _broadcast(ownerId, entry); } catch { /* ignore */ } }
    state.sent[fp] = now;
    sent += 1;
  }
  return sent;
}

/** 跑一轮：对所有有主画布生成建议 */
export async function runSuggestRound(llmCall) {
  const payload = readPayload();
  const owned = (payload.canvases || []).filter((c) => !c.deleted && c.ownerId);
  const state = loadState();
  let total = 0;
  for (const c of owned) {
    try {
      total += await suggestForCanvas(c, llmCall, state);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[pmSuggest] 画布 ${c.id} 建议失败：`, e.message);
    }
  }
  // 清理过期 dedup 记录
  const now = Date.now();
  for (const k of Object.keys(state.sent)) {
    if (now - state.sent[k] > DEDUP_WINDOW_MS) delete state.sent[k];
  }
  saveState(state);
  // eslint-disable-next-line no-console
  console.log(`✓ AI PM 主动建议完成：投出 ${total} 条（${owned.length} 张有主画布）`);
  return total;
}
