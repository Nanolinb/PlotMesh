import type { Canvas } from '../types/db';

export function isTemplateCanvas(canvas: Pick<Canvas, 'kind'> | null | undefined): boolean {
  return canvas?.kind === 'template';
}

export interface ClonedCanvasGraph {
  nodes: any[];
  edges: any[];
}

const NODE_RUNTIME_FIELDS = new Set([
  'output',
  'streamOutput',
  'error',
  'pendingEmit',
  'appliedAt',
  'lastDeliveredAt',
  'receivedAt',
  'lastRunAt',
  'lastExportedAt',
  '__commitId',
]);

const FILE_REFERENCE_FIELDS = new Set([
  'file',
  'fileObject',
  'blob',
  'objectUrl',
  'previewUrl',
]);

const CROSS_INPUT_FIELDS = [
  'sourceCanvasId',
  'sourceCanvasName',
  'sourceNodeId',
  'sourceNodeName',
  'sourceNodeLabel',
  'connectionId',
  'referenceId',
];

const CROSS_OUTPUT_FIELDS = [
  'targetCanvasId',
  'targetCanvasName',
  'targetNodeId',
  'targetNodeName',
  'connectionId',
  'referenceId',
];

function cloneJson<T>(value: T): T {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(value);
    } catch {
      // File/Blob or other host objects can fail in older browsers; JSON fallback is enough for persisted data.
    }
  }
  return JSON.parse(JSON.stringify(value)) as T;
}

function uniqueId(prefix: string, index: number): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${Date.now().toString(36)}-${index.toString(36)}-${random}`;
}

function cleanNestedValue(value: any): any {
  if (Array.isArray(value)) return value.map(cleanNestedValue);
  if (!value || typeof value !== 'object') return value;

  const tag = Object.prototype.toString.call(value);
  if (tag === '[object File]' || tag === '[object Blob]') return undefined;

  const next: Record<string, any> = {};
  for (const [key, child] of Object.entries(value)) {
    if (FILE_REFERENCE_FIELDS.has(key)) continue;
    const cleaned = cleanNestedValue(child);
    if (cleaned !== undefined) next[key] = cleaned;
  }
  return next;
}

function resetNodeData(data: any, idMap: Map<string, string>): any {
  const next = cleanNestedValue(cloneJson(data || {})) || {};
  for (const key of NODE_RUNTIME_FIELDS) delete next[key];
  next.status = 'idle';

  const nodeType = next.type;
  if (nodeType === 'crossInput') {
    for (const key of CROSS_INPUT_FIELDS) delete next[key];
    if ('text' in next) next.text = '';
  }
  if (nodeType === 'crossOutput') {
    for (const key of CROSS_OUTPUT_FIELDS) delete next[key];
  }

  if (Array.isArray(next.exposedPorts)) {
    next.exposedPorts = next.exposedPorts.map((port: any) => ({
      ...port,
      childNodeId: idMap.get(port?.childNodeId) || port?.childNodeId,
    }));
  }
  if (Array.isArray(next.derivedOutputIds)) {
    next.derivedOutputIds = next.derivedOutputIds
      .map((id: string) => idMap.get(id))
      .filter(Boolean);
  }
  if (typeof next.__emittedBy === 'string') {
    next.__emittedBy = idMap.get(next.__emittedBy) || undefined;
  }

  return next;
}

/**
 * 为模板或实例生成一份与原画布完全解耦的图。
 * 保留业务配置和内容，但重建所有 ID、清理执行态，并断开跨画布实时引用。
 */
export function cloneCanvasGraph(nodes: any[], edges: any[]): ClonedCanvasGraph {
  const sourceNodes = Array.isArray(nodes) ? nodes : [];
  const sourceEdges = Array.isArray(edges) ? edges : [];
  const idMap = new Map<string, string>();
  sourceNodes.forEach((node, index) => {
    if (node?.id) idMap.set(node.id, uniqueId('node', index));
  });

  const clonedNodes = sourceNodes.map((node, index) => {
    const cloned = cloneJson(node || {});
    const oldId = node?.id;
    const nextId = idMap.get(oldId) || uniqueId('node', index);
    const {
      selected: _selected,
      measured: _measured,
      dragging: _dragging,
      resizing: _resizing,
      ...stable
    } = cloned;
    return {
      ...stable,
      id: nextId,
      ...(stable.parentId ? { parentId: idMap.get(stable.parentId) || stable.parentId } : {}),
      data: resetNodeData(stable.data, idMap),
    };
  });

  const clonedEdges = sourceEdges
    .filter((edge) => edge && idMap.has(edge.source) && idMap.has(edge.target))
    .map((edge, index) => {
      const cloned = cloneJson(edge);
      const {
        selected: _selected,
        ...stable
      } = cloned;
      return {
        ...stable,
        id: uniqueId('edge', index),
        source: idMap.get(edge.source),
        target: idMap.get(edge.target),
      };
    });

  return { nodes: clonedNodes, edges: clonedEdges };
}
