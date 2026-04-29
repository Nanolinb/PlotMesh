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

/**
 * LLM API Key 配置面板
 * - 启动时拉取每个模型的配置状态（不暴露真实 key）
 * - 用户填写后 POST 到 /api/llm/config 持久化到 server/.env
 */
export default function ApiKeyConfigModal({ open, onClose }: Props) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string>('');

  const load = async () => {
    setLoading(true);
    try {
      const resp = await fetch('/api/llm/config');
      const json = await resp.json();
      setModels(json.models || []);
    } catch (e: any) {
      setMsg('❌ 加载失败：' + (e.message || '未知错误'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (open) {
      setMsg('');
      setEdits({});
      load();
    }
  }, [open]);

  const handleSave = async (id: string) => {
    const key = (edits[id] ?? '').trim();
    setSavingId(id);
    setMsg('');
    try {
      const resp = await fetch('/api/llm/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: id, apiKey: key }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || '保存失败');
      }
      setMsg(`✅ ${id} 保存成功`);
      setEdits((prev) => ({ ...prev, [id]: '' }));
      await load();
    } catch (e: any) {
      setMsg('❌ ' + (e.message || '保存失败'));
    } finally {
      setSavingId(null);
    }
  };

  const handleClear = async (id: string) => {
    if (!confirm('确定清空该模型的 API Key?')) return;
    setEdits((prev) => ({ ...prev, [id]: '' }));
    setSavingId(id);
    try {
      await fetch('/api/llm/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: id, apiKey: '' }),
      });
      setMsg(`🗑 ${id} 已清空`);
      await load();
    } finally {
      setSavingId(null);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" style={{ width: 520, maxWidth: '92vw' }} onClick={(e) => e.stopPropagation()}>
        <h3>🔑 大模型 API 配置</h3>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 }}>
          配置后的 Key 会保存在 <code>server/.env</code>。运行时立刻生效，无需重启。
        </p>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-muted)' }}>加载中...</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: '60vh', overflowY: 'auto' }}>
            {models.map((m) => (
              <div
                key={m.id}
                style={{
                  padding: 10,
                  border: '1px solid var(--border-color)',
                  borderRadius: 8,
                  background: 'var(--bg-card-body)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                  <div>
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
                    }}
                  >
                    {m.configured ? `✓ 已配置 (${m.masked})` : '未配置'}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="password"
                    placeholder={m.configured ? '留空不修改；输入新值则覆盖' : `输入 ${m.envName}`}
                    value={edits[m.id] ?? ''}
                    onChange={(e) => setEdits((prev) => ({ ...prev, [m.id]: e.target.value }))}
                    style={{
                      flex: 1,
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
                  <button
                    onClick={() => handleSave(m.id)}
                    disabled={savingId === m.id || !edits[m.id]}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 6,
                      border: '1px solid var(--accent)',
                      background: 'var(--accent)',
                      color: 'white',
                      fontSize: 12,
                      cursor: 'pointer',
                      opacity: (savingId === m.id || !edits[m.id]) ? 0.5 : 1,
                    }}
                  >
                    {savingId === m.id ? '保存中...' : '保存'}
                  </button>
                  {m.configured && (
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
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {msg && (
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 10 }}>{msg}</div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}
