/**
 * App.tsx · v1.5 D2 启动 gate
 *
 * 启动流程：
 *   1) 等待 LS → IDB 一次性迁移完成
 *   2) 等待 hydrate（从 IDB 把 nodes / edges / packages / 最近画布 灌进 store）
 *   3) 渲染 <Canvas/>
 *
 * 在 1+2 完成前，UI 显示一个极简 loading，避免 store 还是空状态时让用户先看到空画布。
 */
import { useEffect, useState } from 'react';
import Canvas from './components/Canvas';
import './App.css';
import { migrateFromLocalStorageIfNeeded } from './store/migration';
import { hydrateNodeStore } from './store/nodes';

function App() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await migrateFromLocalStorageIfNeeded();
        await hydrateNodeStore();
        if (!cancelled) setReady(true);
      } catch (e: any) {
        console.error('[plotmesh] 启动失败：', e);
        if (!cancelled) setError(e?.message || '启动失败');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
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
        <div style={{ color: '#94a3b8', fontSize: 13 }}>{error}</div>
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

  if (!ready) {
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
        <div data-testid="plotmesh-loading">加载中…</div>
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
