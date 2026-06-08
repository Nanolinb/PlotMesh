/**
 * server/src/loadEnv.js · 环境变量加载（必须最先 import）
 * ---------------------------------------------------------------
 * 显式从 server/.env 加载，不依赖启动时的工作目录（CWD）。
 *
 * 为什么单独成文件：
 *   ES Module 的 import 会被提升并先于普通语句执行。若把 dotenv.config()
 *   写在 index.js 的 import 语句之间，它实际会晚于其它被 import 的模块
 *   （如 routes/llm.js）的顶层代码运行——那时 llm.js 已经读过 process.env，
 *   读到的是空值。把加载逻辑放进本模块并让 index.js 第一个 import 它，
 *   就能保证在任何其它模块求值前完成 .env 加载。
 *
 * 之前用 `import 'dotenv/config'`（只读 CWD/.env）：从项目根目录启动
 * （node server/src/index.js）时读不到 server/.env，API Key 看似"丢失"。
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server/.env 的绝对路径（loadEnv.js 在 server/src/ 下，上一级即 server/）
dotenv.config({ path: path.resolve(__dirname, '../.env') });
