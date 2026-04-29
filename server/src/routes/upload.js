import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

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

router.post('/file', upload.single('file'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: '未检测到文件' });
    const fileInfo = {
      id: req.file.filename,
      originalName: req.file.originalname,
      filename: req.file.filename,
      path: `/uploads/${req.file.filename}`,
      size: req.file.size,
      mimetype: req.file.mimetype,
      ext: path.extname(req.file.originalname).toLowerCase(),
    };
    res.json({ success: true, file: fileInfo });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
