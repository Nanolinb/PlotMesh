export type TimelinePoint = {
  seconds: number;
  description: string;
};

const secKey = (seconds: number) => String(Math.round(seconds * 100) / 100);

/** 时间轴自动派生的文本节点默认放在时间轴上方，底边与时间轴保留约 30px 空隙。 */
export const TIMELINE_DERIVED_TEXT_OFFSET_Y = -170;

export function formatTimelineTime(
  seconds: number,
  mode: 'frames' | 'seconds' | 'tc' = 'seconds',
  fps = 30,
): string {
  if (mode === 'seconds') return `${seconds.toFixed(2)}s`;
  if (mode === 'frames') return `${Math.round(seconds * fps)}f`;
  const totalFrames = Math.round(seconds * fps);
  const ff = totalFrames % fps;
  const totalSec = Math.floor(totalFrames / fps);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

function normalizeDescription(line: string, matchedText: string, seconds: number, mode: 'frames' | 'seconds' | 'tc', fps: number) {
  const cleaned = line
    .replace(matchedText, ' ')
    .replace(/^\s*(?:镜头|片段|场景|cut|shot)?\s*\d*\s*[:：\-—|]\s*/i, '')
    .replace(/^[\s:：\-—|]+|[\s:：\-—|]+$/g, '')
    .trim();
  return cleaned || `时间点 ${formatTimelineTime(seconds, mode, fps)}`;
}

/**
 * 从逐行镜头描述中抽取“时间 + 描述”。支持秒、帧、mm:ss / hh:mm:ss 以及 0-3s 范围。
 * 范围取起点作为输出点，描述保留整行除时间标记外的文本。
 */
export function parseTimelinePoints(
  text: string,
  fps = 30,
  durationSec = 15,
  mode: 'frames' | 'seconds' | 'tc' = 'seconds',
): TimelinePoint[] {
  if (!text.trim()) return [];
  const points = new Map<string, TimelinePoint>();
  const add = (secondsIn: number, line: string, matchedText: string) => {
    const seconds = Math.round(secondsIn * 100) / 100;
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > durationSec) return;
    const key = secKey(seconds);
    const description = normalizeDescription(line, matchedText, seconds, mode, fps);
    const current = points.get(key);
    if (!current || current.description.startsWith('时间点 ')) points.set(key, { seconds, description });
  };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    // 0-3s / 0 至 3 秒：输出点使用区间起点。
    const range = line.match(/(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*(?:-|—|~|至|到)\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\b/i);
    if (range) {
      add(Number(range[1]), line, range[0]);
      continue;
    }

    const tcMatches = [...line.matchAll(/\b(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?\b/g)];
    if (tcMatches.length) {
      for (const match of tcMatches) {
        const seconds = match[3] !== undefined
          ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])
          : Number(match[1]) * 60 + Number(match[2]);
        add(seconds, line, match[0]);
      }
      continue;
    }

    const secMatches = [...line.matchAll(/(\d+(?:\.\d+)?)\s*(?:s\b|秒)/gi)];
    if (secMatches.length) {
      for (const match of secMatches) add(Number(match[1]), line, match[0]);
      continue;
    }

    const frameMatches = [...line.matchAll(/\b(?:f|frame|帧)\s*(\d+)/gi)];
    for (const match of frameMatches) add(Number(match[1]) / fps, line, match[0]);
  }

  return [...points.values()].sort((left, right) => left.seconds - right.seconds);
}

export function mergeTimelineCuts(
  existingCuts: number[],
  points: TimelinePoint[],
): { cuts: number[]; descriptionsByTime: Record<string, string> } {
  const cuts = [...new Set([
    ...existingCuts.map((value) => Math.round(value * 100) / 100),
    ...points.map((point) => point.seconds),
  ])].sort((left, right) => left - right);
  const descriptionsByTime: Record<string, string> = {};
  for (const point of points) descriptionsByTime[secKey(point.seconds)] = point.description;
  return { cuts, descriptionsByTime };
}

export function timelineSecondsKey(seconds: number) {
  return secKey(seconds);
}

/**
 * 计算为了让时间轴派生文本节点横向不重叠所需的最小 px/s。
 * 文本节点默认约 200px 宽；相邻时间点越近，时间轴需要越高的像素密度。
 */
export function minimumPixelsPerSecondForCuts(
  cuts: number[],
  textNodeWidth = 200,
  gap = 16,
  fallback = 60,
): number {
  const sorted = [...new Set(cuts
    .map((value) => Math.round(Number(value) * 100) / 100)
    .filter((value) => Number.isFinite(value) && value >= 0))]
    .sort((a, b) => a - b);
  if (sorted.length < 2) return fallback;
  let required = fallback;
  for (let index = 1; index < sorted.length; index++) {
    const delta = sorted[index] - sorted[index - 1];
    if (delta <= 0) continue;
    required = Math.max(required, (textNodeWidth + gap) / delta);
  }
  return Math.ceil(required);
}

/** 时间轴显示宽度：至少容纳所有 200px 派生文本节点，但不因短时间差把整轴无限放大。 */
export function timelineTrackWidthForCuts(
  durationSec: number,
  pixelsPerSecond: number,
  cuts: number[],
  textNodeWidth = 200,
  gap = 16,
): number {
  const temporalWidth = Math.max(60, durationSec * pixelsPerSecond);
  const contentWidth = Math.max(60, cuts.length * (textNodeWidth + gap));
  return Math.ceil(Math.max(temporalWidth, contentWidth));
}

/**
 * 从上游文本中提取所有时间范围（如 0-10s、3~8秒）的终点，返回最大值。
 * 如果上游没有显式范围，返回 null。
 * 用于：时间轴自动跟随上游时间范围延长 durationSec。
 */
export function extractMaxRangeEnd(text: string): number | null {
  if (!text || !text.trim()) return null;
  let maxEnd: number | null = null;
  const rangeRe = /(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*(?:-|—|~|至|到)\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\b/gi;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    // reset lastIndex for the global regex across lines
    rangeRe.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rangeRe.exec(line)) !== null) {
      const endVal = Number(match[2]);
      if (Number.isFinite(endVal) && endVal > 0) {
        if (maxEnd === null || endVal > maxEnd) maxEnd = endVal;
      }
    }
  }
  return maxEnd;
}
