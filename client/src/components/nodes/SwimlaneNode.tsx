/**
 * SwimlaneNode · 项目时序泳道节点（v1.6.0-β）
 * ---------------------------------------------------------------
 * 形态：一个横向 group 容器，提供：
 *   - 顶部时间刻度行（单位可切：秒 / 小时 / 天）
 *   - 中间 N 条泳道行（用户可增删/改名/调高度）
 *   - 子节点通过 parentId 挂在容器内，extent='parent' 限制不能拖出
 *
 * 软驱动（方案 Z）：
 *   - 子节点的 x 决定它在时间轴上的"参考位置"（仅显示用）
 *   - 子节点的 y 决定它属于哪条 lane（按 lane y 范围反查）
 *   - 不做强吸附；用户拖到哪儿都接受（保留方案 Z 的"参考线"精神）
 *
 * 节点宽度 = lanePaddingLeft + durationValue * pixelsPerUnit
 * 节点高度 = rulerHeight + Σ lanes[i].height
 *
 * 与 TimelineNode 完全独立：
 *   - 文件独立（这一个）
 *   - 字段独立（SwimlaneNodeData / SwimlaneRow）
 *   - type 字符串 'swimlane' 不进 NodeType enum
 *   - 不参与执行（与 TimelineNode 一样，画布拓扑里直接跳过）
 *   - 想删除 = 删本文件 + Canvas/Sidebar 各 1 行注册
 *
 * v1.6.0-β 范围：
 *   ✅ 容器 + 刻度行 + 泳道行 + lane 增删改名
 *   ✅ NodeResizer 拉宽（按当前 unit 改 pixelsPerUnit；时长用单独输入框改）
 *   ✅ 单位切换（秒 / 小时 / 天）
 *   ⏸ 节假日（v1.6.1 holiday-cn）
 *   ⏸ 多时区分深浅色（v1.6.2）
 *   ⏸ lane 行内拖动子节点的吸附线（v1.6.0-β2 视情况）
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { NodeResizer, useUpdateNodeInternals } from '@xyflow/react';
import { useNodeStore } from '../../store/nodes';
import type { SwimlaneNodeData, SwimlaneRow } from '../../types/nodes';

type Props = {
  id: string;
  data: SwimlaneNodeData;
  selected?: boolean;
};

/** lane 默认主题色循环（避免依赖 chroma 等外部库） */
const LANE_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

/** 单位下默认配置 */
const UNIT_DEFAULTS: Record<SwimlaneNodeData['unit'], { dur: number; pxPerUnit: number; tickLabel: (i: number, startISO?: string) => string }> = {
  seconds: {
    dur: 15,
    pxPerUnit: 60,
    tickLabel: (i) => `${i}s`,
  },
  hours: {
    dur: 24,
    pxPerUnit: 40,
    tickLabel: (i, startISO) => {
      if (!startISO) return `${i}h`;
      const t = new Date(startISO);
      t.setHours(t.getHours() + i);
      return t.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit' }).replace(/\//g, '-');
    },
  },
  days: {
    dur: 7,
    pxPerUnit: 90,
    tickLabel: (i, startISO) => {
      if (!startISO) return `D${i}`;
      const t = new Date(startISO);
      t.setDate(t.getDate() + i);
      return t.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' });
    },
  },
};

function pickTickStep(durationValue: number, pixelsPerUnit: number): number {
  // 主刻度密度：每条 ≥50px
  const minPx = 50;
  let step = 1;
  while (step * pixelsPerUnit < minPx) {
    if (step < 5) step = 5;
    else if (step < 10) step = 10;
    else if (step < 30) step = 30;
    else if (step < 60) step = 60;
    else step *= 2;
    if (step > durationValue) break;
  }
  return step;
}

export default function SwimlaneNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((s) => s.updateNodeData);
  const updateNodeInternals = useUpdateNodeInternals();

  // 字段读取 + 默认值
  const unit: SwimlaneNodeData['unit'] = data.unit ?? 'days';
  const defaults = UNIT_DEFAULTS[unit];
  const durationValue: number = data.durationValue ?? defaults.dur;
  const pixelsPerUnit: number = data.pixelsPerUnit ?? defaults.pxPerUnit;
  const startISO: string | undefined = data.startISO;
  const rulerHeight: number = data.rulerHeight ?? 36;
  const paddingLeft: number = data.paddingLeft ?? 80; // 左侧给 lane label 一条 80px
  // 双模缩放：与 TimelineNode 同语义
  //   compress（默认）：拉宽 → 改 pixelsPerUnit，时长不变（刻度变密/稀）
  //   stretch        ：拉宽 → 改 durationValue，px 不变（时间变长/短）
  const resizeMode: 'compress' | 'stretch' = (data as any).resizeMode === 'stretch' ? 'stretch' : 'compress';

  // 默认 3 条 lane（首次创建时由 Canvas 默认 data 给；这里防御性兜底）
  const lanes: SwimlaneRow[] = useMemo(
    () => Array.isArray(data.lanes) && data.lanes.length > 0 ? data.lanes : [],
    [data.lanes]
  );

  // ── 节点尺寸 ─────
  const trackWidth = Math.max(120, durationValue * pixelsPerUnit);
  const totalWidth = paddingLeft + trackWidth + 12;
  const lanesHeight = lanes.reduce((s, l) => s + (l.height || 80), 0);
  const totalHeight = rulerHeight + Math.max(80, lanesHeight) + 8;

  // 让节点 width/height 跟随计算结果（React Flow group 节点要 width/height 都在节点对象里）
  // store 里没有 setNodes action，直接用底层 setState 改 nodes 数组（保证 RF parent 边界正确）
  // v1.6.0-β2：同时设 zIndex: -1，让泳道渲染到子节点之下，避免覆盖子节点导致点不中。
  // 同时扫一遍 parentId 指向自己的子节点，确保它们都有 'swimlane-child' className（兜底）。
  useEffect(() => {
    useNodeStore.setState((state) => ({
      nodes: state.nodes.map((n: any) => {
        if (n.id === id) {
          return {
            ...n,
            width: totalWidth,
            height: totalHeight,
            style: { ...(n.style || {}), width: totalWidth, height: totalHeight },
            zIndex: -1,
          };
        }
        // 子节点 className 兜底 + 清掉 extent='parent'（v1.6.0-β2 早期版本设过，会卡住拖出）
        if (n.parentId === id) {
          let updated: any = n;
          let needsUpdate = false;
          if (!(n.className || '').includes('swimlane-child')) {
            const cls = [n.className, 'swimlane-child'].filter(Boolean).join(' ');
            updated = { ...updated, className: cls };
            needsUpdate = true;
          }
          if (n.extent === 'parent') {
            updated = { ...updated };
            delete updated.extent;
            needsUpdate = true;
          }
          if (needsUpdate) return updated;
        }
        return n;
      }),
    }));
    updateNodeInternals(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalWidth, totalHeight]);

  // ── 编辑 label ─────
  const [editingTitle, setEditingTitle] = useState(false);
  const [localLabel, setLocalLabel] = useState(data.label || '🏊 项目泳道');
  useEffect(() => { setLocalLabel(data.label || '🏊 项目泳道'); }, [data.label]);
  const commitLabel = useCallback(() => {
    setEditingTitle(false);
    const v = localLabel.trim();
    if (v) updateNodeData(id, { label: v } as any);
    else setLocalLabel(data.label || '🏊 项目泳道');
  }, [id, localLabel, updateNodeData, data.label]);

  // ── lane 操作 ─────
  const addLane = useCallback(() => {
    const newLane: SwimlaneRow = {
      id: `lane-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      label: `泳道 ${lanes.length + 1}`,
      height: 80,
      color: LANE_COLORS[lanes.length % LANE_COLORS.length],
    };
    updateNodeData(id, { lanes: [...lanes, newLane] } as any);
  }, [id, lanes, updateNodeData]);

  const renameLane = useCallback((laneId: string, name: string) => {
    const next = lanes.map((l) => (l.id === laneId ? { ...l, label: name } : l));
    updateNodeData(id, { lanes: next } as any);
  }, [id, lanes, updateNodeData]);

  const removeLane = useCallback((laneId: string) => {
    if (lanes.length <= 1) return; // 至少保留 1 条
    if (!confirm(`删除泳道「${lanes.find((l) => l.id === laneId)?.label}」？此泳道下的子节点不会被删除，但会落到第一条泳道。`)) return;
    const next = lanes.filter((l) => l.id !== laneId);
    updateNodeData(id, { lanes: next } as any);
  }, [id, lanes, updateNodeData]);

  // ── 单位切换 / 时长 / 像素密度 ─────
  const setUnit = useCallback((u: SwimlaneNodeData['unit']) => {
    // 切单位时把 durationValue / pixelsPerUnit 自动重置为该单位的默认值
    const def = UNIT_DEFAULTS[u];
    updateNodeData(id, { unit: u, durationValue: def.dur, pixelsPerUnit: def.pxPerUnit } as any);
  }, [id, updateNodeData]);

  const setDurationValue = useCallback((v: number) => {
    updateNodeData(id, { durationValue: Math.max(1, v) } as any);
  }, [id, updateNodeData]);

  const setStartISO = useCallback((iso: string) => {
    updateNodeData(id, { startISO: iso } as any);
  }, [id, updateNodeData]);

  // ── NodeResizer 拉伸：双模 ─────
  // compress（默认）：拉宽 → 改 pixelsPerUnit，时长不变（刻度变密/稀）
  // stretch        ：拉宽 → 改 durationValue，px 不变（时间变长/短）
  const onResize = useCallback((_e: any, params: { width: number; height: number }) => {
    const w = Math.round(params.width);
    const usable = Math.max(80, w - paddingLeft - 12);
    if (resizeMode === 'stretch') {
      if (pixelsPerUnit <= 0) return;
      const newDur = Math.max(1, Math.round(usable / pixelsPerUnit));
      updateNodeData(id, { durationValue: newDur } as any);
    } else {
      if (durationValue <= 0) return;
      const newPx = Math.max(4, Math.round(usable / durationValue));
      updateNodeData(id, { pixelsPerUnit: newPx } as any);
    }
  }, [id, durationValue, pixelsPerUnit, paddingLeft, resizeMode, updateNodeData]);

  const setResizeMode = useCallback((m: 'compress' | 'stretch') => {
    updateNodeData(id, { resizeMode: m } as any);
  }, [id, updateNodeData]);

  // ── 主刻度计算 ─────
  const tickStep = useMemo(() => pickTickStep(durationValue, pixelsPerUnit), [durationValue, pixelsPerUnit]);
  const ticks = useMemo(() => {
    if (durationValue <= 0) return [];
    const arr: number[] = [];
    for (let i = 0; i <= durationValue + 0.0001; i += tickStep) arr.push(i);
    return arr;
  }, [durationValue, tickStep]);

  return (
    <div
      className={`swimlane-node-wrap ${selected ? 'selected' : ''}`}
      style={{
        width: totalWidth,
        height: totalHeight,
        background: 'rgba(15, 23, 42, 0.04)',
        border: selected ? '1px solid #0ea5e9' : '1px dashed rgba(14, 165, 233, 0.35)',
        borderRadius: 6,
        position: 'relative',
        boxSizing: 'border-box',
        // group 类节点不能 overflow:hidden（裁剪 Handle）；本节点没有外凸 handle，
        // 但子节点 NodeResizer 的拉手可能落在边界外，留 visible 一致性
        overflow: 'visible',
      }}
      onContextMenu={(e) => e.stopPropagation()}
    >
      <NodeResizer
        minWidth={paddingLeft + 240}
        minHeight={rulerHeight + 80 + 8}
        isVisible={selected}
        onResize={onResize}
        lineStyle={{ borderColor: '#0ea5e9' }}
        handleStyle={{ width: 8, height: 8, backgroundColor: '#0ea5e9', borderRadius: 2 }}
      />

      {/* 顶部标题 + 控件栏（在节点之外的 toolbar，定位在节点上方）。
          v1.6.0-β5：容器**不**加 'nodrag' —— 让用户在 toolbar 空白处也能拖动整个泳道节点。
          只在交互控件（button / input / select / span 标题）上加 'nodrag' 阻止 RF 的拖动捕获，
          这样按钮可点、输入可编辑、空白处可拖。 */}
      <div
        style={{
          position: 'absolute',
          top: -28,
          left: 0,
          right: 0,
          height: 24,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '0 8px',
          fontSize: 11,
          color: 'var(--text-secondary, #64748b)',
          background: 'var(--bg-card, #fff)',
          borderRadius: 4,
          boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
          pointerEvents: 'auto',
          cursor: 'move',
        }}
      >
        <span style={{ fontSize: 13 }}>🏊</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localLabel}
            onChange={(e) => setLocalLabel(e.target.value)}
            onBlur={commitLabel}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLabel();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalLabel(data.label || '🏊 项目泳道'); }
            }}
            style={{
              flex: 1,
              minWidth: 80,
              maxWidth: 200,
              padding: '1px 6px',
              fontSize: 12,
              fontWeight: 600,
              border: '1px solid var(--border-color, #e2e8f0)',
              borderRadius: 4,
              background: 'var(--bg-input, #fff)',
              color: 'var(--text-primary, #1e293b)',
            }}
          />
        ) : (
          <span
            className="nodrag"
            onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
            title="双击重命名"
            style={{ cursor: 'text', fontWeight: 600, color: 'var(--text-primary, #0f172a)', fontSize: 12 }}
          >
            {data.label || '🏊 项目泳道'}
          </span>
        )}

        {/* 标题与控件之间的间隔 + 分隔符 */}
        <span
          aria-hidden
          style={{
            display: 'inline-block',
            width: 1,
            height: 14,
            background: 'var(--border-color, #cbd5e1)',
            margin: '0 4px',
            flex: '0 0 auto',
          }}
        />

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title="时间单位">
          单位
          <select className="nodrag" value={unit} onChange={(e) => setUnit(e.target.value as any)} style={{ fontSize: 11, padding: '0 2px' }}>
            <option value="seconds">秒</option>
            <option value="hours">小时</option>
            <option value="days">天</option>
          </select>
        </label>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title="时长（按当前单位）">
          时长
          <input
            className="nodrag"
            type="number"
            min={1}
            value={durationValue}
            onChange={(e) => setDurationValue(parseFloat(e.target.value) || 1)}
            style={{ width: 50, fontSize: 11, padding: '0 3px' }}
          />
        </label>

        {(unit === 'hours' || unit === 'days') && (
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title="开始时间">
            起
            <input
              className="nodrag"
              type={unit === 'hours' ? 'datetime-local' : 'date'}
              value={(() => {
                if (!startISO) return '';
                if (unit === 'hours') {
                  // datetime-local 需要 YYYY-MM-DDTHH:mm，无时区
                  return startISO.slice(0, 16);
                }
                return startISO.slice(0, 10);
              })()}
              onChange={(e) => {
                const v = e.target.value;
                if (!v) { setStartISO(''); return; }
                setStartISO(unit === 'hours' ? `${v}:00` : `${v}T00:00:00`);
              }}
              style={{ fontSize: 11, padding: '0 3px' }}
            />
          </label>
        )}

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }} title={`每${unit === 'seconds' ? '秒' : unit === 'hours' ? '小时' : '天'}占多少像素`}>
          缩放
          <input
            className="nodrag"
            type="number"
            min={4}
            max={400}
            value={pixelsPerUnit}
            onChange={(e) => updateNodeData(id, { pixelsPerUnit: Math.max(4, parseInt(e.target.value, 10) || defaults.pxPerUnit) } as any)}
            style={{ width: 48, fontSize: 11, padding: '0 3px' }}
          />
          <span style={{ opacity: 0.7 }}>px</span>
        </label>

        <label
          style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}
          title="拖节点边缘时的语义：&#10;· 密度（默认）= 改 px/单位，时长不变&#10;· 等长 = 改时长，px 不变"
        >
          拉伸
          <select
            className="nodrag"
            value={resizeMode}
            onChange={(e) => setResizeMode(e.target.value as any)}
            style={{ fontSize: 11, padding: '0 2px' }}
          >
            <option value="compress">密度</option>
            <option value="stretch">等长</option>
          </select>
        </label>
      </div>

      {/* 主体：刻度行 + 泳道行 */}
      <div style={{ position: 'absolute', inset: 0 }}>
        {/* 「+ 泳道」按钮：放在刻度行左侧（paddingLeft 区域），与 lane label 列对齐 */}
        <button
          className="nodrag"
          onClick={addLane}
          title="新增一条泳道"
          style={{
            position: 'absolute',
            left: 8,
            top: (rulerHeight - 22) / 2,
            width: paddingLeft - 16,
            height: 22,
            padding: '0 6px',
            fontSize: 11,
            border: '1px dashed var(--accent, #6366f1)',
            background: 'var(--accent-bg, rgba(99,102,241,0.08))',
            color: 'var(--accent, #6366f1)',
            borderRadius: 4,
            cursor: 'pointer',
            zIndex: 2,
            // 文本左对齐，让"泳道 +"的"泳"字与下方 lane label 列文字左缘对齐
            textAlign: 'left',
            paddingLeft: 16,
          }}
        >
          泳道 +
        </button>

        {/* 顶部刻度行 */}
        <div
          style={{
            position: 'absolute',
            left: paddingLeft,
            top: 0,
            width: trackWidth,
            height: rulerHeight,
            borderBottom: '1px solid var(--border-color, #e2e8f0)',
          }}
        >
          {/* 主刻度 */}
          {ticks.map((i) => {
            const x = i * pixelsPerUnit;
            return (
              <div key={i} style={{ position: 'absolute', left: x, top: 0, height: rulerHeight, width: 1, background: 'var(--text-muted, #94a3b8)', opacity: 0.4 }}>
                <div
                  style={{
                    position: 'absolute',
                    top: rulerHeight - 16,
                    left: -30,
                    width: 60,
                    textAlign: 'center',
                    fontSize: 10,
                    color: 'var(--text-secondary, #64748b)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {defaults.tickLabel(i, startISO)}
                </div>
              </div>
            );
          })}
        </div>

        {/* 泳道行 */}
        {lanes.map((lane, idx) => {
          const yTop = rulerHeight + lanes.slice(0, idx).reduce((s, l) => s + (l.height || 80), 0);
          const h = lane.height || 80;
          const color = lane.color || LANE_COLORS[idx % LANE_COLORS.length];
          return (
            <div
              key={lane.id}
              style={{
                position: 'absolute',
                left: 0,
                top: yTop,
                width: totalWidth,
                height: h,
                borderBottom: idx < lanes.length - 1 ? '1px solid var(--border-color, #e2e8f0)' : 'none',
                pointerEvents: 'none', // 让子节点接管事件，lane 行本身不抢
              }}
            >
              {/*
                lane label 左侧条
                v1.6.0-β4：去掉 'nodrag nopan'，让用户在 lane 标签区**就能拖动整个泳道节点**
                （之前必须点空白底色才能拖，太挑剔）。
                只在 × 按钮上保留 nodrag 防止误触；双击改名用 prompt，不会与拖动冲突
                （RF 拖动需要持续 mousemove，prompt 会立刻打断 + 弹窗，无影响）。
              */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: paddingLeft,
                  height: h,
                  background: `linear-gradient(180deg, ${color}22, ${color}11)`,
                  borderRight: `3px solid ${color}`,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  // v1.6.0-β7：左 padding 与上方"泳道 +"按钮 paddingLeft (16) 对齐，
                  // 让 lane 标签文字左缘与按钮第一个字"泳"对齐
                  padding: '0 6px 0 16px',
                  pointerEvents: 'auto',
                  cursor: 'move', // 提示用户这里可以拖
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  const next = prompt('泳道名称：', lane.label);
                  if (next != null && next.trim() !== '' && next !== lane.label) {
                    renameLane(lane.id, next.trim());
                  }
                }}
                title="拖动 = 移动整个泳道；双击 = 改名"
              >
                <span style={{ fontSize: 11, fontWeight: 600, color, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {lane.label}
                </span>
                <button
                  className="nodrag"
                  onClick={(e) => { e.stopPropagation(); removeLane(lane.id); }}
                  disabled={lanes.length <= 1}
                  title={lanes.length > 1 ? '删除此泳道' : '至少保留一条泳道'}
                  style={{
                    width: 16,
                    height: 16,
                    border: 'none',
                    borderRadius: 8,
                    background: lanes.length > 1 ? 'rgba(239,68,68,0.15)' : 'transparent',
                    color: lanes.length > 1 ? '#ef4444' : 'rgba(0,0,0,0.2)',
                    fontSize: 11,
                    lineHeight: 1,
                    cursor: lanes.length > 1 ? 'pointer' : 'not-allowed',
                    padding: 0,
                  }}
                >×</button>
              </div>

              {/* 泳道内可视区域（仅做底色斑马纹示意，子节点由 React Flow 在节点容器外层渲染） */}
              <div
                style={{
                  position: 'absolute',
                  left: paddingLeft,
                  top: 0,
                  width: trackWidth,
                  height: h,
                  background: idx % 2 === 0 ? 'transparent' : 'rgba(99,102,241,0.03)',
                }}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
