/**
 * 复合节点（group）相关工具：
 * - 推断对外暴露的端口（哪些子节点的 handle 没被内部边连上）
 * - 折叠态下把"外部边"映射到"内部子节点"以便执行器使用
 */

export interface ExposedPort {
  /** 端口的稳定 id（由 nodeId + handleId/role 拼成），用于 React Flow 的 handleId */
  id: string;
  /** 落到内部哪个子节点 */
  childNodeId: string;
  /** 落到内部该子节点的 handleId（undefined = 默认 handle） */
  childHandleId?: string | null;
  /** 'input' = 子节点缺少入边的 target handle；'output' = 子节点缺少出边的 source handle */
  role: 'input' | 'output';
  /** 默认显示的标签 */
  label: string;
  /** 用户填的描述（hover 提示） */
  description?: string;
  /** 是否对外可见。用户可以在打包弹窗里取消勾选 */
  exposed: boolean;
}

/**
 * 给定一组子节点 + 内部边，推断出复合节点应当对外暴露的端口。
 * 规则：
 *  - 一个子节点的 target handle 上"没有任何内部边连入" → 视为对外 input
 *  - 一个子节点的 source handle 上"没有任何内部边连出" → 视为对外 output
 *  - 条件分支节点（type=condition）天然有 2 个 source handle: 'true' / 'false'，分别处理
 */
export function inferExposedPorts(
  childNodes: any[],
  innerEdges: any[]
): ExposedPort[] {
  const ports: ExposedPort[] = [];
  const innerSourceKeys = new Set<string>();
  const innerTargetKeys = new Set<string>();
  innerEdges.forEach((e) => {
    innerSourceKeys.add(`${e.source}::${e.sourceHandle ?? ''}`);
    innerTargetKeys.add(`${e.target}::${e.targetHandle ?? ''}`);
  });

  childNodes.forEach((n) => {
    if (n.type === 'group') return;
    const labelBase = (n.data as any)?.label || n.id;

    // 输入端（target）
    // 普通节点都是单个默认 input handle
    if (!innerTargetKeys.has(`${n.id}::`)) {
      ports.push({
        id: `in__${n.id}__`,
        childNodeId: n.id,
        childHandleId: null,
        role: 'input',
        label: `↦ ${labelBase}`,
        exposed: true,
      });
    }

    // 输出端（source）
    if (n.type === 'condition') {
      // 条件分支有两个 source handle: true / false
      ['true', 'false'].forEach((h) => {
        if (!innerSourceKeys.has(`${n.id}::${h}`)) {
          ports.push({
            id: `out__${n.id}__${h}`,
            childNodeId: n.id,
            childHandleId: h,
            role: 'output',
            label: `${labelBase} · ${h === 'true' ? '匹配' : '不匹配'} ↦`,
            exposed: true,
          });
        }
      });
    } else {
      if (!innerSourceKeys.has(`${n.id}::`)) {
        ports.push({
          id: `out__${n.id}__`,
          childNodeId: n.id,
          childHandleId: null,
          role: 'output',
          label: `${labelBase} ↦`,
          exposed: true,
        });
      }
    }
  });

  return ports;
}

/** 根据端口数组计算各端口在节点上的 top% 位置（均匀分布） */
export function computePortPositions(ports: ExposedPort[]): Record<string, number> {
  const inputs = ports.filter((p) => p.role === 'input' && p.exposed);
  const outputs = ports.filter((p) => p.role === 'output' && p.exposed);
  const positions: Record<string, number> = {};
  inputs.forEach((p, i) => {
    positions[p.id] = ((i + 1) / (inputs.length + 1)) * 100;
  });
  outputs.forEach((p, i) => {
    positions[p.id] = ((i + 1) / (outputs.length + 1)) * 100;
  });
  return positions;
}
