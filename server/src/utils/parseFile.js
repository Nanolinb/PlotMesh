/**
 * 文件内容解析器
 * 把上传的二进制文件转成 LLM 可读的纯文本：
 *   - .docx  → mammoth 提取纯文本
 *   - .xlsx / .xls / .csv → SheetJS 转为 Markdown 表格
 *   - .pdf   → pdf-parse 抽取文本
 *   - .txt / .md / .json / 等文本类 → 直接 utf8 读取
 *   - 其他二进制 → 返回 null
 */
import fs from 'fs';
import path from 'path';
import mammoth from 'mammoth';

// xlsx 和 pdf-parse 都是 CJS，用 createRequire 引入更稳
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
let PDFParse;
try {
  const m = require('pdf-parse');
  // pdf-parse 2.x 暴露了 PDFParse 类；旧版本是函数
  PDFParse = m.PDFParse || m.default || m;
} catch (e) {
  console.warn('[parseFile] pdf-parse load failed:', e.message);
  PDFParse = null;
}

const TEXT_EXTS = new Set([
  '.txt', '.md', '.json', '.csv', '.tsv', '.log', '.yml', '.yaml', '.xml', '.html', '.htm',
  '.js', '.ts', '.jsx', '.tsx', '.py', '.java', '.go', '.rs', '.sh', '.css', '.scss', '.sql',
  '.ini', '.toml', '.env', '.gitignore', '.dockerfile',
]);

const MAX_TEXT_LEN = 50_000; // 50K 字符上限，避免给 LLM 灌入超大内容

/**
 * 从文件路径解析内容为 UTF-8 字符串。失败或不支持 → 返回 null。
 */
export async function parseFileContent(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  try {
    // 1) 文本类
    if (TEXT_EXTS.has(ext)) {
      const text = fs.readFileSync(filePath, 'utf8');
      return truncate(text);
    }

    // 2) Word .docx
    if (ext === '.docx') {
      const result = await mammoth.extractRawText({ path: filePath });
      return truncate(result.value || '');
    }

    // 3) 老 .doc 不支持（mammoth 不行）
    if (ext === '.doc') {
      return '[不支持的格式：旧版 Word .doc — 请另存为 .docx 后重新上传]';
    }

    // 4) Excel
    if (ext === '.xlsx' || ext === '.xls') {
      const wb = XLSX.readFile(filePath);
      const parts = [];
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        // 用 csv 然后转成 markdown 表格更易读
        const csv = XLSX.utils.sheet_to_csv(sheet);
        if (!csv.trim()) continue;
        parts.push(`### Sheet: ${sheetName}\n\n${csvToMarkdownTable(csv)}`);
      }
      return truncate(parts.join('\n\n') || '(空 Excel 文件)');
    }

    // 5) PDF
    if (ext === '.pdf') {
      if (!PDFParse) return '[PDF 解析器加载失败，请检查 server 端 pdf-parse 模块]';
      const buf = fs.readFileSync(filePath);
      // 兼容新旧 API：
      // - 新（class）：new PDFParse({ data: buf }).getText() -> { text }
      // - 旧（function）：pdfParse(buf) -> { text }
      let text = '';
      if (typeof PDFParse === 'function' && PDFParse.prototype && typeof PDFParse.prototype.getText === 'function') {
        const inst = new PDFParse({ data: buf });
        const r = await inst.getText();
        text = r?.text || '';
      } else if (typeof PDFParse === 'function') {
        const r = await PDFParse(buf);
        text = r?.text || '';
      }
      return truncate(text);
    }

    // 6) 图片：返回占位提示（让 LLM 知道这是图，未来可对接 OCR / 视觉模型）
    if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) {
      return `[图片文件：${path.basename(originalName || filePath)}（当前后端尚未启用 OCR / 视觉模型抽取，模型只能看到本提示）]`;
    }

    // 其他二进制
    return null;
  } catch (err) {
    return `[解析失败：${err.message || '未知错误'}]`;
  }
}

function truncate(s) {
  if (!s) return '';
  if (s.length <= MAX_TEXT_LEN) return s;
  return s.slice(0, MAX_TEXT_LEN) + `\n\n... [内容超过 ${MAX_TEXT_LEN} 字符，已截断剩余 ${s.length - MAX_TEXT_LEN} 字符]`;
}

/**
 * 把 CSV 转成 Markdown 表格（GFM）。空白行会被过滤。
 * 行/列过多时只保留前 200 行 × 30 列。
 */
function csvToMarkdownTable(csv) {
  const rows = csv.split(/\r?\n/).filter((r) => r.trim().length > 0);
  if (!rows.length) return '';

  const MAX_ROWS = 200;
  const MAX_COLS = 30;
  const truncated = rows.length > MAX_ROWS;
  const used = rows.slice(0, MAX_ROWS).map((r) => parseCsvRow(r).slice(0, MAX_COLS));

  const colCount = Math.max(...used.map((r) => r.length));
  // 补齐列数
  used.forEach((r) => { while (r.length < colCount) r.push(''); });

  const escape = (cell) => String(cell ?? '').replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');
  const header = used[0].map(escape);
  const sep = header.map(() => '---');
  const body = used.slice(1).map((r) => r.map(escape));

  let md = `| ${header.join(' | ')} |\n| ${sep.join(' | ')} |\n`;
  for (const r of body) md += `| ${r.join(' | ')} |\n`;
  if (truncated) md += `\n_(表格超过 ${MAX_ROWS} 行，已截断)_\n`;
  return md;
}

/** 简单 CSV 行解析（处理引号内逗号） */
function parseCsvRow(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQuote = false;
      else cur += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}
