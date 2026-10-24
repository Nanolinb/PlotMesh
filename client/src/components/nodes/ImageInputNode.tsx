import { Handle, Position } from '@xyflow/react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNodeStore } from '../../store/nodes';
import type { ImageInputNodeData } from '../../types/nodes';

type Props = {
  id: string;
  data: ImageInputNodeData;
  selected?: boolean;
  [key: string]: any;
};

type UploadedImage = ImageInputNodeData['images'][number];

const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif';
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function ImageInputNode({ id, data, selected }: Props) {
  const updateNodeData = useNodeStore((state) => state.updateNodeData);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '图片输入');
  const images = Array.isArray(data.images) ? data.images : [];
  const weight = typeof data.weight === 'number' ? data.weight : 1;

  useEffect(() => { setLocalTitle(data.label || '图片输入'); }, [data.label]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const value = localTitle.trim();
    if (value) updateNodeData(id, { label: value } as any);
    else setLocalTitle(data.label || '图片输入');
  }, [data.label, id, localTitle, updateNodeData]);

  const bumpOrder = useCallback((delta: number) => {
    (useNodeStore.getState() as any).swapPromptOrder?.(id, delta < 0 ? 'up' : 'down');
  }, [id]);

  const uploadToServer = async (file: File) => {
    const form = new FormData();
    form.append('file', file);
    const response = await fetch('/api/upload/file', { method: 'POST', body: form });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error(errorBody.error || '图片上传失败');
    }
    const json = await response.json();
    return json.file as {
      originalName: string;
      filename: string;
      path: string;
      size: number;
      mimetype: string;
      ext: string;
    };
  };

  const processImages = useCallback(async (filesIn: File[]) => {
    const files = filesIn.filter((file) => file.type.startsWith('image/'));
    if (!files.length) {
      updateNodeData(id, { status: 'error', error: '请选择 PNG、JPEG、WebP 或 GIF 图片' } as any);
      return;
    }

    const current = (useNodeStore.getState().nodes.find((node: any) => node.id === id)?.data as any)?.images || [];
    const temporary: UploadedImage[] = files.map((file) => ({
      id: `image-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: file.name,
      filename: '',
      path: '',
      size: file.size,
      type: file.type,
      ext: file.name.includes('.') ? `.${file.name.split('.').pop()?.toLowerCase()}` : '',
      uploading: true,
      error: file.size > MAX_IMAGE_BYTES ? '图片不能超过 10 MB' : undefined,
    }));
    updateNodeData(id, { images: [...current, ...temporary], status: 'running', error: undefined } as any);

    const completed: UploadedImage[] = [];
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      const placeholder = temporary[index];
      if (placeholder.error) {
        completed.push({ ...placeholder, uploading: false });
        continue;
      }
      try {
        const uploaded = await uploadToServer(file);
        completed.push({
          id: placeholder.id,
          name: uploaded.originalName,
          filename: uploaded.filename,
          path: uploaded.path || `/uploads/${uploaded.filename}`,
          size: uploaded.size,
          type: uploaded.mimetype || file.type || 'image/png',
          ext: uploaded.ext,
          uploading: false,
        });
      } catch (error: any) {
        completed.push({ ...placeholder, uploading: false, error: error?.message || '图片上传失败' });
      }
    }

    const latest = ((useNodeStore.getState().nodes.find((node: any) => node.id === id)?.data as any)?.images || []) as UploadedImage[];
    const completedById = new Map(completed.map((image) => [image.id, image]));
    const merged = latest.map((image) => completedById.get(image.id) || image);
    const hasError = merged.some((image) => image.error);
    updateNodeData(id, {
      images: merged,
      status: merged.some((image) => !image.error && !image.uploading) ? 'success' : hasError ? 'error' : 'idle',
      error: hasError ? '部分图片上传失败' : undefined,
    } as any);
  }, [id, updateNodeData]);

  const removeImage = useCallback((imageId: string) => {
    const next = images.filter((image) => image.id !== imageId);
    updateNodeData(id, {
      images: next,
      status: next.some((image) => !image.error && !image.uploading) ? 'success' : 'idle',
      error: undefined,
    } as any);
  }, [id, images, updateNodeData]);

  return (
    <div
      className={`node-card image-input-node ${selected ? 'selected' : ''}`}
      data-status={data.status || 'idle'}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(true);
      }}
      onDragLeave={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
      }}
      onDrop={(event) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        void processImages(Array.from(event.dataTransfer.files));
      }}
      style={{ width: 350, border: dragOver ? '2px dashed #8b5cf6' : '2px solid transparent' }}
    >
      <Handle type="source" position={Position.Right} />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #7c3aed, #a855f7)' }}>
        <span className="node-icon">🖼️</span>
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
                setLocalTitle(data.label || '图片输入');
              }
              event.stopPropagation();
            }}
            onClick={(event) => event.stopPropagation()}
            style={{ flex: 1, minWidth: 70, background: 'rgba(255,255,255,.22)', border: '1px solid rgba(255,255,255,.55)', borderRadius: 6, color: '#fff', padding: '2px 6px', fontSize: 13, outline: 'none' }}
          />
        ) : (
          <span
            className="node-title"
            onDoubleClick={(event) => { event.stopPropagation(); setEditingTitle(true); }}
            title="双击重命名"
            style={{ flex: 1, minWidth: 58, cursor: 'text', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
          >
            {data.label || '图片输入'}
          </span>
        )}
        <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <button className="nodrag" onClick={(event) => { event.stopPropagation(); bumpOrder(-1); }} title="上移图片输入顺序" style={{ width: 18, height: 18, padding: 0, border: 0, borderRadius: 4, color: '#fff', background: 'rgba(255,255,255,.22)', cursor: 'pointer', fontSize: 9 }}>▲</button>
          <span style={{ minWidth: 28, textAlign: 'center', padding: '1px 5px', borderRadius: 10, background: 'rgba(255,255,255,.22)', color: '#fff', fontSize: 10, fontWeight: 700 }}>#{data.promptNumber || 1}</span>
          <button className="nodrag" onClick={(event) => { event.stopPropagation(); bumpOrder(1); }} title="下移图片输入顺序" style={{ width: 18, height: 18, padding: 0, border: 0, borderRadius: 4, color: '#fff', background: 'rgba(255,255,255,.22)', cursor: 'pointer', fontSize: 9 }}>▼</button>
          <button className="nodrag" onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }} title="上传图片" style={{ marginLeft: 2, width: 22, height: 20, background: 'rgba(255,255,255,.24)', border: 0, borderRadius: 6, padding: 0, cursor: 'pointer', color: '#fff', fontSize: 14, lineHeight: '20px' }}>＋</button>
        </div>
      </div>

      <div className="node-body" style={{ padding: 10 }}>
        <input
          ref={inputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          multiple
          style={{ display: 'none' }}
          onChange={(event) => {
            void processImages(Array.from(event.target.files || []));
            event.currentTarget.value = '';
          }}
        />

        <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9, fontSize: 11, color: 'var(--text-secondary)' }} title="该图片输入节点对图片AI结果的相对影响程度">
          <span>权重</span>
          <input
            className="nodrag"
            type="range"
            min={0}
            max={1}
            step={0.1}
            value={weight}
            onChange={(event) => updateNodeData(id, { weight: Number(event.target.value) } as any)}
            style={{ flex: 1, accentColor: '#8b5cf6' }}
          />
          <strong style={{ width: 24, textAlign: 'right', color: '#8b5cf6' }}>{weight.toFixed(1)}</strong>
        </label>

        {images.length === 0 ? (
          <button
            type="button"
            className="nodrag"
            onClick={(event) => { event.stopPropagation(); inputRef.current?.click(); }}
            style={{ width: '100%', minHeight: 92, borderRadius: 8, border: `1px dashed ${dragOver ? '#8b5cf6' : 'var(--border-color)'}`, background: 'var(--bg-card-body)', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 11, lineHeight: 1.5 }}
          >
            <span style={{ display: 'block', fontSize: 26 }}>🖼️</span>
            拖入图片或点击上传
            <span style={{ display: 'block', fontSize: 9 }}>PNG / JPEG / WebP / GIF · 单张 ≤ 10 MB</span>
          </button>
        ) : (
          <div className="nodrag" style={{ display: 'grid', gridTemplateColumns: images.length === 1 ? '1fr' : 'repeat(2, minmax(0, 1fr))', gap: 8 }}>
            {images.map((image) => (
              <div
                key={image.id}
                title={image.error || `${image.name} · ${Math.max(1, Math.round(image.size / 1024))} KB`}
                style={{ position: 'relative', height: images.length === 1 ? 160 : 128, borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-color)', background: 'var(--bg-card-body)', boxSizing: 'border-box' }}
              >
                {!image.uploading && !image.error && image.filename ? (
                  <img src={image.path || `/uploads/${image.filename}`} alt={image.name} draggable={false} style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: image.error ? '#ef4444' : 'var(--text-secondary)', fontSize: 11, textAlign: 'center', padding: 8, boxSizing: 'border-box' }}>{image.uploading ? '⏳ 正在上传' : `❌ ${image.error || '上传失败'}`}</div>
                )}
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); removeImage(image.id); }}
                  title="删除图片"
                  style={{ position: 'absolute', top: 4, right: 4, width: 20, height: 20, border: '1px solid rgba(255,255,255,.8)', borderRadius: '50%', background: 'rgba(239,68,68,.96)', color: '#fff', padding: 0, fontSize: 12, lineHeight: '18px', cursor: 'pointer', boxShadow: '0 1px 4px rgba(0,0,0,.28)' }}
                >
                  ×
                </button>
                {!image.uploading && !image.error && (
                  <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '3px 6px', background: 'rgba(15,23,42,.7)', color: '#fff', fontSize: 9, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{image.name}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {data.status === 'error' && data.error && (
          <div style={{ marginTop: 6, color: '#ef4444', fontSize: 10 }}>{data.error}</div>
        )}
      </div>
    </div>
  );
}

export default ImageInputNode;
