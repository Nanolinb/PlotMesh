/**
 * ServerStatusIndicator · 服务器在线状态指示灯（v1.6.2）
 * ---------------------------------------------------------------
 * 在 sidebar 顶部品牌区右侧显示一个小圆点：
 *   🟢 在线（最后一次 ping 成功）
 *   🟡 等待（首次还没拉到）
 *   🔴 离线（最后一次 ping 失败 / 超时）
 *
 * 行为：
 *   - 5s 一次 GET /health
 *   - hover 显示 tooltip（在线时延 ms / 离线时给启动命令）
 *   - 点击离线灯 → 弹引导：复制启动命令、显示如何配 launchd 自启
 *   - 点击在线灯 → 显示 server 版本 / 当前 token 来源
 *
 * 设计取舍：
 *   - 不放浮窗 / 不阻断；离线时 server 死了用户也能继续看本地 IDB 缓存
 *   - 用 fetch + 超时（3s）比 polling worker 简单
 */
import { useEffect, useRef, useState } from 'react';

// v1.6.3：相对路径（Vite proxy 把 /health 转给 :3001，nginx 反代同理）
// /health 不在 /api/* 下，所以要专门给 vite/nginx 加一条转发规则
const HEALTH_URL = '/health';
const POLL_INTERVAL_MS = 5000;
const TIMEOUT_MS = 3000;

type Status = 'online' | 'offline' | 'pending';

interface PingResult {
  status: Status;
  latencyMs?: number;
  serverTime?: string;
  error?: string;
}

async function ping(): Promise<PingResult> {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(HEALTH_URL, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!r.ok) return { status: 'offline', error: `HTTP ${r.status}` };
    // v1.6.3：必须返回 JSON 且含 status:'ok'，否则可能是 dev server 兜底返回 index.html
    let data: any = null;
    try {
      data = await r.json();
    } catch {
      return { status: 'offline', error: '响应非 JSON（dev proxy 未配 /health？）' };
    }
    if (data?.status !== 'ok') {
      return { status: 'offline', error: `status=${data?.status}` };
    }
    return {
      status: 'online',
      latencyMs: Math.round(performance.now() - t0),
      serverTime: data.timestamp,
    };
  } catch (e) {
    clearTimeout(timer);
    return { status: 'offline', error: e instanceof Error ? e.message : String(e) };
  }
}

const START_CMD = 'cd server && npm start';

export default function ServerStatusIndicator() {
  const [result, setResult] = useState<PingResult>({ status: 'pending' });
  const [showHelp, setShowHelp] = useState(false);
  const [popupPos, setPopupPos] = useState({ top: 0, left: 0 });
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      const r = await ping();
      if (cancelled) return;
      setResult(r);
    };
    run();
    timerRef.current = window.setInterval(run, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (timerRef.current != null) window.clearInterval(timerRef.current);
    };
  }, []);

  // 弹窗打开时计算按钮在 viewport 中的位置，用于 fixed 定位
  useEffect(() => {
    if (showHelp && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      setPopupPos({ top: rect.bottom + 6, left: rect.left });
    }
  }, [showHelp]);

  const dotColor = result.status === 'online' ? '#22c55e' : result.status === 'offline' ? '#ef4444' : '#f59e0b';
  const tooltip =
    result.status === 'online'
      ? `Server 在线 · ${result.latencyMs}ms\n点击查看详情`
      : result.status === 'offline'
      ? `Server 离线 · ${result.error || ''}\n点击查看启动方法`
      : '正在检测...';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(START_CMD);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // 退化：选中提示
      alert(`请手动复制：${START_CMD}`);
    }
  };

  const handleClick = () => {
    setShowHelp((v) => !v);
  };

  // 强制再 ping 一次（用户点了"已启动，立即检测"）
  const forcePing = async () => {
    setResult({ status: 'pending' });
    const r = await ping();
    setResult(r);
  };

  return (
    <div
      style={{
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        title={tooltip}
        aria-label={`Server 状态：${result.status}`}
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          border: 'none',
          padding: 0,
          background: 'transparent',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span
          style={{
            display: 'block',
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: dotColor,
            boxShadow: `0 0 6px ${dotColor}`,
            animation: result.status === 'pending' ? 'pulse 1.2s ease-in-out infinite' : 'none',
          }}
        />
      </button>

      {showHelp && (
        <>
          {/* 点空白关掉 */}
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 9998 }}
            onClick={() => setShowHelp(false)}
          />
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: popupPos.top,
              left: popupPos.left,
              zIndex: 9999,
              minWidth: 280,
              maxWidth: 320,
              padding: 12,
              borderRadius: 8,
              background: 'var(--bg-card, #fff)',
              border: '1px solid var(--border-color, #e2e8f0)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--text-primary, #1e293b)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong style={{ fontSize: 13 }}>
                {result.status === 'online' && '🟢 Server 在线'}
                {result.status === 'offline' && '🔴 Server 离线'}
                {result.status === 'pending' && '🟡 检测中...'}
              </strong>
              <button
                onClick={() => setShowHelp(false)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted, #94a3b8)',
                  cursor: 'pointer',
                  fontSize: 14,
                }}
                title="关闭"
              >
                ×
              </button>
            </div>

            {result.status === 'online' && (
              <div style={{ color: 'var(--text-secondary, #64748b)' }}>
                <div>地址：{window.location.host}</div>
                <div>延迟：{result.latencyMs}ms</div>
                <div>时间：{result.serverTime ? new Date(result.serverTime).toLocaleTimeString('zh-CN') : '—'}</div>
              </div>
            )}

            {result.status === 'offline' && (
              <>
                <div style={{ color: '#ef4444', marginBottom: 8 }}>
                  无法连接到后端 API。<br />
                  外部 AI 接入、画布同步、大模型调用都不可用。
                </div>
                <div style={{ marginBottom: 6, fontWeight: 600 }}>启动命令：</div>
                <div
                  style={{
                    fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                    fontSize: 11,
                    background: 'var(--bg-input, rgba(0,0,0,0.04))',
                    padding: '6px 8px',
                    borderRadius: 4,
                    marginBottom: 8,
                    userSelect: 'all',
                  }}
                >
                  {START_CMD}
                </div>
                <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
                  <button
                    type="button"
                    onClick={handleCopy}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      fontSize: 12,
                      borderRadius: 4,
                      border: '1px solid var(--border-color, #e2e8f0)',
                      background: 'var(--bg-card, #fff)',
                      cursor: 'pointer',
                      color: 'var(--text-primary, #1e293b)',
                    }}
                  >
                    {copied ? '✓ 已复制' : '📋 复制命令'}
                  </button>
                  <button
                    type="button"
                    onClick={forcePing}
                    style={{
                      flex: 1,
                      padding: '6px 8px',
                      fontSize: 12,
                      borderRadius: 4,
                      border: '1px solid var(--border-color, #e2e8f0)',
                      background: 'var(--bg-card, #fff)',
                      cursor: 'pointer',
                      color: 'var(--text-primary, #1e293b)',
                    }}
                  >
                    ↻ 立即检测
                  </button>
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)', lineHeight: 1.6 }}>
                  💡 想以后开机自启？运行：
                  <br />
                  <code style={{ background: 'var(--bg-input, rgba(0,0,0,0.04))', padding: '0 4px', borderRadius: 3, fontSize: 10 }}>
                    bash scripts/install-autostart.sh
                  </code>
                </div>
              </>
            )}
          </div>
        </>
      )}

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>
    </div>
  );
}
