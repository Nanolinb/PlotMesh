/**
 * server/src/index.js · 后端入口（Express）
 * ---------------------------------------------------------------
 * 提供两件事：
 *   1) /api/llm/*    LLM 网关：统一代理 5 家厂商 + 管理 .env 中的 API Key
 *   2) /api/upload/* 文件上传：接收前端 fileUpload 节点的文件，解析为纯文本回传
 *
 * 端口：默认 3001（可通过环境变量 PORT 覆盖）
 * 启动：cd server && npm start    （nodemon 开发：npm run dev）
 *
 * 跨域：app.use(cors()) 默认全开；上线时建议改成白名单（读 ALLOWED_ORIGINS）。
 */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import llmRouter from './routes/llm.js';
import uploadRouter from './routes/upload.js';
import syncRouter from './routes/sync.js';
import webFetchRouter from './routes/webFetch.js';
import tencentDocsRouter from './routes/tencentDocs.js';
import canvasRouter from './routes/canvas.js';
import { printApiTokenBanner } from './middleware/apiToken.js';
import { getServerConfig } from './utils/serverConfig.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

// v1.6.2：根据 remoteAccess 开关决定监听地址
//   false（默认）→ 127.0.0.1（只本机访问）
//   true         → 0.0.0.0（LAN/Docker/群晖 都能访问，必带 token）
const cfg = getServerConfig();
const HOST = cfg.remoteAccess ? '0.0.0.0' : '127.0.0.1';

// 中间件
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// 静态文件服务（上传的文件）
const uploadDir = path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadDir));

// 路由
app.use('/api/llm', llmRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/sync', syncRouter);
app.use('/api/web-fetch', webFetchRouter);
app.use('/api/tencent-docs', tencentDocsRouter);
// v1.6 切片 1：外部 AI 操作画布的 REST API
app.use('/api/canvas', canvasRouter);

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, HOST, () => {
  console.log(`🚀 Server running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0') {
    console.log(`   ↑ 远端访问已开启，LAN 内任意 IP:${PORT} 都能访问（强制 token 鉴权）`);
  } else {
    console.log(`   ↑ 仅本机访问；如需从 LAN/容器访问，请到前端 API 配置 → 外部 AI 接入 → 打开"远端访问"`);
  }
  // 打印 API token（让用户知道怎么调 /api/canvas/*）
  printApiTokenBanner();
});
