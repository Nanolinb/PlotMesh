import { Handle, Position } from '@xyflow/react';
import { useState, useEffect, useCallback } from 'react';
import { authFetch } from '../../auth/api';
import { useNodeStore, flushRemoteSyncNow } from '../../store/nodes';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
  [key: string]: any;
};

type Candidate = {
  userId: string;
  name: string;
  email: string;
  color: string;
  role: string;
  unavailable?: boolean;
  availability: {
    activeAssignments: number;
    runningTargets: number;
    pendingRequests: number;
    label: 'relative-load';
    computedAt: number;
  };
  expertise: { score: null; signals: [] };
};

function CrossOutputNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((state) => state.updateNodeData);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '🌐 跨画布输出');
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => { setLocalTitle(data.label || '🌐 跨画布输出'); }, [data.label]);

  const status: string = data.status || 'idle';
  const assignmentStatus: string = data.assignmentStatus || '';
  const targetCanvasName: string = data.targetCanvasName || '';
  const targetNodeId: string = data.targetNodeId || '';
  const hasTarget = !!targetCanvasName && !!targetNodeId;
  const openAssignment = assignmentStatus === 'pending' || assignmentStatus === 'accepted';

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const value = (localTitle || '').trim();
    if (value && value !== data.label) updateNodeData(id, { label: value } as any);
    else setLocalTitle(data.label || '🌐 跨画布输出');
  }, [id, localTitle, data.label, updateNodeData]);

  const assignmentSummary = assignmentStatus === 'pending'
    ? `等待 ${data.assigneeName || '成员'} 接受`
    : assignmentStatus === 'accepted'
      ? `${data.assigneeName || '成员'} 已接受${targetCanvasName ? ` · ${targetCanvasName}` : ''}`
      : assignmentStatus === 'declined'
        ? `${data.assigneeName || '成员'} 已拒绝，可重新指定`
        : assignmentStatus === 'completed'
          ? `${data.assigneeName || '成员'} 已完成`
          : '';

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
              onChange={(event) => setLocalTitle(event.target.value)}
              onBlur={commitTitle}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitTitle();
                if (event.key === 'Escape') {
                  setEditingTitle(false);
                  setLocalTitle(data.label || '');
                }
              }}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <div className="node-title" onDoubleClick={() => setEditingTitle(true)} title="双击改名">
              {data.label || '🌐 跨画布输出'}
            </div>
          )}
        </div>

        <div style={{ padding: '8px 10px', fontSize: 11 }}>
          {assignmentSummary ? (
            <div style={{
              background: assignmentStatus === 'declined' ? 'rgba(239,68,68,0.08)' : 'rgba(99,102,241,0.1)',
              border: `1px solid ${assignmentStatus === 'declined' ? 'rgba(239,68,68,0.3)' : 'rgba(99,102,241,0.3)'}`,
              borderRadius: 4,
              padding: '5px 8px',
              marginBottom: 6,
              color: assignmentStatus === 'declined' ? '#ef4444' : 'var(--text-primary)',
            }}>
              <strong>{assignmentStatus === 'pending' ? '待确认' : assignmentStatus === 'accepted' ? '协作中' : assignmentStatus === 'completed' ? '已完成' : '已拒绝'}</strong>
              <div style={{ marginTop: 2, fontSize: 10, color: 'var(--text-muted)' }}>{assignmentSummary}</div>
            </div>
          ) : hasTarget ? (
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
            <div style={{
              background: 'rgba(245,158,11,0.08)',
              border: '1px dashed rgba(245,158,11,0.4)',
              borderRadius: 4,
              padding: '4px 8px',
              marginBottom: 6,
              color: '#f59e0b',
            }}>
              未配置目标画布或成员
            </div>
          )}

          <button
            className="node-action-btn"
            onClick={(event) => { event.stopPropagation(); if (!openAssignment) setShowPicker(true); }}
            disabled={openAssignment}
            title={openAssignment ? '当前分配待确认或仍在进行，不能重复分配' : undefined}
            style={{ width: '100%', fontSize: 11, padding: '4px 8px', opacity: openAssignment ? 0.55 : 1 }}
          >
            {openAssignment ? (assignmentStatus === 'pending' ? '等待成员确认' : '协作进行中') : hasTarget ? '修改目标' : '配置去向 →'}
          </button>

          {data.output && (
            <div style={{
              marginTop: 6,
              fontSize: 10,
              color: data.status === 'error' ? '#ef4444' : data.status === 'success' ? 'var(--success, #22c55e)' : 'var(--text-muted)',
              maxHeight: 60,
              overflow: 'hidden',
              lineHeight: 1.4,
            }}>
              {data.status === 'error' ? (
                <><strong>投递失败：</strong>{String(data.error || '未知错误')}</>
              ) : data.status === 'success' ? (
                <><strong>已投递：</strong>{String(data.output).slice(0, 80)}{String(data.output).length > 80 ? '…' : ''}</>
              ) : data.status === 'running' ? (
                <><strong>投递中：</strong>{String(data.output).slice(0, 80)}</>
              ) : (
                <><strong>待投递：</strong>{String(data.output).slice(0, 80)}</>
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
          sourceLabel={data.label || '协作任务'}
          currentTargetCanvasId={data.targetCanvasId}
          onClose={() => setShowPicker(false)}
          onConnected={() => setShowPicker(false)}
        />
      )}
    </>
  );
}

export default CrossOutputNode;

type PickerProps = {
  srcCanvasId: string;
  srcNodeId: string;
  sourceLabel: string;
  currentTargetCanvasId?: string;
  onClose: () => void;
  onConnected: () => void;
};

function CrossTargetPicker({ srcCanvasId, srcNodeId, sourceLabel, currentTargetCanvasId, onClose, onConnected }: PickerProps) {
  const [destinationMode, setDestinationMode] = useState<'canvas' | 'person'>('canvas');
  const [canvases, setCanvases] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCanvasId, setSelectedCanvasId] = useState(currentTargetCanvasId || '');
  const [existingCrossInputs, setExistingCrossInputs] = useState<Array<{ id: string; label: string }>>([]);
  const [connectionMode, setConnectionMode] = useState<'auto' | 'pick'>('auto');
  const [pickedNodeId, setPickedNodeId] = useState('');
  const [project, setProject] = useState<{ id: string; name: string } | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [proposedCanvasName, setProposedCanvasName] = useState(sourceLabel);
  const [expertiseTags, setExpertiseTags] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr('');
    const path = destinationMode === 'canvas'
      ? '/api/canvas/list'
      : `/api/assignment/candidates?sourceCanvasId=${encodeURIComponent(srcCanvasId)}`;
    authFetch(path)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || body.message || `HTTP ${response.status}`);
        if (cancelled) return;
        if (destinationMode === 'canvas') {
          setCanvases((body.canvases || [])
            .filter((canvas: any) => !canvas.deleted && canvas.id !== srcCanvasId)
            .map((canvas: any) => ({ id: canvas.id, name: canvas.name || canvas.id })));
        } else {
          setProject(body.project || null);
          setCandidates(body.candidates || []);
        }
      })
      .catch((error) => { if (!cancelled) setErr(`加载失败：${error.message}`); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [destinationMode, srcCanvasId]);

  useEffect(() => {
    if (!selectedCanvasId || destinationMode !== 'canvas') {
      setExistingCrossInputs([]);
      return;
    }
    authFetch(`/api/canvas/${encodeURIComponent(selectedCanvasId)}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        setExistingCrossInputs((body.canvas?.nodes || [])
          .filter((node: any) => (node.data?.type || node.type) === 'crossInput')
          .map((node: any) => ({ id: node.id, label: node.data?.label || node.id, sourceCanvasId: node.data?.sourceCanvasId }))
          .filter((node: any) => !node.sourceCanvasId));
      })
      .catch(() => setExistingCrossInputs([]));
  }, [destinationMode, selectedCanvasId]);

  const chooseCandidate = (candidate: Candidate) => {
    setSelectedUserId(candidate.userId);
    setProposedCanvasName(`${sourceLabel} · ${candidate.name}`);
  };

  const submitDirectCanvas = async () => {
    if (!selectedCanvasId) throw new Error('请先选目标画布');
    if (connectionMode === 'pick' && !pickedNodeId) throw new Error('请选择 crossInput');
    await flushRemoteSyncNow();
    const srcNode = (useNodeStore.getState().nodes as any[]).find((node) => node.id === srcNodeId);
    const body: any = {
      srcCanvasId,
      srcNodeId,
      dstCanvasId: selectedCanvasId,
      srcNodeFallback: srcNode ? {
        id: srcNode.id,
        type: srcNode.type,
        position: srcNode.position,
        data: srcNode.data,
      } : null,
    };
    if (connectionMode === 'pick') body.dstNodeId = pickedNodeId;
    const response = await authFetch('/api/canvas/connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || result.error || `HTTP ${response.status}`);
    const targetCanvas = canvases.find((canvas) => canvas.id === selectedCanvasId);
    const targetNodeId = result.connection?.dstNodeId || result.createdNode?.id;
    useNodeStore.getState().updateNodeData(srcNodeId, {
      targetCanvasId: selectedCanvasId,
      targetCanvasName: targetCanvas?.name || selectedCanvasId,
      targetNodeId,
    } as any);
    try {
      const { reloadCanvasFromServer } = await import('../../store/nodes');
      await reloadCanvasFromServer(selectedCanvasId);
    } catch { /* 下次切换画布时同步 */ }
  };

  const submitPersonAssignment = async () => {
    const candidate = candidates.find((item) => item.userId === selectedUserId);
    if (!candidate) throw new Error('请选择项目成员');
    if (!proposedCanvasName.trim()) throw new Error('请输入下游画布名称');
    const flushed = await flushRemoteSyncNow();
    if (!flushed) throw new Error('当前画布尚未同步，请稍后重试');
    const tags = expertiseTags.split(/[,，\n]/).map((tag) => tag.trim()).filter(Boolean);
    const response = await authFetch('/api/assignment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sourceCanvasId: srcCanvasId,
        sourceNodeId: srcNodeId,
        targetUserId: candidate.userId,
        targetMode: 'create',
        proposedCanvasName: proposedCanvasName.trim(),
        requestedExpertiseTags: tags,
      }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || result.message || `HTTP ${response.status}`);
    useNodeStore.getState().updateNodeData(srcNodeId, {
      assignmentId: result.assignment.id,
      assignmentStatus: 'pending',
      assigneeUserId: candidate.userId,
      assigneeName: candidate.name,
    } as any);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setErr('');
    try {
      if (destinationMode === 'canvas') await submitDirectCanvas();
      else await submitPersonAssignment();
      onConnected();
    } catch (error: any) {
      setErr(`配置失败：${error.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose} onMouseDown={(event) => event.stopPropagation()}>
      <div className="modal-content" style={{ width: 540, maxWidth: '94vw', maxHeight: '86vh', overflowY: 'auto' }} onClick={(event) => event.stopPropagation()}>
        <h3>配置跨画布输出</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 12 }}>
          <button
            onClick={() => setDestinationMode('canvas')}
            style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-color)', background: destinationMode === 'canvas' ? 'var(--accent)' : 'var(--bg-card-body)', color: destinationMode === 'canvas' ? '#fff' : 'var(--text-primary)' }}
          >指定画布</button>
          <button
            onClick={() => setDestinationMode('person')}
            style={{ padding: '7px 10px', borderRadius: 6, border: '1px solid var(--border-color)', background: destinationMode === 'person' ? 'var(--accent)' : 'var(--bg-card-body)', color: destinationMode === 'person' ? '#fff' : 'var(--text-primary)' }}
          >指定成员</button>
        </div>

        {err && <div style={{ background: 'rgba(239,68,68,0.12)', color: '#ef4444', padding: 8, borderRadius: 4, marginBottom: 8 }}>{err}</div>}
        {loading && <div style={{ color: 'var(--text-muted)', padding: 12 }}>加载中…</div>}

        {!loading && destinationMode === 'canvas' && (
          <>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              直接关联已有画布；跨用户画布仍沿用原有引用确认流程。
            </p>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>目标画布</label>
            <select value={selectedCanvasId} onChange={(event) => setSelectedCanvasId(event.target.value)} style={{ width: '100%', padding: '6px 10px', borderRadius: 4, marginBottom: 12 }}>
              <option value="">— 请选择 —</option>
              {canvases.map((canvas) => <option key={canvas.id} value={canvas.id}>{canvas.name}</option>)}
            </select>
            {selectedCanvasId && (
              <>
                <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>关联方式</label>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, marginBottom: 12 }}>
                  <label><input type="radio" checked={connectionMode === 'auto'} onChange={() => setConnectionMode('auto')} /> 自动新建 crossInput</label>
                  <label>
                    <input type="radio" checked={connectionMode === 'pick'} onChange={() => setConnectionMode('pick')} disabled={existingCrossInputs.length === 0} /> 接收已有 crossInput
                    {existingCrossInputs.length === 0 && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>（无空闲节点）</span>}
                  </label>
                </div>
                {connectionMode === 'pick' && existingCrossInputs.length > 0 && (
                  <select value={pickedNodeId} onChange={(event) => setPickedNodeId(event.target.value)} style={{ width: '100%', padding: '6px 10px', borderRadius: 4, marginBottom: 12 }}>
                    <option value="">— 选 crossInput —</option>
                    {existingCrossInputs.map((node) => <option key={node.id} value={node.id}>{node.label}</option>)}
                  </select>
                )}
              </>
            )}
          </>
        )}

        {!loading && destinationMode === 'person' && (
          <>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 8 }}>
              从项目 <strong>{project?.name || 'Flex Pool'}</strong> 的人员候选池发起邀请。成员接受前不会创建画布、授权或连接。
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <label style={{ fontSize: 11, color: 'var(--text-secondary)' }}>排序</label>
              <select value="relative-load" onChange={() => undefined} style={{ padding: '4px 7px', borderRadius: 4 }}>
                <option value="relative-load">相对空闲</option>
                <option value="expertise" disabled>任务擅长度</option>
              </select>
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>任务擅长度：需要能力与历史数据积累</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {candidates.length === 0 && <div style={{ padding: 12, color: 'var(--text-muted)' }}>项目 Flex Pool 暂无人员</div>}
              {candidates.map((candidate) => (
                <button
                  key={candidate.userId}
                  disabled={candidate.unavailable}
                  onClick={() => chooseCandidate(candidate)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', textAlign: 'left',
                    borderRadius: 6, border: selectedUserId === candidate.userId ? '1px solid var(--accent)' : '1px solid var(--border-color)',
                    background: selectedUserId === candidate.userId ? 'var(--accent-bg)' : 'var(--bg-card-body)',
                    color: 'var(--text-primary)', opacity: candidate.unavailable ? 0.5 : 1,
                  }}
                >
                  <span style={{ width: 10, height: 10, borderRadius: '50%', background: candidate.color, flexShrink: 0 }} />
                  <span style={{ flex: 1 }}>
                    <strong style={{ fontSize: 12 }}>{candidate.name}</strong>
                    <span style={{ marginLeft: 6, fontSize: 10, color: 'var(--text-muted)' }}>{candidate.role}</span>
                    <span style={{ display: 'block', marginTop: 2, fontSize: 10, color: 'var(--text-secondary)' }}>
                      活跃分配 {candidate.availability.activeAssignments} · 运行目标 {candidate.availability.runningTargets} · 待确认 {candidate.availability.pendingRequests}
                    </span>
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>擅长度待积累</span>
                </button>
              ))}
            </div>
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>下游画布名称</label>
            <input value={proposedCanvasName} onChange={(event) => setProposedCanvasName(event.target.value)} placeholder="成员接受后创建" style={{ width: '100%', boxSizing: 'border-box', padding: '6px 10px', borderRadius: 4, marginBottom: 10 }} />
            <label style={{ display: 'block', fontSize: 12, marginBottom: 4, fontWeight: 600 }}>期望能力标签（可选）</label>
            <input value={expertiseTags} onChange={(event) => setExpertiseTags(event.target.value)} placeholder="例如：数据分析，文案；仅记录，不参与当前排序" style={{ width: '100%', boxSizing: 'border-box', padding: '6px 10px', borderRadius: 4, marginBottom: 10 }} />
          </>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>取消</button>
          <button
            className="primary"
            onClick={handleSubmit}
            disabled={submitting || loading || (destinationMode === 'canvas' ? !selectedCanvasId || (connectionMode === 'pick' && !pickedNodeId) : !selectedUserId || !proposedCanvasName.trim())}
          >
            {submitting ? '提交中…' : destinationMode === 'person' ? '发送分配请求' : '确认关联'}
          </button>
        </div>
      </div>
    </div>
  );
}
