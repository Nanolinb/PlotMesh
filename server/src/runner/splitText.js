/**
 * server/src/runner/splitText.js · v1.7 P1
 * ----------------------------------------------------------------
 * 把 client/src/components/nodes/SplitterNode.tsx 的 splitText 函数
 * 镜像到 server 端。逻辑必须 1:1 对齐前端，否则双引擎跑出不一样的结果。
 *
 * ⚠️ 重要：以后改这个函数时，client 那边也要同步改。
 */

/**
 * @param {string} text
 * @param {'auto'|'json-array'|'numbered'|'list'|'delimiter'|'regex'} mode
 * @param {string} delimiter
 * @param {string} regex
 * @returns {string[]}
 */
export function splitText(text, mode, delimiter, regex) {
  const t = (text || '').trim();
  if (!t) return [];

  if (mode === 'auto') {
    let inner = t;
    const fence = inner.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/);
    if (fence) inner = fence[1].trim();

    try {
      const data = JSON.parse(inner);
      if (Array.isArray(data) && data.length > 0) {
        return data.map((x) =>
          typeof x === 'string' ? x : JSON.stringify(x, null, 2)
        );
      }
    } catch {
      /* not json */
    }
    const numbered = inner.match(/(?:^|\n)\s*\d+[.、)]\s+[\s\S]*?(?=\n\s*\d+[.、)]\s+|$)/g);
    if (numbered && numbered.length >= 2) {
      return numbered.map((s) => s.replace(/^\s*\d+[.、)]\s+/, '').trim());
    }
    const bullets = inner.match(/(?:^|\n)\s*[-*]\s+[\s\S]*?(?=\n\s*[-*]\s+|$)/g);
    if (bullets && bullets.length >= 2) {
      return bullets.map((s) => s.replace(/^\s*[-*]\s+/, '').trim());
    }
    const paras = inner.split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);
    if (paras.length >= 2) return paras;
    return [inner];
  }

  if (mode === 'json-array') {
    let inner = t;
    const fence = inner.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```\s*$/);
    if (fence) inner = fence[1].trim();
    try {
      const data = JSON.parse(inner);
      if (Array.isArray(data)) {
        return data.map((x) => (typeof x === 'string' ? x : JSON.stringify(x, null, 2)));
      }
      return [];
    } catch {
      return [];
    }
  }

  if (mode === 'numbered') {
    const m = t.match(/(?:^|\n)\s*\d+[.、)]\s+[\s\S]*?(?=\n\s*\d+[.、)]\s+|$)/g);
    if (!m) return [t];
    return m.map((s) => s.replace(/^\s*\d+[.、)]\s+/, '').trim());
  }

  if (mode === 'list') {
    const m = t.match(/(?:^|\n)\s*[-*]\s+[\s\S]*?(?=\n\s*[-*]\s+|$)/g);
    if (!m) return [t];
    return m.map((s) => s.replace(/^\s*[-*]\s+/, '').trim());
  }

  if (mode === 'delimiter') {
    const sep = delimiter || '---';
    return t.split(sep).map((s) => s.trim()).filter(Boolean);
  }

  if (mode === 'regex') {
    try {
      const re = new RegExp(regex || '\\n\\n');
      return t.split(re).map((s) => s.trim()).filter(Boolean);
    } catch {
      return [t];
    }
  }

  return [t];
}
