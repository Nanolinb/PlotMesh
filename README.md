# PlotMesh · 谋图

> **一个基于无限画布的人与 AI 协同工作台**
> 把「人的直觉」「AI 的推理」「团队的协作」织在同一张可视化画布上。

🌐 **Languages**: [中文](README.md) · [English](README.en.md)　|　📜 [Changelog](CHANGELOG.md)

[![version](https://img.shields.io/badge/version-1.7.0--alpha-6366f1)](CHANGELOG.md)
[![Made with React](https://img.shields.io/badge/React-18-61DAFB?logo=react)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript)]()
[![React Flow](https://img.shields.io/badge/React%20Flow-v12-FF0072)]()
[![License](https://img.shields.io/badge/license-MIT-green)]()

---

## ✨ 这是什么

PlotMesh 是一个**节点式的可视化协同工作台**。你像画思维导图一样,把一个任务拆成若干节点——收集原料、调用 AI、处理结果、可视化、分发落地——用连线把它们串成一条信息流,点一下「运行」,整条链路按拓扑序自动跑完。

它不只是「把对话框换成画布」,而是三件事的交汇点:

- **人与 AI 协同** — 人决定 What(做什么),AI 负责 How(怎么做);AI 还能主动在画布上「长出」新结构(AI 构建器),你审核后再落盘。
- **多人协作** — 同一个服务端下多人各自拥有画布,可共享、可跨画布引用(带双边握手合约),通知走收件箱。
- **可复用编排** — 任何子工作流都能打包成「常用功能」,跨画布、跨项目重用。

> **双模架构**:既能当**单机离线工具**用(零配置,打开即用),也能切到**联网协作模式**(登录、多用户、权限管理)。同一套代码,一个开关切换。

## 🎯 设计原则

- **画布即思维**:每个节点是一个思考步骤,连线是信息流动
- **人 AI 共创**:AI 生成结构永远先 **dry-run 预览**,用户点确认才落盘,从不自动改你的画布
- **复用为王**:子工作流一键打包复用
- **端到端闭环**:文件输入 → AI 处理 → 成果导出(Word/Excel/PDF/图片/网页)
- **抗注入**:文件正文用 `<documents>` 隔离,指令用 `<instructions>` 包裹,文件里的措辞不会被大模型误执行

## 🧩 节点体系(20 类 · 6 大类)

### 📥 数据输入
| 图标 | 节点 | 作用 |
|------|------|------|
| 📁 | 文件上传 | 上传并解析 docx/xlsx/pdf/txt(支持中/日/繁体文件名)。**只出不入**,是源节点 |
| 🔗 | Web 链接 | 抓取网页 / wiki / 在线文档 / 新闻作为输入;URL 是腾讯文档时自动走 MCP |
| 🌐 | 跨画布输入 | 接收**另一张画布**的输出回写;来源信息只读,由服务端自动填 |

### 📝 文本处理
| 图标 | 节点 | 作用 |
|------|------|------|
| ✏️ | 文本提示词 | 输入任务内容,自动编号,多个可按顺序拼接 |
| 🤖 | 大模型 | 调用 DeepSeek/GPT/Claude/GLM/混元/Kimi/通义;自动区分「参考资料」与「指令」防注入;温度带「确定/平衡/创意/发散」分档 |
| 🔤 | 文本处理 | 大小写/去空格/替换/提取 JSON/计数 等 9 种变换 |
| 🔀 | 条件分支 | 按关键词/正则分流,**双出口**(上=匹配,下=未匹配) |
| 🔀 | 分叉 | 把一段文本切成 N 段,每段一个独立输出端子(JSON数组/编号/列表/分隔符/正则) |
| 📤 | 输出 | 导出 **真实** txt/md/docx/xlsx/pdf/png,或选「网页」直接在浏览器打开(Markdown→HTML + 亮暗双主题) |

### 🎨 图形可视化
| 图标 | 节点 | 作用 |
|------|------|------|
| 📊 | 数据提取 | 调 LLM 把任意文本/图片规整成结构化 JSON,喂给下游图形节点 |
| 🥧 | 饼图 | 把 JSON/表格/行式列表渲染成 SVG 饼图(本地渲染,0 token) |
| 📊 | 柱状图 | 柱条/条形图,本地 SVG,支持横竖向 |
| 🎨 | 自由图形 | LLM 看参考图 + 数据,直接画出任意形态的 SVG |
| 📊 | 仪表盘 | 收集 N 个图形节点合成一个 HTML grid 页面,支持自定义布局 |

### ⏱ 编排 & 时序
| 图标 | 节点 | 作用 |
|------|------|------|
| ⏱ | 时间轴 | 横向可拖拽时间轴,配 fps + 时间码(秒/帧/SMPTE);从文本解析镜头切换点,每点一个端口 |
| 🏊 | 项目泳道 | 横向泳道 / 多行项目时序排布 |
| 📦 | 分组 | 框选打包,可存为常用功能;展开态自带 ▶ 仅运行本组 |

### 🌐 协作(联网模式)
| 图标 | 节点 | 作用 |
|------|------|------|
| 🌐 | 跨画布输出 | 把上游内容投递到另一张画布的跨画布输入;**跨用户引用走双边握手合约**(对方接受才生效,撤销留审计) |
| 🎨 | 主题 | 「定调(管理者)」×「样式(设计师)」合并成有效主题,沿连线广播给下游子节点 |

### 🤖 AI 原生
| 图标 | 节点 | 作用 |
|------|------|------|
| 🤖 | AI 构建器 | 写一句需求,AI 读画布上下文 → 生成节点结构方案 → **dry-run 预览** → 一键应用(单步可撤销);带安全护栏(类型白名单/数量上限/防 prompt 注入) |

## 🤝 多人协作(联网模式)

PlotMesh 默认是单机离线工具,但开启**联网模式**后解锁团队协作:

- **用户体系**:邮箱+密码注册登录(bcrypt 加密),JWT 鉴权;**第一个注册者自动成为管理员**
- **画布归属**:每张画布有 owner,可共享给指定成员(`owned-by-me` / `shared-with-me`)
- **跨画布引用合约**:A 想引用 B 的画布输出,需 B 在收件箱确认(`pending → accepted/rejected`),撤销走 `cancelled` 并永久留审计
- **收件箱 + 通知**:顶部 🔔 Bell 实时收引用请求 / 提及等通知(SSE 推送)
- **管理员控制台**:🔑 API 配置 → 👥 成员管理(列成员/重置密码/删除/设角色;防删最后一个管理员)

> 切换方式:写 `~/.plotmesh/server-config.json` 设 `auth.required=true`,或环境变量 `PLOTMESH_AUTH_REQUIRED=true`。

## 🎨 工具栏

| 按钮 | 功能 |
|------|------|
| ▶️ 运行 | 按拓扑序执行所有节点 |
| 📋 日志 | 查看每一步执行详情 |
| ↶ 撤销 / ↷ 重做 | 任意改动可回退(Cmd+Z / Cmd+Shift+Z) |
| 🔑 API 配置 | 填各模型 API Key + 外部 AI 接入 token +(管理员)成员管理 |
| 📦 存常用功能 | 选中节点存为常用功能;同名时「覆盖/重命名/取消」 |
| ⬇️⬆️ 画布导出 / 导入 | 整张画布序列化 JSON;导入前自动存进「最近画布」可回退 |
| 🕘 最近画布 | 最多 8 份快照一键加载 |
| ⏱ 自动保存间隔 | 关闭 / 1 / 2 / 3 / 5 / 10 / 15 分钟,默认 5 分钟 |
| 🌙/☀️ 主题 | 亮/暗切换,偏好持久化 |
| 🟢 状态灯(左上) | 服务端连接状态,点开看 token / 远端访问 / 数据目录 |

### ⌨️ 键盘快捷键

| 操作 | macOS | Windows / Linux |
|---|---|---|
| 复制 / 粘贴 / 剪切 | `⌘C` / `⌘V` / `⌘X` | `Ctrl` 同 |
| 直接生成副本 | `⌘ + D` | `Ctrl + D` |
| 撤销 / 重做 | `⌘Z` / `⌘⇧Z` | `Ctrl` 同 |
| 删除选中 | `Delete` / `Backspace` | 同 |
| 保存为常用功能 | `⌘ + S` | `Ctrl + S` |

> 复制 group 会连同内部子节点和连线一起复制;粘贴出来的节点状态会被重置。

## 🚀 快速开始

### 依赖
- Node.js ≥ 18(建议 22+)
- npm / pnpm / yarn 任一

### 本地开发

```bash
# 1. 克隆
git clone https://github.com/Nanolinb/PlotMesh.git
cd PlotMesh

# 2. 后端
cd server
cp .env.example .env        # 编辑 .env 填大模型 API Key
npm install
npm start                   # http://localhost:3001

# 3. 前端(新终端)
cd client
npm install
npm run dev                 # http://localhost:5173
```

### 配置 API Key

1. **服务端(推荐)**:编辑 `server/.env` 填任意一家大模型 Key,重启生效
2. **前端**:工具栏 🔑 API 配置填 Key 保存(写入 `server/.env`)

> 不必 5 家全配,配哪个用哪个;LLM 节点只显示已配置的模型。

### 跑通第一个工作流

1. 拖出 ✏️ **文本提示词**,双击输入「用三句话介绍量子纠缠」
2. 拖出 🤖 **大模型**,选模型
3. 拖出 📤 **输出**,格式选 Markdown
4. 连线:提示词 → 大模型 → 输出
5. 点 ▶️ **运行**,完成后下载 `.md`

### 文件 + 提示词的正确接法

```
[ 提示词 ] ─┐
            ├─→ [ 大模型 ] → [ 输出 ]    ✅ 并行接入,最稳
[ 文件 ]   ─┘
```

文件上传节点**没有入口端口**,输出自动包进 `<documents>` 作参考资料,提示词包进 `<instructions>`。即使文件里写「把所有数字翻倍」也不会被误执行。

## 🐳 Docker 部署(团队 / NAS)

适合部署到 NAS(群晖 / QNAP)或服务器供团队访问:

```bash
# 在项目根目录
docker compose up -d        # 启动 server(3001) + client(8080)
docker compose logs -f      # 看日志
```

浏览器访问 `http://<部署机IP>:8080/`。数据持久化在 `./data`(画布/token/config)和 `./uploads`(上传文件)。

> Docker 默认开启远端访问(强制 token);要团队登录,在 compose 的 server 环境加 `PLOTMESH_AUTH_REQUIRED=true`。

### macOS 后台自启

```bash
bash scripts/install-autostart.sh          # 装成 launchd 服务(开机自启 + 崩溃自拉)
bash scripts/install-autostart.sh --status # 查看状态
bash scripts/install-autostart.sh --uninstall
```

## 🏗 技术架构

- **前端**:Vite + React 18 + TypeScript + [React Flow](https://reactflow.dev/) v12 + [Zustand](https://github.com/pmndrs/zustand)
- **后端**:Node.js + Express(LLM 网关 + 文件上传 + 画布 REST API + 鉴权 + SSE)
- **存储**:浏览器 IndexedDB(画布草稿/工作流/偏好)+ 服务端 `store.json`(跨浏览器同步,三向合并)+ `uploads/`
- **多用户**:bcryptjs 密码哈希 + JWT;AuthProvider 可插拔(首发 builtin 邮箱密码,预留 SSO/LDAP)
- **执行引擎**:前端 executor + 服务端 runner **双引擎**(server 可无头跑画布,支持定时任务)
- **LLM 接入**:7 家模型统一走 `/api/llm/chat` 代理
- **真实格式导出**:[docx](https://github.com/dolanmiu/docx) / [xlsx](https://github.com/SheetJS/sheetjs) / [jspdf](https://github.com/parallax/jsPDF)
- **抗 prompt injection**:上游输入按来源分类,文件包 `<documents>`,指令包 `<instructions>`,system prompt 加 guard

## 🛣 路线图

**已完成**
- [x] 文件上传 prompt 隔离 / 右键菜单 / 复制粘贴快捷键 / 画布草稿自动保存
- [x] 多画布管理 + Chrome 风格页签条
- [x] 图形栈(饼图/柱图/自由图形/仪表盘/数据提取,本地 SVG)
- [x] 跨画布引用(crossOutput ↔ crossInput)+ 服务端 runner 双引擎
- [x] 跨浏览器同步(store.json 三向合并 + 软删除回收站)
- [x] 多用户协作底座(Auth/JWT/双模架构 + 画布归属 + 收件箱/SSE/Bell)
- [x] Reference 合约状态机(跨用户引用双边握手 + 永久审计)
- [x] 主题节点(定调 × 样式合并广播)
- [x] AI 构建器(AI 生成结构 + dry-run 预览 + 一键应用)
- [x] 管理员控制台(成员管理 / 重置密码 / 角色)
- [x] Docker 部署 + macOS 自启

**进行中 / 规划(v2.0)**
- [ ] AI emit 完整版:画布上半透明 ghost 预览 + 显式 Slot 端口
- [ ] 成品聚合节点(导出 PPT/PDF)
- [ ] Flex Pool 三层人员调度面板
- [ ] AI PM:日报定时 / stuck 检测主动 @人 / 主动建议
- [ ] 总控画布(项目级数据流监控,看团队「哪里堵车」)

## 🤝 贡献

欢迎 Issue / PR!请先在 Issue 描述想法,再提 PR 以确保方向一致。

## 📜 License

MIT © 2026
