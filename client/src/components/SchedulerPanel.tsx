/**
 * SchedulerPanel · v1.7 alpha P1 第二刀
 * ----------------------------------------------------------------
 * 定时任务管理面板。CRUD 走 server REST `/api/canvas/_schedules`。
 * 用 modal 形态弹出，外层在 toolbar 加 ⏰ 按钮调用。
 *
 * 表达式格式（与 server scheduler.js 保持一致）：
 *   - every:60s / every:5m / every:1h
 *   - daily:HH:MM
 */
import { useState, useEffect, useCallback } from 'react';
import { useNodeStore } from '../store/nodes';
import { authFetch } from '../auth/api';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface Schedule {
  id: string;
  canvasId: string;
  name: string;
  expr: string;
  enabled: boolean;
  description: string;
  createdAt: number;
  lastRunAt: number | null;
  nextRunAt: number | null;
  lastJobId: string | null;
  lastStatus: string | null;
}

const fmtTime = (t: number | null) => {
  if (!t) return '—';
  return new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
};

export default function SchedulerPanel({ open, onClose }: Props) {
  const recentCanvases = useNodeStore((s) => s.recentCanvases);
  const activeCanvasId = useNodeStore((s) => s.activeCanvasId);
  const activeCanvasName = useNodeStore((s) => s.activeCanvasName);
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // 表单
  const [formCanvasId, setFormCanvasId] = useState<string>('');
  const [formName, setFormName] = useState('');
  const [formMode, setFormMode] = useState<'every' | 'daily'>('every');
  const [formEveryN, setFormEveryN] = useState(5);
  const [formEveryUnit, setFormEveryUnit] = useState<'s' | 'm' | 'h'>('m');
  const [formDailyHH, setFormDailyHH] = useState(9);
  const [formDailyMM, setFormDailyMM] = useState(30);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const r = await authFetch('/api/canvas/_schedules');
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setSchedules(j.schedules || []);
    } catch (e: any) {
      setErr(e.message || '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      refresh();
      // 刚打开时默认选当前画布
      if (activeCanvasId) setFormCanvasId(activeCanvasId);
      // 每 5 秒自动刷新（看到 cron 实际触发）
      const t = setInterval(refresh, 5000);
      return () => clearInterval(t);
    }
  }, [open, refresh, activeCanvasId]);

  const buildExpr = () => {
    if (formMode === 'every') return `every:${formEveryN}${formEveryUnit}`;
    return `daily:${String(formDailyHH).padStart(2, '0')}:${String(formDailyMM).padStart(2, '0')}`;
  };

  const handleCreate = async () => {
    if (!formCanvasId) { alert('请选择目标画布'); return; }
    const expr = buildExpr();
    try {
      const r = await authFetch('/api/canvas/_schedules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          canvasId: formCanvasId,
          name: formName.trim() || undefined,
          expr,
          enabled: true,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setFormName('');
      refresh();
    } catch (e: any) {
      alert('创建失败：' + e.message);
    }
  };

  const handleToggle = async (sch: Schedule) => {
    try {
      const r = await authFetch(`/api/canvas/_schedules/${sch.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !sch.enabled }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      refresh();
    } catch (e: any) {
      alert('切换失败：' + e.message);
    }
  };

  const handleDelete = async (sch: Schedule) => {
    if (!confirm(`删除「${sch.name}」？`)) return;
    try {
      const r = await authFetch(`/api/canvas/_schedules/${sch.id}`, {
        method: 'DELETE',
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      refresh();
    } catch (e: any) {
      alert('删除失败：' + e.message);
    }
  };

  const canvasName = (id: string): string => {
    if (id === activeCanvasId) return activeCanvasName || id;
    const r = recentCanvases.find((rc) => rc.id === id);
    return r?.name || id;
  };

  if (!open) return null;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--bg-card)', color: 'var(--text-primary)',
          width: 720, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,0.25)',
          border: '1px solid var(--border-color)',
        }}
      >
        <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-color)', display: 'flex', alignItems: 'center' }}>
          <h3 style={{ margin: 0, fontSize: 15, flex: 1 }}>⏰ 定时任务</h3>
          <button onClick={onClose} style={{ background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', color: 'inherit' }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px' }}>
          {/* 创建表单 */}
          <div style={{
            background: 'rgba(99,102,241,0.05)',
            border: '1px solid var(--border-color)', borderRadius: 8, padding: 12, marginBottom: 16,
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>新建定时任务</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 8, fontSize: 12, alignItems: 'center' }}>
              <label>画布：</label>
              <select
                value={formCanvasId}
                onChange={(e) => setFormCanvasId(e.target.value)}
                style={{ fontSize: 12, padding: '4px 6px' }}
              >
                <option value="">— 选择画布 —</option>
                {activeCanvasId && (
                  <option value={activeCanvasId}>★ 当前：{activeCanvasName || activeCanvasId}</option>
                )}
                {recentCanvases.filter((c) => c.id !== activeCanvasId).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>

              <label>名称：</label>
              <input
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="留空 = 用表达式描述"
                style={{ fontSize: 12, padding: '4px 6px' }}
              />

              <label>触发：</label>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                  <input type="radio" checked={formMode === 'every'} onChange={() => setFormMode('every')} />
                  每隔
                </label>
                {formMode === 'every' && (
                  <>
                    <input
                      type="number" min={1}
                      value={formEveryN}
                      onChange={(e) => setFormEveryN(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      style={{ width: 60, fontSize: 12, padding: '4px 6px' }}
                    />
                    <select value={formEveryUnit} onChange={(e) => setFormEveryUnit(e.target.value as any)} style={{ fontSize: 12, padding: '4px 6px' }}>
                      <option value="s">秒</option>
                      <option value="m">分钟</option>
                      <option value="h">小时</option>
                    </select>
                  </>
                )}
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3, marginLeft: 12 }}>
                  <input type="radio" checked={formMode === 'daily'} onChange={() => setFormMode('daily')} />
                  每天
                </label>
                {formMode === 'daily' && (
                  <>
                    <input
                      type="number" min={0} max={23}
                      value={formDailyHH}
                      onChange={(e) => setFormDailyHH(Math.max(0, Math.min(23, parseInt(e.target.value, 10) || 0)))}
                      style={{ width: 50, fontSize: 12, padding: '4px 6px' }}
                    />
                    <span>:</span>
                    <input
                      type="number" min={0} max={59}
                      value={formDailyMM}
                      onChange={(e) => setFormDailyMM(Math.max(0, Math.min(59, parseInt(e.target.value, 10) || 0)))}
                      style={{ width: 50, fontSize: 12, padding: '4px 6px' }}
                    />
                  </>
                )}
              </div>

              <div></div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <code style={{ fontSize: 11, background: 'rgba(0,0,0,0.06)', padding: '2px 6px', borderRadius: 3 }}>{buildExpr()}</code>
                <button
                  onClick={handleCreate}
                  disabled={!formCanvasId}
                  style={{
                    background: formCanvasId ? '#6366f1' : '#cbd5e1',
                    color: 'white', border: 'none', borderRadius: 4,
                    padding: '6px 12px', fontSize: 12, cursor: formCanvasId ? 'pointer' : 'not-allowed',
                  }}
                >
                  ＋ 创建
                </button>
              </div>
            </div>
          </div>

          {/* 列表 */}
          <div style={{ fontSize: 12, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 600 }}>当前任务（{schedules.length}）</span>
            <button
              onClick={refresh}
              disabled={loading}
              style={{ fontSize: 11, padding: '2px 8px', cursor: loading ? 'wait' : 'pointer' }}
            >🔄 刷新</button>
            {err && <span style={{ color: '#ef4444', fontSize: 11 }}>⚠️ {err}</span>}
          </div>

          {schedules.length === 0 ? (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>
              {loading ? '加载中…' : '暂无定时任务，用上面的表单创建一个'}
            </div>
          ) : (
            <table style={{ width: '100%', fontSize: 11, borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.04)' }}>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>名称</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>画布</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>触发</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>下次</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>上次</th>
                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>状态</th>
                  <th style={{ padding: '6px 8px', textAlign: 'right' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((s) => (
                  <tr key={s.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td style={{ padding: '6px 8px' }}>{s.name}</td>
                    <td style={{ padding: '6px 8px', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.canvasId}>
                      {canvasName(s.canvasId)}
                    </td>
                    <td style={{ padding: '6px 8px' }}>{s.description}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{fmtTime(s.nextRunAt)}</td>
                    <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{fmtTime(s.lastRunAt)}</td>
                    <td style={{ padding: '6px 8px' }}>
                      {s.lastStatus === 'succeeded' && <span style={{ color: '#10b981' }}>✅</span>}
                      {s.lastStatus === 'failed' && <span style={{ color: '#ef4444' }}>❌</span>}
                      {!s.lastStatus && <span style={{ color: 'var(--text-muted)' }}>—</span>}
                    </td>
                    <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        onClick={() => handleToggle(s)}
                        style={{
                          background: s.enabled ? '#10b981' : '#94a3b8',
                          color: 'white', border: 'none', borderRadius: 3,
                          padding: '3px 8px', fontSize: 11, cursor: 'pointer', marginRight: 4,
                        }}
                        title={s.enabled ? '点击暂停' : '点击启用'}
                      >
                        {s.enabled ? '运行中' : '已暂停'}
                      </button>
                      <button
                        onClick={() => handleDelete(s)}
                        style={{ background: 'transparent', border: '1px solid var(--border-color)', color: 'inherit', borderRadius: 3, padding: '3px 8px', fontSize: 11, cursor: 'pointer' }}
                      >🗑</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div style={{ marginTop: 16, padding: '8px 10px', background: 'rgba(99,102,241,0.05)', borderRadius: 4, fontSize: 11, color: 'var(--text-muted)' }}>
            💡 定时任务在 server 端执行，不需要前端打开。重启 server 后任务会自动恢复（持久化在 ~/.plotmesh/schedules.json）。<br />
            含 <code>fileUpload</code> 节点的画布无法被定时跑（文件在浏览器内存里）。
          </div>
        </div>
      </div>
    </div>
  );
}
