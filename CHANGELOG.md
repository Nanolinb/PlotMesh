# Changelog · 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [1.4.3] — 2026-05-17

### Changed · 优化（分叉节点）
- **预览框可手动拉长**：原来只显示前 5 段且单行省略，现在底部预览容器支持垂直 resize（最小 60px / 最大 600px），高度持久化到 `data.previewHeight`。拉高后会显示完整段落内容（保留换行 + 自动换行），方便审阅长段。
- **画布/Group 运行时，auto 模式自动按当前段数刷新端子**：以前 auto 模式取已固化的 `autoCommittedCount`，运行时不会变（导致用户必须再点一次"生成"才能让端子数 = 段数）。现在执行器在 auto 模式会把 `autoCommittedCount` 同步为当前 `segments.length`，运行后立刻看到正确端子数 + 按钮回到 ▶ 状态。
- **生成按钮独立运行**：按钮文案从 `▶ 生成` 改为 `▶ 抓取并生成`。点击时**不再触发整画布运行**，而是主动从 store 里读取所有上游节点已有的输出（textPrompt 读 `data.text`、LLM 读 `data.output / streamOutput`、textTransform 读 `data.output`、splitter 按 `sourceHandle=out__N` 取对应段、fileUpload 读已解析的文件内容），然后 `splitText` 再算一次段数并固化。这样在上游 textPrompt 被改过、但 LLM 已有缓存输出的情况下，可以**秒级刷新端子数**而不必重跑整个流程。

---

## [1.4.2] — 2026-05-17

### Changed · 优化
- **左键按住节点即选中**：把 `selectNodesOnDrag` 从 `false` 改为 `true`。以前用户能直接拖动节点但需要再点一次才出现高亮选中外框（导致 Delete 等操作必须二次点击），现在按住即选中，行为符合直觉。

### Fixed · 修复
- **展开状态的 group 现在也能被再嵌套**：以前 `groupSelectedOnCanvas` 检查到任何"已在 group 内的子节点被选中"就会拒绝，导致框选展开 group 时连带选中其内部节点 → Group 菜单灰掉。现在改为：被选中 group 的子节点会**自动忽略**；只有当存在"父 group 没被选中"的孤儿子节点才禁止。
- **Group 虚线边界恢复可调**：`.group-node { pointer-events: none }` 把 NodeResizer 的把手也屏蔽了。新增 `.group-node .react-flow__resize-control { pointer-events: auto }`，让 resize 把手重新可点 → 嵌套 group 展开时空间不够可手动拉大。
- **保存单个 group 为常用功能不再多套一层**：以前 `savePackage` 不区分输入是不是已经是 group，永远再加一层 wrapper。现在检测到"顶层只选中 1 个 group"时直接给原 group 写 `packageId` 标记，画布上节点结构保持不变。
- **常用功能拖到画布右端不再跳到中间**：`handleDrop` 之前用 `[...allNodes].reverse().find(type==='group')` 找刚加载的 group，但嵌套包加载后最后一个 group 是**深层子 group**，不是 wrapper。改为：用"加载前 id 集合"的差集精确定位最外层新 wrapper，再把它的位置对齐到鼠标释放点。
- **最外层 group 折叠时级联折叠所有内部 group**：以前外层折叠只 hide 直接子节点，嵌套子 group 自身仍是 `collapsed=false`，再次展开时看到的是空虚线框。现在改为：外层折叠 → 递归把所有后代 group 也设为 `collapsed=true`（保留 expandedSize），等于恢复到刚拖出常用功能时的"层层黑盒"状态。

---

## [1.4.1] — 2026-05-17

### Changed · 优化
- **多层 Group 现在可以保存为常用功能**：v1.4.0 已经支持画布上嵌套 group，但当时保存为常用功能时嵌套结构会被摊平为单层（只剩叶子节点）。本版改造 `savePackage` / `loadPackage`，让多层 group 完整保留嵌套层级，加载后可以层层展开/折叠。
  - 保存：递归收集所有后代（含嵌套 group），区分"顶层"与"嵌套"节点的坐标基准；每层嵌套 group 的对外端口（exposedPorts）都重新推断一遍，避免引用 stale 数据。
  - 加载：所有节点（含嵌套 group）生成新 id，`parentId` 与嵌套 group 的 `exposedPorts.childNodeId` 都跟着 idMap 重映射；嵌套 group 默认折叠为黑盒，与单层 group 语义一致。
  - 节点按"父在前"的拓扑顺序输出，符合 React Flow v12 约束。

---

## [1.4.0] — 2026-05-17

### Changed · 优化
- **分叉节点端子数量改为手动确认机制**：标签从「端子」→「**端子数量**」
  - 「自动（按段数）」选项后面新增 **▶ 生成 (N)** 按钮：用户点了才把当前段数固化为端子数；切出的段数和已生成端子数不一致时，按钮变成 **↻ 重新生成 (N)**（橙色高亮）
  - 「手动（固定 N）」依然是数字输入框
  - 解决"上游 LLM 输出抖动 → 端子数跳变 → 下游边乱接"的问题
  - 新增 `data.autoCommittedCount` 字段持久化已生成的端子数（跟着画布一起保存）

- **Group 支持多层嵌套**：
  - 现在可以选中"已有 group + 其他独立节点"做 Group → 生成更大的外层 group，**内层 group 的边界、▶ 局部运行按钮、子节点全部保留**
  - 多个 group 也可以一起被封装成更大的 group（合并工作流的关键能力）
  - **保护规则**：选中"已经在某个 group 里的子节点"时禁止 Group（避免把内层结构拆碎）；菜单项变灰，hover 显示「不能把已在 group 内的子节点单独再分组」
  - 包围盒计算正确处理 group 节点（取 width/height/style 而不是默认尺寸）

---

## [1.3.0] — 2026-05-17

### Added · 新增
- **🔀 分叉节点（SplitterNode）**：把上游一段文本切成 N 段，每段对应一个独立的右侧输出端子
  - **切分模式**：自动（识别 JSON 数组 / 编号 / 列表 / 段落） / JSON 数组 / 编号列表（1./2./3.） / 无序列表（- /  *） / 自定义分隔符 / 正则
  - **端子模式**：自动（按段数动态生成） / 手动（固定 N 个，多余丢弃，不足留空）
  - 节点 UI 实时预览前 5 段（每段截前 60 字），手动模式下段数 ≠ 端子数时显示 ⚠ 警告徽标
  - 端子 hover tooltip 显示该段前 50 字，方便连线时识别
  - **跨厂商兼容**：自动剥外层 ` ```json / ```markdown ` 包装

### Changed · 优化
- **执行器路由**：`results` Map 现在支持按 `${source}__${sourceHandle}` 取值，不影响普通节点（无 sourceHandle 时回退到 `source` 单值）。这是分叉节点能从不同 handle 送不同内容的关键
- 同一框架未来可让其它"多输出端子"节点（如 timeline / condition）受益

---

## [1.2.3] — 2026-05-17

### Changed · 优化
- **提示词节点输入框尺寸记忆**：双击重新进入编辑态时，textarea **不再回到默认 80px**：
  1. 用户上一次手动拉伸过的高度优先（持久化在 `data.editorHeight`，会跟着画布草稿一起保存）
  2. 没有手动拉伸过时，自动用预览态 div 的当前高度（视觉上完全无跳变）
  3. 兜底 80px
- 用户拖动 textarea 右下角 resize 手柄时（onMouseUp）实时把新尺寸写入 store

---

## [1.2.2] — 2026-05-17

### Fixed · 修复
- **网页输出顶部出现多余的 ` ```html ` 标记**：LLM 经常把整篇内容用 ` ```html `（或 ` ```markdown `）代码块包裹，导致渲染出网页时顶部出现一段误打的代码块。修复方式：
  - 新增 `stripOuterFence()`，只在整段内容**恰好**就是一个代码块时剥外层（中间穿插的代码块仍正常渲染）
  - 根据外层语言提示（`html` / `markdown` / 无）选择 HTML 直渲或 markdown 转换
- LLM 节点对下游 web 格式的提示明确加上「**不要把整篇内容用 ` ```html ` 或 ` ```markdown ` 包裹**」

---

## [1.2.1] — 2026-05-17

### Added · 新增
- **输出节点新增「网页（浏览器打开）」格式**：把 Markdown / HTML / 纯文本智能渲染成完整网页，在新标签页打开
  - 选择 `web` 格式后，按钮文字从 `⬇️ 下载` 变成 `🌐 浏览器打开`
  - 自带亮色 / 暗色双主题、合理排版样式（中文字体兜底）
  - 自带 mini Markdown→HTML 转换（不依赖第三方库），支持：标题、列表、表格、引用、代码块、粗体/斜体、链接、图片、分割线
  - 兼容已是完整 HTML 文档的输出（直接渲染）
  - 中文「分类：v1、v2」格式自动转 H3 + 项目符号列表
- **LLM 节点根据下游 web 格式自动追加 Markdown 输出提示**，引导模型用合适的格式产出，渲染效果最佳

---

## [1.2.0] — 2026-05-16

### Added · 新增
- **⏱ 时间轴节点（TimelineNode）**：可拖入画布的横向时间轴控件
  - 默认 15 秒、30 fps、宽度约等于 8 个提示词节点并排
  - **fps 可选**：60 / 30 / 24 / 12，或自定义任意值（1–240）
  - **时间显示模式**：秒（1.20s）/ 帧（36f）/ SMPTE 时间码（HH:MM:SS:FF）三选一
  - **拉伸模式**：「等比改时长」（拉宽=变长）或「总时长不变」（拉宽=刻度变密）
  - **左侧 1 个 target 输入**：自动从上游文本里识别 `0:03` / `7s` / `12 秒` / `frame 200` 等时间标记，生成镜头切换点
  - **右侧 N 个 source**：每个切换点对应一个 source handle，竖排均匀分布
  - **轨道交互**：点空白处添加切换点，点切换点上的 × 删除
  - 通过 `window.__pmRunGroup`-like 模式与执行器集成；执行后输出"切换点列表"字符串供下游消费

### Changed · 优化
- **Excel 输出（xlsx）大幅改进**：现在能正确识别中文常见的「分类：值1、值2、值3」格式
  - 例如 `战力描述：万夫不当、威震华夏、…\n内在修为：…\n后人传颂：…` → 3 行 7 列，标题在第 1 列，每个形容词独立 cell
  - 同时支持：JSON 对象数组 / JSON 二维数组 / **JSON 单层对象**（key→array） / Markdown 表格 / CSV / TSV
  - **自动剥** ` ```json ... ``` ` 代码块包装
- **DOCX 输出**：识别"标题：v1、v2、v3"的中文行式分类，渲染成 H3 + 项目符号列表
- **LLM 节点智能格式提示**：当下游 Output 节点格式为 `xlsx` 时，自动在 system prompt 中提示模型用 JSON 数组返回（不带代码块），保证 Excel 行/列识别可靠
  - 同样也适用于下游为 `json` 格式

### Fixed · 修复
- **画布顶部「▶️ 运行」按钮失效**：`onClick={executeFlow}` 把 React 鼠标事件传给了 `executeFlow(subsetIds?)`，导致 `subsetIds.has(...)` 抛错；改为 `onClick={() => executeFlow()}`。group 内的局部运行（▶ 按钮）不受影响，原本就传的是 Set。

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
