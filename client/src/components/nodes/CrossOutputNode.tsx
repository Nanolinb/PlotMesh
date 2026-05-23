/**
 * CrossOutputNode · 跨画布输出节点（v1.7 P2-A）
 * ---------------------------------------------------------------
 * 把上游内容投递到另一个画布的 crossInput。配置流程：
 *   1. 双击节点 / 点 ⚙ → 打开"选目标画布"弹窗
 *   2. 选画布 + （可选）选已有 crossInput 节点
 *   3. server 自动建 connection；如目标画布无对应 crossInput 则自动 create 一个
 *
 * 节点上显示当前去向 chip：🌐 → 画布B / 节点Y
 *
 * 触发开关：在画布内连一条边到本画布的 crossInput 上 → "我在等结果" → 自动 cascade
 */
import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback } from 'react';
import { useNodeStore, flushRemoteSyncNow } from '../../store/nodes';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
  [key: string]: any;
};

function CrossOutputNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '🌐 跨画布输出');
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => { setLocalTitle(data.label || '🌐 跨画布输出'); }, [data.label]);

  const status: string = data.status || 'idle';
  const targetCanvasName: string = data.targetCanvasName || '';
  const targetNodeId: string = data.targetNodeId || '';
  const hasTarget = !!targetCanvasName && !!targetNodeId;

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = (localTitle || '').trim();
    if (v && v !== data.label) updateNodeData(id, { label: v } as any);
    else setLocalTitle(data.label || '🌐 跨画布输出');
  }, [id, localTitle, data.label, updateNodeData]);

  return (
    <>
      <div
        className={`node-card${selected ? ' selected' : ''} cross-output-node`}
        data-status={status}
        style={{ minWidth: 220, borderLeft: '3px solid #6366f1' }}
      >
        <Handle type="target" position={Position.Left} />
        <div className="node-header">
          {editingTitle ? (
            <input
              autoFocus
              className="node-title-input"
              value={localTitle}
              onChange={(e) => setLocalTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || ''); } }}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div className="node-title" onDoubleClick={() => setEditingTitle(true)} title="双击改名">
              {data.label || '🌐 跨画布输出'}
            </div>
          )}
        </div>

        <div style={{ padding: '8px 10px', fontSize: 11 }}>
          {hasTarget ? (
            <div
              style={{
                background: 'rgba(99,102,241,0.1)',
                border: '1px solid rgba(99,102,241,0.3)',
                borderRadius: 4,
                padding: '4px 8px',
                marginBottom: 6,
                color: 'var(--text-primary)',
              }}
              title={`目标：${targetCanvasName} / ${targetNodeId}`}
            >
              🌐 → <strong>{targetCanvasName}</strong>
              <div style={{ fontSize: 10, color: 'var(--text-muted)', wordBreak: 'break-all' }}>
                {targetNodeId.slice(0, 30)}{targetNodeId.length > 30 ? '...' : ''}
              </div>
            </div>
          ) : (
            <div
              style={{
                background: 'rgba(245,158,11,0.08)',
                border: '1px dashed rgba(245,158,11,0.4)',
                borderRadius: 4,
                padding: '4px 8px',
                marginBottom: 6,
                color: '#f59e0b',
              }}
            >
              ⚠️ 未配置目标画布
            </div>
          )}

          <button
            className="node-action-btn"
            onClick={(e) => { e.stopPropagation(); setShowPicker(true); }}
            style={{ width: '100%', fontSize: 11, padding: '4px 8px' }}
          >
            {hasTarget ? '⚙ 修改目标' : '配置目标画布 →'}
          </button>

          {data.output && (
            <div
              style={{
                marginTop: 6,
                fontSize: 10,
                color:
                  data.status === 'error'
                    ? '#ef4444'
                    : data.status === 'success'
                    ? 'var(--success, #22c55e)'
                    : 'var(--text-muted)',
                maxHeight: 60,
                overflow: 'hidden',
                lineHeight: 1.4,
              }}
            >
              {data.status === 'error' ? (
                <>
                  <strong>❌ 投递失败：</strong>{String((data as any).error || '未知错误')}
                </>
              ) : data.status === 'success' ? (
                <>
                  <strong>✓ 已投递：</strong>{String(data.output).slice(0, 80)}
                  {String(data.output).length > 80 ? '…' : ''}
                </>
              ) : data.status === 'running' ? (
                <>
                  <strong>⏳ 投递中：</strong>{String(data.output).slice(0, 80)}
                </>
              ) : (
                <>
                  <strong>待投递：</strong>{String(data.output).slice(0, 80)}
                </>
              )}
            </div>
          )}
        </div>

        <Handle type="source" position={Position.Right} />
      </div>

      {showPicker && (
        <CrossTargetPicker
          srcCanvasId={useNodeStore.getState().activeCanvasId || ''}
          srcNodeId={id}
          currentTargetCanvasId={data.targetCanvasId}
          onClose={() => setShowPicker(false)}
          onConnected={() => {
            setShowPicker(false);
          }}
        />
      )}
    </>
  );
}

export default CrossOutputNode;

// ─── 选目标画布弹窗 ───────────────────────────────────────────────

type PickerProps = {
  srcCanvasId: string;
  srcNodeId: string;
  currentTargetCanvasId?: string;
  onClose: () => void;
  onConnected: () => void;
};

function CrossTargetPicker({ srcCanvasId, srcNodeId, currentTargetCanvasId, onClose, onConnected }: PickerProps) {
  const [canvases, setCanvases] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCanvasId, setSelectedCanvasId] = useState<string>(currentTargetCanvasId || '');
  const [existingCrossInputs, setExistingCrossInputs] = useState<Array<{ id: string; label: string }>>([]);
  const [mode, setMode] = useState<'auto' | 'pick'>('auto');
  const [pickedNodeId, setPickedNodeId] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string>('');

  // 拉所有画布
  useEffect(() => {
    fetch('/api/canvas/list')
      .then((r) => r.json())
      .then((d) => {
        const list = (d.canvases || [])
          .filter((c: any) => !c.deleted && c.id !== srcCanvasId)
          .map((c: any) => ({ id: c.id, name: c.name || c.id }));
        setCanvases(list);
        setLoading(false);
      })
      .catch((e) => {
        setErr(`加载画布列表失败：${e.message}`);
        setLoading(false);
      });
  }, [srcCanvasId]);

  // 当选了画布，拉它的 crossInput 节点
  useEffect(() => {
    if (!selectedCanvasId) { setExistingCrossInputs([]); return; }
    fetch(`/api/canvas/${selectedCanvasId}`)
      .then((r) => r.json())
      .then((d) => {
        const cis = (d.canvas?.nodes || [])
          .filter((n: any) => (n.data?.type || n.type) === 'crossInput')
          .map((n: any) => ({
            id: n.id,
            label: n.data?.label || n.id,
            sourceCanvasId: n.data?.sourceCanvasId,
          }))
          // 已经被别人占用的不显示
          .filter((n: any) => !n.sourceCanvasId);
        setExistingCrossInputs(cis);
      })
      .catch(() => setExistingCrossInputs([]));
  }, [selectedCanvasId]);

  const handleSubmit = async () => {
    if (!selectedCanvasId) { setErr('请先选目标画布'); return; }
    setSubmitting(true);
    setErr('');
    try {
      // v1.7 P2-A 关键修复：先把本地 IDB 强制 flush 到 server。
      // 即使 flush 失败也不阻塞 —— POST /connections 带 srcNodeFallback 兜底，
      // server 端找不到节点会用 fallback 自动 create。
      console.log('[plotmesh] CrossOutput 配置：开始 flushRemoteSyncNow...');
      const flushed = await flushRemoteSyncNow();
      console.log('[plotmesh] CrossOutput 配置：flushRemoteSyncNow 返回', flushed);

      // 拿到当前 src 节点的完整数据，作为 server 兜底用
      const allNodes = useNodeStore.getState().nodes as any[];
      const srcNode = allNodes.find((n) => n.id === srcNodeId);
      const srcNodeFallback = srcNode ? {
        id: srcNode.id,
        type: srcNode.type,
        position: srcNode.position,
        data: srcNode.data,
      } : null;

      const body: any = {
        srcCanvasId,
        srcNodeId,
        dstCanvasId: selectedCanvasId,
        srcNodeFallback,
      };
      if (mode === 'pick' && pickedNodeId) body.dstNodeId = pickedNodeId;
      const r = await fetch('/api/canvas/connections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || `HTTP ${r.status}`);
      // 把 target 信息写到本地节点 data，避免等同步刷新
      const targetCanvas = canvases.find((c) => c.id === selectedCanvasId);
      const conn = data.connection;
      const dstNodeId = conn?.dstNodeId || data.createdNode?.id;
      useNodeStore.getState().updateNodeData(srcNodeId, {
        targetCanvasId: selectedCanvasId,
        targetCanvasName: targetCanvas?.name || selectedCanvasId,
        targetNodeId: dstNodeId,
      } as any);
      // server 端在 dst 画布上自动建了 crossInput 节点，需要把 server 最新画布拉回前端
      // （否则切到 dst 画布看不到自动建的 crossInput）
      // 这里先 reload，让 server 的画布数据覆盖本地
      try {
        const { reloadCanvasFromServer } = await import('../../store/nodes');
        if (typeof reloadCanvasFromServer === 'function') {
          await reloadCanvasFromServer(selectedCanvasId);
        }
      } catch { /* 没有此 API 就跳过；下次切画布时会拉到 */ }
      onConnected();
    } catch (e: any) {
      setErr(`配置失败：${e.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} onMouseDown={(e) => e.stopPropagation()}>
      <div className="modal-content" style={{ width: 480, maxWidth: '94vw' }} onClick={(e) => e.stopPropagation()}>
        <h3>🌐 配置跨画布输出</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
          选定后，本节点跑完时会把输出投递到目标画布的 crossInput。
          如果想"投出去就等结果"，请在画布内连一条边从本节点到一个 crossInput 节点。
        </p>

        {loading && <div>加载画布列表...</div>}
        {err && <div style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', padding: 8, borderRadius: 4, marginBottom: 8 }}>{err}</div>}

        {!loading && (
          <>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>目标画布</label>
            <select
              value={selectedCanvasId}
              onChange={(e) => setSelectedCanvasId(e.target.value)}
              style={{ width: '100%', padding: '6px 10px', borderRadius: 4, marginBottom: 12 }}
            >
              <option value="">— 请选择 —</option>
              {canvases.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>

            {selectedCanvasId && (
              <>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>关联方式</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, marginBottom: 12 }}>
                  <label>
                    <input type="radio" checked={mode === 'auto'} onChange={() => setMode('auto')} />
                    {' '}🆕 自动在目标画布上新建 crossInput（推荐）
                  </label>
                  <label>
                    <input
                      type="radio"
                      checked={mode === 'pick'}
                      onChange={() => setMode('pick')}
                      disabled={existingCrossInputs.length === 0}
                    />
                    {' '}🔗 接收已有的 crossInput
                    {existingCrossInputs.length === 0 && (
                      <span style={{ color: 'var(--text-muted)', fontSize: 11, marginLeft: 6 }}>
                        （目标画布无空闲 crossInput）
                      </span>
                    )}
                  </label>
                </div>

                {mode === 'pick' && existingCrossInputs.length > 0 && (
                  <select
                    value={pickedNodeId}
                    onChange={(e) => setPickedNodeId(e.target.value)}
                    style={{ width: '100%', padding: '6px 10px', borderRadius: 4, marginBottom: 12 }}
                  >
                    <option value="">— 选 crossInput —</option>
                    {existingCrossInputs.map((n) => (
                      <option key={n.id} value={n.id}>{n.label} ({n.id.slice(0, 20)})</option>
                    ))}
                  </select>
                )}
              </>
            )}
          </>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            onClick={handleSubmit}
            disabled={submitting || !selectedCanvasId || (mode === 'pick' && !pickedNodeId)}
          >
            {submitting ? '配置中...' : '确认'}
          </button>
        </div>
      </div>
    </div>
  );
}
