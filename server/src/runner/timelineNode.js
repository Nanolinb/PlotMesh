const secKey = (seconds) => String(Math.round(seconds * 100) / 100);

export function formatTimelineTime(seconds, mode = 'seconds', fps = 30) {
  if (mode === 'seconds') return `${seconds.toFixed(2)}s`;
  if (mode === 'frames') return `${Math.round(seconds * fps)}f`;
  const totalFrames = Math.round(seconds * fps);
  const ff = totalFrames % fps;
  const totalSec = Math.floor(totalFrames / fps);
  const ss = totalSec % 60;
  const mm = Math.floor(totalSec / 60) % 60;
  const hh = Math.floor(totalSec / 3600);
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
}

function normalizeDescription(line, matchedText, seconds, mode, fps) {
  const cleaned = line
    .replace(matchedText, ' ')
    .replace(/^\s*(?:镜头|片段|场景|cut|shot)?\s*\d*\s*[:：\-—|]\s*/i, '')
    .replace(/^[\s:：\-—|]+|[\s:：\-—|]+$/g, '')
    .trim();
  return cleaned || `时间点 ${formatTimelineTime(seconds, mode, fps)}`;
}

export function parseTimelinePoints(text, fps = 30, durationSec = 15, mode = 'seconds') {
  if (!String(text || '').trim()) return [];
  const points = new Map();
  const add = (secondsIn, line, matchedText) => {
    const seconds = Math.round(Number(secondsIn) * 100) / 100;
    if (!Number.isFinite(seconds) || seconds < 0 || seconds > durationSec) return;
    const key = secKey(seconds);
    const description = normalizeDescription(line, matchedText, seconds, mode, fps);
    const current = points.get(key);
    if (!current || current.description.startsWith('时间点 ')) points.set(key, { seconds, description });
  };

  for (const rawLine of String(text || '').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const range = line.match(/(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*(?:-|—|~|至|到)\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\b/i);
    if (range) {
      add(range[1], line, range[0]);
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
      for (const match of secMatches) add(match[1], line, match[0]);
      continue;
    }
    const frameMatches = [...line.matchAll(/\b(?:f|frame|帧)\s*(\d+)/gi)];
    for (const match of frameMatches) add(Number(match[1]) / fps, line, match[0]);
  }
  return [...points.values()].sort((left, right) => left.seconds - right.seconds);
}

/**
 * 从上游文本中提取所有时间范围（如 0-10s、3~8秒）的终点，返回最大值。
 * 如果上游没有显式范围，返回 null。
 */
export function minimumPixelsPerSecondForCuts(cuts, textNodeWidth = 200, gap = 16, fallback = 60) {
  const sorted = [...new Set((Array.isArray(cuts) ? cuts : [])
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

export function timelineTrackWidthForCuts(durationSec, pixelsPerSecond, cuts, textNodeWidth = 200, gap = 16) {
  const temporalWidth = Math.max(60, Number(durationSec) * Number(pixelsPerSecond));
  const contentWidth = Math.max(60, (Array.isArray(cuts) ? cuts.length : 0) * (textNodeWidth + gap));
  return Math.ceil(Math.max(temporalWidth, contentWidth));
}

export function extractMaxRangeEnd(text) {
  if (!text || !String(text).trim()) return null;
  let maxEnd = null;
  const rangeRe = /(\d+(?:\.\d+)?)\s*(?:s|秒)?\s*(?:-|—|~|至|到)\s*(\d+(?:\.\d+)?)\s*(?:s|秒)\b/gi;
  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    rangeRe.lastIndex = 0;
    let match;
    while ((match = rangeRe.exec(line)) !== null) {
      const endVal = Number(match[2]);
      if (Number.isFinite(endVal) && endVal > 0) {
        if (maxEnd === null || endVal > maxEnd) maxEnd = endVal;
      }
    }
  }
  return maxEnd;
}

export function runTimeline(node, upstreamList = []) {
  const data = node.data || {};
  const fps = data.fps ?? 30;
  const mode = data.timeMode ?? 'seconds';
  const upstream = upstreamList.filter(Boolean).join('\n\n');
  // 上游有显式时间（范围终点或独立点）→ durationSec 跟随上游最大值
  // ⚠️ 不计入 existingCuts：旧 cuts 在旧 durationSec 下的时间值对新尺度无效
  const maxRangeEnd = extractMaxRangeEnd(upstream);
  const existingCuts = Array.isArray(data.cuts) ? data.cuts : [];
  const probePoints = parseTimelinePoints(upstream, fps, 86400, mode);
  const probeMaxSec = probePoints.length > 0
    ? Math.max(...probePoints.map((p) => p.seconds))
    : 0;
  const upstreamMax = Math.max(maxRangeEnd ?? 0, probeMaxSec);
  let durationSec = data.durationSec ?? 15;
  if (upstreamMax > 0) {
    durationSec = upstreamMax;
  }
  const points = parseTimelinePoints(upstream, fps, durationSec, mode);
  const descriptionsByTime = { ...(data.cutDescriptionsByTime || {}) };
  for (const point of points) descriptionsByTime[secKey(point.seconds)] = point.description;
  const cuts = [...new Set([
    ...(Array.isArray(data.cuts) ? data.cuts : []),
    ...points.map((point) => point.seconds),
  ].map((value) => Math.round(Number(value) * 100) / 100))]
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= durationSec)
    .sort((left, right) => left - right);
  const portOutputs = {};
  const lines = cuts.map((seconds, index) => {
    const description = descriptionsByTime[secKey(seconds)] || `时间点 ${formatTimelineTime(seconds, mode, fps)}`;
    const line = `${formatTimelineTime(seconds, mode, fps)} · ${description}`;
    portOutputs[`cut__${index}`] = line;
    return `镜头切换 ${index + 1}: ${line}`;
  });
  return {
    output: lines.length
      ? lines.join('\n')
      : `时间轴：总长 ${formatTimelineTime(durationSec, mode, fps)}（${fps} fps），尚无切换点`,
    status: 'success',
    portOutputs,
    dataPatch: {
      upstreamText: upstream,
      cuts,
      cutDescriptionsByTime: descriptionsByTime,
      durationSec,
      timelineDerived: { cuts, descriptionsByTime, fps, durationSec, mode },
    },
  };
}
