import { Handle, Position } from '@xyflow/react';
import { useCallback, useEffect, useState } from 'react';
import { useNodeStore } from '../../store/nodes';
import { IMAGE_AI_MODEL_OPTIONS, type ImageAIProvider, type ImageAINodeData } from '../../types/nodes';
import { resolveImageUrl } from '../../utils/imagePayload';

type Props = {
  id: string;
  data: ImageAINodeData;
  selected?: boolean;
  [key: string]: any;
};

function ImageAINode({ id, data, selected }: Props) {
  const provider: ImageAIProvider = data.provider === 'kimi' ? 'kimi' : 'openai';
  const model = data.model || (provider === 'kimi' ? 'kimi-k3' : 'gpt-image-1');
  const updateNodeData = useNodeStore((state) => state.updateNodeData);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '图片AI');
  const [localPrompt, setLocalPrompt] = useState(data.prompt || '');
  const [localStrength, setLocalStrength] = useState(data.strength ?? 0.65);
  const [providerConfigs, setProviderConfigs] = useState<Record<string, { configured: boolean; model: string }> | null>(null);
  const image = Array.isArray(data.images) ? data.images[0] : undefined;
  const imageUrl = resolveImageUrl(image);
  const imageConfigured = providerConfigs?.[provider]?.configured;

  useEffect(() => { setLocalTitle(data.label || '图片AI'); }, [data.label]);
  useEffect(() => { setLocalPrompt(data.prompt || ''); }, [data.prompt]);
  useEffect(() => { setLocalStrength(data.strength ?? 0.65); }, [data.strength]);
  useEffect(() => {
    let active = true;
    fetch('/api/llm/image-config')
      .then((response) => response.json())
      .then((body) => { if (active) setProviderConfigs(body?.providers || null); })
      .catch(() => { if (active) setProviderConfigs(null); });
    return () => { active = false; };
  }, []);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const value = localTitle.trim();
    if (value) updateNodeData(id, { label: value } as any);
    else setLocalTitle(data.label || '图片AI');
  }, [data.label, id, localTitle, updateNodeData]);

  const handleDownload = useCallback(async () => {
    if (!imageUrl) return;
    try {
      const response = await fetch(imageUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = objectUrl;
      anchor.download = image?.name || `${data.label || '图片AI'}.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (error: any) {
      alert(`下载失败：${error?.message || '未知错误'}`);
    }
  }, [data.label, image?.name, imageUrl]);

  return (
    <div
      className={`node-card image-ai-node ${selected ? 'selected' : ''}`}
      data-status={data.status || 'idle'}
      style={{ width: 340 }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="prompt"
        style={{ top: 92, background: '#3b82f6' }}
        title="文字 Prompt 输入"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="reference"
        style={{ top: 142, background: '#a855f7' }}
        title="参考图片输入"
      />
      <Handle type="source" position={Position.Right} id="image" />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #db2777, #8b5cf6)' }}>
        <span className="node-icon">🎨</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localTitle}
            onChange={(event) => setLocalTitle(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitTitle();
              if (event.key === 'Escape') {
                setEditingTitle(false);
                setLocalTitle(data.label || '图片AI');
              }
              event.stopPropagation();
            }}
            onClick={(event) => event.stopPropagation()}
            style={{ flex: 1, background: 'rgba(255,255,255,.22)', border: '1px solid rgba(255,255,255,.55)', borderRadius: 6, color: '#fff', padding: '2px 6px', fontSize: 13, outline: 'none' }}
          />
        ) : (
          <span
            className="node-title"
            onDoubleClick={(event) => { event.stopPropagation(); setEditingTitle(true); }}
            title="双击重命名"
            style={{ flex: 1, cursor: 'text' }}
          >
            {data.label || '图片AI'}
          </span>
        )}
        <span style={{ fontSize: 10, opacity: 0.86 }}>PNG</span>
      </div>

      <div className="node-body" style={{ padding: 10 }}>
        <div style={{ display: 'flex', gap: 6, marginBottom: 8, fontSize: 10 }}>
          <span style={{ color: '#3b82f6' }}>● 文字</span>
          <span style={{ color: '#a855f7' }}>● 参考图</span>
          <span style={{ marginLeft: 'auto', color: imageConfigured === false ? '#ef4444' : 'var(--text-muted)' }}>
            {imageConfigured === false ? `未配置 ${provider === 'kimi' ? 'Kimi' : 'OpenAI'} Key` : '运行画布生成'}
          </span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.45fr', gap: 7, marginBottom: 9 }}>
          <label style={{ display: 'block', fontSize: 10, color: 'var(--text-secondary)' }}>
            提供商
            <select
              className="nodrag"
              value={provider}
              onChange={(event) => {
                const nextProvider = event.target.value as ImageAIProvider;
                updateNodeData(id, {
                  provider: nextProvider,
                  model: IMAGE_AI_MODEL_OPTIONS[nextProvider][0].value,
                } as any);
              }}
              style={{ width: '100%', marginTop: 3, padding: '4px 6px', fontSize: 11, borderRadius: 5 }}
            >
              <option value="openai">OpenAI</option>
              <option value="kimi">Kimi</option>
            </select>
          </label>
          <label style={{ display: 'block', fontSize: 10, color: 'var(--text-secondary)' }}>
            模型
            <select
              className="nodrag"
              value={model}
              onChange={(event) => updateNodeData(id, { model: event.target.value } as any)}
              style={{ width: '100%', marginTop: 3, padding: '4px 6px', fontSize: 11, borderRadius: 5 }}
            >
              {IMAGE_AI_MODEL_OPTIONS[provider].map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
        </div>
        {provider === 'kimi' && (
          <div style={{ margin: '-3px 0 8px', fontSize: 9, lineHeight: 1.35, color: 'var(--text-muted)' }}>
            Kimi K3 图片输出取决于当前 API 账号/网关能力；若只返回文字会明确报错。
          </div>
        )}

        <label style={{ display: 'block', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>基础 Prompt</label>
        <textarea
          className="nodrag"
          value={localPrompt}
          placeholder="例如：透明背景的蓝紫色水晶机器人图标，正面视角，柔和光照"
          onChange={(event) => {
            const value = event.target.value;
            setLocalPrompt(value);
            updateNodeData(id, { prompt: value } as any);
          }}
          onKeyDown={(event) => event.stopPropagation()}
          style={{ width: '100%', minHeight: 70, resize: 'vertical', boxSizing: 'border-box', border: '1px solid var(--border-color)', borderRadius: 6, background: 'var(--bg-input)', color: 'var(--text-primary)', padding: 7, fontSize: 12, lineHeight: 1.45 }}
        />

        <div style={{ marginTop: 9 }}>
          <label style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-secondary)', marginBottom: 3 }}>
            <span title="参考图对生成结果的影响程度">参考强度</span>
            <strong style={{ color: '#a855f7' }}>{Math.round(localStrength * 100)}%</strong>
          </label>
          <input
            className="nodrag"
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={localStrength}
            onChange={(event) => {
              const value = Number(event.target.value);
              setLocalStrength(value);
              updateNodeData(id, { strength: value } as any);
            }}
            style={{ width: '100%', accentColor: '#a855f7' }}
          />
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '8px 0' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-secondary)' }}>
            <input
              className="nodrag"
              type="checkbox"
              checked={data.transparent === true}
              onChange={(event) => updateNodeData(id, { transparent: event.target.checked } as any)}
            />
            透明背景
          </label>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 'auto', fontSize: 11, color: 'var(--text-secondary)' }}>
            构图
            <select
              className="nodrag"
              value={data.size || '1024x1024'}
              onChange={(event) => updateNodeData(id, { size: event.target.value as ImageAINodeData['size'] } as any)}
              style={{ fontSize: 11, padding: '2px 4px' }}
            >
              <option value="1024x1024">方形</option>
              <option value="1024x1536">竖版</option>
              <option value="1536x1024">横版</option>
            </select>
          </label>
        </div>

        <div
          style={{
            width: '100%',
            maxWidth: 512,
            height: 260,
            maxHeight: 512,
            borderRadius: 8,
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-card-body)',
            backgroundImage: data.transparent
              ? 'linear-gradient(45deg, rgba(148,163,184,.18) 25%, transparent 25%), linear-gradient(-45deg, rgba(148,163,184,.18) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(148,163,184,.18) 75%), linear-gradient(-45deg, transparent 75%, rgba(148,163,184,.18) 75%)'
              : 'none',
            backgroundSize: data.transparent ? '20px 20px' : undefined,
            backgroundPosition: data.transparent ? '0 0, 0 10px, 10px -10px, -10px 0px' : undefined,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {data.status === 'running' ? (
            <div style={{ color: '#8b5cf6', fontSize: 12, textAlign: 'center' }}>
              <div style={{ fontSize: 28, marginBottom: 6 }}>◌</div>
              正在生成图片…
            </div>
          ) : imageUrl ? (
            <img src={imageUrl} alt={image?.name || 'AI 生成图片'} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
          ) : (
            <div style={{ color: 'var(--text-muted)', fontSize: 12, textAlign: 'center', lineHeight: 1.6 }}>
              <div style={{ fontSize: 36, opacity: 0.75 }}>🎨</div>
              运行后在这里预览
              <div style={{ fontSize: 10 }}>预览框不超过 512×512</div>
            </div>
          )}
        </div>

        {imageUrl && (
          <button
            className="nodrag"
            onClick={(event) => { event.stopPropagation(); void handleDownload(); }}
            style={{ width: '100%', marginTop: 8, border: '1px solid #a855f7', borderRadius: 6, background: 'rgba(168,85,247,.12)', color: '#a855f7', padding: '5px 8px', cursor: 'pointer', fontSize: 11, fontWeight: 600 }}
          >
            ⬇️ 下载 PNG
          </button>
        )}

        {data.status === 'error' && (
          <div style={{ marginTop: 7, color: '#ef4444', fontSize: 11, lineHeight: 1.4 }} title={data.error || ''}>
            ❌ {(data.error || '图片生成失败').slice(0, 90)}
          </div>
        )}
      </div>
    </div>
  );
}

export default ImageAINode;
