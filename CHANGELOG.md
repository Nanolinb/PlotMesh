# Changelog · 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 与
[Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [1.5.3] — 2026-05-20

> 围绕"画布对接外部世界"做了一组体验补强：新增 Web 链接输入节点（含腾讯文档智能识别）、输出节点新增"输出到腾讯文档"、API 配置新增 Kimi/Qwen、LLM 节点新增自定义版本号字段。同时修复 Sidebar 两个 bug 与夜晚模式右键菜单字色看不清问题。

### Added · 新增

- **Web 链接输入节点（`WebLinkNode`）**：把外部 URL 当画布输入源（wiki / 在线文档 / 新闻）。
  - 单 source handle 源节点；URL 双击编辑、抓取一次后写入 `fetchedText` 供下游 LLM 消费
  - 抓取走 `POST /api/web-fetch`（避免 token 进 URL 日志），32KB 截断 + 标签剥离
  - **腾讯文档智能分支**：URL 是 `docs.qq.com` 时自动改走 MCP `get_content`（兜底 `smartcanvas.read` 分页读取），UI 露出 password 风格的 token 输入框（双击编辑、4****4 显示）
  - 抓取来源徽章：MCP 路径在节点上显示蓝色 `MCP` 标签
- **输出到腾讯文档（OutputNode 新格式）**：选择 `tencentDocs` 格式后填 token + 标题，运行画布即创建一份新文档；UI 展示最后一次导出的链接 + fileId + 时间。
  - 后端走腾讯文档 OpenAPI MCP 真实协议：`POST https://docs.qq.com/openapi/mcp` + JSON-RPC 2.0 + 工具 `create_smartcanvas_by_mdx`
- **API 配置新增 Kimi (Moonshot) 和通义千问 (Qwen)**：两家都走 OpenAI 兼容协议，前端 `MODEL_OPTIONS` 加 2 项；后端 `MODEL_CONFIG` 加 2 项；`ApiKeyConfigModal` 加 KEY_HINTS（链到 platform.moonshot.cn / bailian.console.aliyun.com）
- **LLM 节点自定义版本号字段（`customModelName`）**：模型选择下方多一行可选输入框，placeholder 显示该厂商默认版本（`deepseek-chat / qwen-plus / moonshot-v1-8k` 等）；
  - 留空 → 用厂商默认版本号
  - 填值 → server chat 路由直接用该值替换默认 `modelName`
  - 副产品：DeepSeek 现已支持 `deepseek-v4-pro / deepseek-v4-flash`，无须改代码即可切到新版

### Fixed · 修复

- **Sidebar 分组删除**：分组右上角的 `×` 按钮现在真的删除分组（之前只是把分组下的包脱钩到"未分组"）；删空分组直接消失。
- **Sidebar 包"…"菜单**：包的右上角 `…` 菜单现在含「删除此包」选项（带二次确认）。
- **腾讯文档导出"调用失败"**：之前用了猜的 endpoint（`/mcp/v1/tools/...`）和 `Bearer` 头格式。改成真实协议 `https://docs.qq.com/openapi/mcp` + JSON-RPC 2.0 + Authorization 直接是 token（不带 Bearer）+ 参数名 `mdx`（不是 content）。已通过 server 实测创建多份文档验证。
- **夜晚模式右键菜单字色看不清**：根因是 `Canvas.tsx` 行内 style 用了 `var(--surface, #fff)` 等不存在的 CSS 变量，浏览器永远走白色 fallback；dark 主题 `--text-primary` 是浅灰，浅灰字 + 白底 → 看不见。在 `App.css` 末尾加 `[data-theme='dark'] .context-menu` 规则用 `!important` 覆盖背景/文字/边框/分隔线，白天模式不写规则零影响。

### Changed · 优化

- `server/src/routes/webFetch.js` 重写为双通道（腾讯文档 MCP / 普通 axios.get），新增 `extractTencentDocsFileId` 智能提取 `?_fid=` 或 path 末段。
- `client/src/types/nodes.ts` 加：
  - `WebLinkNodeData.tencentDocsToken? / fetchedSource?`
  - `LLMNodeData.customModelName?`
  - `OutputFormat` 加 `'tencentDocs'`，`OutputNodeData.tencentDocs` 子结构
  - `ModelType` 加 `'kimi' | 'qwen'`
- 经验沉淀进 MEMORY：项目里行内 style 一律用真实存在的变量（`--bg-card / --text-primary / --border-color` 等），**禁用** 编造的 `--surface / --border / --primary / --bg`。

---

## [1.5.2] — 2026-05-19

> 把同步从"整盘覆盖"升级为"实体级三向合并"。同一账户下双浏览器分别编辑不同画布的场景从"必弹窗强迫覆盖一边"变成"自动并集，零打扰"；只有真正同 ID 画布两边都改了才弹窗，且每条画布独立决策。同时引入软删除 + 30 天回收站底座，删除从此可跨浏览器同步且可恢复。

### Added · 新增

- **三向合并核心**：新增 `client/src/store/syncMerge.ts`。
  - 用 `meta:last-synced-base`（id→updatedAt 映射 + version）作为同步基线
  - 按实体类型分类合并：
    - canvas 同 ID 都改 → 真冲突（每条画布独立决策）
    - canvas 不同 ID → 直接并集
    - package / packageGroup / workspace / project 同 ID 都改 → 取 updatedAt 较新一方
    - 双方都软删 → 自动取较新（不算冲突）
  - 边界处理：首次同步无 base 时双方同 ID 实体按 updatedAt 较新一方处理（不算冲突）
- **合并报告弹窗**：新增 `client/src/components/MergeReportDialog.tsx`。
  - 顶部"自动合并清单"（X 项变更，知情即可）
  - 中部"需要决策的画布"列表，每条画布独立 3 选 1：保留本地 / 保留远端 / 都保留（远端版以新 id「(远端版)」副本形式追加）
  - 必须为所有冲突画布做完决策才能继续
- **软删除底座**：`types/db.ts` 的 BaseEntity 加 `deleted?: boolean` + `deletedAt?: number`。
  - `storage.listCanvases()` / `listPackages()` / `listPackageGroups()` 默认过滤 deleted=true
  - 新增 `listDeletedCanvases()` / `softDeleteCanvas()` / `restoreCanvas()` / `softDeletePackage()`
  - 新增 `purgeOldDeleted(retentionDays=30)`：启动时清理 deletedAt 超 30 天的实体
  - `nodes.ts` 的 `deleteCanvasById` 改走软删 + 触发远端推送
  - `replaceAllPackages` / `replaceAllPackageGroups` 修正：仅替换活实体，保留 deleted=true 的留在回收站
- **同步基线管理**：syncAdapter 新增 `getSyncBase / setSyncBase / planSync / applyMerged / buildBaseFromMerged`。
  - `dumpLocalSnapshot` 现在直接从 IDB 全量读（含 deleted 实体），让删除通过同步 propagate
  - `applyMerged` 单事务清空 + 重写所有 store；保留浏览器本地 meta；active-canvas-id 兜底（指向已删/不存在的画布时自动跳到第一张活画布）

### Changed · 优化

- **App.tsx 启动 gate** 从"整盘 hash 比对 + 三选一弹窗"重写为"三向合并 + 仅真冲突弹窗"。
- 老 `<SyncConflictDialog>` 文件保留作为兜底（暂未使用），后续可清理。
- meta 中新增 `last-synced-base` 加入浏览器本地 key 白名单（不参与同步）。

### Fixed · 修复

- 同账户双浏览器各自加不同画布的场景从"必弹窗 + 选谁覆盖谁就丢一边数据"变成"零打扰自动并集"。
- 删除操作从此能跨浏览器同步（之前删了画布另一浏览器仍能看到）。

### Internal · 内部

- 浏览器内单元测试 mergeSnapshots 8 个边界 case 全过：
  - 加不同 ID / 同 ID 都改冲突 / 一方改一方没改 / 软删 vs 编辑 / 双方都软删 / 首次同步无 base / 同 ID 包都改取较新 / 混合新增
- Playwright 端到端 4 项验证全过：
  - 干净启动不弹窗
  - 双浏览器加不同画布 → 自动合并不弹窗（核心目标）
  - 双浏览器同 ID 画布都改 → 弹窗，仅冲突那条出现在列表
  - 选「都保留」→ 远端版以「(远端版)」副本入列；同步基线记下，下次启动不再弹

### v2.0 兼容性承诺

- 升级路径不变：v2.0-α 启动时检测到 `<DATA_DIR>/store.json` → 创建第一个本地账号 → mv 到 `users/<uid>/store.json`，零数据损失。
- `last-synced-base` 是浏览器本地状态，每个浏览器独立，不参与共享，v2.0 升级不影响。

### 已知遗留

- 回收站 UI 暂未做（计划批 4：CanvasManager 抽屉里加一个"🗑 回收站"区，列出 deleted=true 画布 + 恢复 / 彻底删除按钮）；当前回收站只能通过 `softDeleteCanvas / restoreCanvas` API 操作，UI 上删了就是删了。
- "较新"判定遗留同 v1.5.1：基于 updatedAt，hydrate 写盘会刷新本地 updatedAt。

---

## [1.5.1] — 2026-05-19

> 跨浏览器画布同步（共享盘模式）。同一台机器的多个浏览器（Edge / Chrome / Firefox）从此共享同一份画布数据；启动时若本地与共享盘内容不一致会弹出对比对话框，由用户决定以哪一侧为准。本期为 v2.0-α 后端账号系统的雏形——只是少了"用户身份"那一层。

### Added · 新增

- **server 端 sync 路由**：新增 `server/src/routes/sync.js` + `server/src/utils/storePath.js`。
  - `GET /api/sync/meta` 返回轻量元数据（`{ exists, version, updatedAt, hash, summary }`），前端启动时拿来比对本地 hash。
  - `GET /api/sync/snapshot` 返回完整快照；不存在返 `null`。
  - `PUT /api/sync/snapshot` 接收 `{ lastKnownVersion, payload, summary }`，version 不一致返 409 + 当前 meta；一致则原子写盘（先写 `.tmp` 再 rename）+ version+1。
  - 数据目录默认 `~/.plotmesh/`，支持 `PLOTMESH_DATA_DIR` 环境变量覆盖（可指向 iCloud / Dropbox / OneDrive 同步盘间接获得跨设备同步）。
- **client 端同步适配层**：新增 `client/src/store/syncAdapter.ts`。
  - `dumpLocalSnapshot()` 把 IDB 全部内容打包成 SnapshotPayload，**剔除浏览器本地状态**（`canvas.lastOpenedAt / thumbnail / viewport` + meta 中的 `active-canvas-id / presets-injected / migrated-from-ls / ls-backup / last-sync-decision / last-synced-hash`）。
  - `computeLocalSummary()` 计算稳定 hash（SHA-1 hex 前 16 位），hash 算法**剥离 updatedAt 和节点上的 React Flow 渲染时字段**（`measured / selected / dragging / resizing`），server 端用同样规则保持算法一致。
  - `applyRemoteSnapshot(payload)` 单事务清空 + 重写所有 store；保留浏览器本地 meta（active-canvas-id 等）；远端不存在 active-canvas-id 对应的 canvas 时自动指向第一条，避免 hydrate 凭空新建空白画布污染下次同步。
  - `pushSnapshot(lastKnownVersion, payload, summary)` 推本地到远端，409 时返 `{ ok: false, conflict: true, current }` 让 UI 走冲突弹窗。
- **启动 gate 改造**：`App.tsx` 增加 `checking-sync` 阶段。
  - server 不可用 / 远端无数据 / hash 一致 → 直接进入 hydrate（不阻塞、不弹窗）。
  - hash 不一致 → 阻塞渲染，弹出冲突对话框等待用户决策。
- **冲突弹窗**：新增 `client/src/components/SyncConflictDialog.tsx`。
  - 双列对比：上次保存时间 / 画布数 / 节点总数 / 大小，更新时间较新的一侧加 `← 较新` 标记 + 推荐按钮高亮。
  - 三个按钮：「使用共享目录覆盖本地」「用本地覆盖共享目录」「本次不同步，稍后处理」。
  - 选定后写 `meta:last-sync-decision` 记录决策（含双方 hash + 时间），便于排查。
- **写后异步推送（防抖）**：`store/nodes.ts` 的 `flushActiveCanvasToIDB` 写完 IDB 后调用 `scheduleRemoteSync()`（2s 防抖），用户连续编辑时只推最后一次。
  - `skip_this_session` 期间不推送；`pushSnapshot` 收 409 时不打断本地操作，下次启动仍会通过 hash 比对兜底处理。

### Changed · 优化

- **网关请求都走 server**：vite proxy 配置已支持 `/api/sync/*`，无需额外配置（沿用 v1.0 的 LLM 网关 proxy）。
- **CHANGELOG 路径**：本次新增 `server/src/utils/storePath.js`，构成"数据访问层"骨架，未来 v2.0-α 加用户身份时只需扩展为 `users/<uid>/store.json`。

### Fixed · 修复

- 解决"Edge 编辑画布 → Chrome 看不到"的根本原因（IndexedDB 按"浏览器 + profile + origin"三维隔离）。

### Internal · 内部

- 端到端验证：5 项 Playwright 自动化测试用例全过——
  - 干净状态启动不弹窗
  - server 不可用降级
  - 用本地覆盖远端 + reload 不再弹窗
  - 选 skip 后本次会话不推送
  - 模拟另一浏览器较新 → 弹窗显示"远端较新"
- 并发 PUT 用 `lastKnownVersion` 校验 + 409 返回当前 meta，前端拿到 409 会再走一次冲突弹窗。

### v2.0 兼容性承诺

- 当前数据布局：`<DATA_DIR>/store.json`（单用户）。
- v2.0-α 升级路径：检测到 `<DATA_DIR>/store.json` 存在 → 自动创建第一个本地账号 → `mv` 到 `users/<uid>/store.json`，零数据损失。
- store.json 顶层格式预留 `ownerHint` 字段，v2.0 直接填实际 uid 即可，不破协议。

### 已知遗留（不影响主功能）

- "较新"判定基于实体的 `updatedAt`，hydrate 写盘会刷新本地 updatedAt，可能让本地标记为"较新"即使实际内容旧。后续考虑用 server 时间戳作为权威来源。

---

## [1.5.0] — 2026-05-18

> 多画布管理（D1 + D2 + D3 三步合并发布）。把单画布 + LocalStorage 时代的 PlotMesh 升级为 IndexedDB 多画布工作台：可同时管理任意张画布、左侧抽屉里随时切换、顶栏显示并支持双击重命名当前画布。底层从 LS 完全迁移到 IDB，老用户首次启动会一次性把现有画布和常用功能搬迁过去。

### Added · 新增

- **IndexedDB 数据底座（D1）**：新建 `client/src/store/db.ts`、`storage.ts`、`migration.ts`、`types/db.ts`。
  - 数据库 `plotmesh` 共 6 个 store：`workspaces / projects / canvases / packages / packageGroups / meta`。
  - `canvases` 主键 `id`，含 `name / nodes / edges / createdAt / updatedAt / lastOpenedAt / projectId / workspaceId` 字段；按 `lastOpenedAt` 索引以支持"最近画布"查询。
  - `meta` 表存 schema 版本、当前 `activeCanvasId / activeProjectId / activeWorkspaceId`、迁移完成标记等单值。
  - 老 LocalStorage（`workflow-state` / `plotmesh-recent-canvases-v1` / `plotmesh-packages` / `plotmesh-package-groups`）启动时一次性搬入 IDB，写入 `meta.migration_done` 后不再回搬。
- **启动 gate（D2）**：`App.tsx` 改为 `migrate → hydrateNodeStore → render`，在数据就绪前显示加载占位，避免 store 与 IDB 之间出现"先渲染后回填"的闪烁/丢节点问题。
- **画布管理器抽屉（D3）**：新增 `components/CanvasManager.tsx`（左侧 320px 抽屉 + 遮罩层）。
  - 列表按 `lastOpenedAt` 倒序展示所有画布，搜索框支持按名称过滤；自动排除带 `recent-` 前缀的快照型条目（与"最近画布"快照解耦）。
  - 每行：● 当前 active 标记、画布名（行内可双击重命名进入编辑态）、节点数 + 最后打开时间 meta、行内 ✎ 重命名 / ✕ 删除按钮。
  - Header 提供「＋ 新建画布」与「✕ 关闭」；Footer 显示总数。
- **顶栏 Tab Bar（D3）**：在 `Canvas.tsx` 工具栏开头插入 ≡（打开抽屉）+ 受控的"当前画布名"标签 + ＋（创建新画布）+ 分隔条。
  - 当前画布名支持**双击切换为 input 进入重命名**，Enter 提交、Escape 取消、blur 自动提交（带 `data-testid="active-canvas-name"`，方便自动化测试）。
- **Store 新增 6 个 D3 actions**（`store/nodes.ts`）：
  - `switchActiveCanvas(id)`：flush 当前画布 → 拉取目标画布（不存在则建空白）→ 更新 `lastOpenedAt` → 替换 store 的 `nodes/edges`，并清空 `history/future`。
  - `createNewCanvas(name?)`：先 flush 当前 → 生成 `canvas-{ts36}-{rnd}` id → 默认名 `画布 MM/dd HH:mm` → putCanvas + setMeta，并把 store 切到空画布。
  - `renameActiveCanvas(name)`：写库时使用 store 当前内容（`stripRuntimeFields(cur.nodes) + cur.edges`），避免误用 IDB 旧快照覆盖未刷盘的内存修改；同时 clearPendingFlush + 刷新最近列表。
  - `renameCanvasById(id, name)`：active 画布走 `renameActiveCanvas`，其它画布直接读改写一次 IDB。
  - `deleteCanvasById(id)`：删除指定画布；若是当前 active，自动按 `lastOpenedAt` 切到最近一张，没有则新建空白。
  - `refreshRecentCanvases()`：读取 `listRecentCanvasesIDB`，排除当前 active，取前 8 张写入 store 的 `recentCanvases`。

### Changed · 优化

- **store/nodes.ts 全面异步化**：`saveStateToLS / loadStateFromLS / restoreCanvasFromLS / pushHistory` 等函数改走 `storage.ts`（IDB），所有保存动作改成 async + putCanvas。
- **新增 `activeCanvasName` store 字段**：`hydrateNodeStore()` 启动时从 IDB Canvas 读取并同步到 store；新建空白 active 时也会同步写一份。
- **pending-flush 兜底（沿用自 D2）**：把 store 内存里"未刷盘"的 nodes/edges 临时写入 LS，App 启动 hydrate 完成后再倒灌回 IDB，覆盖关闭浏览器/刷新等极端场景下的数据丢失风险。

### Fixed · 修复

- **重命名当前画布时丢节点**：`renameActiveCanvas` 早期实现是 `existing?.nodes || stripRuntimeFields(cur.nodes)`，会用 IDB 上一次刷盘的节点覆盖 store 内存里更新过但未刷盘的节点。改为始终用 store 当前 `cur.nodes / cur.edges` 写盘，并 `clearPendingFlush()`。

### Internal · 内部

- 抽屉组件订阅 `useNodeStore` 取 `activeCanvasId / activeCanvasName / recentCanvases`，对外通过 `open / onClose` 受控；切换/新建画布后自动 `onClose`，避免操作完后还要再点一次空白处。
- 顶栏受控 input 的 React 受控特性导致 Playwright 直接 `fill` 难以触发 onChange，验证脚本改成直接调 store action（`renameActiveCanvas`）来跑功能测试，UI 层只校验 dblclick 后能切换到 input。
- TypeScript `tsc --noEmit`：0 报错。

### Verified · 验证（Playwright，6/6 通过）

| # | 场景 | 期望 | 实际 |
|---|---|---|---|
| 1 | CRUD + 切换 + 隔离 | 画布 A/B 节点互不污染，删 B 后自动回 A | ✅ |
| 2 | 刷新后 active 持久化 | reload 后 `activeCanvasId / Name / nodes` 完整还原 | ✅ |
| 3 | 抽屉「＋ 新画布」 | 创建 + 自动 `onClose` + store 切到新画布 | ✅ |
| 4 | 抽屉点击非 active 行 | 切换到目标画布 + 自动 `onClose` | ✅ |
| 5 | `renameActiveCanvas` action | 同步更新 store + 顶栏 DOM 文本 | ✅ |
| 6 | 二次 reload | 上一步重命名 + 节点完整保留 | ✅ |

---

## [1.4.4] — 2026-05-17

### Fixed · 修复
- **分叉节点端子数变化后视觉位置与连线锚点错位**：当 `autoCommittedCount` 变化时，React Flow 内部缓存的 handle DOM 位置没刷新，导致新增/减少的端子在画面上显示在 A 位置但连线实际连到 B 位置。修复：在端子数变化的 `useEffect` 中调用 `useUpdateNodeInternals(id)` 通知 React Flow 重新读取 handle 位置。

### Changed · 优化
- **「端子数量」改名为「输出端子数量」**，并改成与「切分模式」一致的"标签在上、控件在下"两行排版（之前是单行 label + select + 数字/按钮，挤在一起），视觉层级更清晰。

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
