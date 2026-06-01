/**
 * canvasVisibility.ts · v1.7 抽屉「显示/隐藏」开关
 * ---------------------------------------------------------------
 * 把画布从顶部页签条隐藏起来，**抽屉里仍能看到**（灰色/划线）。
 * 类似浏览器固定标签页对面的"折叠"语义，但是反过来：默认全部可见，
 * 把不常用的"藏起来"减少页签条噪音。
 *
 * 持久化策略：
 *   - IDB.META key = `canvas-hidden-set` → string[]（canvas ID 列表）
 *   - **本地浏览器视图偏好**，不参与 server sync（每台设备可不同，
 *     与 active-canvas-id 同语义）
 *
 * 三态语义（独立维度）：
 *   - deleted   软删/回收站
 *   - hidden    页签条不显示，但抽屉仍可见
 *   - visible   默认
 *
 * 保护：永远保证至少 1 个可见画布，避免空页签条。调用层在批量隐藏时
 * 必须先检查 ensureAtLeastOneVisible。
 */

import { getMeta, setMeta } from '../store/storage';

const HIDDEN_SET_KEY = 'canvas-hidden-set';

export async function loadHiddenSet(): Promise<Set<string>> {
  const arr = (await getMeta<string[]>(HIDDEN_SET_KEY)) || [];
  return new Set(arr);
}

export async function saveHiddenSet(set: Set<string>): Promise<void> {
  await setMeta(HIDDEN_SET_KEY, Array.from(set));
}

export async function isHidden(canvasId: string): Promise<boolean> {
  const set = await loadHiddenSet();
  return set.has(canvasId);
}

export async function setHidden(canvasId: string, hidden: boolean): Promise<void> {
  const set = await loadHiddenSet();
  if (hidden) set.add(canvasId);
  else set.delete(canvasId);
  await saveHiddenSet(set);
}

export async function toggleHidden(canvasId: string): Promise<boolean> {
  const set = await loadHiddenSet();
  const next = !set.has(canvasId);
  if (next) set.add(canvasId);
  else set.delete(canvasId);
  await saveHiddenSet(set);
  return next;
}

/**
 * 批量设置一组画布的隐藏状态（文件夹级"全显/全隐"）。
 * 返回最终的 hidden set。
 */
export async function setHiddenBatch(
  canvasIds: string[],
  hidden: boolean,
): Promise<Set<string>> {
  const set = await loadHiddenSet();
  for (const cid of canvasIds) {
    if (hidden) set.add(cid);
    else set.delete(cid);
  }
  await saveHiddenSet(set);
  return set;
}

/**
 * 给定全部画布 id 列表 + 候选 hidden set，返回"可见画布 id 列表"。
 * CanvasTabs 用此过滤。
 */
export function filterVisible(allIds: string[], hidden: Set<string>): string[] {
  return allIds.filter((id) => !hidden.has(id));
}
