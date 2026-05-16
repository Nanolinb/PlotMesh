# Changelog · 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [1.1.0] — 2026-05-16

### Added · 新增
- **画布右键菜单**：在画布任何位置（空白 / 节点上 / 选区矩形上 / group 内）右键都能弹出
  - ➕ 新建节点（二级菜单 6 类节点）：在右键的画布坐标处直接落点
  - 📦 Group（打包到画布）：≥2 个顶层节点选中时激活；点击把它们框成画布内 group（不写入常用功能）
  - 🔓 Ungroup（解散）：仅当右键命中某个 group 时显示；解散后子节点自动选中并恢复绝对坐标
- **键盘快捷键（跨 macOS / Windows）**：`Cmd/Ctrl + C/V/X/D` 复制 / 粘贴 / 剪切 / 直接生成副本
  - 选中 group 自动连同 children 与内部边一起复制
  - 粘贴出来的节点状态被重置（不带旧的运行结果）
  - 不动系统剪贴板，与浏览器原生复制粘贴互不干扰
- **画布草稿自动保存**：按时间间隔（默认 5 分钟）写到 localStorage，下次打开自动恢复
  - 工具栏可选间隔：关闭 / 1 / 2 / 3 / 5 / 10 / 15 分钟
  - 点击保存指示器可立即手动刷盘
  - 关闭页面前 `beforeunload` 强制刷盘
- **最近画布**：左侧栏底部新增 🕘 最近画布区，最多 8 张快照
  - 触发时机：画布导出、画布导入前、加载最近画布前（覆盖当前）
  - × 按钮单条删除
- **分组级局部运行**：每个展开态 group 标签栏自带 ▶ 按钮，仅运行本组内节点
  - 状态色：紫（idle/success）/ 橙（running，带呼吸脉冲）/ 绿（success 边框）/ 红（error）
  - 局部运行不会污染 group 外节点的状态
- **LLM 节点温度档位徽标**：四档语义化标签 + 颜色编码
  - 0–0.3 蓝「确定」 / 0.3–0.7 绿「平衡」 / 0.7–1.1 橙「创意」 / 1.1+ 红「发散」
  - 温度上限从 1.0 扩展到 1.5
- **存常用功能按钮智能化**：
  - 选中 ≥1 节点：直接进命名对话框
  - 未选中节点：弹「是否存储画布为常用功能？」二次确认
- **同名常用功能冲突对话框**：「覆盖 / 重命名 / 取消」三选项（取代原 `window.confirm`）
- **保存对话框名字自动预填**：从画布上选中的 group label 推断默认名

### Changed · 优化
- 工具栏「⬇️ 导出」「⬆️ 导入」 → 「⬇️ 画布导出」「⬆️ 画布导入」
- 「📦 打包」 → 「📦 存常用功能」
- README 改为中英文双语（[中文](README.md) / [English](README.en.md)）
- README 增加「分发与部署」三条路径（本地分发 / Vercel+Railway 托管 / 产品化）

### Fixed · 修复
- **GroupNode 折叠/展开导致整个画面白屏**（hooks 顺序违反 React 规则；已把 `handleRunGroup` 的 useCallback 提到 early return 之前）
- **Prompt Injection**：文件正文里的指令性措辞会干扰 LLM 节点
  - 引入 `__PM_FILE__` 前缀 + `<documents>` / `<instructions>` 标签隔离
  - LLM system prompt 自动追加 guard 提示
- **拖出来的常用功能再次保存为常用功能时无法覆盖** — savePackage 现在会自动展开 group children
- **常用功能在侧栏点选会自动加载到画布** — 改为只允许拖拽
- **fileUpload 节点的左侧 target handle 容易被误连**（导致提示词被静默丢弃）— 移除入口端口
- **executeFlow 中 results Map 初始化丢失**导致点运行所有节点保持 idle

### Internal · 内部
- 给 7 个核心节点组件、Sidebar、ApiKeyConfigModal、Canvas、store、types、server 路由
  全部加上中文头注释（功能说明 / 关键设计 / 踩坑提示）
- store 增加：`saveCanvasDraft / loadCanvasDraft / clearCanvasDraft`、最近画布管理、`toggleGroupCollapsed`
- 新工具函数：`groupSelectedOnCanvas / createNodeAt / findGroupAtFlowPos / ungroup`
- 执行器 `executeFlow(subsetIds?)` 支持子集运行；`runGroupOnly(groupId)` 通过 `window.__pmRunGroup` 暴露给 GroupNode
- App.css 增加 group 状态色 + 运行脉冲动画

---

## [1.0.0] — 2026-04-29

### Added · 新增
- **PlotMesh（谋图）正式命名 & 仓库迁移**：从 CoMind/ThoughtMesh 候选名定稿为 PlotMesh
- **7 类核心节点**：textPrompt、fileUpload、llm、textTransform、condition、output、group
- **5 家 LLM 接入**：DeepSeek / GPT / Claude / GLM / 混元（统一 `/api/llm/chat` 网关）
- **真实格式导出**：`.txt / .md / .docx / .xlsx / .pdf / .png`（不是改后缀）
- **常用功能（package）**：把任意子图保存为可复用预设，支持分组、搜索、重命名、移动到分组
- **画布工具**：拖拽创建、连线、撤销/重做、JSON 导入导出、夜晚/白天主题、清空、API Key 可视化配置
- **GroupNode 折叠/展开**：自动推断暴露端口，画布黑盒
- **首次启动注入示例**：3 个开箱即用的工作流模板
- **服务端文件解析**：docx / xlsx / pdf / 文本类，CJK 文件名乱码修复

### Internal
- 前端：Vite + React 18 + TypeScript + React Flow v12 + Zustand
- 后端：Node.js + Express
- 持久化：浏览器 localStorage（画布/包/偏好）+ 服务端 `uploads/`
