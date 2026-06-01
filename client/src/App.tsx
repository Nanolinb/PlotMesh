/**
 * App.tsx · v1.5.2 启动 gate（含三向合并冲突解决）
 *
 * 启动流程：
 *   1) 等待 LS → IDB 一次性迁移完成
 *   2) 调 /api/sync/meta + /api/sync/snapshot，跑三向合并：
 *      - server 不可用 / 远端无数据 → 直接进 hydrate
 *      - 合并无冲突 + 无 autoChanges → 直接 hydrate
 *      - 合并有 autoChanges 但无冲突 → 自动 apply + 推 server，不弹窗
 *      - 合并有冲突（同 id 画布两边都改） → 弹 MergeReportDialog 等用户决策
 *   3) hydrate 完成 → 渲染 <Canvas/>
 *
 * 决策语义：
 *   - keep_local：用本地版本覆盖该画布
 *   - keep_remote：用远端版本覆盖该画布
 *   - keep_both：本地版本保留 + 远端版本以新 id「(远端版)」副本形式追加
 */
import { useEffect, useState } from 'react';
import Canvas from './components/Canvas';
import MergeReportDialog, { type ConflictResolution } from './components/MergeReportDialog';
import LoginPage from './auth/LoginPage';
import { useAuth } from './auth/authContext';
import './App.css';
import { migrateFromLocalStorageIfNeeded } from './store/migration';
import { hydrateNodeStore } from './store/nodes';
import {
  planSync,
  applyMerged,
  pushSnapshot,
  computeLocalSummary,
  setKnownRemoteVersion,
  setSkipThisSession,
  setSyncBase,
  buildBaseFromMerged,
  recordSyncDecision,
  type SnapshotPayload,
} from './store/syncAdapter';
import type { CanvasConflict, AutoMergeChange } from './store/syncMerge';
import type { Canvas as CanvasRecord } from './types/db';

type SyncStage =
  | { kind: 'init' }
  | { kind: 'checking-sync' }
  | { kind: 'merge-conflict'; conflicts: CanvasConflict[]; autoChanges: AutoMergeChange[]; remoteVersion: number; merged: any }
  | { kind: 'applying'; label: string }
  | { kind: 'hydrating' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

function App() {
  const [stage, setStage] = useState<SyncStage>({ kind: 'init' });
  const auth = useAuth();

  // v2.0-α Phase A：启动 gate 前先等 auth 检测完毕
  const authReady = auth.phase === 'optional' || auth.phase === 'ready';

  useEffect(() => {
    if (!authReady) return; // auth 没确定前，什么都不做
    let cancelled = false;
    (async () => {
      try {
        await migrateFromLocalStorageIfNeeded();
        if (cancelled) return;

        setStage({ kind: 'checking-sync' });
        const plan = await planSync();

        if (!plan) {
          // server 不可用 / 远端无数据 —— 直接 hydrate
          await recordSyncDecision('server_unavailable');
          if (cancelled) return;
          setStage({ kind: 'hydrating' });
          await hydrateNodeStore();
          if (!cancelled) setStage({ kind: 'ready' });
          return;
        }

        const { remoteMeta, remoteFullVersion, result } = plan;

        if (result.conflicts.length === 0 && result.autoChanges.length === 0) {
          // 完全一致 —— 记录 base 后直接进
          setKnownRemoteVersion(remoteMeta.version);
          await setSyncBase(buildBaseFromMerged(remoteMeta.version, result));
          await recordSyncDecision('in_sync');
          setStage({ kind: 'hydrating' });
          await hydrateNodeStore();
          if (!cancelled) setStage({ kind: 'ready' });
          return;
        }

        if (result.conflicts.length === 0) {
          // 只有自动合并项，无真冲突 —— 静默 apply + 推 server
          setStage({ kind: 'applying', label: '正在合并差异…' });
          await applyMerged(result);
          // 推一次给 server 让 hash 对齐
          const fresh = await computeLocalSummary();
          const r = await pushSnapshot(remoteFullVersion, fresh.payload, {
            canvasCount: fresh.summary.canvasCount,
            nodeCount: fresh.summary.nodeCount,
            sizeBytes: fresh.summary.sizeBytes,
          });
          if (r.ok) {
            setKnownRemoteVersion(r.version);
            await setSyncBase(buildBaseFromMerged(r.version, result));
          } else if (r.conflict) {
            // 合并期间另一浏览器又写了 —— 重新规划
            console.warn('[plotmesh] 合并推送时遇到 409，重新规划');
            // 简化处理：把"重新规划"留给下次启动
            setKnownRemoteVersion(r.current.version);
          }
          setStage({ kind: 'hydrating' });
          await hydrateNodeStore();
          if (!cancelled) setStage({ kind: 'ready' });
          return;
        }

        // 有真冲突 —— 弹窗等用户决策
        setStage({
          kind: 'merge-conflict',
          conflicts: result.conflicts,
          autoChanges: result.autoChanges,
          remoteVersion: remoteFullVersion,
          merged: result,
        });
      } catch (e: any) {
        console.error('[plotmesh] 启动失败：', e);
        if (!cancelled) setStage({ kind: 'error', message: e?.message || '启动失败' });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady]);

  /** 用户决策完所有冲突后：组装最终实体集合 + apply + push + hydrate */
  const handleConflictsResolved = async (resolutions: Record<string, ConflictResolution>) => {
    if (stage.kind !== 'merge-conflict') return;
    const { conflicts, merged, remoteVersion } = stage;
    try {
      setStage({ kind: 'applying', label: '正在应用合并…' });

      // 把每条冲突按用户选择展开成实际要写的 canvas
      const finalCanvases: CanvasRecord[] = [...merged.canvases];
      for (const c of conflicts) {
        const r = resolutions[c.id];
        if (r === 'keep_local') {
          finalCanvases.push(c.local);
        } else if (r === 'keep_remote') {
          finalCanvases.push(c.remote);
        } else if (r === 'keep_both') {
          // 本地版保留原 id；远端版复制成新 id「(远端版)」副本
          finalCanvases.push(c.local);
          const dupId = `${c.remote.id}-remote-copy-${Date.now().toString(36)}`;
          const dup: CanvasRecord = {
            ...c.remote,
            id: dupId,
            name: `${c.remote.name || '画布'} (远端版)`,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          finalCanvases.push(dup);
        }
      }

      const finalMerged = { ...merged, canvases: finalCanvases };
      await applyMerged(finalMerged);

      // 推一次给 server 让对方拉到我们决策后的版本
      const fresh = await computeLocalSummary();
      const r = await pushSnapshot(remoteVersion, fresh.payload, {
        canvasCount: fresh.summary.canvasCount,
        nodeCount: fresh.summary.nodeCount,
        sizeBytes: fresh.summary.sizeBytes,
      });
      let newVersion = remoteVersion;
      if (r.ok) {
        newVersion = r.version;
        setKnownRemoteVersion(r.version);
      } else if (r.conflict) {
        // 罕见：另一浏览器抢先 PUT 了 —— 这次合并算半成品落本地了，
        // 下次启动会再触发合并流程
        console.warn('[plotmesh] 合并 PUT 收 409，等下次启动再合一次');
        setKnownRemoteVersion(r.current.version);
        newVersion = r.current.version;
      }
      await setSyncBase(buildBaseFromMerged(newVersion, finalMerged));

      await recordSyncDecision('local_overrides_remote'); // 复用既有枚举值；详细决策在 last-synced-base 里

      setStage({ kind: 'hydrating' });
      await hydrateNodeStore();
      setStage({ kind: 'ready' });
    } catch (e: any) {
      console.error('[plotmesh] 合并应用失败：', e);
      setStage({ kind: 'error', message: e?.message || '合并应用失败' });
    }
  };

  const handleSkip = async () => {
    if (stage.kind !== 'merge-conflict') return;
    setSkipThisSession(true);
    setKnownRemoteVersion(stage.remoteVersion);
    await recordSyncDecision('skip_this_session');
    setStage({ kind: 'hydrating' });
    await hydrateNodeStore();
    setStage({ kind: 'ready' });
  };

  if (auth.phase === 'checking') {
    return (
      <div
        className="app"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--text-muted, #94a3b8)',
          fontSize: 14,
        }}
      >
        <div>检测认证状态…</div>
      </div>
    );
  }

  if (auth.phase === 'login' || auth.phase === 'register') {
    return <LoginPage />;
  }

  if (auth.phase === 'error') {
    return (
      <div
        className="app"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          flexDirection: 'column',
          gap: 12,
          padding: 24,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>⚠️ 认证服务不可用</div>
        <div style={{ color: '#94a3b8', fontSize: 13 }}>
          无法连接到 PlotMesh 认证服务，请检查 server 是否启动。
        </div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '6px 16px',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: 6,
            background: 'var(--bg-2, #fff)',
            cursor: 'pointer',
          }}
        >
          重新加载
        </button>
      </div>
    );
  }

  // 以下进入现有启动流程（sync + hydrate）

  if (stage.kind === 'error') {
    return (
      <div
        className="app"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          flexDirection: 'column',
          gap: 12,
          padding: 24,
        }}
      >
        <div style={{ fontSize: 18, fontWeight: 600 }}>⚠️ 启动失败</div>
        <div style={{ color: '#94a3b8', fontSize: 13 }}>{stage.message}</div>
        <button
          onClick={() => window.location.reload()}
          style={{
            padding: '6px 16px',
            border: '1px solid var(--border, #e2e8f0)',
            borderRadius: 6,
            background: 'var(--bg-2, #fff)',
            cursor: 'pointer',
          }}
        >
          重新加载
        </button>
      </div>
    );
  }

  if (stage.kind === 'merge-conflict') {
    return (
      <div className="app">
        <MergeReportDialog
          conflicts={stage.conflicts}
          autoChanges={stage.autoChanges}
          onResolved={handleConflictsResolved}
          onSkip={handleSkip}
        />
      </div>
    );
  }

  if (stage.kind !== 'ready') {
    const label =
      stage.kind === 'checking-sync'
        ? '检查共享目录…'
        : stage.kind === 'applying'
        ? stage.label
        : stage.kind === 'hydrating'
        ? '加载画布…'
        : '加载中…';
    return (
      <div
        className="app"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          color: 'var(--text-muted, #94a3b8)',
          fontSize: 14,
        }}
      >
        <div data-testid="plotmesh-loading">{label}</div>
      </div>
    );
  }

  return (
    <div className="app">
      <Canvas />
    </div>
  );
}

export default App;
