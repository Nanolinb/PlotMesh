/**
 * server/src/routes/upload.js · 文件上传 + 解析路由
 * ---------------------------------------------------------------
 * 接收前端 fileUpload 节点上传的文件，按扩展名解析成纯文本回传，
 * 让画布上的 LLM / 文本处理节点能直接消费。
 *
 * 支持的解析（其它二进制原样存盘，content 留空 + parseError 说明）：
 *   .txt / .md / .json / .csv / .log    UTF-8 直读
 *   .docx                               mammoth 抽纯文本
 *   .xlsx / .xls                        xlsx 库按 sheet 拼接 CSV
 *   .pdf                                pdf-parse 抽文本（保留段落）
 *
 * 关键修复：
 *   - multer 默认会把中文/日文/繁体文件名搞乱码，这里用 latin1 → utf-8 还原
 *   - 解析失败时不抛 500，而是返回 parseError，让前端能给出友好提示
 *
 * 文件存放：server/uploads/，不入库；上线如果需要持久化建议挂对象存储。
 */
import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { parseFileContent } from '../utils/parseFile.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/**
 * multer 默认把 multipart 的 filename 当 latin1 解，所以中文/日文/繁体会变成
 * "ä¸­ææµè¯.txt" 之类。这里按 latin1 还原字节，再当 UTF-8 重新解析。
 * 用 WeakSet 避免重复解码（fileFilter 和 filename 回调会先后调到同一个 file 对象）。
 */
const decodedFiles = new WeakSet();
function ensureDecodedName(file) {
  if (decodedFiles.has(file)) return;
  try {
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
  } catch {
    /* keep as-is */
  }
  decodedFiles.add(file);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    ensureDecodedName(file);
    const uniqueName = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    ensureDecodedName(file);
    const allowedTypes = /jpeg|jpg|png|webp|gif|docx|doc|xlsx|xls|pdf|txt|md|json|csv|log|yml|yaml|xml|html|js|ts|jsx|tsx|py|java|go|rs|sh|css|scss/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    if (extname) cb(null, true);
    else cb(new Error('不支持的文件类型：' + path.extname(file.originalname)));
  },
});

const router = Router();

router.post('/file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未检测到文件' });
    const fullPath = path.join(uploadDir, req.file.filename);

    // 后端解析文件内容（docx/xlsx/pdf/文本类）
    let content = null;
    let parseError = null;
    try {
      content = await parseFileContent(fullPath, req.file.originalname);
    } catch (e) {
      parseError = e.message || String(e);
    }

    const fileInfo = {
      id: req.file.filename,
      originalName: req.file.originalname,
      filename: req.file.filename,
      path: `/uploads/${req.file.filename}`,
      size: req.file.size,
      mimetype: req.file.mimetype,
      ext: path.extname(req.file.originalname).toLowerCase(),
      content: content || '',                  // 解析得到的纯文本内容（喂给 LLM）
      contentLength: content ? content.length : 0,
      parsed: content !== null && !parseError,
      parseError: parseError || undefined,
    };
    res.json({ success: true, file: fileInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
