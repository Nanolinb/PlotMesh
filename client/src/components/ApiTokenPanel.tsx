/**
 * ApiTokenPanel · "外部 AI 接入" token 配置面板
 * ---------------------------------------------------------------
 * v1.6.2 起：从 sidebar 搬到 ApiKeyConfigModal 里作为一个 tab。
 * 提供两种使用形态：
 *   - 默认（sidebar 形态，已废弃但保留兼容）：折叠头 + 展开后内容
 *   - embedded={true}（弹窗内）：直接展开内容，按钮和字号都更大
 *
 * 让用户能：
 *   1) 看到当前 server API token（默认掩码，点眼睛切换显示）
 *   2) 一键复制
 *   3) 一键重置（POST /api/canvas/auth/reset-token）
 *
 * 接入说明：
 *   - 后端从 v1.6.1 起把 token 持久化到 ~/.plotmesh/api-token，重启不丢
 *   - PLOTMESH_API_TOKEN env 优先级最高；写在 .env 里时 source='env'，
 *     此时 canReset=false（重置无效，要先取消 env 变量）
 *   - 这两个端点只允许 localhost 访问，前端在 dev 与生产都能用
 */
import { useEffect, useState, useCallback } from 'react';

// v1.6.3：相对路径，让 Vite dev proxy（dev）和 nginx 反代（生产/Docker）都生效
const API_BASE = '/api/canvas/auth';

type Source = 'env' | 'file' | 'generated';

interface TokenInfo {
  token: string;
  source: Source;
  canReset: boolean;
}

interface Props {
  /** true：在弹窗内嵌入使用（不显示折叠头，直接展开内容，按钮加大） */
  embedded?: boolean;
}

function maskToken(t: string): string {
  if (!t) return '';
  if (t.length <= 8) return '•'.repeat(t.length);
  return t.slice(0, 4) + '•'.repeat(t.length - 8) + t.slice(-4);
}

function sourceLabel(s: Source): { text: string; tip: string } {
  switch (s) {
    case 'env':
      return {
        text: 'env',
        tip: '来自 PLOTMESH_API_TOKEN 环境变量，优先级最高，无法通过此面板重置',
      };
    case 'file':
      return {
        text: '已持久化',
        tip: '保存在 ~/.plotmesh/api-token，重启后不会丢失',
      };
    case 'generated':
    default:
      return {
        text: '临时',
        tip: '本次会话临时生成，未能写入磁盘；重启会变。建议手动写入 server/.env',
      };
  }
}

export default function ApiTokenPanel({ embedded = false }: Props) {
  // embedded 模式默认就展开；sidebar 模式默认折叠
  const [open, setOpen] = useState(embedded);
  const [info, setInfo] = useState<TokenInfo | null>(null);
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // v1.6.2：远端访问开关
  const [remoteAccess, setRemoteAccess] = useState<boolean | null>(null);
  const [remoteSaving, setRemoteSaving] = useState(false);
  const [remoteRestartHint, setRemoteRestartHint] = useState(false);

  const fetchToken = useCallback(async () => {
    try {
      setLoading(true);
      setErr(null);
      const r = await fetch(`${API_BASE}/token`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = (await r.json()) as TokenInfo;
      setInfo(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 同时拉远端访问开关状态
  const fetchServerConfig = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/server-config`);
      if (!r.ok) return;
      const data = await r.json();
      setRemoteAccess(!!data.remoteAccess);
    } catch {
      /* server 没起，忽略 */
    }
  }, []);

  useEffect(() => {
    if (open && !info && !loading && !err) {
      fetchToken();
      fetchServerConfig();
    }
  }, [open, info, loading, err, fetchToken, fetchServerConfig]);

  const toggleRemoteAccess = async () => {
    if (remoteAccess == null) return;
    const next = !remoteAccess;
    if (next) {
      if (!confirm(
        '开启远端访问后：\n\n' +
        '• server 监听 0.0.0.0（LAN 内其他机器、Docker、群晖等都可访问）\n' +
        '• localhost 也强制 token（你之前免 token 的 curl 脚本会失效）\n' +
        '• 切换后需要重启 server 才生效\n\n' +
        '确认开启？',
      )) return;
    }
    try {
      setRemoteSaving(true);
      const r = await fetch(`${API_BASE}/server-config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remoteAccess: next }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({}));
        throw new Error(data.message || `HTTP ${r.status}`);
      }
      setRemoteAccess(next);
      setRemoteRestartHint(true);
    } catch (e) {
      alert('保存失败：' + (e instanceof Error ? e.message : String(e)));
    } finally {
      setRemoteSaving(false);
    }
  };

  const handleCopy = async () => {
    if (!info?.token) return;
    try {
      await navigator.clipboard.writeText(info.token);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      alert('复制失败，请手动选中 token 复制');
    }
  };

  const handleReset = async () => {
    if (!info?.canReset) return;
    if (!confirm('确认重置 API token？\n\n旧 token 会立即失效；正在使用的外部 AI 客户端、MCP 配置、curl 脚本都需要更新。')) {
      return;
    }
    try {
      setLoading(true);
      setErr(null);
      const r = await fetch(`${API_BASE}/reset-token`, { method: 'POST' });
      const data = await r.json();
      if (!r.ok) throw new Error(data.message || `HTTP ${r.status}`);
      setInfo({ token: data.token, source: data.source, canReset: data.source !== 'env' });
      setShow(true); // 重置后直接显示，方便用户拷贝
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const display = !info ? '' : show ? info.token : maskToken(info.token);
  const srcMeta = info ? sourceLabel(info.source) : null;

  // 嵌入模式（弹窗内）：不显示折叠头，按钮和字号更大
  // sidebar 模式：保留原有折叠头（向后兼容）
  const fontMain = embedded ? 13 : 11;
  const fontMeta = embedded ? 12 : 11;
  const fontHelp = embedded ? 11 : 10;
  const padBtn = embedded ? '6px 12px' : '4px 6px';
  const padToken = embedded ? '10px 12px' : '6px 8px';

  // 内容区（不论哪种形态都共用）
  const content = (
    <div style={{ padding: embedded ? 0 : '8px 0', display: 'flex', flexDirection: 'column', gap: embedded ? 12 : 8 }}>
      {loading && !info && (
        <div style={{ fontSize: fontMeta, color: 'var(--text-muted, #94a3b8)' }}>正在加载...</div>
      )}

      {err && (
        <div
          style={{
            fontSize: fontMeta,
            color: '#ef4444',
            padding: 10,
            background: 'rgba(239, 68, 68, 0.08)',
            borderRadius: 6,
            border: '1px solid rgba(239, 68, 68, 0.2)',
          }}
        >
          获取失败：{err}
          <br />
          <span style={{ fontSize: fontHelp, color: 'var(--text-muted, #94a3b8)' }}>
            请确认 server 已运行
          </span>
        </div>
      )}

      {info && (
        <>
          {/* token 显示行 */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              background: 'var(--bg-input, rgba(0,0,0,0.04))',
              borderRadius: 6,
              padding: padToken,
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              fontSize: fontMain,
              border: '1px solid var(--border-color, transparent)',
            }}
          >
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--text-primary, #1e293b)',
              }}
              title={show ? info.token : '点眼睛显示完整 token'}
            >
              {display || '—'}
            </span>
            <button
              type="button"
              style={{
                fontSize: fontMain,
                padding: embedded ? '4px 8px' : '2px 6px',
                background: 'transparent',
                border: '1px solid var(--border-color, #e2e8f0)',
                borderRadius: 4,
                cursor: 'pointer',
                color: 'var(--text-primary, #1e293b)',
              }}
              title={show ? '隐藏' : '显示完整 token'}
              onClick={() => setShow((v) => !v)}
            >
              {show ? '🙈' : '👁'}
            </button>
            <button
              type="button"
              style={{
                fontSize: fontMain,
                padding: embedded ? '4px 8px' : '2px 6px',
                background: 'transparent',
                border: '1px solid var(--border-color, #e2e8f0)',
                borderRadius: 4,
                cursor: 'pointer',
                color: 'var(--text-primary, #1e293b)',
              }}
              title="复制 token"
              onClick={handleCopy}
            >
              {copied ? '✓' : '📋'}
            </button>
          </div>

          {/* 来源标签 */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: fontMeta }}>
            <span style={{ color: 'var(--text-muted, #94a3b8)' }}>来源：</span>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 4,
                background:
                  info.source === 'env'
                    ? 'rgba(59, 130, 246, 0.12)'
                    : info.source === 'file'
                    ? 'rgba(34, 197, 94, 0.12)'
                    : 'rgba(245, 158, 11, 0.12)',
                color:
                  info.source === 'env'
                    ? '#3b82f6'
                    : info.source === 'file'
                    ? '#22c55e'
                    : '#f59e0b',
                fontWeight: 600,
              }}
              title={srcMeta!.tip}
            >
              {srcMeta!.text}
            </span>
            <span style={{ color: 'var(--text-muted, #94a3b8)', fontSize: fontHelp }}>
              {info.source === 'file' && '~/.plotmesh/api-token，重启不丢'}
              {info.source === 'env' && 'PLOTMESH_API_TOKEN 环境变量'}
              {info.source === 'generated' && '本次会话生成（未持久化）'}
            </span>
          </div>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              style={{
                flex: 1,
                fontSize: fontMeta,
                padding: padBtn,
                opacity: info.canReset ? 1 : 0.5,
                cursor: info.canReset && !loading ? 'pointer' : 'not-allowed',
                background: 'var(--bg-card, #fff)',
                border: '1px solid var(--border-color, #e2e8f0)',
                borderRadius: 6,
                color: 'var(--text-primary, #1e293b)',
              }}
              disabled={!info.canReset || loading}
              onClick={handleReset}
              title={
                info.canReset
                  ? '生成一个新的 token，旧 token 立即失效'
                  : '当前 token 来自 .env 环境变量，无法通过此面板重置'
              }
            >
              {loading ? '处理中...' : '🔄 重置 token'}
            </button>
            <button
              type="button"
              style={{
                fontSize: fontMeta,
                padding: padBtn,
                background: 'var(--bg-card, #fff)',
                border: '1px solid var(--border-color, #e2e8f0)',
                borderRadius: 6,
                cursor: loading ? 'not-allowed' : 'pointer',
                color: 'var(--text-primary, #1e293b)',
              }}
              onClick={fetchToken}
              disabled={loading}
              title="重新拉取当前 token"
            >
              ↻ 刷新
            </button>
          </div>

          {!info.canReset && (
            <div style={{ fontSize: fontHelp, color: 'var(--text-muted, #94a3b8)', lineHeight: 1.5 }}>
              当前 token 来自 PLOTMESH_API_TOKEN 环境变量，优先级最高。要重置请改 server/.env 后重启。
            </div>
          )}

          {info.canReset && info.source === 'generated' && (
            <div style={{ fontSize: fontHelp, color: '#f59e0b', lineHeight: 1.5 }}>
              ⚠ 当前 token 未能写入磁盘，重启会变。可手动复制到 server/.env：
              <br />
              <code>PLOTMESH_API_TOKEN={info.token.slice(0, 8)}...</code>
            </div>
          )}

          {/* v1.6.2：远端访问开关 ─────────────────────────── */}
          {remoteAccess != null && (
            <div
              style={{
                marginTop: 12,
                paddingTop: 12,
                borderTop: '1px solid var(--border-color, #e2e8f0)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginBottom: 6,
                }}
              >
                <div>
                  <div style={{ fontSize: fontMain, fontWeight: 600, color: 'var(--text-primary, #1e293b)' }}>
                    🌐 远端访问
                  </div>
                  <div style={{ fontSize: fontHelp, color: 'var(--text-muted, #94a3b8)', marginTop: 2 }}>
                    {remoteAccess
                      ? '已开启：LAN/Docker/群晖 都能访问，所有请求强制 token'
                      : '已关闭：仅本机访问，localhost 免 token'}
                  </div>
                </div>
                {/* 自制 toggle 开关 */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={remoteAccess}
                  disabled={remoteSaving}
                  onClick={toggleRemoteAccess}
                  style={{
                    width: 42,
                    height: 22,
                    borderRadius: 11,
                    border: 'none',
                    background: remoteAccess ? '#22c55e' : 'var(--bg-input, #cbd5e1)',
                    position: 'relative',
                    cursor: remoteSaving ? 'wait' : 'pointer',
                    flexShrink: 0,
                    transition: 'background 0.2s',
                  }}
                  title={remoteAccess ? '点击关闭远端访问' : '点击开启远端访问'}
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: 2,
                      left: remoteAccess ? 22 : 2,
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: '#fff',
                      transition: 'left 0.2s',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                    }}
                  />
                </button>
              </div>
              {remoteRestartHint && (
                <div
                  style={{
                    fontSize: fontHelp,
                    color: '#f59e0b',
                    background: 'rgba(245,158,11,0.08)',
                    padding: '6px 8px',
                    borderRadius: 4,
                    marginTop: 4,
                    lineHeight: 1.5,
                  }}
                >
                  ⚠ 设置已保存，但 server 监听地址需要重启才会切换。<br />
                  请到 terminal 重启 <code>npm start</code>。
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );

  // embedded 形态：直接返回内容，不带任何包装
  if (embedded) return content;

  // sidebar 形态：折叠包装（向后兼容）
  return (
    <div
      className="sidebar-section api-token-panel"
      style={{ borderTop: '1px solid var(--border-color, #e2e8f0)' }}
    >
      <div
        className="sidebar-section-header"
        style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
        onClick={() => setOpen((v) => !v)}
        title="外部 AI（codex / kimi / Claude Desktop / curl）调用画布 API 的 token"
      >
        <h3 style={{ margin: 0 }}>🔑 外部 AI 接入</h3>
        <span style={{ fontSize: 11, color: 'var(--text-muted, #94a3b8)' }}>
          {open ? '▾' : '▸'}
        </span>
      </div>

      {open && content}
    </div>
  );
}
