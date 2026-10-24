/**
 * 画布 Group 的几何边界工具。
 *
 * Group 的 children 使用相对 parent 的 position。这里仅计算直属 children 的局部包围盒，
 * 并从内向外扩展 Group / 祖先 Group，保证执行后的内容增长也不会溢出虚线框。
 */

type Size = { w: number; h: number };

const FALLBACK_SIZES: Record<string, Size> = {
  textPrompt: { w: 220, h: 130 },
  fileUpload: { w: 220, h: 150 },
  imageInput: { w: 350, h: 300 },
  imageAI: { w: 340, h: 560 },
  llm: { w: 240, h: 220 },
  textTransform: { w: 220, h: 150 },
  condition: { w: 220, h: 150 },
  splitter: { w: 240, h: 220 },
  output: { w: 150, h: 110 },
  timeline: { w: 1100, h: 130 },
  swimlane: { w: 800, h: 320 },
  group: { w: 240, h: 140 },
};

const numeric = (value: unknown): number | undefined => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** 优先读取当前浏览器真实测量尺寸；Group 自身优先使用其持久化 style 尺寸。 */
export function getCanvasNodeSize(node: any): Size {
  const fallback = FALLBACK_SIZES[node?.type] || { w: 200, h: 130 };
  const isGroup = node?.type === 'group';
  const width = isGroup
    ? numeric(node?.style?.width) ?? numeric(node?.width) ?? numeric(node?.measured?.width)
    : numeric(node?.measured?.width) ?? numeric(node?.width) ?? numeric(node?.style?.width);
  const height = isGroup
    ? numeric(node?.style?.height) ?? numeric(node?.height) ?? numeric(node?.measured?.height)
    : numeric(node?.measured?.height) ?? numeric(node?.height) ?? numeric(node?.style?.height);
  return { w: width ?? fallback.w, h: height ?? fallback.h };
}

/**
 * 让指定 Group 及其祖先完整包围直属 children。
 * 默认只增大，避免节点运行后/浏览器测量时抖动；reset=true 用于“收折后再展开”，
 * 此时会按当前 child 范围精确重置宽高（可缩小或扩大）。收折 Group 不参与包围计算。
 */
export function fitExpandedGroupChains(
  nodes: any[],
  seedGroupIds: Iterable<string>,
  options: { reset?: boolean } = {},
): any[] {
  const byId = new Map(nodes.map((node: any) => [node.id, node]));
  const orderedIds: string[] = [];
  const seen = new Set<string>();

  for (const initialId of seedGroupIds) {
    let id: string | undefined = initialId;
    while (id && !seen.has(id)) {
      seen.add(id);
      const group = byId.get(id);
      if (!group || group.type !== 'group') break;
      orderedIds.push(id);
      id = group.parentId;
    }
  }

  if (!orderedIds.length) return nodes;
  let nextNodes = nodes;
  let changed = false;
  const PADDING_RIGHT = 40;
  const PADDING_BOTTOM = 40;
  const MIN_W = 240;
  const MIN_H = 140;

  for (const groupId of orderedIds) {
    const group = nextNodes.find((node: any) => node.id === groupId);
    if (!group || group.type !== 'group' || group.data?.collapsed) continue;
    const children = nextNodes.filter((node: any) => node.parentId === groupId);
    if (!children.length) continue;

    let requiredW = MIN_W;
    let requiredH = MIN_H;
    children.forEach((child: any) => {
      const { w, h } = getCanvasNodeSize(child);
      requiredW = Math.max(requiredW, (Number(child.position?.x) || 0) + w + PADDING_RIGHT);
      requiredH = Math.max(requiredH, (Number(child.position?.y) || 0) + h + PADDING_BOTTOM);
    });

    const current = getCanvasNodeSize(group);
    // 常规 auto-fit 只向外扩，防止执行过程的动态测量导致框来回跳；
    // 收折 → 展开则是用户明确要求的“范围重置”，按最新直属子节点范围精确收紧或扩展。
    const width = options.reset ? Math.ceil(requiredW) : Math.max(current.w, Math.ceil(requiredW));
    const height = options.reset ? Math.ceil(requiredH) : Math.max(current.h, Math.ceil(requiredH));
    if (width === current.w && height === current.h) continue;

    changed = true;
    nextNodes = nextNodes.map((node: any) => node.id === groupId
      ? {
          ...node,
          width,
          height,
          style: { ...(node.style || {}), width, height },
          data: { ...(node.data || {}), expandedSize: { w: width, h: height } },
        }
      : node);
  }

  return changed ? nextNodes : nodes;
}
