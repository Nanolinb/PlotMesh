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
// ⚠️ 必须第一行 import：在任何其它模块（routes/llm.js 等）求值 process.env 之前
// 完成 server/.env 加载。ESM import 会被提升，故用独立模块承载加载逻辑。
import './loadEnv.js';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import llmRouter from './routes/llm.js';
import uploadRouter from './routes/upload.js';
import syncRouter from './routes/sync.js';
import webFetchRouter from './routes/webFetch.js';
import tencentDocsRouter from './routes/tencentDocs.js';
import canvasRouter from './routes/canvas.js';
import authRouter from './routes/auth.js';
import inboxRouter from './routes/inbox.js';
import eventsRouter from './routes/events.js';
import dashboardRouter from './routes/dashboard.js';
import projectRouter from './routes/project.js';
import { printApiTokenBanner } from './middleware/apiToken.js';
import { optionalAuth } from './auth/middleware.js';
import { getServerConfig } from './utils/serverConfig.js';

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

// v2.0-α Phase A：所有请求挂可选 user 上下文（带 JWT 时 req.user 有值；
// 不带也不报错，向后兼容 v1.x 的"无身份"调用）
app.use(optionalAuth);

// 静态文件服务（上传的文件）
const uploadDir = path.join(__dirname, '../uploads');
app.use('/uploads', express.static(uploadDir));

// 路由
app.use('/api/auth', authRouter);
app.use('/api/llm', llmRouter);
app.use('/api/upload', uploadRouter);
app.use('/api/sync', syncRouter);
app.use('/api/web-fetch', webFetchRouter);
app.use('/api/tencent-docs', tencentDocsRouter);
// v1.6 切片 1：外部 AI 操作画布的 REST API
app.use('/api/canvas', canvasRouter);
// v2.0-α Phase A 步 2：inbox + SSE 多 channel
app.use('/api/inbox', inboxRouter);
app.use('/api/events', eventsRouter);
// v2.0 Phase C：总控画布 + Flex Pool
app.use('/api/dashboard', dashboardRouter);
// v2.0 Phase C 续：项目一等实体
app.use('/api/project', projectRouter);

// 健康检查
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// v2.0-α Phase A：若存在 build 后的前端产物，直接服务（用于测试/独立部署）
// 支持两种启动方式：从 server/ 启动 或 从项目根目录启动
const clientDistCandidates = [
  path.resolve(process.cwd(), '../client/dist'),
  path.resolve(process.cwd(), 'client/dist'),
];
let clientDist = null;
for (const cand of clientDistCandidates) {
  if (fs.existsSync(path.join(cand, 'index.html'))) {
    clientDist = cand;
    break;
  }
}
if (clientDist) {
  app.use(express.static(clientDist));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.listen(PORT, HOST, async () => {
  console.log(`🚀 Server running on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  if (HOST === '0.0.0.0') {
    console.log(`   ↑ 远端访问已开启，LAN 内任意 IP:${PORT} 都能访问（强制 token 鉴权）`);
  } else {
    console.log(`   ↑ 仅本机访问；如需从 LAN/容器访问，请到前端 API 配置 → 外部 AI 接入 → 打开"远端访问"`);
  }
  // 打印 API token（让用户知道怎么调 /api/canvas/*）
  printApiTokenBanner();

  // v1.7 alpha P1 第二刀：启动定时调度器
  try {
    const { startScheduler } = await import('./runner/scheduler.js');
    const { runCanvasJob } = await import('./routes/canvas.js');
    startScheduler(runCanvasJob, { scanIntervalMs: 10000 });
  } catch (e) {
    console.warn('⚠️  启动 scheduler 失败：', e.message);
  }

  // v2.0 Phase C 步 7：AI PM —— 把 inbox SSE 广播器注入 pmNotify（L1 失败实时推送）
  try {
    const { setPmBroadcaster } = await import('./runner/pmNotify.js');
    const { setSuggestBroadcaster } = await import('./runner/pmSuggest.js');
    const { broadcastInbox } = await import('./routes/events.js');
    setPmBroadcaster(broadcastInbox);
    setSuggestBroadcaster(broadcastInbox);
  } catch (e) {
    console.warn('⚠️  注入 AI PM 广播器失败：', e.message);
  }

  // v2.0 Phase C 步 7：AI PM L2 —— 启动每日日报调度
  try {
    const { startPmDigest } = await import('./runner/pmDigestScheduler.js');
    const hour = process.env.PLOTMESH_PM_DIGEST_HOUR ? parseInt(process.env.PLOTMESH_PM_DIGEST_HOUR, 10) : 9;
    startPmDigest({ digestHour: hour });
  } catch (e) {
    console.warn('⚠️  启动 AI PM 日报调度失败：', e.message);
  }
});
