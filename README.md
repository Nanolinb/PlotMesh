# PlotMesh · 谋图

> **一个基于无限画布的人与 AI 协同工作台**
> 用可视化节点把「人的直觉」与「AI 的推理」织在同一张画布上。

🌐 **Languages**: [中文](README.md) · [English](README.en.md)　|　📜 [Changelog](CHANGELOG.md)

[![version](https://img.shields.io/badge/version-1.4.0-6366f1)](CHANGELOG.md)
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
| 🤖 | 大模型 | 调用 DeepSeek / GPT / Claude / GLM / 混元；自动区分「参考资料」与「指令」防止 prompt injection。**温度**滑杆带「确定 / 平衡 / 创意 / 发散」分档徽标 |
| 🔤 | 文本处理 | 大小写/去空格/替换/提取 JSON/计数 等 9 种变换 |
| 🔀 | 条件分支 | 按关键词/正则分流，**双出口**（上=匹配，下=未匹配） |
| 🔀 | 分叉 | 把上游一段文本切成 N 段，**每段一个独立输出端子**。支持 JSON 数组 / 编号 / 列表 / 自定义分隔符 / 正则；端子可设为按段数自动生成或手动固定 N 个 |
| 📤 | 输出 | 导出为 **真正的** txt/md/docx/xlsx/pdf/png 文件，或选 **网页** 格式直接在浏览器新标签页打开（自带 Markdown→HTML 渲染 + 亮/暗双主题）|
| 📦 | 分组 | 自动包围选中节点，可保存为常用功能复用。**展开态 group 标签栏自带 ▶ 按钮**，可仅运行本组内的节点（运行中橙色脉冲、成功绿色、失败红色） |
| ⏱ | 时间轴 | 横向可拖拽时间轴，配置 fps（60/30/24/12/自定义）和时间显示（秒/帧/SMPTE 时间码）；从上游文本自动解析时间标记生成镜头切换点；右侧每个切换点对应一个 source 端口 |

## 🎨 工具栏

| 按钮 | 功能 |
|------|------|
| ▶️ 运行 | 按拓扑序执行所有节点 |
| 📋 日志 | 查看每一步执行详情 |
| ↶ 撤销 / ↷ 重做 | 任意改动可回退（Cmd+Z / Cmd+Shift+Z） |
| 🔑 API 配置 | 可视化填写各模型 API Key，持久化到 `.env` |
| 📦 存常用功能 | 选中 ≥1 节点时把选中节点存为常用功能；未选中时弹「是否存储画布为常用功能？」二次确认。同名时进入「覆盖 / 重命名 / 取消」三选项 |
| ⬇️ 画布导出 / ⬆️ 画布导入 | 整张画布序列化为 JSON；导入前会自动把当前画布存进「最近画布」，可随时回退 |
| 🕘 最近画布（左侧栏底部） | 最多 8 份导入/导出/被覆盖的画布快照，一键加载；切换前会询问是否把当前画布也存一份 |
| ⏱ 自动保存间隔 | 工具栏右侧下拉，可选 关闭 / 1 / 2 / 3 / 5 / 10 / 15 分钟，默认 5 分钟；关闭页面前仍会刷盘一次 |
| 🌙 夜晚 / ☀️ 白天 | 主题切换，偏好持久化 |

### ⌨️ 键盘快捷键

| 操作 | macOS | Windows / Linux |
|---|---|---|
| 复制选中节点 | `⌘ + C` | `Ctrl + C` |
| 粘贴（向右下偏移，连续粘贴递增） | `⌘ + V` | `Ctrl + V` |
| 剪切 | `⌘ + X` | `Ctrl + X` |
| 直接生成副本 | `⌘ + D` | `Ctrl + D` |
| 撤销 / 重做 | `⌘ + Z` / `⌘ + ⇧ + Z` | `Ctrl + Z` / `Ctrl + Shift + Z` |
| 删除选中节点/连线 | `Delete` / `Backspace` | `Delete` / `Backspace` |
| 保存为常用功能 | `⌘ + S` | `Ctrl + S` |

> 复制 group 会自动连同其内部子节点和子节点之间的连线一起复制；粘贴出来的节点状态会被重置（不携带旧的运行结果）。

### 🖱 右键菜单（画布内）

在画布的**任何位置**右键都会弹出菜单——空白处、节点上、group 内、框选出来的选区矩形上都行：

- **➕ 新建节点 ▶**：在右键的画布坐标处直接创建一个节点（二级菜单列出 6 类节点）
- **📦 Group（打包到画布）**：选中 ≥2 个顶层节点（不在已有 group 内）时激活；点击后把它们框成一个**仅画布内**的 group，**不会**写入常用功能。少于 2 个时显示为灰色禁用
- **🔓 Ungroup（解散）**：仅当右键命中了某个 group（包括 group 内空白处）时显示；点击后把 group 拆开，子节点恢复绝对坐标并自动选中

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

## 🏗 技术架构

- **前端**：Vite + React 18 + TypeScript + [React Flow](https://reactflow.dev/) v12 + [Zustand](https://github.com/pmndrs/zustand)
- **后端**：Node.js + Express（LLM 网关 + 文件上传）
- **LLM 接入**：5 家模型统一通过 `/api/llm/chat` 代理
- **真实格式导出**：[docx](https://github.com/dolanmiu/docx) / [xlsx](https://github.com/SheetJS/sheetjs) / [jspdf](https://github.com/parallax/jsPDF)
- **存储**：浏览器 localStorage（**画布草稿**自动持久化、工作流/常用功能/主题偏好）+ 服务端 `uploads/` 目录
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
- [x] 画布右键菜单（新建节点 / Group / Ungroup）
- [x] 复制粘贴快捷键（C/V/X/D）
- [x] 画布草稿自动保存（关闭浏览器再打开，工作不丢）
- [ ] 节点右键菜单（更多单节点操作）
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
