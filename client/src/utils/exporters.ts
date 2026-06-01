/**
 * 真实格式导出工具：DOCX / XLSX / PDF / 图片
 * 把上游字符串内容转成对应的二进制文件并触发下载
 */
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from 'docx';
import * as XLSX from 'xlsx';
import jsPDF from 'jspdf';

type BaseOpts = { filename: string };

/** 把 Blob 作为下载触发 */
function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** 按 Markdown 风格把纯文本切成 docx 段落
 *  额外支持中文常见的"标题：v1、v2、v3"——会渲染成 H3 标题 + 每个值一行项目符号
 */
function textToDocxParagraphs(text: string): Paragraph[] {
  const lines = text.split(/\r?\n/);
  const paragraphs: Paragraph[] = [];
  const colonRe = /^([^:：]+)[:：]\s*(.+)$/;
  const itemSepRe = /[、，,；;｜|\t]+/;
  for (const line of lines) {
    if (line.startsWith('# ')) {
      paragraphs.push(new Paragraph({ text: line.slice(2), heading: HeadingLevel.HEADING_1 }));
    } else if (line.startsWith('## ')) {
      paragraphs.push(new Paragraph({ text: line.slice(3), heading: HeadingLevel.HEADING_2 }));
    } else if (line.startsWith('### ')) {
      paragraphs.push(new Paragraph({ text: line.slice(4), heading: HeadingLevel.HEADING_3 }));
    } else if (line.trim() === '') {
      paragraphs.push(new Paragraph({ text: '' }));
    } else if (colonRe.test(line) && itemSepRe.test(line)) {
      // 中文分类：把 "标题：v1、v2、v3" 拆成 H3 + 子项
      const m = line.match(colonRe)!;
      const title = m[1].trim();
      const items = m[2].split(itemSepRe).map((s) => s.trim()).filter(Boolean);
      if (items.length >= 2 && title.length <= 16) {
        paragraphs.push(new Paragraph({ text: title, heading: HeadingLevel.HEADING_3 }));
        for (const it of items) {
          paragraphs.push(new Paragraph({ text: `• ${it}` }));
        }
        continue;
      }
      paragraphs.push(new Paragraph({ children: [new TextRun(line)] }));
    } else {
      paragraphs.push(new Paragraph({ children: [new TextRun(line)] }));
    }
  }
  return paragraphs;
}

/** 导出 DOCX（真正的 Word 文档） */
export async function exportAsDocx(text: string, { filename }: BaseOpts): Promise<void> {
  const doc = new Document({
    sections: [{ properties: {}, children: textToDocxParagraphs(text) }],
  });
  const blob = await Packer.toBlob(doc);
  triggerDownload(blob, filename);
}

/** 把字符串解析成"二维数组"以便写入 xlsx。
 *  支持（按优先级）：JSON 对象数组、JSON 二维数组、Markdown 表格、CSV/TSV、
 *  以及中文常见的"标题：值1、值2、值3" 行式分类（支持全/半角冒号、顿号、逗号、分号、空格）。
 *  最后兜底每行一个单元格。
 */
function parseToTable(text: string): string[][] {
  let trimmed = text.trim();
  if (!trimmed) return [['']];

  // 0) 剥 markdown 代码块包装：```json ... ``` 或 ``` ... ```
  const fenceMatch = trimmed.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n```$/);
  if (fenceMatch) trimmed = fenceMatch[1].trim();

  // 1) JSON 对象数组 [{a:1, b:2}, ...] → 表头 + 行
  try {
    const data = JSON.parse(trimmed);
    if (Array.isArray(data) && data.length && typeof data[0] === 'object' && data[0] !== null) {
      const keys = Array.from(new Set(data.flatMap((r: any) => Object.keys(r))));
      const rows = data.map((r: any) => keys.map((k) => (r[k] ?? '')));
      return [keys, ...rows.map((row) => row.map((v: any) => String(v)))];
    }
    // 2) JSON 二维数组 [[..],[..]]
    if (Array.isArray(data) && Array.isArray(data[0])) {
      return data.map((row: any[]) => row.map((v) => String(v)));
    }
    // 3) JSON 单层对象 {key: [v1, v2, ...]} → 每行一组（关键字 + 值列表）
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      const rows: string[][] = [];
      for (const k of Object.keys(data)) {
        const v = (data as any)[k];
        if (Array.isArray(v)) {
          rows.push([k, ...v.map((x) => String(x))]);
        } else if (v && typeof v === 'object') {
          rows.push([k, JSON.stringify(v)]);
        } else {
          rows.push([k, String(v)]);
        }
      }
      if (rows.length) return rows;
    }
  } catch {
    /* not json */
  }

  const lines = trimmed.split(/\r?\n/).filter((l) => l.length > 0);

  // 4) Markdown 表格（| col1 | col2 |）
  if (lines[0]?.trim().startsWith('|') && lines[1]?.trim().match(/^\|\s*:?-+:?\s*\|/)) {
    const rows = lines
      .filter((_l, i) => i !== 1) // 跳过对齐行
      .map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    return rows;
  }

  // 5) CSV / TSV（逗号、分号、tab 列数一致时认为是表格）
  const seps = [',', '\t', ';'];
  for (const sep of seps) {
    const rows = lines.map((l) => l.split(sep).map((c) => c.trim()));
    if (rows.length > 1 && rows.every((r) => r.length === rows[0].length) && rows[0].length > 1) {
      return rows;
    }
  }

  // 6) 中文"分类 + 多值"格式：每一行形如 "标题：v1、v2、v3"
  //    冒号支持半角/全角；分隔符支持 顿号、半/全角逗号、分号、中竖线、tab
  //    如果至少 2 行命中这个模式，就认为是这种结构
  {
    const colonRe = /[:：]\s*/;
    const itemSepRe = /[、，,；;｜|\t]+/;
    const matches: string[][] = [];
    for (const line of lines) {
      const m = line.split(colonRe);
      if (m.length >= 2) {
        const title = m[0].trim();
        const rest = m.slice(1).join('：').trim();
        const items = rest.split(itemSepRe).map((s) => s.trim()).filter(Boolean);
        if (title && items.length >= 1) {
          matches.push([title, ...items]);
        }
      }
    }
    if (matches.length >= 2) {
      return matches;
    }
  }

  // 7) 兜底：每行一个单元格
  return lines.map((l) => [l]);
}

/** 导出 XLSX（真正的 Excel 文件） */
export function exportAsXlsx(text: string, { filename }: BaseOpts): void {
  const rows = parseToTable(text);
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  const arr = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  triggerDownload(blob, filename);
}

/** 导出 PDF（真正的 PDF 文件） */
export function exportAsPdf(text: string, { filename }: BaseOpts): void {
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  // jsPDF 自带字体不支持中文；需要嵌入中文字体。此处退而求其次：
  // 把中文字符转写到 UTF-8 字节流后以 Courier 渲染。这里先用自带字体显示英文，
  // 中文能显示但可能缺字形——作为基础版本，未来可加载 NotoSansSC 字体改善。
  doc.setFont('helvetica');
  doc.setFontSize(11);
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;
  const usableW = pageWidth - margin * 2;
  const lineHeight = 16;
  let y = margin;

  // 把长段落按宽度切行
  const lines = doc.splitTextToSize(text, usableW);
  for (const line of lines) {
    if (y + lineHeight > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(line, margin, y);
    y += lineHeight;
  }
  doc.save(filename);
}

/** 从 URL / base64 下载图片。如果 output 包含图片 URL，就下载它 */
export async function exportAsImage(text: string, { filename }: BaseOpts): Promise<void> {
  // 1) data URL
  const dataMatch = text.match(/data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+/);
  if (dataMatch) {
    const dataUrl = dataMatch[0];
    const resp = await fetch(dataUrl);
    const blob = await resp.blob();
    triggerDownload(blob, filename);
    return;
  }

  // 2) http(s) 图片 URL
  const urlMatch = text.match(/https?:\/\/[^\s)'">]+\.(png|jpg|jpeg|webp|gif)/i);
  if (urlMatch) {
    try {
      const resp = await fetch(urlMatch[0]);
      if (resp.ok) {
        const blob = await resp.blob();
        triggerDownload(blob, filename);
        return;
      }
    } catch {
      /* fall through */
    }
    // 跨域情况下直接用浏览器下载
    const a = document.createElement('a');
    a.href = urlMatch[0];
    a.download = filename;
    a.target = '_blank';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return;
  }

  // 3) 没有图片信息时：把文本写到 1024x1024 的 canvas 再导出 PNG
  const canvas = document.createElement('canvas');
  const size = 1024;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = '#1f2937';
  ctx.font = '20px -apple-system, "PingFang SC", sans-serif';
  const padding = 40;
  const maxW = size - padding * 2;
  const lineHeight = 28;
  let y = padding + lineHeight;
  const wrap = (s: string) => {
    const result: string[] = [];
    for (const raw of s.split('\n')) {
      let line = '';
      for (const ch of raw) {
        const test = line + ch;
        if (ctx.measureText(test).width > maxW) {
          result.push(line);
          line = ch;
        } else {
          line = test;
        }
      }
      result.push(line);
    }
    return result;
  };
  const lines = wrap(text);
  for (const line of lines) {
    if (y > size - padding) break;
    ctx.fillText(line, padding, y);
    y += lineHeight;
  }
  const blob: Blob = await new Promise((r) => canvas.toBlob((b) => r(b!), 'image/png')!);
  triggerDownload(blob, filename);
}

/**
 * 把上游文本作为网页在浏览器新标签页中打开。
 *
 * 智能识别 3 种内容：
 *   1) 完整 HTML（含 <html> 或 <!doctype>）→ 直接渲染
 *   2) Markdown / 类 markdown 文本 → 简易 md→html 转换后渲染
 *   3) 纯文本 → 用 <pre> 包裹保留换行
 *
 * 不依赖第三方 markdown 库（保持 bundle 小）；支持基础语法：
 *   # 一级 / ## 二级 / ### 三级 标题
 *   **粗体** *斜体* `代码`
 *   ``` 代码块 ```
 *   - 列表 / 1. 有序列表
 *   > 引用
 *   [文字](http) 链接
 *   ![alt](src) 图片
 *   --- 分割线
 *   | 表格 |
 *
 * 输出会被自动包成完整 HTML 文档（含 viewport、合理排版样式 + 中文字体兜底）。
 */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** 极简 Markdown → HTML 转换（不依赖第三方库） */
function markdownToHtml(md: string): string {
  // 1) 先剥代码块，避免里面的内容被 inline 规则改写
  const codeBlocks: string[] = [];
  md = md.replace(/```([a-zA-Z]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
    codeBlocks.push(`<pre><code data-lang="${escapeHtml(lang || '')}">${escapeHtml(code)}</code></pre>`);
    return `\u0000CODEBLOCK${codeBlocks.length - 1}\u0000`;
  });

  // 2) 行级处理
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let inList: false | 'ul' | 'ol' = false;
  let inTable = false;

  const closeList = () => { if (inList) { out.push(`</${inList}>`); inList = false; } };
  const closeTable = () => { if (inTable) { out.push('</tbody></table>'); inTable = false; } };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.trim();

    // 表格：第一行 |a|b| 后跟 |---|---|
    if (line.startsWith('|') && line.endsWith('|') && lines[i + 1]?.trim().match(/^\|\s*:?-+:?\s*\|/)) {
      closeList();
      const headers = line.slice(1, -1).split('|').map((c) => c.trim());
      out.push('<table><thead><tr>' + headers.map((h) => `<th>${inlineMd(escapeHtml(h))}</th>`).join('') + '</tr></thead><tbody>');
      inTable = true;
      i++; // 跳过对齐行
      continue;
    }
    if (inTable && line.startsWith('|') && line.endsWith('|')) {
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      out.push('<tr>' + cells.map((c) => `<td>${inlineMd(escapeHtml(c))}</td>`).join('') + '</tr>');
      continue;
    }
    if (inTable) closeTable();

    // 标题
    let m: RegExpMatchArray | null;
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      closeList();
      const level = m[1].length;
      out.push(`<h${level}>${inlineMd(escapeHtml(m[2]))}</h${level}>`);
      continue;
    }
    // 引用
    if (line.startsWith('> ')) {
      closeList();
      out.push(`<blockquote>${inlineMd(escapeHtml(line.slice(2)))}</blockquote>`);
      continue;
    }
    // 分割线
    if (/^-{3,}$|^\*{3,}$/.test(line)) {
      closeList();
      out.push('<hr/>');
      continue;
    }
    // 无序列表
    if ((m = line.match(/^[-*]\s+(.*)$/))) {
      if (inList !== 'ul') { closeList(); out.push('<ul>'); inList = 'ul'; }
      out.push(`<li>${inlineMd(escapeHtml(m[1]))}</li>`);
      continue;
    }
    // 有序列表
    if ((m = line.match(/^\d+\.\s+(.*)$/))) {
      if (inList !== 'ol') { closeList(); out.push('<ol>'); inList = 'ol'; }
      out.push(`<li>${inlineMd(escapeHtml(m[1]))}</li>`);
      continue;
    }
    // 空行
    if (line === '') {
      closeList();
      out.push('');
      continue;
    }
    // 中文「分类：v1、v2」格式 → H3 + ul
    const colonM = line.match(/^([^:：]{1,16})[:：]\s*(.+)$/);
    const itemSepRe = /[、，,；;｜|\t]+/;
    if (colonM && itemSepRe.test(colonM[2])) {
      const items = colonM[2].split(itemSepRe).map((s) => s.trim()).filter(Boolean);
      if (items.length >= 2) {
        closeList();
        out.push(`<h3>${inlineMd(escapeHtml(colonM[1]))}</h3>`);
        out.push('<ul>' + items.map((it) => `<li>${inlineMd(escapeHtml(it))}</li>`).join('') + '</ul>');
        continue;
      }
    }
    // 普通段落
    closeList();
    out.push(`<p>${inlineMd(escapeHtml(raw))}</p>`);
  }
  closeList();
  closeTable();

  let html = out.join('\n');
  // 还原代码块占位
  html = html.replace(/\u0000CODEBLOCK(\d+)\u0000/g, (_m, n) => codeBlocks[+n] || '');
  return html;
}

/** 内联 markdown：粗体 / 斜体 / 代码 / 链接 / 图片 */
function inlineMd(s: string): string {
  // 顺序很重要：图片 → 链接 → 代码 → 粗体 → 斜体
  s = s.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_m, alt, src) => `<img alt="${alt}" src="${src}" style="max-width:100%"/>`);
  s = s.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t, u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  return s;
}

/** 用一个干净的 HTML 文档把内容包起来，注入排版 CSS */
function wrapHtmlDocument(bodyHtml: string, title: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; }
    body {
      font: 16px/1.7 -apple-system, "PingFang SC", "Microsoft YaHei", "Helvetica Neue", Arial, sans-serif;
      color: #1f2937;
      background: #ffffff;
      padding: 32px max(16px, calc((100vw - 760px) / 2));
    }
    @media (prefers-color-scheme: dark) {
      body { color: #e5e7eb; background: #0f172a; }
      blockquote { color: #94a3b8; border-color: #334155; }
      pre, code { background: #1e293b; color: #e2e8f0; }
      table th { background: #1e293b; }
      table td, table th { border-color: #334155; }
      hr { border-color: #334155; }
      a { color: #60a5fa; }
    }
    h1 { font-size: 1.9em; margin: 0.6em 0 0.4em; line-height: 1.3; }
    h2 { font-size: 1.5em; margin: 1.2em 0 0.5em; line-height: 1.3; border-bottom: 1px solid #e5e7eb; padding-bottom: 0.2em; }
    h3 { font-size: 1.2em; margin: 1em 0 0.4em; }
    h4, h5, h6 { font-size: 1em; margin: 0.9em 0 0.4em; }
    p { margin: 0.6em 0; }
    ul, ol { padding-left: 1.6em; }
    li { margin: 0.3em 0; }
    blockquote { color: #6b7280; border-left: 4px solid #d1d5db; margin: 0.8em 0; padding: 0.2em 0.9em; }
    code { background: #f3f4f6; padding: 1px 6px; border-radius: 4px; font-size: 0.92em; font-family: "SF Mono", Menlo, Consolas, monospace; }
    pre { background: #f3f4f6; padding: 12px 14px; border-radius: 8px; overflow-x: auto; font-family: "SF Mono", Menlo, Consolas, monospace; font-size: 0.92em; }
    pre code { background: transparent; padding: 0; }
    table { border-collapse: collapse; margin: 0.8em 0; width: 100%; font-size: 0.95em; }
    table th, table td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; }
    table th { background: #f9fafb; font-weight: 600; }
    a { color: #2563eb; text-decoration: none; }
    a:hover { text-decoration: underline; }
    hr { border: none; border-top: 1px solid #e5e7eb; margin: 1.6em 0; }
    img { max-width: 100%; height: auto; border-radius: 6px; }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/** 剥掉外层 markdown 代码块包装（如果整段内容恰好就是一个代码块）。
 *  例如 LLM 经常返回 ```html\n<...>\n``` 或 ```markdown\n# 标题\n```，
 *  此时应把内层内容拿出来作为真正的渲染目标。
 *  注意：仅当整段去除首尾空白后形如 ```lang? \n ... \n``` 时剥；
 *  内容里间夹的代码块要保留（让 markdown 渲染成 <pre>）。
 */
function stripOuterFence(text: string): { content: string; lang: string | null } {
  const trimmed = text.trim();
  // 用非贪婪 + 多行：开头 ```[lang]\n  ...  \n```（结尾后面可能还有零碎空白）
  const m = trimmed.match(/^```([a-zA-Z0-9_+\-.]*)\s*\n([\s\S]*?)\n```\s*$/);
  if (!m) return { content: text, lang: null };
  return { content: m[2], lang: (m[1] || '').toLowerCase() || null };
}

/** 把内容渲染成网页并在浏览器新标签页打开 */
export function openAsWeb(text: string, opts?: { title?: string }): void {
  // 0) LLM 经常把整段输出用 ```html ... ``` / ```markdown ... ``` 包裹。
  //    如果整段就是一个代码块，直接拆出内层内容；同时记下语言提示，
  //    用于后面决定是按 HTML 还是 Markdown 渲染。
  const { content: unwrapped, lang } = stripOuterFence(text);
  const trimmed = unwrapped.trim();
  let html: string;

  // 显式声明 html 的代码块 → 直接当 HTML 渲染
  if (lang === 'html' || lang === 'htm' || lang === 'xhtml') {
    if (/^<!doctype/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
      html = unwrapped; // 完整 HTML 文档
    } else {
      html = wrapHtmlDocument(unwrapped, opts?.title || '网页输出');
    }
  } else if (lang === 'markdown' || lang === 'md') {
    html = wrapHtmlDocument(markdownToHtml(unwrapped), opts?.title || '网页输出');
  } else if (/^<!doctype/i.test(trimmed) || /^<html[\s>]/i.test(trimmed)) {
    // 已是完整 HTML 文档
    html = unwrapped;
  } else if (/<\w+[^>]*>[\s\S]*<\/\w+>/.test(trimmed) && (trimmed.includes('<div') || trimmed.includes('<section') || trimmed.includes('<article') || trimmed.includes('<table') || trimmed.includes('<h1') || trimmed.includes('<p>') || trimmed.includes('<body'))) {
    // 含明显的 HTML 片段：直接拿来作为 body
    html = wrapHtmlDocument(unwrapped, opts?.title || '网页输出');
  } else {
    // markdown / 纯文本：统一走 mini md→html
    html = wrapHtmlDocument(markdownToHtml(unwrapped), opts?.title || '网页输出');
  }

  // 打开新标签页：用 Blob URL（不污染 history、刷新仍然在），失败时兜底用 about:blank+document.write
  try {
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank', 'noopener');
    if (!win) {
      // 弹窗被拦截：退而求其次，下载 .html 让用户自己打开
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(opts?.title || 'output').replace(/[/\\?%*:|"<>]/g, '-')}.html`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
    // 不立即 revokeObjectURL，让新标签页有时间加载（30s 后清理）
    setTimeout(() => URL.revokeObjectURL(url), 30 * 1000);
  } catch {
    const win = window.open('', '_blank', 'noopener');
    if (win) {
      win.document.open();
      win.document.write(html);
      win.document.close();
    }
  }
}
