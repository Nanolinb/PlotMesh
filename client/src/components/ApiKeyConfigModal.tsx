/**
 * ApiKeyConfigModal · 大模型 API Key 配置弹窗
 * ---------------------------------------------------------------
 * 让用户在前端可视化地填入 5 家厂商的 API Key（DeepSeek / GPT / Claude / GLM / 混元）。
 *
 * 重要：Key 不会留在浏览器，而是 POST 到 /api/llm/config 由后端写入 server/.env
 * 文件 — 这样既避免泄露，又能让后端在调用 LLM 时直接读取。
 *
 * 行为细节：
 *  - 加载弹窗时从 GET /api/llm/config 拉一次现有配置，仅显示是否已配置（****）
 *  - 用户每改一个输入框 → debounce 后写回；不显式"保存"按钮，少一次操作
 *  - 后端为安全起见返回时不会把真实 Key 回传，只回 has_xxx 布尔状态
 */
import { useEffect, useState } from 'react';

type ModelInfo = {
  id: string;
  name: string;
  modelName: string;
  envName: string;
  configured: boolean;
  masked: string;
};

type Props = {
  open: boolean;
  onClose: () => void;
};

const KEY_HINTS: Record<string, { url: string; tip: string }> = {
  hunyuan: { url: 'https://cloud.tencent.com/document/product/1729', tip: '腾讯云控制台 → 混元大模型 → API Key' },
  deepseek: { url: 'https://platform.deepseek.com/api_keys', tip: 'DeepSeek 平台 → API Keys' },
  glm: { url: 'https://open.bigmodel.cn/usercenter/apikeys', tip: '智谱开放平台 → 用户中心 → API Keys' },
  gpt: { url: 'https://platform.openai.com/api-keys', tip: 'OpenAI Platform → API keys（注意：国内无法直连，需代理）' },
  claude: { url: 'https://console.anthropic.com/settings/keys', tip: 'Anthropic Console → Settings → API Keys（同样需要代理）' },
  kimi: { url: 'https://platform.moonshot.cn/console/api-keys', tip: 'Moonshot 平台 → API Keys（Kimi 同款）' },
  qwen: { url: 'https://bailian.console.aliyun.com/?apiKey=1', tip: '阿里云百炼 / DashScope → API Key' },
};

/**
 * LLM API Key 配置面板
 * - 启动时拉取每个模型的配置状态（不暴露真实 key）
 * - 用户填写后 POST 到 /api/llm/config 持久化到 server/.env
 * - 支持显示/隐藏明文、测试连接、官网链接
 */
export default function ApiKeyConfigModal({ open, onClose }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [showPlain, setShowPlain] = useState<Record<string, boolean>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [error, setError] = useState<string>('');

  const showToast = (kind: 'ok' | 'err', text: string) => {
    setToast({ kind, text });
    setTimeout(() => setToast(null), 3000);
  };

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const resp = await fetch('/api/llm/config');
      if (!resp.ok) throw new Error(`后端响应 ${resp.status}：请确认后端服务（3001 端口）已启动`);
      const json = await resp.json();
      setModels(json.models || []);
    } catch (e: any) {
      setError(e.message || '加载失败 — 是否后端没启动？');
      setModels([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setEdits({});
      setShowPlain({});
      setTestResults({});
      load();
    }
  }, [open]);

  const handleSave = async (id: string) => {
    const key = (edits[id] ?? '').trim();
    if (!key) return;
    setSavingId(id);
    try {
      const resp = await fetch('/api/llm/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: id, apiKey: key }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(typeof err.error === 'string' ? err.error : '保存失败');
      }
      showToast('ok', `✅ ${id} 已保存（已写入 server/.env）`);
      setEdits((prev) => ({ ...prev, [id]: '' }));
      setTestResults((prev) => ({ ...prev, [id]: undefined as any }));
      await load();
    } catch (e: any) {
      showToast('err', '❌ ' + (e.message || '保存失败'));
    } finally {
      setSavingId(null);
    }
  };

  const handleClear = async (id: string) => {
    if (!confirm('确定清空该模型的 API Key？已写入 .env 的内容会被覆盖为空。')) return;
    setSavingId(id);
    try {
      await fetch('/api/llm/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: id, apiKey: '' }),
      });
      showToast('ok', `🗑 ${id} 已清空`);
      setEdits((prev) => ({ ...prev, [id]: '' }));
      setTestResults((prev) => ({ ...prev, [id]: undefined as any }));
      await load();
    } finally {
      setSavingId(null);
    }
  };

  // 用一句简单的 ping 验证 key 是否能调通
  const handleTest = async (id: string) => {
    setTestingId(id);
    setTestResults((prev) => ({ ...prev, [id]: { ok: false, msg: '测试中...' } }));
    try {
      const resp = await fetch('/api/llm/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: id,
          messages: [{ role: 'user', content: 'ping' }],
          temperature: 0,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        const errText =
          (typeof json.error === 'string' ? json.error : json.error?.message) || `HTTP ${resp.status}`;
        setTestResults((prev) => ({ ...prev, [id]: { ok: false, msg: '❌ ' + errText.toString().slice(0, 80) } }));
        return;
      }
      const content =
        json?.choices?.[0]?.message?.content ||
        json?.content?.[0]?.text ||
        '(无内容返回)';
      setTestResults((prev) => ({ ...prev, [id]: { ok: true, msg: '✅ 连通：' + String(content).slice(0, 30) } }));
    } catch (e: any) {
      setTestResults((prev) => ({ ...prev, [id]: { ok: false, msg: '❌ 网络错误：' + (e.message || '未知') } }));
    } finally {
      setTestingId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ width: 580, maxWidth: '94vw' }} onClick={(e) => e.stopPropagation()}>
        <h3>🔑 大模型 API 配置</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.6 }}>
          填入后点击「保存」会立即生效并写入 <code>server/.env</code>，无需重启。
          已保存的 Key 不会以明文回显，可以点 👁 切换查看你刚输入的内容。
        </p>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)', padding: '8px 10px', borderRadius: 6, fontSize: 12, marginBottom: 10 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>加载中...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '60vh', overflowY: 'auto' }}>
            {models.map((m) => {
              const editing = edits[m.id] ?? '';
              const inputType = showPlain[m.id] ? 'text' : 'password';
              const tr = testResults[m.id];
              const hint = KEY_HINTS[m.id];
              return (
                <div
                  key={m.id}
                  style={{
                    padding: 10,
                    border: '1px solid var(--border-color)',
                    borderRadius: 8,
                    background: 'var(--bg-card-body)',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, gap: 8 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: 13 }}>{m.name}</strong>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                        {m.modelName}
                      </span>
                    </div>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '2px 8px',
                        borderRadius: 10,
                        background: m.configured ? 'rgba(16,185,129,0.15)' : 'rgba(148,163,184,0.15)',
                        color: m.configured ? 'var(--success)' : 'var(--text-muted)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.configured ? `✓ 已配置 (${m.masked})` : '未配置'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type={inputType}
                      placeholder={m.configured ? '留空不修改；输入新值则覆盖' : `输入 ${m.envName}`}
                      value={editing}
                      onChange={(e) => setEdits((prev) => ({ ...prev, [m.id]: e.target.value }))}
                      onKeyDown={(e) => { if (e.key === 'Enter' && editing.trim()) { e.preventDefault(); handleSave(m.id); } }}
                      style={{
                        flex: 1,
                        minWidth: 0,
                        padding: '6px 10px',
                        borderRadius: 6,
                        border: '1px solid var(--border-input)',
                        background: 'var(--bg-input)',
                        color: 'var(--text-primary)',
                        fontSize: 12,
                        outline: 'none',
                        fontFamily: 'monospace',
                      }}
                    />
                    {editing && (
                      <button
                        onClick={() => setShowPlain((prev) => ({ ...prev, [m.id]: !prev[m.id] }))}
                        title={showPlain[m.id] ? '隐藏' : '显示明文'}
                        style={{
                          padding: '6px 8px',
                          borderRadius: 6,
                          border: '1px solid var(--border-color)',
                          background: 'var(--bg-card)',
                          color: 'var(--text-primary)',
                          fontSize: 12,
                          cursor: 'pointer',
                        }}
                      >
                        {showPlain[m.id] ? '🙈' : '👁'}
                      </button>
                    )}
                    <button
                      onClick={() => handleSave(m.id)}
                      disabled={savingId === m.id || !editing.trim()}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid var(--accent)',
                        background: 'var(--accent)',
                        color: 'white',
                        fontSize: 12,
                        cursor: savingId === m.id || !editing.trim() ? 'not-allowed' : 'pointer',
                        opacity: savingId === m.id || !editing.trim() ? 0.5 : 1,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {savingId === m.id ? '保存中…' : '保存'}
                    </button>
                    {m.configured && (
                      <>
                        <button
                          onClick={() => handleTest(m.id)}
                          disabled={testingId === m.id}
                          title="发起一次最小请求验证 Key 是否可用"
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-card)',
                            color: 'var(--text-primary)',
                            fontSize: 12,
                            cursor: 'pointer',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {testingId === m.id ? '⌛' : '🧪 测试'}
                        </button>
                        <button
                          onClick={() => handleClear(m.id)}
                          disabled={savingId === m.id}
                          style={{
                            padding: '6px 10px',
                            borderRadius: 6,
                            border: '1px solid var(--border-color)',
                            background: 'var(--bg-card)',
                            color: 'var(--danger)',
                            fontSize: 12,
                            cursor: 'pointer',
                          }}
                          title="清空此 Key"
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </div>

                  {/* 帮助链接 */}
                  {hint && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
                      获取 Key：<a href={hint.url} target="_blank" rel="noreferrer" style={{ color: 'var(--accent)' }}>{hint.tip} ↗</a>
                    </div>
                  )}

                  {/* 测试结果 */}
                  {tr && (
                    <div
                      style={{
                        fontSize: 11,
                        marginTop: 6,
                        color: tr.ok ? 'var(--success)' : 'var(--danger)',
                        wordBreak: 'break-all',
                      }}
                    >
                      {tr.msg}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {toast && (
          <div
            style={{
              fontSize: 12,
              marginTop: 10,
              padding: '8px 10px',
              borderRadius: 6,
              background: toast.kind === 'ok' ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
              color: toast.kind === 'ok' ? 'var(--success)' : 'var(--danger)',
            }}
          >
            {toast.text}
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
