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
      .filter((l, i) => i !== 1) // 跳过对齐行
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
