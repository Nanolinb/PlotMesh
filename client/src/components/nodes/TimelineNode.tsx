/**
 * TimelineNode · 时间轴节点
 * ---------------------------------------------------------------
 * 工作流里的"时序控制器"：在画布上呈现一条横向时间轴，作为镜头/输出在
 * 不同时间点呈现内容的调度中心。
 *
 * 数据模型（保存在 data 字段里，会被序列化）：
 *   - durationSec: 时间轴总长（秒），默认 15
 *   - fps: 每秒帧数（30/60/24/12 或自定义）
 *   - widthPx: 时间轴目前在画布上的渲染宽度（被 NodeResizer 拉伸时改变）
 *   - resizeMode:
 *       'stretch'  拉伸时长度等比变长 / 缩短 (durationSec 跟着变)
 *       'compress' 拉伸时总时长不变，刻度密度变化（widthPx 变 / durationSec 不变）
 *   - cuts: 镜头切换点（秒），自动从输入文本解析或手动添加
 *   - timeMode:
 *       'frames'   显示成 N 帧
 *       'seconds'  显示成 N.NN s
 *       'tc'       SMPTE 时间码 HH:MM:SS:FF
 *
 * 端口约定：
 *   - 左侧 1 个 target （汇总文本 → 自动解析时间点）
 *   - 右侧 N 个 source（每个 cut 对应一个 source handle，id 形如 `cut__<idx>`）
 *
 * 这个节点本身**不参与执行**（不出现在拓扑里）；它的作用是 UI 编排。
 * 后续如果加"按时间轴串联多个 LLM 调用"等场景，可以让 executeFlow 识别
 * 来自 timeline 的特殊边并按 cuts 顺序调度。
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Handle, Position, NodeResizer } from '@xyflow/react';
import { useNodeStore } from '../../store/nodes';

type Props = {
  id: string;
  data: any;
  selected?: boolean;
};

const FPS_PRESETS = [60, 30, 24, 12];

/** 把"秒"按当前显示模式格式化成可读字符串 */
function formatTime(seconds: number, mode: 'frames' | 'seconds' | 'tc', fps: number): string {
  if (mode === 'seconds') return `${seconds.toFixed(2)}s`;
  if (mode === 'frames') return `${Math.round(seconds * fps)}f`;
  // SMPTE 时间码 HH:MM:SS:FF
  const totalFrames = Math.round(seconds * fps);
  const ff = totalFrames % fps;
  const totalSec = Math.floor(totalFrames / fps);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

/** 从上游文本中尝试抽取镜头切换的时间点。
 *  支持的写法（顺带兼容中英文）：
 *    "0:05" / "00:00:05" / "1.2s" / "2 秒" / "f72" / "frame 72"
 *  每识别到一个时间标记就当成一个 cut 点。 */
function parseCutsFromText(text: string, fps: number, durationSec: number): number[] {
  if (!text) return [];
  const cuts = new Set<number>();
  // hh:mm:ss / mm:ss
  const tcRe = /\b(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\b/g;
  let m: RegExpExecArray | null;
  while ((m = tcRe.exec(text))) {
    let hh = 0, mm = 0, ss = 0;
    if (m[3] !== undefined) { hh = +m[1]; mm = +m[2]; ss = +m[3]; }
    else { mm = +m[1]; ss = +m[2]; }
    const total = hh * 3600 + mm * 60 + ss;
    if (total > 0 && total <= durationSec) cuts.add(total);
  }
  // "1.2s" 或 "1.2 s" 或 "1秒" / "12 秒"
  const secRe = /(\d+(?:\.\d+)?)\s*(?:s\b|秒)/gi;
  while ((m = secRe.exec(text))) {
    const v = parseFloat(m[1]);
    if (!Number.isNaN(v) && v > 0 && v <= durationSec) cuts.add(Math.round(v * 100) / 100);
  }
  // "f72" / "frame 72" 帧
  const frameRe = /\b(?:f|frame|帧)\s*(\d+)/gi;
  while ((m = frameRe.exec(text))) {
    const f = parseInt(m[1], 10);
    if (Number.isFinite(f) && f > 0) {
      const sec = f / fps;
      if (sec <= durationSec) cuts.add(Math.round(sec * 100) / 100);
    }
  }
  return Array.from(cuts).sort((a, b) => a - b);
}

function TimelineNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);

  // ── 本地状态 ─────────────────────────────
  const durationSec: number = data.durationSec ?? 15;
  const fps: number = data.fps ?? 30;
  const widthPx: number = data.widthPx ?? 1100; // 默认约 8 个提示词节点宽（150 * 8 = 1200，留余量）
  const heightPx: number = data.heightPx ?? 130;
  const resizeMode: 'stretch' | 'compress' = data.resizeMode ?? 'stretch';
  const timeMode: 'frames' | 'seconds' | 'tc' = data.timeMode ?? 'seconds';
  const cuts: number[] = useMemo(() => Array.isArray(data.cuts) ? data.cuts : [], [data.cuts]);

  // 编辑标题
  const [editingTitle, setEditingTitle] = useState(false);
  const [localLabel, setLocalLabel] = useState(data.label || '时间轴');
  useEffect(() => { setLocalLabel(data.label || '时间轴'); }, [data.label]);
  const commitLabel = useCallback(() => {
    setEditingTitle(false);
    if (localLabel.trim()) updateNodeData(id, { label: localLabel.trim() } as any);
    else setLocalLabel(data.label || '时间轴');
  }, [id, localLabel, updateNodeData, data.label]);

  // 自定义 fps 输入框
  const [customFpsInput, setCustomFpsInput] = useState<string>('');

  // ── 处理 NodeResizer 调整尺寸 ─────────────
  // 用 NodeResizer 的 onResize 回调（仅用户主动拖手柄时触发）。
  // 注意：避免用 ResizeObserver — 那会在挂载时把 React 默认的 minWidth 误当成拉伸结果。
  const onResize = useCallback((_e: any, params: { width: number; height: number }) => {
    const w = Math.round(params.width);
    const h = Math.round(params.height);
    if (resizeMode === 'stretch' && widthPx > 0) {
      // 等比改 durationSec，刻度密度保持不变
      const ratio = w / widthPx;
      const newDur = Math.max(1, Math.round(durationSec * ratio * 100) / 100);
      updateNodeData(id, { widthPx: w, heightPx: h, durationSec: newDur } as any);
    } else {
      // compress：宽度变 / 时长不变 → 刻度自然变密 / 变疏
      updateNodeData(id, { widthPx: w, heightPx: h } as any);
    }
  }, [id, widthPx, durationSec, resizeMode, updateNodeData]);

  // ── 上游文本变化时自动解析 cuts ───────────
  const upstreamText: string = data.upstreamText || '';
  useEffect(() => {
    if (!upstreamText) return;
    const parsed = parseCutsFromText(upstreamText, fps, durationSec);
    if (parsed.length === 0) return;
    // 与现有 cuts 合并去重
    const merged = Array.from(new Set([...cuts, ...parsed])).sort((a, b) => a - b);
    if (JSON.stringify(merged) !== JSON.stringify(cuts)) {
      updateNodeData(id, { cuts: merged } as any);
    }
  }, [upstreamText]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 时间轴刻度计算 ───────────────────────
  // 主刻度数量（自动选择，避免过密）：每秒一格如果总宽够；否则按 5/10 秒一格
  const ticks = useMemo(() => {
    if (durationSec <= 0) return [];
    let stepSec = 1;
    if (durationSec > 30) stepSec = 5;
    if (durationSec > 120) stepSec = 10;
    if (durationSec > 600) stepSec = 60;
    const arr: number[] = [];
    for (let s = 0; s <= durationSec + 0.0001; s += stepSec) arr.push(Math.round(s * 100) / 100);
    return arr;
  }, [durationSec]);

  // 把秒转屏幕 x（相对节点内部）
  const trackPaddingX = 30;
  const trackWidth = Math.max(60, widthPx - trackPaddingX * 2);
  const secToX = (sec: number) => trackPaddingX + (sec / durationSec) * trackWidth;

  // ── 操作 ──────────────────────────────────
  const setFps = (next: number) => updateNodeData(id, { fps: next } as any);
  const setTimeMode = (m: 'frames' | 'seconds' | 'tc') => updateNodeData(id, { timeMode: m } as any);
  const setResizeMode = (m: 'stretch' | 'compress') => updateNodeData(id, { resizeMode: m } as any);
  const setDurationSec = (v: number) => updateNodeData(id, { durationSec: Math.max(1, v) } as any);
  const addCutAt = (sec: number) => {
    const v = Math.max(0, Math.min(durationSec, Math.round(sec * 100) / 100));
    if (cuts.includes(v)) return;
    updateNodeData(id, { cuts: [...cuts, v].sort((a, b) => a - b) } as any);
  };
  const removeCut = (idx: number) => {
    const next = cuts.filter((_, i) => i !== idx);
    updateNodeData(id, { cuts: next } as any);
  };
  const onTrackClick = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('.timeline-cut')) return;
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const sec = ((x - trackPaddingX) / trackWidth) * durationSec;
    if (sec >= 0 && sec <= durationSec) addCutAt(sec);
  };

  return (
    <div
      className={`node-card timeline-node ${selected ? 'selected' : ''}`}
      data-status={data.status || 'idle'}
      style={{ width: widthPx, height: heightPx, minWidth: 320, minHeight: 110, padding: 0 }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <NodeResizer
        minWidth={320}
        minHeight={110}
        isVisible={selected}
        onResize={onResize}
        lineStyle={{ borderColor: '#0ea5e9' }}
        handleStyle={{ width: 8, height: 8, backgroundColor: '#0ea5e9', borderRadius: 2 }}
      />
      {/* 左：单个 target 输入（接受文本，自动解析时间点） */}
      <Handle type="target" position={Position.Left} id="in" />

      {/* 右：每个 cut 一个 source。如果没 cut，至少给一个默认 source 让节点能被连下游 */}
      {cuts.length === 0 ? (
        <Handle type="source" position={Position.Right} id="cut__0" style={{ top: '50%' }} />
      ) : (
        cuts.map((sec, idx) => {
          // 把 source 端口竖着均匀排在右侧
          const top = ((idx + 1) / (cuts.length + 1)) * 100;
          return (
            <Handle
              key={`cut-${idx}-${sec}`}
              type="source"
              position={Position.Right}
              id={`cut__${idx}`}
              style={{ top: `${top}%` }}
              title={`镜头切换 ${formatTime(sec, timeMode, fps)}`}
            />
          );
        })
      )}

      {/* 标题栏 */}
      <div
        className="node-header"
        style={{ background: 'linear-gradient(135deg, #0ea5e9, #38bdf8)', padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 6 }}
      >
        <span className="node-icon">⏱</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLabel();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalLabel(data.label || '时间轴'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,0.25)', border: '1px solid rgba(255,255,255,0.6)', borderRadius: 6, color: 'white', padding: '2px 6px', fontSize: 12 }}
          />
        ) : (
          <span
            className="node-title"
            onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
            title="双击重命名"
            style={{ flex: 1, cursor: 'text', color: 'white', fontSize: 12, fontWeight: 600 }}
          >
            {data.label || '时间轴'}
          </span>
        )}
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)' }}>
          总长 {formatTime(durationSec, timeMode, fps)} · {fps} fps · {cuts.length} 个切换点
        </span>
      </div>

      {/* 主轨道 */}
      <div
        className="nodrag"
        onClick={onTrackClick}
        style={{
          position: 'relative',
          height: 50,
          margin: '6px 0',
          cursor: 'crosshair',
          background: 'transparent',
        }}
        title="点空白处添加切换点；点切换点上的 × 删除"
      >
        {/* 主线 */}
        <div
          style={{
            position: 'absolute',
            left: trackPaddingX,
            right: trackPaddingX,
            top: 24,
            height: 4,
            background: 'linear-gradient(90deg, #0ea5e9, #38bdf8)',
            borderRadius: 2,
          }}
        />
        {/* 主刻度 */}
        {ticks.map((t) => {
          const x = secToX(t);
          return (
            <div key={t} style={{ position: 'absolute', left: x - 0.5, top: 18, width: 1, height: 16, background: '#94a3b8' }} title={formatTime(t, timeMode, fps)}>
              <div style={{ position: 'absolute', top: 18, left: -16, width: 32, textAlign: 'center', fontSize: 9, color: '#64748b', whiteSpace: 'nowrap' }}>
                {formatTime(t, timeMode, fps)}
              </div>
            </div>
          );
        })}
        {/* 切换点 */}
        {cuts.map((sec, idx) => {
          const x = secToX(sec);
          return (
            <div
              key={`pin-${idx}`}
              className="timeline-cut nodrag"
              style={{ position: 'absolute', left: x - 7, top: 10, width: 14, height: 32, cursor: 'pointer' }}
              title={`切换点 ${idx + 1} @ ${formatTime(sec, timeMode, fps)}（点击 × 删除）`}
              onClick={(e) => { e.stopPropagation(); }}
            >
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#f59e0b',
                  border: '2px solid white',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  position: 'absolute',
                  top: 8,
                }}
              />
              <button
                onClick={(e) => { e.stopPropagation(); removeCut(idx); }}
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -8,
                  width: 14,
                  height: 14,
                  border: 'none',
                  borderRadius: '50%',
                  background: '#ef4444',
                  color: 'white',
                  fontSize: 10,
                  lineHeight: 1,
                  cursor: 'pointer',
                  padding: 0,
                }}
                title="删除"
              >×</button>
            </div>
          );
        })}
      </div>

      {/* 底部控制栏 */}
      <div
        className="nodrag"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '4px 10px',
          fontSize: 11,
          color: 'var(--text-muted, #64748b)',
          flexWrap: 'wrap',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title="每秒帧数（FPS）">
          fps
          <select value={FPS_PRESETS.includes(fps) ? fps : -1} onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            if (v === -1) return;
            setFps(v);
          }} style={{ fontSize: 11 }}>
            {FPS_PRESETS.map((f) => <option key={f} value={f}>{f}</option>)}
            {!FPS_PRESETS.includes(fps) && <option value={-1}>{fps}（自定义）</option>}
          </select>
          <input
            type="number"
            min={1}
            max={240}
            placeholder="自定义"
            value={customFpsInput}
            onChange={(e) => setCustomFpsInput(e.target.value)}
            onBlur={() => {
              const v = parseInt(customFpsInput, 10);
              if (Number.isFinite(v) && v > 0 && v <= 240) setFps(v);
              setCustomFpsInput('');
            }}
            style={{ width: 50, fontSize: 11 }}
          />
        </label>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title="时间显示方式">
          显示
          <select value={timeMode} onChange={(e) => setTimeMode(e.target.value as any)} style={{ fontSize: 11 }}>
            <option value="seconds">秒</option>
            <option value="frames">帧</option>
            <option value="tc">时间码</option>
          </select>
        </label>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title="拉伸节点时如何处理时长">
          拉伸
          <select value={resizeMode} onChange={(e) => setResizeMode(e.target.value as any)} style={{ fontSize: 11 }}>
            <option value="stretch">等比改时长</option>
            <option value="compress">总时长不变</option>
          </select>
        </label>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title="手动设置总时长（秒）">
          时长
          <input
            type="number"
            min={1}
            step={0.5}
            value={durationSec}
            onChange={(e) => setDurationSec(parseFloat(e.target.value) || 1)}
            style={{ width: 60, fontSize: 11 }}
          />
          s
        </label>
      </div>
    </div>
  );
}

export default TimelineNode;
