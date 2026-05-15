import { Handle, Position } from '@xyflow/react';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useNodeStore } from '../../store/nodes';
import type { FileUploadNodeData } from '../../types/nodes';

type Props = {
  id: string;
  data: FileUploadNodeData;
  selected?: boolean;
  [key: string]: any;
};

function FileUploadNode({ id, data, selected }: Props) {
  const [dragOver, setDragOver] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [localTitle, setLocalTitle] = useState(data.label || '文件上传');
  const [localFiles, setLocalFiles] = useState<any[]>(data.files || []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateNodeData = useNodeStore((s) => s.updateNodeData);

  useEffect(() => { setLocalFiles(data.files || []); }, [data.files]);
  useEffect(() => { setLocalTitle(data.label || '文件上传'); }, [data.label]);

  const commitTitle = useCallback(() => {
    setEditingTitle(false);
    const v = localTitle.trim();
    if (v) updateNodeData(id, { label: v } as any);
    else setLocalTitle(data.label || '文件上传');
  }, [id, localTitle, updateNodeData, data.label]);

  // 上传文件到后端，返回后端返回的 file 对象
  const uploadToServer = async (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    const resp = await fetch('/api/upload/file', { method: 'POST', body: fd });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: resp.statusText }));
      throw new Error(err.error || '上传失败');
    }
    const json = await resp.json();
    return json.file as { id: string; originalName: string; filename: string; path: string; size: number; mimetype: string; ext: string };
  };

  // 对支持的文本类文件，读取前 8KB 内容作为文本预览
  const readTextPreview = (file: File) => new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string) || '');
    reader.onerror = () => resolve('');
    reader.readAsText(file.slice(0, 8 * 1024));
  });

  const processNewFiles = async (files: File[]) => {
    if (!files.length) return;
    // 先给一个"正在上传"的占位
    const tempItems = files.map((f) => ({
      id: `file-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      name: f.name,
      size: f.size,
      type: f.type,
      uploading: true,
    }));
    const afterAdd = [...localFiles, ...tempItems];
    setLocalFiles(afterAdd);
    updateNodeData(id, { files: afterAdd, status: 'running' } as any);

    const finalItems: any[] = [];
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      const temp = tempItems[i];
      try {
        const serverFile = await uploadToServer(f);
        // 后端已经把 docx / xlsx / pdf / 文本类 文件解析成纯文本返回到 content 字段
        finalItems.push({
          id: temp.id,
          name: serverFile.originalName,
          size: serverFile.size,
          type: serverFile.mimetype,
          ext: serverFile.ext,
          path: serverFile.path,
          filename: serverFile.filename,
          content: (serverFile as any).content || '',
          contentLength: (serverFile as any).contentLength || 0,
          parsed: (serverFile as any).parsed,
          parseError: (serverFile as any).parseError,
          uploading: false,
        });
      } catch (e: any) {
        finalItems.push({ id: temp.id, name: f.name, size: f.size, type: f.type, uploading: false, error: e.message || '上传失败' });
      }
    }

    const merged = [...localFiles, ...finalItems];
    setLocalFiles(merged);
    const hasError = finalItems.some((x) => x.error);
    updateNodeData(id, { files: merged, status: hasError ? 'error' : 'success', error: hasError ? '部分文件上传失败' : undefined } as any);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    processNewFiles(files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleDeleteFile = useCallback((fileId: string) => {
    const updated = localFiles.filter((f: any) => f.id !== fileId);
    setLocalFiles(updated);
    updateNodeData(id, { files: updated } as any);
  }, [id, localFiles, updateNodeData]);

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    processNewFiles(files);
  };

  return (
    <div
      className={`node-card file-upload-node ${selected ? 'selected' : ''}`}
      data-status={(data as any).status || 'idle'}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ border: dragOver ? '2px dashed #10b981' : '2px solid transparent' }}
    >
      {/*
        说明：文件上传节点是工作流的「源」节点，自身只读取挂载到节点上的文件，
        不消费任何上游输入。为避免用户把提示词错连进来导致"提示词丢失"的歧义，
        这里**不渲染入口端口**（target Handle），从 UI 层面直接禁止入边。
        相关讨论：v1.x prompt 隔离方案。
      */}
      <Handle type="source" position={Position.Right} />

      <div className="node-header" style={{ background: 'linear-gradient(135deg, #3b82f6, #60a5fa)' }}>
        <span className="node-icon">📁</span>
        {editingTitle ? (
          <input
            className="nodrag"
            autoFocus
            value={localTitle}
            onChange={(e) => setLocalTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitTitle();
              if (e.key === 'Escape') { setEditingTitle(false); setLocalTitle(data.label || '文件上传'); }
              e.stopPropagation();
            }}
            onClick={(e) => e.stopPropagation()}
            style={{
              flex: 1,
              background: 'rgba(255,255,255,0.25)',
              border: '1px solid rgba(255,255,255,0.6)',
              borderRadius: '6px',
              color: 'white',
              padding: '2px 6px',
              fontSize: '13px',
              outline: 'none',
            }}
          />
        ) : (
          <span
            className="node-title"
            onDoubleClick={(e) => { e.stopPropagation(); setEditingTitle(true); }}
            title="双击重命名"
            style={{ flex: 1, cursor: 'text' }}
          >
            {data.label || '文件上传'}
          </span>
        )}
        <button
          className="nodrag"
          onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}
          style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.25)', border: 'none', borderRadius: '6px', padding: '2px 8px', cursor: 'pointer', color: 'white', fontSize: '11px' }}
          title="上传文件"
        >
          + 上传
        </button>
      </div>

      <div className="node-body">
        <input
          ref={fileInputRef}
          type="file"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {localFiles.length === 0 ? (
          <div className="file-upload-dropzone" style={{ padding: '10px', textAlign: 'center', fontSize: '11px', borderRadius: '6px' }}>
            拖拽文件到此处或点击"上传"按钮
          </div>
        ) : (
          <div style={{ maxHeight: '150px', overflowY: 'auto' }}>
            {localFiles.map((file: any) => (
              <div
                key={file.id}
                className="file-upload-item"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 7px', borderRadius: '4px', marginBottom: '3px', fontSize: '11px' }}
                title={file.error ? `❌ ${file.error}` : file.path ? `已上传: ${file.path}` : ''}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                  {file.uploading ? '⏳' : file.error ? '❌' : '📄'} {file.name}
                </span>
                <button
                  className="nodrag"
                  onClick={(e) => { e.stopPropagation(); handleDeleteFile(file.id); }}
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: '14px', padding: '0 4px' }}
                  title="删除文件"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default FileUploadNode;
