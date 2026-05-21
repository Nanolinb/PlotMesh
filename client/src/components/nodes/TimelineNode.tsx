/**
 * TimelineNode · 时间轴节点（v1.6.0 形态改造）
 * ---------------------------------------------------------------
 * 与 v1.5 之前的改动重点：
 *   1. 去掉 .node-card 圆角节点框；改成"直接画在画布上的时间轴"
 *   2. 主轴永远贯穿节点全宽 —— 节点宽度由 durationSec * pixelsPerSecond 自动算
 *   3. 控件统一在横轴下方一行展开，不再被节点框挤压
 *   4. NodeResizer 拉伸支持两种语义（用户可切换）：
 *      - 'compress' （密度缩放，默认）：拉宽 → 改 pixelsPerSecond，durationSec 不变；刻度变密/稀
 *      - 'stretch'  （等长缩放）       ：拉宽 → 改 durationSec，pixelsPerSecond 不变；时间变长/短
 *      （v1.5 既有 stretch；v1.6 改造时一度只保留 compress，本版本恢复双模）
 *   5. "时长" 输入框直接改 durationSec，节点宽度跟随 → 直觉一致（不受 resizeMode 影响）
 *
 * 数据模型（保存在 data 字段里）：
 *   - durationSec: 时间轴总长（秒），默认 15
 *   - fps: 每秒帧数（30/60/24/12 或自定义）
 *   - pixelsPerSecond: 每秒占多少像素（v1.6 起替代 widthPx），默认 60
 *   - heightPx: 节点高度（v1.6 起仅作展示预留，节点高度由内容自适应）
 *   - resizeMode: 'compress' | 'stretch'，默认 'compress'
 *   - cuts: 镜头切换点（秒）
 *   - timeMode: 'frames' | 'seconds' | 'tc'
 *
 *   兼容字段（来自 <=v1.5）：
 *   - widthPx: 旧节点的渲染宽度。如果存在，启动时折算成 pixelsPerSecond。
 *
 * 端口约定：
 *   - 左 1 个 target （汇总文本 → 自动解析时间点）
 *   - 右 N 个 source（每 cut 一个，id 形如 `cut__<idx>`）
 *
 * 这个节点不参与执行（不出现在拓扑里），仅做 UI 编排。
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Handle, Position, NodeResizer, useUpdateNodeInternals } from '@xyflow/react';
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
  const tcRe = /\b(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\b/g;
  let m: RegExpExecArray | null;
  while ((m = tcRe.exec(text))) {
    let hh = 0, mm = 0, ss = 0;
    if (m[3] !== undefined) { hh = +m[1]; mm = +m[2]; ss = +m[3]; }
    else { mm = +m[1]; ss = +m[2]; }
    const total = hh * 3600 + mm * 60 + ss;
    if (total > 0 && total <= durationSec) cuts.add(total);
  }
  const secRe = /(\d+(?:\.\d+)?)\s*(?:s\b|秒)/gi;
  while ((m = secRe.exec(text))) {
    const v = parseFloat(m[1]);
    if (!Number.isNaN(v) && v > 0 && v <= durationSec) cuts.add(Math.round(v * 100) / 100);
  }
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

/** 主刻度的步长选择（避免过密）：每秒一格如果空间够，否则按 5/10/60 秒一格 */
function pickTickStep(durationSec: number, pixelsPerSecond: number): number {
  // 主刻度密度阈值：每条主刻度占 ≥40px 时显示
  const minPxPerTick = 50;
  let step = 1;
  while (step * pixelsPerSecond < minPxPerTick) {
    if (step < 5) step = 5;
    else if (step < 10) step = 10;
    else if (step < 30) step = 30;
    else if (step < 60) step = 60;
    else if (step < 300) step = 300;
    else step = step * 2;
    if (step > durationSec) break;
  }
  return step;
}

function TimelineNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);

  // ── 字段读取 + 一次性兼容老字段 widthPx → pixelsPerSecond ─────
  const durationSec: number = data.durationSec ?? 15;
  const fps: number = data.fps ?? 30;
  const heightPx: number = data.heightPx ?? 110;
  const timeMode: 'frames' | 'seconds' | 'tc' = data.timeMode ?? 'seconds';
  const resizeMode: 'compress' | 'stretch' = data.resizeMode === 'stretch' ? 'stretch' : 'compress';
  const cuts: number[] = useMemo(
    () => Array.isArray(data.cuts) ? data.cuts : [],
    [data.cuts]
  );

  // pixelsPerSecond 默认 60；老节点如果有 widthPx 则从中折算
  const pixelsPerSecond: number = (() => {
    if (typeof data.pixelsPerSecond === 'number' && data.pixelsPerSecond > 0) {
      return data.pixelsPerSecond;
    }
    if (typeof data.widthPx === 'number' && data.widthPx > 0 && durationSec > 0) {
      const trackPaddingX = 30;
      const usable = Math.max(60, data.widthPx - trackPaddingX * 2);
      return Math.max(8, Math.round(usable / durationSec));
    }
    return 60;
  })();

  // 一次性把老 widthPx 折算结果回写为 pixelsPerSecond（让后续都走新字段）
  useEffect(() => {
    if (data.pixelsPerSecond == null && typeof data.widthPx === 'number') {
      updateNodeData(id, { pixelsPerSecond, widthPx: undefined } as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── React Flow v12：handle 数量/位置变化必须 useUpdateNodeInternals 通知 ─────
  // 否则 RF 内部缓存的 handle DOM 位置不刷新 → 连线锚点会错位。
  // 触发条件：cuts 长度（数量）/ pixelsPerSecond / durationSec（位置依赖）
  const updateNodeInternals = useUpdateNodeInternals();
  useEffect(() => {
    updateNodeInternals(id);
  }, [id, cuts.length, pixelsPerSecond, durationSec, updateNodeInternals]);

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

  // ── 节点渲染宽度（主轴 + 左右 padding） ─────────
  const trackPaddingX = 30;
  const trackWidth = Math.max(60, durationSec * pixelsPerSecond);
  const totalWidth = trackWidth + trackPaddingX * 2;

  // ── NodeResizer 拉伸 ─────
  // compress（默认）：拉宽 → 改 pixelsPerSecond，durationSec 不变（刻度密度变）
  // stretch        ：拉宽 → 改 durationSec，pixelsPerSecond 不变（时间变长/短）
  const onResize = useCallback((_e: any, params: { width: number; height: number }) => {
    const w = Math.round(params.width);
    const h = Math.round(params.height);
    const usable = Math.max(20, w - trackPaddingX * 2);
    if (resizeMode === 'stretch') {
      if (pixelsPerSecond <= 0) return;
      const newDur = Math.max(1, Math.round((usable / pixelsPerSecond) * 100) / 100);
      updateNodeData(id, { durationSec: newDur, heightPx: h } as any);
    } else {
      if (durationSec <= 0) return;
      const newPx = Math.max(4, Math.round(usable / durationSec));
      updateNodeData(id, { pixelsPerSecond: newPx, heightPx: h } as any);
    }
  }, [id, durationSec, pixelsPerSecond, resizeMode, updateNodeData]);

  // ── 上游文本变化时自动解析 cuts ───────────
  const upstreamText: string = data.upstreamText || '';
  useEffect(() => {
    if (!upstreamText) return;
    const parsed = parseCutsFromText(upstreamText, fps, durationSec);
    if (parsed.length === 0) return;
    const merged = Array.from(new Set([...cuts, ...parsed])).sort((a, b) => a - b);
    if (JSON.stringify(merged) !== JSON.stringify(cuts)) {
      updateNodeData(id, { cuts: merged } as any);
    }
  }, [upstreamText]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── 主刻度计算 ───────────────────────
  const tickStep = useMemo(
    () => pickTickStep(durationSec, pixelsPerSecond),
    [durationSec, pixelsPerSecond]
  );
  const ticks = useMemo(() => {
    if (durationSec <= 0) return [];
    const arr: number[] = [];
    for (let s = 0; s <= durationSec + 0.0001; s += tickStep) {
      arr.push(Math.round(s * 100) / 100);
    }
    return arr;
  }, [durationSec, tickStep]);

  const secToX = (sec: number) => trackPaddingX + (sec / durationSec) * trackWidth;

  // ── 操作 ─────────────────────────────
  const setFps = (next: number) => updateNodeData(id, { fps: next } as any);
  const setTimeMode = (m: 'frames' | 'seconds' | 'tc') => updateNodeData(id, { timeMode: m } as any);
  const setResizeMode = (m: 'compress' | 'stretch') => updateNodeData(id, { resizeMode: m } as any);
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
    // 关键：getBoundingClientRect() 受 React Flow 画布 zoom 影响（屏幕像素），
    // 而 trackWidth 是 CSS 逻辑像素。两者不一致 → 旧代码在画布缩放过的情况下
    // 算出的 sec 会偏小，cut 圆点出现在鼠标左边（v1.6.0-α 改造前同样问题）。
    // 修法：用 rect.width / offsetWidth 反推 zoom，把屏幕坐标折算回 CSS 像素。
    const trackEl = e.currentTarget as HTMLDivElement;
    const rect = trackEl.getBoundingClientRect();
    const cssWidth = trackEl.offsetWidth || rect.width;
    const zoom = cssWidth > 0 ? rect.width / cssWidth : 1;
    const xCss = (e.clientX - rect.left) / Math.max(zoom, 0.0001);
    const sec = ((xCss - trackPaddingX) / trackWidth) * durationSec;
    if (sec >= 0 && sec <= durationSec) addCutAt(sec);
  };

  return (
    <div
      className={`timeline-node-wrap ${selected ? 'selected' : ''}`}
      data-status={data.status || 'idle'}
      style={{
        // v1.6.0：去圆角节点框 → 仅细边框 + 半透明底，避免画布上消失不见
        width: totalWidth,
        minWidth: 320,
        minHeight: 110,
        height: 'auto',
        background: 'rgba(15, 23, 42, 0.04)',
        border: selected ? '1px solid #0ea5e9' : '1px dashed rgba(14, 165, 233, 0.35)',
        borderRadius: 4,
        padding: '6px 0 4px',
        position: 'relative',
        boxSizing: 'border-box',
      }}
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

      {/* 顶部：标题 + 摘要（不再用渐变 header） */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '0 10px 4px',
          fontSize: 11,
          color: 'var(--text-secondary, #64748b)',
        }}
      >
        <span style={{ fontSize: 13 }}>⏱</span>
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
            style={{
              flex: 1,
              background: 'var(--bg-input, #fff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: 4,
              color: 'var(--text-primary, #1e293b)',
              padding: '1px 6px',
              fontSize: 12,
              fontWeight: 600,
            }}
          />
        ) : (
          <span
            onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
            title="双击重命名"
            style={{
              cursor: 'text',
              color: 'var(--text-primary, #0f172a)',
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            {data.label || '时间轴'}
          </span>
        )}
        <span style={{ fontSize: 11, opacity: 0.7, marginLeft: 'auto' }}>
          {formatTime(durationSec, timeMode, fps)} · {fps} fps · {pixelsPerSecond} px/s · {cuts.length} cuts
        </span>
      </div>

      {/* 左：单 target */}
      <Handle type="target" position={Position.Left} id="in" style={{ top: 28 }} />

      {/*
        v1.6.0：cut 输出端子直接画在主轨道里 cut 圆点位置（见下面的 .timeline-cut 块）。
        节点根这里**不**再渲染独立的 cut handle。
        这样视觉上一个点 = cut 标记 + 连线锚点，连线从该点正下方/正右方直接出，不绕路。
      */}

      {/* 主轨道（占总宽，刻度永远贯穿） */}
      <div
        className="nodrag"
        onClick={onTrackClick}
        style={{
          position: 'relative',
          height: 50,
          margin: '0',
          cursor: 'crosshair',
          background: 'transparent',
        }}
        title="点空白处添加切换点；点切换点上的 × 删除"
      >
        {/* 主线 —— 用渐变蓝色，dark/light 都明显 */}
        <div
          style={{
            position: 'absolute',
            left: trackPaddingX,
            width: trackWidth,
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
            <div
              key={t}
              style={{
                position: 'absolute',
                left: x - 0.5,
                top: 18,
                width: 1,
                height: 16,
                background: 'var(--text-muted, #94a3b8)',
              }}
              title={formatTime(t, timeMode, fps)}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 18,
                  left: -22,
                  width: 44,
                  textAlign: 'center',
                  fontSize: 10,
                  color: 'var(--text-secondary, #64748b)',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatTime(t, timeMode, fps)}
              </div>
            </div>
          );
        })}
        {/* 切换点（v1.6.0：圆点本身就是 source Handle，cut 标记和连线锚点合二为一） */}
        {cuts.map((sec, idx) => {
          const x = secToX(sec);
          return (
            <div
              key={`pin-${idx}`}
              className="timeline-cut nodrag"
              style={{ position: 'absolute', left: x - 7, top: 10, width: 14, height: 32, cursor: 'pointer' }}
              title={`切换点 ${idx + 1} @ ${formatTime(sec, timeMode, fps)}（拖出连线 / × 删除）`}
              onClick={(e) => { e.stopPropagation(); }}
            >
              <Handle
                type="source"
                position={Position.Right}
                id={`cut__${idx}`}
                /* cut 圆点画在 .timeline-cut div 内部 top:8 / 14×14（圆心 y=15）；
                   Handle 14×14 + 2px border = 18px 外径，要让外径中心对齐 cut 圆心。
                   实测 top:5 时 handle 中心和 cut 圆点完美重合（playwright offsetY=0）。 */
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: 5,
                  transform: 'translateX(-50%)',
                  width: 14,
                  height: 14,
                  borderRadius: '50%',
                  background: '#f59e0b',
                  border: '2px solid white',
                  boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                  zIndex: 2,
                }}
                title={`镜头切换 ${formatTime(sec, timeMode, fps)} · 拖出连线连下游`}
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
                  zIndex: 3,
                }}
                title="删除"
              >×</button>
            </div>
          );
        })}
      </div>

      {/* 底部控件栏（横轴下方一行；溢出折行） */}
      <div
        className="nodrag"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 10px 0',
          fontSize: 11,
          color: 'var(--text-secondary, #64748b)',
          flexWrap: 'wrap',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="每秒帧数（FPS）">
          fps
          <select
            value={FPS_PRESETS.includes(fps) ? fps : -1}
            onChange={(e) => {
              const v = parseInt(e.target.value, 10);
              if (v === -1) return;
              setFps(v);
            }}
            style={{ fontSize: 11, padding: '1px 4px' }}
          >
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
            style={{ width: 50, fontSize: 11, padding: '1px 4px' }}
          />
        </label>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="时间显示方式">
          显示
          <select
            value={timeMode}
            onChange={(e) => setTimeMode(e.target.value as any)}
            style={{ fontSize: 11, padding: '1px 4px' }}
          >
            <option value="seconds">秒</option>
            <option value="frames">帧</option>
            <option value="tc">时间码</option>
          </select>
        </label>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title="手动设置总时长（秒）">
          时长
          <input
            type="number"
            min={1}
            step={0.5}
            value={durationSec}
            onChange={(e) => setDurationSec(parseFloat(e.target.value) || 1)}
            style={{ width: 60, fontSize: 11, padding: '1px 4px' }}
          />
          s
        </label>

        <label
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          title="拖动节点边缘时的语义：&#10;· 密度（默认）= 改 px/s，时间不变，刻度变密/稀&#10;· 等长 = 改时长，px/s 不变，时间也跟着变长/短"
        >
          拉伸
          <select
            value={resizeMode}
            onChange={(e) => setResizeMode(e.target.value as any)}
            style={{ fontSize: 11, padding: '1px 4px' }}
          >
            <option value="compress">密度（时长不变）</option>
            <option value="stretch">等长（时长跟随）</option>
          </select>
        </label>

        <label
          style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
          title="每秒占多少像素（也可以拖节点边缘改）"
        >
          缩放
          <input
            type="number"
            min={4}
            max={400}
            step={2}
            value={pixelsPerSecond}
            onChange={(e) =>
              updateNodeData(id, { pixelsPerSecond: Math.max(4, parseInt(e.target.value, 10) || 60) } as any)
            }
            style={{ width: 56, fontSize: 11, padding: '1px 4px' }}
          />
          <span style={{ opacity: 0.7 }}>px/s</span>
        </label>

        <span
          style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.5 }}
          title="点击主轴空白处添加切换点；选中节点后拉边缘按当前「拉伸」模式生效"
        >
          {data.upstreamText
            ? '🔗 已连入文本'
            : resizeMode === 'stretch'
              ? '💡 拉边缘改时长'
              : '💡 拉边缘改密度'}
        </span>
      </div>

      {/* 不显示 react-flow__node 的圆角节点 fallback；通过 :global 选择器在 App.css 兜 */}
    </div>
  );
}

export default TimelineNode;
