/**
 * MergeReportDialog.tsx · v1.5.2 三向合并报告 + 冲突决策弹窗
 * ---------------------------------------------------------------
 * 启动时跨浏览器同步出现"差异"时弹出，分两块：
 *
 *   1. 自动合并清单（顶部）：
 *      - 列出"已自动合并"的实体变更（新增 / 更新 / 删除）
 *      - 用户**只需知情**，不需要做选择
 *
 *   2. 需要决策的画布（中部）：
 *      - 仅当同 id 画布两边都改了才会出现在这里
 *      - 每条画布独立 3 选 1：保留本地 / 保留远端 / 都保留（远端版复制为副本）
 *
 * 用户必须为所有冲突画布做完决策才能继续；底部"全部完成"按钮在此之前禁用。
 * 提示用户：如果不知道哪一边对，最佳实践是选「都保留」，然后到画布管理器里
 * 用各自的「(本地版)」「(远端版)」副本人工对比合并。
 */
import { useState, useMemo } from 'react';
import type { CanvasConflict, AutoMergeChange } from '../store/syncMerge';

export type ConflictResolution = 'keep_local' | 'keep_remote' | 'keep_both';

interface Props {
  conflicts: CanvasConflict[];
  autoChanges: AutoMergeChange[];
  /** 用户在所有冲突上都做完决策后调用 */
  onResolved: (resolutions: Record<string, ConflictResolution>) => void;
  /** 用户选"本次不同步" */
  onSkip: () => void;
}

function summarize(c: { nodes: unknown[]; updatedAt: number }) {
  const nodeCount = Array.isArray(c.nodes) ? c.nodes.length : 0;
  const d = new Date(c.updatedAt);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    nodeCount,
    time: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`,
  };
}

function changeLabel(c: AutoMergeChange): string {
  const verb =
    c.kind === 'added_local' || c.kind === 'added_remote'
      ? '新增'
      : c.kind === 'updated_local' || c.kind === 'updated_remote'
      ? '更新'
      : '删除';
  const side =
    c.kind.endsWith('_local') ? '本地' : '远端';
  const entityLabel =
    c.entity === 'canvas' ? '画布' :
    c.entity === 'package' ? '包' :
    c.entity === 'packageGroup' ? '包分组' :
    c.entity === 'workspace' ? '工作区' :
    '项目';
  return `${verb}（${side}）${entityLabel}：${c.name || c.id}`;
}

export default function MergeReportDialog({
  conflicts,
  autoChanges,
  onResolved,
  onSkip,
}: Props) {
  const [resolutions, setResolutions] = useState<Record<string, ConflictResolution>>({});

  const allResolved = useMemo(
    () => conflicts.every((c) => !!resolutions[c.id]),
    [conflicts, resolutions]
  );

  const handlePick = (id: string, r: ConflictResolution) => {
    setResolutions((prev) => ({ ...prev, [id]: r }));
  };

  const handleSubmit = () => {
    if (!allResolved) return;
    onResolved(resolutions);
  };

  return (
    <div className="sync-conflict-overlay" data-testid="merge-report-dialog">
      <div className="sync-conflict-card" style={{ maxWidth: 820 }}>
        <div className="sync-conflict-title">检测到与共享目录的差异</div>
        <div className="sync-conflict-subtitle">
          多数变更已自动合并，{conflicts.length > 0 ? '仅以下画布需要你决定保留哪一份。' : '可直接确认。'}
        </div>

        {/* 自动合并清单 */}
        {autoChanges.length > 0 && (
          <details className="merge-auto-list" open>
            <summary>
              ✅ 自动合并 {autoChanges.length} 项
            </summary>
            <ul>
              {autoChanges.slice(0, 30).map((c, i) => (
                <li key={i}>{changeLabel(c)}</li>
              ))}
              {autoChanges.length > 30 && <li>… 等共 {autoChanges.length} 项</li>}
            </ul>
          </details>
        )}

        {/* 真冲突逐条决策 */}
        {conflicts.length > 0 && (
          <div className="merge-conflicts" data-testid="merge-conflicts">
            <div className="merge-conflicts-title">
              ⚠️ 以下 {conflicts.length} 张画布在两个浏览器都被修改过：
            </div>
            <div className="merge-conflicts-tip">
              不确定时建议选「都保留」——远端那条会以「(远端版)」副本形式新建一张画布，留给你之后人工对比合并。
            </div>
            {conflicts.map((c) => {
              const local = summarize(c.local);
              const remote = summarize(c.remote);
              const picked = resolutions[c.id];
              return (
                <div
                  key={c.id}
                  className={`merge-conflict-row ${picked ? 'picked' : ''}`}
                  data-testid={`conflict-row-${c.id}`}
                >
                  <div className="merge-conflict-row-head">
                    <strong>{c.local.name || c.id}</strong>
                  </div>
                  <div className="merge-conflict-row-cols">
                    <div className={`merge-side ${picked === 'keep_local' ? 'picked' : ''}`}>
                      <div className="merge-side-label">📍 本地</div>
                      <div className="merge-side-meta">
                        {local.nodeCount} 节点 · {local.time}
                      </div>
                    </div>
                    <div className={`merge-side ${picked === 'keep_remote' ? 'picked' : ''}`}>
                      <div className="merge-side-label">☁️ 远端</div>
                      <div className="merge-side-meta">
                        {remote.nodeCount} 节点 · {remote.time}
                      </div>
                    </div>
                  </div>
                  <div className="merge-conflict-buttons">
                    <button
                      className={picked === 'keep_local' ? 'btn-picked' : ''}
                      onClick={() => handlePick(c.id, 'keep_local')}
                      data-testid={`pick-local-${c.id}`}
                    >
                      保留本地
                    </button>
                    <button
                      className={picked === 'keep_remote' ? 'btn-picked' : ''}
                      onClick={() => handlePick(c.id, 'keep_remote')}
                      data-testid={`pick-remote-${c.id}`}
                    >
                      保留远端
                    </button>
                    <button
                      className={picked === 'keep_both' ? 'btn-picked' : ''}
                      onClick={() => handlePick(c.id, 'keep_both')}
                      data-testid={`pick-both-${c.id}`}
                    >
                      都保留（远端版复制为副本）
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="sync-conflict-actions" style={{ marginTop: 8 }}>
          <button
            className="sync-conflict-btn sync-conflict-btn-recommend"
            disabled={!allResolved}
            onClick={handleSubmit}
            data-testid="merge-submit"
          >
            {conflicts.length === 0 ? '继续' : allResolved ? '应用合并' : `请先决策上方 ${conflicts.length - Object.keys(resolutions).length} 张画布`}
          </button>
          <button
            className="sync-conflict-btn sync-conflict-btn-skip"
            onClick={onSkip}
            data-testid="merge-skip"
          >
            本次不同步，稍后处理
          </button>
        </div>

        <div className="sync-conflict-hint">
          数据存放路径：<code>~/.plotmesh/store.json</code>
        </div>
      </div>
    </div>
  );
}
