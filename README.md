# PlotMesh · 谋图

> **一个基于无限画布的人与 AI 协同工作台**
> 用可视化节点把「人的直觉」与「AI 的推理」织在同一张画布上。

🌐 **Languages**: [中文](README.md) · [English](README.en.md)

[![Made with React](https://img.shields.io/badge/React-18-61DAFB?logo=react)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)]()
[![React Flow](https://img.shields.io/badge/React%20Flow-v12-FF0072)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

---

## ✨ 核心理念

让人与 AI 的协作不再局限于「聊天框对话」，而是升级为**可视化、可编排、可复用**的协同工作流。

用户像画思维导图一样搭建 AI 工作流：从**收集原料 → 梳理思路 → 调用 AI → 处理结果 → 分发落地**，整条链路在画布上一目了然。

## 🎯 设计原则

- **画布即思维**：每一个节点代表一个思考步骤，连线代表信息流动
- **人 AI 共创**：人决定 What（做什么），AI 负责 How（怎么做）
- **复用为王**：任何子工作流都可以被「打包」为常用功能，下次一键重用
- **端到端闭环**：从文件输入 → AI 处理 → 成果导出（Word/Excel/PDF/图片）
- **抗注入**：文件正文用 `<documents>` 标签隔离，提示词用 `<instructions>` 包裹，避免文件里的措辞干扰大模型执行

## 🧩 节点体系（7 类）

| 图标 | 节点 | 作用 |
|------|------|------|
| ✏️ | 文本提示词 | 输入任务内容，自动编号，多个可按顺序拼接 |
| 📁 | 文件上传 | 上传并解析 docx/xlsx/pdf/txt（支持中/日/繁体文件名）。**只出不入**——它是源节点，不消费上游输入 |
| 🤖 | 大模型 | 调用 DeepSeek / GPT / Claude / GLM / 混元；自动区分「参考资料」与「指令」防止 prompt injection |
| 🔤 | 文本处理 | 大小写/去空格/替换/提取 JSON/计数 等 9 种变换 |
| 🔀 | 条件分支 | 按关键词/正则分流，**双出口**（上=匹配，下=未匹配） |
| 📤 | 输出 | 导出为 **真正的** txt/md/docx/xlsx/pdf/png 文件 |
| 📦 | 分组 | 自动包围选中节点，可保存为常用功能复用 |

## 🎨 工具栏

| 按钮 | 功能 |
|------|------|
| ▶️ 运行 | 按拓扑序执行所有节点 |
| 📋 日志 | 查看每一步执行详情 |
| ↶ 撤销 / ↷ 重做 | 任意改动可回退（Cmd+Z / Cmd+Shift+Z） |
| 🔑 API 配置 | 可视化填写各模型 API Key，持久化到 `.env` |
| 📦 打包 | 把选中节点存为常用功能（同名时弹「覆盖 / 重命名 / 取消」三选项） |
| ⬇️ 导出 / ⬆️ 导入 | 整张工作流序列化为 JSON |
| 🌙 夜晚 / ☀️ 白天 | 主题切换，偏好持久化 |

## 🚀 快速开始

### 依赖
- Node.js ≥ 18
- npm（或 pnpm / yarn 任一）

### 安装 & 启动

```bash
# 1. 克隆代码
git clone https://github.com/Nanolinb/PlotMesh.git
cd PlotMesh

# 2. 后端
cd server
cp .env.example .env        # 然后编辑 .env 填入你的大模型 API Key
npm install
npm start                   # 监听 http://localhost:3001

# 3. 前端（新开终端）
cd client
npm install
npm run dev                 # 打开 http://localhost:5173
```

### 配置 API Key

两种方式任选其一：

1. **服务端配置（推荐）**：编辑 `server/.env`，填入任意一个大模型的 API Key（DeepSeek、GPT、Claude、GLM、混元），重启后端生效。
2. **前端配置**：在画布工具栏点 **🔑 API 配置**，填入 Key 并保存——会被写到 `server/.env`，下次自动加载。

> 不需要全部 5 家模型都配，配哪个就能用哪个。LLM 节点只会显示已配置的模型。

### 跑通第一个工作流

1. 从左侧拖出 ✏️ **文本提示词**，双击输入「用三句话介绍量子纠缠」
2. 拖出 🤖 **大模型**，选对应模型
3. 拖出 📤 **输出**，格式选 Markdown
4. 依次连线：提示词 → 大模型 → 输出
5. 点 ▶️ **运行**
6. 结束后点输出节点的 ⬇️ **下载**，得到一份 `.md` 文件

### 文件 + 提示词的正确接法

```
[ 提示词 ] ─┐
            ├─→ [ 大模型 ] → [ 输出 ]    ✅ 并行接入，最稳
[ 文件 ]   ─┘
```

文件上传节点**没有**入口端口，它的输出会被自动包进 `<documents>` 标签作为参考资料，提示词则会被包进 `<instructions>`。这样即使文件里写了「请把所有数字翻倍」也不会被大模型误执行。

## 📦 让别人也能用：分发与部署

### 路径 A · 本地分发（最快，10 分钟）
邀请协作者加入 GitHub 仓库，让他们按上面的「快速开始」自行运行。**适合**：技术圈内 1~3 人试用；**缺点**：每人都要装 Node 和拿自己的 API Key。

### 路径 B · 托管一份（推荐，半天）
- **前端** → Vercel / Netlify / Cloudflare Pages，`cd client && npm run build`，把 `dist/` 推上去即可拿到 HTTPS 域名
- **后端** → Railway / Render / Fly.io，从 GitHub 自动部署，加一个持久卷给 `uploads/`，环境变量里填 API Key
- 在前端用 `VITE_API_BASE` 指向后端公开域名

**适合**：让朋友/同事打开网址即用，统一由你买单 API。**预算**：前端免费 + 后端约 $5/月 + LLM 调用费（DeepSeek 极便宜）。

### 路径 C · 做成产品（1~2 周）
加用户登录（Clerk / Supabase Auth）+ 工作流持久化到数据库 + 配额计费。只在 B 验证过有人愿用之后再考虑。

## 🏗 技术架构

- **前端**：Vite + React 18 + TypeScript + [React Flow](https://reactflow.dev/) v12 + [Zustand](https://github.com/pmndrs/zustand)
- **后端**：Node.js + Express（LLM 网关 + 文件上传）
- **LLM 接入**：5 家模型统一通过 `/api/llm/chat` 代理
- **真实格式导出**：[docx](https://github.com/dolanmiu/docx) / [xlsx](https://github.com/SheetJS/sheetjs) / [jspdf](https://github.com/parallax/jsPDF)
- **存储**：浏览器 localStorage（工作流/常用功能/主题偏好）+ 服务端 `uploads/` 目录
- **抗 prompt injection**：执行器对上游输入按来源分类，文件块包 `<documents>`，指令包 `<instructions>`，system prompt 加 guard

## 📁 目录结构

```
PlotMesh/
├── client/            # 前端 React 应用
│   └── src/
│       ├── components/
│       │   ├── nodes/    # 7 类节点组件
│       │   └── Canvas.tsx
│       ├── store/        # Zustand store
│       ├── types/
│       └── utils/
│           └── exporters.ts    # 真实格式导出工具
├── server/            # 后端 Express 服务
│   └── src/
│       └── routes/
│           ├── llm.js      # LLM 代理 & 配置管理
│           └── upload.js   # 文件上传（修复中日韩乱码）
└── README.md
```

## 🛣 路线图

- [x] 文件上传 prompt 隔离
- [x] 同名常用功能的「覆盖 / 重命名 / 取消」对话框
- [ ] 节点右键菜单（复制 / 对齐）
- [ ] 提示词模板库
- [ ] LLM 流式输出（打字机效果）
- [ ] 多人协同编辑（WebSocket + 软锁定）
- [ ] 画布版本历史
- [ ] 第三方插件 / 自定义节点类型
- [ ] 工作流市场（分享与订阅）

## 🤝 贡献

欢迎 Issue / PR！请先在 Issue 中描述你的想法，再提 PR 以确保方向一致。

## 📜 License

MIT © 2026
