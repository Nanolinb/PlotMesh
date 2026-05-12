import { useState, useRef, useEffect, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  MarkerType,
  SelectionMode,
  type Connection,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import FileUploadNode from './nodes/FileUploadNode';
import TextPromptNode from './nodes/TextPromptNode';
import LLMNode from './nodes/LLMNode';
import OutputNode from './nodes/OutputNode';
import GroupNode from './nodes/GroupNode';
import ConditionNode from './nodes/ConditionNode';
import TextTransformNode from './nodes/TextTransformNode';
import Sidebar from './Sidebar';
import ApiKeyConfigModal from './ApiKeyConfigModal';
import { useNodeStore } from '../store/nodes';

const nodeTypes = {
  fileUpload: FileUploadNode,
  textPrompt: TextPromptNode,
  llm: LLMNode,
  output: OutputNode,
  group: GroupNode,
  condition: ConditionNode,
  textTransform: TextTransformNode,
};

let idCounter = 0;
function getNewId(type: string) {
  idCounter += 1;
  return `${type}-${Date.now()}-${idCounter}`;
}

function getDefaultData(type: string): any {
  switch (type) {
    case 'fileUpload': return { type: 'fileUpload', label: '文件上传', files: [], status: 'idle' };
    case 'textPrompt': return { type: 'textPrompt', label: '提示词', text: '', promptNumber: 0, status: 'idle' };
    case 'llm': return { type: 'llm', label: '大模型', model: 'deepseek', systemPrompt: '', temperature: 0.7, status: 'idle', output: '', streamOutput: '' };
    case 'output': return { type: 'output', label: '输出', format: 'text', status: 'idle', output: '' };
    case 'condition': return { type: 'condition', label: '条件分支', mode: 'contains', keyword: '', status: 'idle' };
    case 'textTransform': return { type: 'textTransform', label: '文本处理', transform: 'trim', param: '', param2: '', status: 'idle', output: '' };
    default: return { type: 'textPrompt', label: '', text: '', promptNumber: 0, status: 'idle' };
  }
}

export default function Canvas() {
  // ✅ 直接用 Zustand store 作为数据源，不再用 useNodesState 本地缓存
  const nodes = useNodeStore((s) => s.nodes);
  const edges = useNodeStore((s) => s.edges);
  const storePackages = useNodeStore((s) => s.getPackages());
  const storePackageGroups = useNodeStore((s) => s.packageGroups);

  const storeAddNode = useNodeStore((s) => s.addNode);
  const storeOnNodesChange = useNodeStore((s) => s.onNodesChange);
  const storeOnEdgesChange = useNodeStore((s) => s.onEdgesChange);
  const storeAddEdge = useNodeStore((s) => s.addEdge);
  const storeUpdateNodeData = useNodeStore((s) => s.updateNodeData);
  const storeDeleteNodes = useNodeStore((s) => s.deleteNodes);
  const storeSavePackage = useNodeStore((s) => s.savePackage);
  const storeLoadPackage = useNodeStore((s) => s.loadPackage);
  const storeDeletePackage = useNodeStore((s) => s.deletePackage);
  const storeReset = useNodeStore((s) => s.reset);
  const storeUndo = useNodeStore((s) => s.undo);
  const storeRedo = useNodeStore((s) => s.redo);
  const storePushHistory = useNodeStore((s) => s.pushHistory);
  const storeExportWorkflow = useNodeStore((s) => s.exportWorkflow);
  const storeImportWorkflow = useNodeStore((s) => s.importWorkflow);

  const [showSave, setShowSave] = useState(false);
  const [showApiConfig, setShowApiConfig] = useState(false);
  const [pkgName, setPkgName] = useState('');
  const [pkgDesc, setPkgDesc] = useState('');
  const [pkgGroup, setPkgGroup] = useState<string>('');
  const [savedToast, setSavedToast] = useState<string>('');
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const [rfInstance, setRfInstance] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [runLog, setRunLog] = useState<string[]>([]);

  // 主题切换：light / dark，持久化到 localStorage
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('ui-theme');
      return saved === 'dark' ? 'dark' : 'light';
    } catch {
      return 'light';
    }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('ui-theme', theme); } catch {}
  }, [theme]);

  // ✅ 节点变化直接由 store 处理（包括选中状态）
  const handleNodesChange = useCallback((changes: any[]) => {
    storeOnNodesChange(changes);
  }, [storeOnNodesChange]);

  const handleEdgesChange = useCallback((changes: any[]) => {
    storeOnEdgesChange(changes);
  }, [storeOnEdgesChange]);

  const handleConnect = useCallback((connection: Connection) => {
    storePushHistory();
    // 生成唯一 id（加随机串防止同毫秒冲突）
    const uniqueId = `edge-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const newEdge = {
      ...connection,
      id: uniqueId,
      markerEnd: { type: MarkerType.ArrowClosed, color: '#6366f1' },
      style: { stroke: '#6366f1', strokeWidth: 2 },
    };
    // 只用一次 addEdge 避免重复
    storeAddEdge(newEdge as any);
  }, [storeAddEdge, storePushHistory]);

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/reactflow');
    if (!type) return;
    // React Flow v12 的 screenToFlowPosition 直接接收 clientX/clientY，不需要减 bounds
    const position = rfInstance?.screenToFlowPosition
      ? rfInstance.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      : { x: event.clientX, y: event.clientY };
    const newNode: any = {
      id: getNewId(type),
      type,
      position,
      data: getDefaultData(type),
    };
    storePushHistory();
    storeAddNode(newNode);
  };

  // 打包：直接从 store 读取选中节点
  const handleSave = () => {
    const allNodes = useNodeStore.getState().nodes as any[];
    const selectedIds = allNodes.filter((n: any) => n.selected).map((n: any) => n.id);
    if (!selectedIds.length) { alert('请先选择节点（单击选中，Cmd+点击多选，或空白处拖动框选）'); return; }

    const trimmedName = pkgName.trim();
    if (!trimmedName) return;

    const exists = useNodeStore.getState().hasPackageName(trimmedName);
    if (exists) {
      // 弹出冲突处理：覆盖 / 改名 / 取消
      const choice = window.confirm(
        `已有同名常用功能「${trimmedName}」。\n\n点击「确定」覆盖原有，点击「取消」自动追加编号保存为新版本。`
      );
      storePushHistory();
      const result = useNodeStore.getState().savePackage(trimmedName, pkgDesc, selectedIds, {
        group: pkgGroup,
        mode: choice ? 'overwrite' : 'create',
      });
      if (result.ok) {
        if (result.action === 'overwritten') {
          setSavedToast(`✅ 已覆盖更新「${trimmedName}」（已存在的画布实例不会自动更新）`);
        } else if (result.action === 'renamed') {
          setSavedToast(`✅ 已另存为新版本，避免覆盖`);
        }
        setTimeout(() => setSavedToast(''), 3500);
      }
    } else {
      storePushHistory();
      const result = useNodeStore.getState().savePackage(trimmedName, pkgDesc, selectedIds, {
        group: pkgGroup,
        mode: 'create',
      });
      if (result.ok) {
        setSavedToast(`✅ 已保存「${trimmedName}」${pkgGroup ? `到分组「${pkgGroup}」` : ''}`);
        setTimeout(() => setSavedToast(''), 2500);
      }
    }
    setPkgName('');
    setPkgDesc('');
    setPkgGroup('');
    setShowSave(false);
  };

  // 导出工作流：下载为 .json 文件
  const handleExport = () => {
    const json = storeExportWorkflow();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const timestamp = new Date().toISOString().replace(/[:T.]/g, '-').substring(0, 19);
    a.download = `workflow-${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 导入工作流：从 .json 文件读取
  const handleImportClick = () => importInputRef.current?.click();
  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const ok = storeImportWorkflow(text);
      if (ok) alert('✅ 工作流导入成功');
    };
    reader.readAsText(file);
    // 清空 input 以便重复选择同一文件
    e.target.value = '';
  };

  const executeFlow = async () => {
    setIsRunning(true);
    setRunLog([]);
    const log = (msg: string) => setRunLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
    try {
      const allNodesRaw = useNodeStore.getState().nodes as any[];
      const allEdgesRaw = useNodeStore.getState().edges as any[];
      log(`开始执行，共 ${allNodesRaw.length} 个节点`);

      /**
       * 折叠的 group 节点本身不参与执行，但外界连到它的边需要重定向到内部子节点。
       * 端口 id 约定（见 utils/composite.ts）：
       *   in__<childId>__              → target=childId, targetHandle=null
       *   out__<childId>__             → source=childId, sourceHandle=null
       *   out__<childId>__<handleId>   → source=childId, sourceHandle=<handleId>
       */
      const collapsedGroups = new Set(allNodesRaw.filter((n: any) => n.type === 'group' && n.data?.collapsed).map((n: any) => n.id));
      const parsePort = (id: string | null | undefined) => {
        if (!id || typeof id !== 'string') return null;
        const parts = id.split('__');
        if (parts.length < 3) return null;
        const role = parts[0] === 'in' ? 'in' : parts[0] === 'out' ? 'out' : null;
        if (!role) return null;
        // childId 在中间所有段，handle 在最末段
        const handle = parts[parts.length - 1];
        const childId = parts.slice(1, -1).join('__');
        return { role: role as 'in' | 'out', childId, handle: handle || null };
      };
      // 重定向边
      const allEdges = allEdgesRaw.map((e: any) => {
        let next = { ...e };
        if (collapsedGroups.has(e.target)) {
          const p = parsePort(e.targetHandle);
          if (p && p.role === 'in') {
            next.target = p.childId;
            next.targetHandle = p.handle;
          }
        }
        if (collapsedGroups.has(e.source)) {
          const p = parsePort(e.sourceHandle);
          if (p && p.role === 'out') {
            next.source = p.childId;
            next.sourceHandle = p.handle;
          }
        }
        return next;
      });
      // 节点列表里去除"折叠 group"自身（执行不需要它）
      const allNodes = allNodesRaw.filter((n: any) => !(n.type === 'group' && n.data?.collapsed));

      const adj = new Map<string, string[]>();
      const inDegree = new Map<string, number>();
      allNodes.forEach((n: any) => { adj.set(n.id, []); inDegree.set(n.id, 0); });
      allEdges.forEach((e: any) => {
        if (adj.has(e.source)) (adj.get(e.source)!).push(e.target);
        inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
      });

      const queue: string[] = [];
      allNodes.forEach((n: any) => {
        if ((inDegree.get(n.id) || 0) === 0) queue.push(n.id);
      });

      const results = new Map<string, string>();
      let head = 0;
      while (head < queue.length) {
        const nodeId = queue[head];
        head++;
        const node: any = allNodes.find((n: any) => n.id === nodeId);
        if (!node) continue;
        const data = node.data;
        log(`处理：${data.label || node.type}`);

        if (data.type === 'fileUpload') {
          // 汇总所有文件的文本内容作为下游输入
          const files = ((data as any).files || []).filter((f: any) => !f.error && !f.uploading);
          if (!files.length) {
            results.set(nodeId, '');
            storeUpdateNodeData(nodeId, { status: 'idle' });
          } else {
            const parts = files.map((f: any) => {
              const header = `【文件】${f.name}${f.path ? ` (${f.path})` : ''}`;
              const body = f.content ? `\n${f.content}` : '\n(二进制文件，未提取文本内容)';
              return `${header}${body}`;
            });
            results.set(nodeId, parts.join('\n\n'));
            storeUpdateNodeData(nodeId, { status: 'success' });
            log(`  📁 ${files.length} 个文件已加载`);
          }
        }
        if (data.type === 'textPrompt') {
          results.set(nodeId, (data as any).text || '');
          storeUpdateNodeData(nodeId, { status: 'success' });
        }
        if (data.type === 'llm') {
          const inputs: string[] = [];
          allEdges.forEach((e: any) => {
            if (e.target === nodeId) { const v = results.get(e.source); if (v) inputs.push(v); }
          });
          const prompt = inputs.join('\n\n');
          if (!prompt.trim()) {
            results.set(nodeId, '');
            storeUpdateNodeData(nodeId, { status: 'idle' });
          } else {
            const model = (data as any).model || 'deepseek';
            const systemPrompt = (data as any).systemPrompt || '';
            const temperature = (data as any).temperature ?? 0.7;
            log(`  调用 ${model}（温度 ${temperature}）`);
            storeUpdateNodeData(nodeId, { status: 'running' });
            try {
              const messages = [
                ...(systemPrompt.trim() ? [{ role: 'system', content: systemPrompt }] : []),
                { role: 'user', content: prompt },
              ];
              const resp = await fetch('/api/llm/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ model, messages, temperature, stream: false }),
              });
              if (!resp.ok) {
                const err = await resp.json().catch(() => ({ error: resp.statusText }));
                throw new Error(err.error || `HTTP ${resp.status}`);
              }
              const json = await resp.json();
              // 兼容 OpenAI 风格 / Claude 风格响应
              const content = json?.choices?.[0]?.message?.content
                || json?.content?.[0]?.text
                || json?.output
                || '';
              if (!content) throw new Error('模型返回空内容');
              results.set(nodeId, content);
              storeUpdateNodeData(nodeId, { status: 'success', output: content });
              log(`  ✅ 返回 ${content.length} 字符`);
            } catch (e: any) {
              const errMsg = e.message || '调用失败';
              log(`  ❌ ${errMsg}`);
              storeUpdateNodeData(nodeId, { status: 'error', error: errMsg });
              // 失败时给下游一个空字符串避免级联报错
              results.set(nodeId, '');
            }
          }
        }
        if (data.type === 'output') {
          let upstream = '';
          allEdges.forEach((e: any) => { if (e.target === nodeId) upstream = results.get(e.source) || upstream; });
          results.set(nodeId, upstream);
          storeUpdateNodeData(nodeId, { status: 'success', output: upstream });
        }

        // 条件分支：根据 mode 和 keyword 判定 true/false 分支
        if (data.type === 'condition') {
          let upstream = '';
          allEdges.forEach((e: any) => { if (e.target === nodeId) upstream = results.get(e.source) || upstream; });
          const d = data as any;
          const kw = String(d.keyword || '');
          let matched = false;
          try {
            if (d.mode === 'equals') matched = upstream === kw;
            else if (d.mode === 'startsWith') matched = upstream.startsWith(kw);
            else if (d.mode === 'regex') matched = kw ? new RegExp(kw).test(upstream) : false;
            else matched = kw ? upstream.includes(kw) : !!upstream;
          } catch {
            matched = false;
          }
          // 把"上游内容"写进 results（不论 true/false 都把原文传下去，让下游自己决定）
          results.set(nodeId, upstream);
          // 传给下游 matched 标记以做分流
          (data as any).__matched = matched;
          storeUpdateNodeData(nodeId, { status: 'success' });
          log(`  🔀 ${matched ? '匹配' : '未匹配'}（${d.mode}: "${kw}"）`);
        }

        // 文本处理：各种字符串变换
        if (data.type === 'textTransform') {
          let upstream = '';
          allEdges.forEach((e: any) => { if (e.target === nodeId) upstream = results.get(e.source) || upstream; });
          const d = data as any;
          const tf = d.transform || 'trim';
          const p = d.param || '';
          const p2 = d.param2 || '';
          let output = upstream;
          try {
            if (tf === 'uppercase') output = upstream.toUpperCase();
            else if (tf === 'lowercase') output = upstream.toLowerCase();
            else if (tf === 'trim') output = upstream.trim();
            else if (tf === 'reverse') output = upstream.split('').reverse().join('');
            else if (tf === 'prepend') output = `${p}${upstream}`;
            else if (tf === 'append') output = `${upstream}${p}`;
            else if (tf === 'replace') output = p ? upstream.split(p).join(p2) : upstream;
            else if (tf === 'extract-json') {
              const m = upstream.match(/```json\s*([\s\S]*?)```/i) || upstream.match(/\{[\s\S]*\}/);
              output = m ? (m[1] || m[0]).trim() : upstream;
            } else if (tf === 'count') {
              const lines = upstream.split('\n').length;
              output = `长度: ${upstream.length} 字符\n行数: ${lines}`;
            }
            results.set(nodeId, output);
            storeUpdateNodeData(nodeId, { status: 'success', output });
            log(`  🔤 ${tf} → ${output.length} 字符`);
          } catch (e: any) {
            log(`  ❌ 文本处理失败：${e.message}`);
            storeUpdateNodeData(nodeId, { status: 'error', error: e.message });
            results.set(nodeId, '');
          }
        }

        // 分发到下游时，条件分支节点要按 sourceHandle 过滤
        (adj.get(nodeId) || []).forEach(tid => {
          // 如果当前是 condition 节点，且这条边的 sourceHandle 和匹配结果不符，跳过
          if (data.type === 'condition') {
            const matched = (data as any).__matched;
            const outEdge = allEdges.find((e: any) => e.source === nodeId && e.target === tid);
            const handleId = outEdge?.sourceHandle;
            if (handleId === 'true' && !matched) {
              // 在 inDegree 里降到 0 后也不推进
              inDegree.set(tid, (inDegree.get(tid) || 0) - 1);
              return;
            }
            if (handleId === 'false' && matched) {
              inDegree.set(tid, (inDegree.get(tid) || 0) - 1);
              return;
            }
          }
          inDegree.set(tid, (inDegree.get(tid) || 0) - 1);
          if (inDegree.get(tid) === 0) queue.push(tid);
        });
      }
      log('✅ 全部执行完成！');
    } catch (err: any) {
      log(`❌ 出错：${err.message}`);
    } finally {
      setIsRunning(false);
      setShowLog(true);
    }
  };

  // 键盘快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 如果在输入框里，跳过
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

      // Delete / Backspace = 删除选中节点和选中的连线
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const allNodes = useNodeStore.getState().nodes as any[];
        const allEdges = useNodeStore.getState().edges as any[];
        const nodeIds = allNodes.filter((n: any) => n.selected).map((n: any) => n.id);
        const edgeIds = allEdges.filter((ed: any) => ed.selected).map((ed: any) => ed.id);
        if (nodeIds.length || edgeIds.length) {
          e.preventDefault();
          storePushHistory();
          if (nodeIds.length) storeDeleteNodes(nodeIds);
          if (edgeIds.length) {
            // 删除选中的连线（storeDeleteNodes 已经会清掉与被删节点相关的连线）
            useNodeStore.getState().deleteEdges(edgeIds);
          }
        }
      }

      // Cmd+Z / Ctrl+Z = 撤销
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        storeUndo();
      }

      // Cmd+Shift+Z / Ctrl+Shift+Z = 重做
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        storeRedo();
      }

      // Cmd+S / Ctrl+S = 打开保存对话框
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const allNodes = useNodeStore.getState().nodes as any[];
        const ids = allNodes.filter((n: any) => n.selected).map((n: any) => n.id);
        if (ids.length > 0) setShowSave(true);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [storeDeleteNodes, storeUndo, storeRedo, storePushHistory]);

  return (
    <div style={{ display: 'flex', height: '100vh', width: '100vw' }}>
      <Sidebar
        packages={storePackages}
        packageGroups={storePackageGroups}
        onLoadPackage={storeLoadPackage}
        onDeletePackage={storeDeletePackage}
        onSavePackage={() => setShowSave(true)}
      />

      <div className="canvas-container" ref={reactFlowWrapper} style={{ flex: 1, position: 'relative' }}>
        <ReactFlow
          nodes={nodes as any[]}
          edges={edges as any[]}
          onNodesChange={handleNodesChange}
          onEdgesChange={handleEdgesChange}
          onConnect={handleConnect}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onInit={setRfInstance}
          nodeTypes={nodeTypes}
          fitView
          deleteKeyCode={null}  /* 我们自己处理 Delete 键 */
          selectionOnDrag={true}
          panOnDrag={[2]}  /* 只有鼠标右键（button 2）才平移 */
          selectionMode={SelectionMode.Partial}
          multiSelectionKeyCode={['Meta', 'Control', 'Shift']}
          selectNodesOnDrag={false}
          elementsSelectable={true}
          className="canvas-flow"
        >
          <Background variant="dots" gap={20} size={1} color="#e2e8f0" />
          <Controls />
          <MiniMap nodeColor={() => '#6366f1'} style={{ background: '#f8fafc' }} />
        </ReactFlow>

        {/* 工具栏 */}
        <div className="canvas-toolbar">
          <button className="toolbar-btn primary" onClick={executeFlow} disabled={isRunning}>
            {isRunning ? '⏳ 运行中...' : '▶️ 运行'}
          </button>
          <button className="toolbar-btn" onClick={() => setShowLog(!showLog)}>
            📋 日志{runLog.length ? ` (${runLog.length})` : ''}
          </button>
          <button className="toolbar-btn" onClick={() => storeUndo()} title="撤销 (Cmd+Z)">↶ 撤销</button>
          <button className="toolbar-btn" onClick={() => storeRedo()} title="重做 (Cmd+Shift+Z)">↷ 重做</button>
          <button className="toolbar-btn" onClick={() => setShowApiConfig(true)} title="配置大模型 API Key">🔑 API 配置</button>
          <button className="toolbar-btn" onClick={() => setShowSave(true)}>📦 打包</button>
          <button className="toolbar-btn" onClick={handleExport} title="导出当前工作流为 JSON 文件">⬇️ 导出</button>
          <button className="toolbar-btn" onClick={handleImportClick} title="从 JSON 文件导入工作流">⬆️ 导入</button>
          <input
            ref={importInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: 'none' }}
            onChange={handleImportFile}
          />
          <button
            className="toolbar-btn"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            title={theme === 'light' ? '切换到夜间模式' : '切换到白天模式'}
          >
            {theme === 'light' ? '🌙 夜晚' : '☀️ 白天'}
          </button>
          <button className="toolbar-btn danger" onClick={() => { if (confirm('确定清空？')) { storePushHistory(); storeReset(); } }}>
            🗑️ 清空
          </button>
        </div>

        {/* 提示 */}
        <div style={{
          position: 'absolute',
          bottom: '10px',
          left: '50%',
          transform: 'translateX(-50%)',
          background: 'var(--bg-tip)',
          color: 'var(--bg-tip-text)',
          padding: '6px 14px',
          borderRadius: '20px',
          fontSize: '12px',
          pointerEvents: 'none',
          zIndex: 10,
        }}>
          💡 左键点击=单选 | Cmd+点击=多选 | 空白处拖动=框选 | 右键拖动=平移 | Cmd+Z=撤销
        </div>

        {/* 日志面板 */}
        {showLog && runLog.length > 0 && (
          <div className="log-panel">
            <div className="log-header"><span>执行日志</span><button onClick={() => setShowLog(false)}>✕</button></div>
            <div className="log-content">{runLog.map((l, i) => <div key={i} className="log-line">{l}</div>)}</div>
          </div>
        )}
      </div>

      {/* API Key 配置对话框 */}
      <ApiKeyConfigModal open={showApiConfig} onClose={() => setShowApiConfig(false)} />

      {/* 保存对话框 */}
      {showSave && (
        <div className="modal-overlay" onClick={() => setShowSave(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <h3>保存为常用功能</h3>
            <div className="form-group">
              <label>名称</label>
              <input autoFocus value={pkgName} onChange={e => setPkgName(e.target.value)} placeholder="输入名称..." />
            </div>
            <div className="form-group">
              <label>描述（可选）</label>
              <textarea value={pkgDesc} onChange={e => setPkgDesc(e.target.value)} placeholder="输入描述..." rows={3} />
            </div>
            <div className="form-group">
              <label>分组（可选）</label>
              <div style={{ display: 'flex', gap: 6 }}>
                <select
                  value={pkgGroup}
                  onChange={(e) => {
                    if (e.target.value === '__new__') {
                      const name = prompt('请输入新分组名称：');
                      if (name && name.trim()) {
                        const ok = useNodeStore.getState().createPackageGroup(name);
                        setPkgGroup(ok ? name.trim() : '');
                      }
                    } else {
                      setPkgGroup(e.target.value);
                    }
                  }}
                  style={{ flex: 1 }}
                >
                  <option value="">无分组（默认）</option>
                  {useNodeStore.getState().packageGroups.map((g) => (
                    <option key={g.id} value={g.name}>📁 {g.name}</option>
                  ))}
                  <option value="__new__">+ 新建分组...</option>
                </select>
              </div>
            </div>
            <div className="modal-actions">
              <button onClick={() => { setShowSave(false); setPkgName(''); setPkgDesc(''); setPkgGroup(''); }}>取消</button>
              <button className="primary" onClick={handleSave} disabled={!pkgName.trim()}>保存</button>
            </div>
          </div>
        </div>
      )}

      {/* 保存成功提示 toast */}
      {savedToast && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'var(--bg-tip)',
            color: 'var(--bg-tip-text)',
            padding: '10px 18px',
            borderRadius: 8,
            fontSize: 13,
            zIndex: 2000,
            boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
          }}
        >
          {savedToast}
        </div>
      )}
    </div>
  );
}
