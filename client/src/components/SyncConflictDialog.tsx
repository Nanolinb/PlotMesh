/**
 * SyncConflictDialog.tsx · 启动时跨浏览器同步冲突弹窗（v1.5.1）
 * ---------------------------------------------------------------
 * 当 /api/sync/meta 返回的 hash 与本地 IDB 计算出的 hash 不一致时弹出。
 * 让用户在三个选项中明确选择：
 *
 *   1. 使用远端覆盖本地（如果远端较新会标"推荐"）
 *   2. 用本地覆盖远端（如果本地较新会标"推荐"）
 *   3. 本次不同步（仅本次启动只用本地，不读不写远端）
 *
 * 用户选定后，由 App.tsx 调 syncAdapter 完成对应操作并继续启动流程。
 *
 * 设计要点：
 *   - 模态层（背景遮罩 + 不可点击关闭按钮）—— 必须做选择
 *   - 对比表格：上次保存时间 / 画布数 / 节点总数 / 大小
 *   - "较新"一侧加 ← 较新 标记 + 推荐按钮高亮
 */
import { useMemo } from 'react';
import type { LocalSummary, RemoteMeta, SyncDecision } from '../store/syncAdapter';

interface Props {
  local: LocalSummary;
  remote: RemoteMeta;
  /** 用户做出选择 */
  onChoose: (decision: SyncDecision) => void;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return iso;
  }
}

export default function SyncConflictDialog({ local, remote, onChoose }: Props) {
  // 比较哪一侧较新（用 updatedAt；如果远端没填则按 version > 0 当作较新）
  const remoteNewer = useMemo(() => {
    if (!remote.updatedAt) return false;
    if (!local.updatedAt) return true;
    return new Date(remote.updatedAt).getTime() > new Date(local.updatedAt).getTime();
  }, [local.updatedAt, remote.updatedAt]);

  return (
    <div className="sync-conflict-overlay" data-testid="sync-conflict-dialog">
      <div className="sync-conflict-card">
        <div className="sync-conflict-title">检测到本地与共享目录的画布数据不一致</div>
        <div className="sync-conflict-subtitle">
          请选择以哪一侧的数据为准。如果不确定，建议先选「本次不同步」，稍后处理。
        </div>

        <div className="sync-conflict-grid">
          <div className={`sync-conflict-col ${!remoteNewer ? 'sync-conflict-col-newer' : ''}`}>
            <div className="sync-conflict-col-head">
              <span className="sync-conflict-col-icon">📍</span>
              <span className="sync-conflict-col-name">本地（当前浏览器）</span>
              {!remoteNewer && local.updatedAt && (
                <span className="sync-conflict-newer-tag">← 较新</span>
              )}
            </div>
            <div className="sync-conflict-row">
              <span>上次保存</span>
              <strong>{formatTime(local.updatedAt)}</strong>
            </div>
            <div className="sync-conflict-row">
              <span>画布数</span>
              <strong>{local.canvasCount}</strong>
            </div>
            <div className="sync-conflict-row">
              <span>节点总数</span>
              <strong>{local.nodeCount}</strong>
            </div>
            <div className="sync-conflict-row">
              <span>大小</span>
              <strong>{formatBytes(local.sizeBytes)}</strong>
            </div>
          </div>

          <div className={`sync-conflict-col ${remoteNewer ? 'sync-conflict-col-newer' : ''}`}>
            <div className="sync-conflict-col-head">
              <span className="sync-conflict-col-icon">☁️</span>
              <span className="sync-conflict-col-name">共享目录</span>
              {remoteNewer && <span className="sync-conflict-newer-tag">← 较新</span>}
            </div>
            <div className="sync-conflict-row">
              <span>上次保存</span>
              <strong>{formatTime(remote.updatedAt)}</strong>
            </div>
            <div className="sync-conflict-row">
              <span>画布数</span>
              <strong>{remote.summary?.canvasCount ?? '—'}</strong>
            </div>
            <div className="sync-conflict-row">
              <span>节点总数</span>
              <strong>{remote.summary?.nodeCount ?? '—'}</strong>
            </div>
            <div className="sync-conflict-row">
              <span>大小</span>
              <strong>{remote.summary ? formatBytes(remote.summary.sizeBytes) : '—'}</strong>
            </div>
          </div>
        </div>

        <div className="sync-conflict-actions">
          <button
            className={`sync-conflict-btn ${remoteNewer ? 'sync-conflict-btn-recommend' : ''}`}
            onClick={() => onChoose('remote_overrides_local')}
            data-testid="sync-conflict-use-remote"
          >
            使用共享目录覆盖本地
            {remoteNewer && <span className="sync-conflict-recommend-tag">推荐</span>}
          </button>
          <button
            className={`sync-conflict-btn ${!remoteNewer ? 'sync-conflict-btn-recommend' : ''}`}
            onClick={() => onChoose('local_overrides_remote')}
            data-testid="sync-conflict-use-local"
          >
            用本地覆盖共享目录
            {!remoteNewer && <span className="sync-conflict-recommend-tag">推荐</span>}
          </button>
          <button
            className="sync-conflict-btn sync-conflict-btn-skip"
            onClick={() => onChoose('skip_this_session')}
            data-testid="sync-conflict-skip"
          >
            本次不同步，稍后处理
          </button>
        </div>

        <div className="sync-conflict-hint">
          数据存放路径：<code>~/.plotmesh/store.json</code>（可通过环境变量 <code>PLOTMESH_DATA_DIR</code> 覆盖）
        </div>
      </div>
    </div>
  );
}
