export type WebAnalysisMode = 'full' | 'keyword';

export interface WebContentSelection {
  text: string;
  originalChars: number;
  selectedChars: number;
  truncated: boolean;
  matchedChunks: number;
}

function clampLimit(value: unknown, fallback = 24000): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1000, Math.min(64000, Math.floor(n)));
}

function queryTerms(query: string): string[] {
  return Array.from(new Set(
    String(query || '')
      .split(/[\s,，;；|]+/)
      .map((term) => term.trim().toLowerCase())
      .filter(Boolean)
  ));
}

/**
 * 从已经采集的 Web 快照中选出本次真正发送给 LLM 的内容。
 * Web 节点负责“资料可用边界”，本函数负责“本次分析边界”。
 */
export function selectWebContent(
  content: string,
  options?: { mode?: WebAnalysisMode; query?: string; maxChars?: number }
): WebContentSelection {
  const source = String(content || '');
  const maxChars = clampLimit(options?.maxChars);
  const mode = options?.mode || 'full';

  if (mode !== 'keyword') {
    const text = source.slice(0, maxChars);
    return {
      text,
      originalChars: source.length,
      selectedChars: text.length,
      truncated: source.length > text.length,
      matchedChunks: source ? 1 : 0,
    };
  }

  const terms = queryTerms(options?.query || '');
  if (terms.length === 0 || !source) {
    const text = source.slice(0, maxChars);
    return {
      text,
      originalChars: source.length,
      selectedChars: text.length,
      truncated: source.length > text.length,
      matchedChunks: source ? 1 : 0,
    };
  }

  const lower = source.toLowerCase();
  const radius = Math.max(500, Math.min(2200, Math.floor(maxChars / Math.max(terms.length * 2, 4))));
  const ranges: Array<{ start: number; end: number }> = [];

  for (const term of terms) {
    let from = 0;
    let matches = 0;
    while (matches < 8) {
      const index = lower.indexOf(term, from);
      if (index < 0) break;
      ranges.push({
        start: Math.max(0, index - radius),
        end: Math.min(source.length, index + term.length + radius),
      });
      from = index + Math.max(term.length, 1);
      matches += 1;
    }
  }

  ranges.sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end + 120) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }

  const chunks: string[] = [];
  let used = 0;
  for (const range of merged) {
    if (used >= maxChars) break;
    const prefix = chunks.length ? '\n\n…\n\n' : '';
    const available = maxChars - used - prefix.length;
    if (available <= 0) break;
    const chunk = source.slice(range.start, range.end).trim().slice(0, available);
    if (!chunk) continue;
    chunks.push(prefix + chunk);
    used += prefix.length + chunk.length;
  }

  const fallback = chunks.length === 0;
  const text = fallback ? source.slice(0, maxChars) : chunks.join('');
  return {
    text,
    originalChars: source.length,
    selectedChars: text.length,
    truncated: source.length > text.length,
    matchedChunks: fallback ? 0 : chunks.length,
  };
}
