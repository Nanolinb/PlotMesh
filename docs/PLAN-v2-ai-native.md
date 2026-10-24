# PlotMesh v2.0 设计稿 — AI 原生画布

> 版本：v1.0（2026-05-27 正式立项）
> 状态：**已立项**，按 Phase A→B→C 顺序推进
> 前置：v1.7 收尾（文件夹实测 + 跨画布引用回归 + 正式版 push GitHub tag），1-2 天
> 起手第一刀：Phase A 步 1（AuthProvider + users 表 + 双模架构）

## 0. 总目标

把 PlotMesh 从 **"用户手画 + AI 出数据"** 升级为 **"AI 主动建结构 + 人审"** 的协作画布。

两个独立但相互成就的能力：

| 议题 | 一句话 |
|---|---|
| **议题 1 — 画布内 AI 节点** | AI 节点能 emit 新节点/连线/补丁，画布会"长出来"，不只输出数据 |
| **议题 2 — 跨用户 AI PM** | 同一 server 下多人协作时，AI 监听画布、推消息、派任务、给建议 |

**关键洞察**：议题 2 的高阶能力（主动建议）= 议题 1（emit）× 议题 2（用户/通知地基）。
所以**先把 emit 做扎实，PM 是它的应用场景**，不要并行开两条线。

---

## 0.1 与产品文档第 7 章的关系（必读）

本设计稿**不是替代**产品文档第 7 章《v2.0 产品规划：协作画布》，而是在其地基上叠加"AI 主动生成结构 + AI PM"这层能力。对齐表：

| 能力 | 第 7 章原规划 | 本稿增量 | 类型 |
|---|---|---|---|
| 用户身份 | v2.0-α AuthProvider（builtin 邮箱+密码）双模架构 | 直接复用，token→userId 复用 builtin AuthProvider | 继承 |
| 画布归属 | v2.0-α 多人协作同一 server | 直接复用，在 canvases 加 ownerId / sharedWith[] | 继承 |
| 画布间数据传输 | 5.2 + 10.6 跨画布引用（crossOutput↔crossInput connections）已实现 | 本稿不动，AI 节点只在本画布内 emit；AI PM 跨画布走现有 cascade 通道 | 继承 |
| 画布边界 + 单人操作语义 | 现行"画布为单位的单人操作 + 三向合并"完全保留 | AI emit 也只动本用户本画布，不跨边界；dry-run 预览仅本人可见 | 继承 |
| Reference 合约保护 | v2.0-β pending/accepted/rejected/cancelled 状态机 | AI 节点 emit 的 patches 若改动跨人 Reference，必须走同一状态机 | 继承 |
| 主题节点（样式+定调） | 7.x 设计师样式 × 管理者定调合并 | AI 节点 emit 读取当前主题节点作为上下文约束之一 | 继承 |
| Flex Pool / PM 调度面板 | v2.0 正式 三层人员 + PM 可见并发数 | AI PM（议题 2）是其智能化升级：PM 节点在同一面板下跑，产出走 inbox | 继承 + 增量 |
| AI 节点 emit 能力 | 原规划中未提及 | 本稿首次提出 ai-builder、EmitPlan、dry-run 审批、commit 撤销 | 新增 |
| AI PM（跨用户信息推送） | 原规划中未提及 | 本稿首次提出 L1-L4 分层、inbox 表、SSE inbox channel、@提及 | 新增 |
| 7.7.2 协作铁律 10 条 | 现行 | AI 节点生成的节点 + AI PM 推送的任务都遵守同一套铁律（特别是"不能跨边界动他人节点"） | 调整：约束范围扩充 |
| CRDT 级实时协同 | v2.0 不做 | 本稿也不做（保持同步） | 范围外 |

**一句话**：第 7 章是"多人协作的画布"，本稿是"让 AI 也成为协作者之一"。地基（身份 / 归属 / Reference / 主题节点 / Flex Pool）完全复用；增量只是 emit 契约 + inbox 表。

---

## 1. 议题 1 — 画布内 AI 节点（结构生成器）

### 1.1 节点契约

新增节点类型：`ai-builder`（暂定名）。

```ts
interface AIBuilderNodeData extends BaseNodeData {
  kind: 'ai-builder'
  prompt: string                    // 用户对 AI 的指令
  contextScope: 'upstream' | 'canvas' | 'selection'
  llm: LLMConfig                    // 复用 ExtractNode 的多模型选择
  pendingEmit?: EmitPlan            // dry-run 产出，待用户确认
  appliedAt?: number                // 已应用的时间戳（commit 标记）
}

interface EmitPlan {
  commitId: string                  // 一次 emit 一个 commit，撤销以此为单位
  nodes: PartialNode[]              // 要新建的节点
  edges: PartialEdge[]              // 要新建的连线
  patches: NodePatch[]              // 对现有节点的修改 { nodeId, dataDiff }
  rationale: string                 // AI 的解释，给用户看
  confidence: number                // 0–1，影响是否需要二次确认
}
```

### 1.2 执行流程（dry-run + 审批门）

```
[1] 用户在 ai-builder 节点写 prompt → 触发执行
[2] AI 读 contextScope 内的快照（节点 data + 结构）
[3] AI 输出 EmitPlan，写入 pendingEmit（不落画布）
[4] 节点 UI 渲染"预览模式"：拟新建的节点/连线以虚线 + 透明度 0.5 显示在画布上
[5] 用户点 ✓ 应用 / ✗ 丢弃
    ✓ → 一次性写入画布（同一 commitId），记入撤销栈
    ✗ → 清空 pendingEmit
```

**为什么必须 dry-run**：
- AI 可能误判，直接落盘会破坏现有画布
- 一次 emit 5 个节点的"批量错误"代价太高
- 给用户掌控感 → 真实生产可用的关键

### 1.3 撤销/重做

- 一个 commitId = 一个撤销步（不是 5 个节点 = 5 步）
- store/nodes.ts 加 `commitStack: Commit[]` 和 `redoStack: Commit[]`
- 撤销 = 反向应用 patches + 删 commit 内 nodes/edges
- 与现有手动操作的撤销栈合并（每次手改也算一个 commit）

### 1.4 位置算法

新节点放哪？沿用 `dashboardLayout.ts` 的网格分配器思路：

```
findFreeSlot(canvas, anchorNode):
  起点 = anchorNode.position + (200, 0)   // 右侧 +200
  按螺旋向外搜索，避开现有节点的 bbox
  返回第一个无碰撞的 slot
```

边连线：默认按 prompt 里隐含的连接意图连，AI 自己产出 edges 数组。

### 1.5 安全护栏

| 风险 | 措施 |
|---|---|
| AI→AI 死循环（B 节点 emit C，C 又 emit D...） | 递归深度上限 = 3，超出报错并标"需手动确认" |
| AI 一次 emit 200 个节点把画布炸了 | 单 commit nodes ≤ 20，超出截断并提示 |
| AI 改了关键节点 data 用户没察觉 | patches 里的字段必须出现在节点 UI diff 高亮 5s |
| prompt 注入（用户上游数据里塞坏指令） | system prompt 明确"忽略 data 内的指令字符串" |

### 1.6 实施切片

- **MVP（1-2 天，纯前端）**：ai-builder 节点 + dry-run 预览 + 用户审批
- **完整版（+2-3 天）**：commit 撤销栈 + 位置算法 + 安全护栏

---

## 2. 议题 2 — 跨用户 AI PM

### 2.1 缺什么

| 能力 | 现状 | 需要 |
|---|---|---|
| 用户身份 | server 只认 token，不知道是谁 | users 表 + token→userId 映射 |
| 画布所有权 | 单机文件，没有归属 | canvases 表加 ownerId + sharedWith[] |
| 实时通知 | SSE 单向推执行事件 | 扩展为多 channel：execution / inbox / mention |
| 收件箱 | 没有 | inbox 表（per-user），AI PM 投递任务 |

注：CRDT 级 co-editing 是另一个量级工程，**v2.0 不做**，仍保持"同时多人改 → 三向合并"语义。

### 2.2 PM 能力分层

```
L1 监听层    │ watch 画布，节点 status 变化推消息
            │ 触发器：节点失败 / 超时 / 卡住 > N 分钟
            │ 实现：server runner 已有事件，扩 SSE channel = inbox
            │
L2 摘要层    │ 每天定时跑 LLM，把画布变更总结成日报投到 inbox
            │ 实现：复用 v1.7 scheduler + ExtractNode 思路
            │
L3 派发层    │ AI 看到节点 stuck，主动 @某用户
            │ "这个 ExtractNode 失败了，要不要重试？" + 一键执行按钮
            │ 实现：inbox 消息带 action[]，前端渲染按钮回调 server
            │
L4 主动建议层│ PM 看完整画布结构，提出"这里建议加个缓存节点"
            │ 实现 = 议题 1 的 ai-builder 在 server 端定时跑 + 写入 inbox
```

### 2.3 数据模型（最小）

```sql
-- server 端 SQLite/JSON-store
users          (id, name, email, color, createdAt)
canvas_owners  (canvasId, ownerId, role: owner|editor|viewer)
inbox          (id, userId, kind, title, body, action[], readAt, createdAt)
mentions       (id, fromUser, toUser, canvasId, nodeId, message, readAt)
```

### 2.4 前端组件

- **顶部 Bell 图标**：未读数徽标，点开抽屉显示 inbox
- **Inbox Item**：标题 + 来源（哪个画布哪个节点）+ 操作按钮
- **协作者头像条**：画布右上角显示当前在线用户头像（轮询 + SSE presence）

### 2.5 实施切片

- **地基（1-2 天）**：users 表 + token→userId + 画布 ownerId
- **L1（1-2 天）**：inbox 表 + SSE inbox channel + Bell UI
- **L2（1 天）**：日报定时任务（复用 scheduler）
- **L3（2 天）**：消息带 action + 前端按钮回调
- **L4（依赖议题 1）**：server 跑 ai-builder，结果走 inbox

### 2.6 总控画布 + Admin 角色（关联脑洞，2026-06-01 记录）

这三块是**同一份数据流分析的不同出口**，强关联，统一在此记录，落地排在 Phase C（和 AI PM 一体两面）：

#### A. 总控画布（Dashboard Canvas）
- **定位**：团队协作某个项目时，项目 **owner** 处可启用的一张"俯瞰图"画布，聚合该项目下所有子画布的运行状态、节点进度、跨画布引用依赖流，一眼看出"哪里堵车"。
- **权限模型**：owner 启用后，可把**只读查看权限**分享出去（复用步 2 sharedWith[]，但标记为 view-only）；owner 自己能在总控画布上做**宏观调节 + 主动推送**（如一键给某画布所有协作者发提醒）。
- **数据来源全现成**：server runner 有每节点 status/耗时；`connections`（步 3 合约）有跨画布依赖图；inbox 有失败事件。缺的只是**聚合视图层**。
- **与 AI PM 一体两面**：总控画布 = "人看的俯瞰图"；AI PM（L1-L4）= "AI 看同一份数据后主动 @人"。同源数据，两个出口。

#### B. Admin 角色 + 后台 ✅（2026-06-01 已实现）
- **现状缺口**：目前 users 平权，只有"画布 owner"，没有"系统 admin"。server-config（auth.required / allowSelfRegister / remoteAccess）只能改 env 或本机 curl，无 UI。
- **极简方案**（符合"不做权限矩阵"原则）：users.json 加 `role: 'admin' | 'member'`；**第一个注册者自动 admin**（bootstrapMode 那位 = 开服者，零配置；env 可覆盖）。
- **后台入口**：不做独立页，复用「API 配置弹窗」加 "管理" tab（仅 admin 可见）：列用户 / 开关自助注册 / 看 connectionsArchive 审计流水 / 重置他人密码。
- **层级关系**：admin（系统级，管 server）⊃ 项目 owner（项目级，管总控画布 + 成员）⊃ member（参与者）。
- **实现状态（2026-06-01 ✅）**：
  - 后端：usersStore 加 role（第一个注册者/PLOTMESH_ADMIN_EMAIL→admin，含老数据 normalizeRoles 兼容）；JWT+middleware 带 role；requireAdmin 中间件；usersStore 加 deleteUser/adminResetPassword/setUserRole/countAdmins（禁删/降级最后一个 admin、禁删自己）；auth.js 加 `GET /admin/users`、`DELETE /admin/users/:id`、`PATCH /admin/users/:id/reset-password|/role`
  - 前端：`AdminPanel.tsx`（用户列表 + 删除/重置密码弹窗/角色切换）；`ApiKeyConfigModal` 加"👥 成员管理"tab（仅 `useAuth().user.role==='admin'` 可见）
  - 实测：admin 见 tab + 列用户 + 重置 Bob 密码后 Bob 用新密码登录成功；member 访问 admin 接口 403、看不到 tab；admin 删自己 400
  - **待后续**：看 connectionsArchive 审计流水、server-config 开关（自助注册/远端访问）也搬进此 tab ✅（2026-06-02 已完成：AdminPanel 拆 👤成员/⚙️server设置/📜引用审计 三子区）

#### C. @提及卷入项目团队
- 在一个项目下成立的团队，**@某成员** 不只是发消息——要**把对方卷入这个项目的协作上下文**：自动给被 @者授予相关画布的查看权限（若还没有）、在其 inbox 落一条带"跳转到该画布/节点"action 的 mention 消息、并让其出现在该项目的协作者列表/总控画布在线条里。
- 复用：步 2 inbox(kind=mention) + SSE mention channel + 步 3 sharedWith 授权链路。
- 这是 L3（派发层）的自然延伸：AI PM 派任务 @人 与 人 @人 走同一套"卷入"逻辑。

---

## 3. 推进顺序（2026-05-27 正式立项，按"底座先行 + 最大复用"重排）

> 旧顺序（议题 1 优先）已废弃。理由：议题 1 的 emit 必须依赖身份/归属/Reference 才能保证"不跨边界"，所以底座必须先做。

### Phase A · 协作底座（v2.0-α）

| 步 | 内容 | 周期 | 复用 / 产出 |
|---|---|---|---|
| 1 | AuthProvider 接口抽象 + users 表 + builtin 邮箱密码 + 双模架构（离线全功能 / 联网解锁协作） | 2-3 天 | 复用现有 token 鉴权；users 给后面 2-7 全用 |
| 2 | 画布归属 + 通信底座：canvases.ownerId / sharedWith[] + SSE 多 channel（execution / inbox / mention / presence）+ inbox 表 + Bell UI | 2-3 天 | 复用步 1 users；inbox channel 给步 5-7；ownerId 给步 3-6 |

**Phase A 验收**：注册 → 建画布 → 共享给他人 → 离线模式仍可用 → Bell 收到他人执行通知。

### Phase B · 合约 + 主题（v2.0-β）

| 步 | 内容 | 周期 | 复用 / 产出 |
|---|---|---|---|
| 3 ✅ | Reference 合约状态机（active/pending/accepted/rejected/cancelled）+ 跨用户握手 + CancellationRecord 永久审计（connectionsArchive）+ 前端审批 UI | 2 天 | 复用步 1 users + 步 2 ownerId/inbox/SSE；状态机给步 4 主题节点跨人引用 + 步 5/6 emit patches |
| 4 ✅ | 主题节点（样式 + 定调合并）+ Slot 语义端口 + 成品聚合节点（PPT/PDF） | 3-4 天 | 复用步 3 Reference；Slot 给步 5/6 emit 识别可改边界 |

**步 4 实现状态（2026-06-01 主题节点 MVP；2026-06-12 成品聚合节点完成 → 步 4 全部 ✅）**：
- 决策：作用机制=**连线广播**；第一刀=主题节点 MVP；导出=先复用 exporters，PPT/PDF 后续接 skill
- `themeNode` 节点：role='tone'(定调:基调/受众/禁忌词) | 'style'(样式:配色/字体/版式) | 'merged'(读上游 tone+style 边实时合成有效主题，只读)
- `utils/themeMerge.ts`：computeEffectiveTheme 沿入边合并（支持链式 merged 递归一层防环）；themeToSummary 序列化
- 广播：Canvas useEffect 监听 nodes/edges，merged 沿出边注入下游子节点 data.appliedTheme（变化才写防循环）；OutputNode/LLMNode 显示「🎨 主题」chip
- 注册 5 处：Canvas import+nodeTypes+getDefaultData、Sidebar（新增"主题"分类）、server NODE_TYPES_SCHEMA
- 浏览器实测：tone+style→merged 合并2上游 → merged→output 广播 appliedTheme="专业严谨·科技紫/无衬线" → 断连自动清除 ✓
- **成品聚合节点（2026-06-12 ✅）**：`AggregateNode.tsx`（type=`aggregate`）—— 把多个上游输出**按 promptNumber 升序**聚成"章节"（每个上游=1章节，用上游 label 作章节标题），导出 PPT/PDF/DOCX/Markdown/网页
  - 导出器（`utils/exporters.ts` 新增）：`exportAsPptx`（pptxgenjs，封面+每章一页幻灯，标题条+要点项目符号）/ `exportSectionsAsDocx`（每章 H1+正文）/ `exportSectionsAsPdf`（每章一页，jsPDF 中文受限）/ `sectionsToMarkdown` / 复用 `openAsWeb`；`parseSections` 用 `SECTION_DELIM='<<<PLOTMESH_SECTION>>>'` 还原章节（兼容无分隔符时按 Markdown H1/H2 切）
  - executeFlow `aggregate` 分支：按编号顺序收集各上游、剥文件前缀、上游 label 作标题、SECTION_DELIM 串接；写 output + sectionCount
  - 依赖：新增 `pptxgenjs@4.0.1`（vite 动态 import 单独 code-split 成 pptxgen.es chunk，不进主包）
  - 注册 5 处齐全；EMITTABLE_TYPES 加 aggregate（AI 构建器可生成）
  - 验证：tsc 通过 / vite build 通过（pptxgen 独立 chunk）/ parseSections 3 用例单测 PASS / server types 含 aggregate

**步 3 实现状态（2026-06-01，✅ 后端 + 前端全通）**：
- 后端：`referenceContract.js` 状态机 + `crossCanvas.js` 投递门 + `canvas.js` 握手路由（accept/reject/cancel/pending）+ inbox(kind=reference)/SSE 联动。21 项端到端断言通过
- 前端：`InboxDrawer.tsx` reference 消息「接受/拒绝」按钮接通（调 accept/reject 路由 + 标已读）；`CrossInputNode.tsx` pending 态视觉（黄色虚线 + "⏳ 待对方确认"）+ 解除关联改走 cancel（留审计）。所有组件修正了不存在的 CSS 变量，dark 模式适配
- 浏览器实测：Bob 登录 → inbox 见「Alice 引用请求 + 接受/拒绝」→ 点接受 → 后端 status: propose→accept、decidedAt 记录 ✓

**Phase B 验收**：A 用户向 B 发 Reference → B 接受 → A 撤销走握手 → 主题节点驱动子节点 → Slot 接成品聚合 → 导出 PPT/PDF。

### Phase C · 智能化（v2.0 正式）

| 步 | 内容 | 周期 | 复用 / 产出 |
|---|---|---|---|
| 5 ✅ | AI 节点 emit MVP：ai-builder + dry-run 预览 + 单次 commit | 1-2 天 | 复用步 1 users + 步 2 ownerId + 步 3 Reference + 步 4 主题节点；emit 不跨边界；契约给步 6/7 |
| 6 ✅ | AI 节点 emit 完整版：ghost 半透明预览 + 显式 Slot 端口 + Flex Pool 三层人员 + PM 调度面板 | 3 天 | 复用步 5 emit；Flex Pool 给步 7 PM 调度 |
| 7 ✅ | AI PM：L1 stuck/失败 → inbox 重试 / L2 日报 / L3 @提及卷入 / L4 主动建议 + Flex Pool 调度面板 | 2-3 天 | 复用步 6 完整 emit + 步 2 inbox；为 v3.0 Art Bible 打基础 |

**步 6 实现状态（2026-06-02，✅ ghost 预览 + Slot 端口；Flex Pool 待后续）**：
- ghost 半透明预览：`GhostNode.tsx`（虚线 + 透明度 0.72）；Canvas useMemo 把所有 preview 态 aiBuilder 的 pendingEmit 算成临时 ghost 节点/边（不进 store），合并进 `displayNodes/displayEdges` 传给 ReactFlow；应用后 ghost 自动消失
- 显式 Slot 端口：节点 data 可声明 `slots: string[]`（可被 AI patch 的字段边界）；`aiEmit.getNodeSlots()` 优先用节点 slots，未声明回退全局 PATCHABLE_FIELDS；`sanitizeEmitPlan(plan, existingNodes)` 按目标节点的 Slot 边界过滤 patch；collectContext 把 slots 暴露给 LLM
- 浏览器实测：preview → 画布出现 2 个 ghost 节点（react-flow__node-ghostNode）→ slot 护栏拦截越界字段（tp-1 slots=['label']，AI 想改 status 被拦）→ 应用后 ghost 消失 + 真实节点落盘 + label 改成功 status 不变
- **已知小限制**：React Flow v12 受控模式批量加节点+边时，两端都是新节点的边渲染有测量时序延迟（数据正确，刷新即显）；ghost 边同理。不影响 ghost 节点核心价值

**Flex Pool + 总控画布实现状态（2026-06-05，✅ 完成）**：
- **Flex Pool 三层人员**：画布从 `ownerId + sharedWith[]` 升级为 `flexPool: [{userId, role, joinedAt}]`，role 取值 `owner/admin/editor/viewer`；`migrateToFlexPool()` 自动迁移旧数据（ownerId→owner，sharedWith→editor）；同步维护 `sharedWith` 向后兼容
- 后端 API（`routes/dashboard.js`）：
  - `GET /api/dashboard/overview` → 项目级聚合（按 ownerId 分组），含子画布运行状态、跨画布依赖图、堵车预警、成员池
  - `GET /api/dashboard/project/:ownerId` → 单项目详细总控数据
  - `GET /api/dashboard/canvas/:id/flex-pool` → 读取画布 Flex Pool（丰富用户名/色/邮箱）
  - `PATCH /api/dashboard/canvas/:id/flex-pool` → 加人/改角色（action=add/setRole，支持邮箱查用户）
  - `DELETE /api/dashboard/canvas/:id/flex-pool/:userId` → 移除成员（不能移 owner）
  - `POST /api/dashboard/broadcast` → owner 一键广播给项目成员（投 inbox kind=mention）
  - `POST /api/dashboard/batch-retry` → owner 批量重试失败画布
- 前端组件：
  - `DashboardView.tsx`：项目总控面板，俯瞰视图（画布状态色标/堵车预警/跨画布依赖）+ Flex Pool 视图（成员角色色标）；宏观操作（📢提醒全员/🔄批量重试）
  - Canvas 顶栏 `📊` 入口按钮 → 侧滑面板打开 DashboardView
  - `AdminPanel.tsx` 增加「📊 Flex Pool」子区：按项目分组管理成员（添加/移除/改角色）
- 数据来源全现成：runner runStore（运行状态）、connections（跨画布依赖图）、inbox（失败事件），缺的只是聚合视图层
- 验证：进程内 API 测试全通（认领画布→overview聚合4画布→flex-pool读取owner角色→广播sent=0/排除自己→batch-retry触发运行）

**Flex Pool 模型校正与人员卷入第一版（2026-07-20）**：
- `project.flexPool` 是唯一的项目人员候选池；画布不是 Pool 成员。旧 `canvas.flexPool` 仅作为过渡期画布 ACL 兼容字段，不再出现在人员池产品语义中。
- 新增 server-authoritative `assignments[]`：跨画布输出可从当前项目人员池指定成员；成员通过 Inbox 接受或拒绝。接受前不创建画布、不授权、不建立可执行连接。
- 接受后原子创建/授权下游画布、生成 CrossInput 和已接受的跨画布连接，并以 `parentCanvasId/sourceAssignmentId` 记录工作层级；跨画布 connection 仍只表示数据依赖。
- 系统管理员、项目 Owner/Admin 可查看项目全部画布；普通需求画布 Owner 可递归查看由 accepted Assignment 产生的所有下游画布；执行成员只看到直接授权及其下游。
- 候选排序第一版只使用可解释的相对负载：已接受且进行中的分配、正在运行的目标画布、待确认请求。任务擅长度保留显式能力标签和空评分，数据不足时不参与排序。
- 总控增加“向下协作链路”，人员池显示活跃/待确认负载；成员或项目管理者可标记分配完成，以释放负载。
- 同步保护 `assignments`、Assignment 创建的 server-only 画布及源 CrossOutput 的接受/拒绝终态，避免旧客户端快照回写覆盖。

**步 7 实现状态（2026-06-02，✅ L1+L2；L3/L4 待后续）**：
- L1 监听层：`pmNotify.notifyRunResult(run)` —— runCanvasJob 失败时给画布 owner 投 kind=execution inbox（带「重试运行」action）+ SSE 实时推送；成功不打扰、无主画布不发
- L2 摘要层：`pmNotify.notifyDailyDigest(canvasId, llmCall, {runs})` + `pmDigestScheduler.js`（每天 09:00 定时，对所有有主画布调 LLM 总结近期 run 投 kind=daily inbox；LLM 失败有兜底 summary；无 run 不发）
- 前端：InboxDrawer 接 execution 的 `retry-canvas`（调 /:id/run）+ daily 的 `open-canvas`（switchActiveCanvas）；kind 图标 ⚠️/📊/🔗 区分
- 注入：index.js 启动时 setPmBroadcaster(broadcastInbox) + startPmDigest({digestHour:9})；env PLOTMESH_PM_DIGEST_HOUR 可调
- 验证：进程内 8 项断言（失败投/成功不打扰/无主不发/重试action/日报LLM总结/无变更不发）全过；浏览器实测 owner 登录 → Bell 见失败通知+重试按钮+日报+打开按钮 → 点重试真调 /run API + 标已处理
- **L3 @提及卷入（2026-06-02 ✅）**：`pmNotify.notifyMention({canvasId,nodeId,fromUser,toUserId,message})` —— 自动 share 画布给对方（若未 share）+ 投 kind=mention inbox（带跳转 action）+ SSE 推送；`POST /api/canvas/:id/mention`（toUserId 或 toEmail）；前端 `MentionDialog.tsx`（选成员/留言）+ `MentionButton.tsx`（顶栏 @ 入口，仅登录态）。验证：进程内 share+mention 链路通；浏览器 Alice @ Bob → cv-a 自动 share + Bob inbox 收到「Alice 在『营销文案』@了你」带跳转
- **L4 主动建议（2026-06-02 ✅）**：`pmSuggest.js` —— 规则启发式（analyzeCanvasStructure：llm-no-downstream/crossoutput-no-target/isolated-node/no-output-node）+ 可选 LLM 润色 → 投 kind=suggestion inbox 给 owner（带「查看节点」action）；指纹去重（canvasId+ruleId+nodeId，7天窗口）；并入 pmDigestScheduler 同一日报轮触发。验证：进程内检测 3 问题→投 3 建议→去重重跑投 0
- 前端 InboxDrawer kind 图标全套：⚠️execution / 📊daily / 🔗reference / 💬mention / 💡suggestion；mention/suggestion 的 open-canvas action 复用已有 handler
- **待后续**：总控画布更细粒度的 macro 操作（如宏观调节节点参数、AI PM 在总控内嵌入调度卡片）

**管理面板增强（2026-06-02，✅ 完成）**：
- AdminPanel 拆三子区：👤 成员（原功能）/ ⚙️ server 设置 / 📜 引用审计
- server 设置：联网模式(auth.required) / 自助注册(allowSelfRegister) / 远端访问(remoteAccess) 三个 toggle，改后按字段提示是否需重启（required/remoteAccess 需重启，allowSelfRegister 即时生效）
- 引用审计：读 connectionsArchive，展示 rejected/cancelled 的跨画布引用历史（画布名 + 状态 + 流转 + 原因）
- 后端：serverConfig.updateServerConfig 改深合并 auth；auth.js 加 `GET/PATCH /admin/server-config`、`GET /admin/audit`（均 requireAdmin）
- 验证：server-config 读/改即时生效、restartRequired 分级正确；audit 读到归档记录；浏览器三子区 UI 全渲染

**步 5 实现状态（2026-06-01，✅ AI emit MVP 完成）**：
- `aiBuilder` 节点：prompt + contextScope(upstream|canvas|selection) + model；状态机 idle→running→preview→applied/error
- `utils/aiEmit.ts`：buildEmitSystemPrompt（要求输出 EmitPlan JSON + 防 prompt 注入）/ collectContext（按 scope 收集快照）/ parseEmitPlan（容错剥 markdown）/ sanitizeEmitPlan（护栏：≤20 节点、类型白名单 EMITTABLE_TYPES、patches 字段白名单 PATCHABLE_FIELDS=slot 边界）/ assignPositions（findFreeSlot 不重叠）
- `AIBuilderNode.tsx`：调 /api/llm/chat 产 EmitPlan → dry-run 预览栏（方案+置信度+节点清单）→ ✓应用/✗丢弃。应用走 pushHistory + 单 commit 落盘（tmpId→realId 映射、边重连、patches 改现有节点），emit 节点带 __emittedBy/__commitId 标记
- 注册 4 处：Canvas import+nodeTypes+getDefaultData、Sidebar 新增"AI"分类、server NODE_TYPES_SCHEMA
- 浏览器实测（mock LLM）：生成→status=preview+3节点→应用→落盘4节点+2边+位置不重叠+同commit→undo 一次性撤回整批 ✓
- **MVP 简化点（步 6 补全）**：ghost 虚线预览暂只在节点内列清单（未在画布上画半透明节点）；Slot 用 PATCHABLE_FIELDS 白名单近似（未做显式 Slot 端口）；emit 节点不自动执行（防递归）

**Phase C 验收**：ai-builder dry-run 预览 → 一键应用 → 可撤销 → 服务端 PM 节点定时跑 → stuck 检测 @某人 → 被 @者 inbox 收到动作按钮。

### Phase D · 多人协作生产闭环（v2.0 协作模式收口，2026-07-19 立项）

> 当前客户端和服务端均已声明 `2.0.0`。本阶段不另起一套工作流系统，也暂不升级 GitHub 版本号；先在本地完成、由用户试用验收，再决定补丁版本及提交推送。

#### D1. 统一画布与 Workflow Template

- Workflow Template 与普通画布使用**同一 Canvas schema、同一编辑器、同一节点/连线和执行器**。
- 三种创建来源最终生成同一种可编辑画布：人工创建、模板实例化、MCP/Codex/AI 外部创建。
- 模板草稿和实例画布默认始终可编辑，不冻结整个画布。
- 需要不可变的对象仅限：已发布模板版本、阶段回传快照、审计快照、外部自动化批量修改前快照。
- 第一版数据模型：`kind: 'canvas' | 'template'`；实例记录 `sourceTemplateId/sourceTemplateUpdatedAt`；未来再增加发布版本和参数槽位。
- AI 可以匹配已有模板或生成候选画布，必须先预览并由人工确认；尽量复用现有 AI Builder emit 与 MCP 画布控制能力。

#### D2. 分配驱动的最小权限

- 工作时人员身份来源不影响流程语义；内部、外包或外部团队统一视为被分配的用户/团队。
- 分配到节点后自动派生最小权限：查看必要输入与状态、编辑/执行被分配范围、提交结果、接收相关通知。
- 审批、回传、分配人员、查看项目总览等权限单独控制，不因普通任务分配自动获得。
- 跨画布默认只暴露回传节点明确提供的数据、资产引用与状态，不自动开放完整上游画布。
- 取消分配时回收派生权限，保留人工额外授权；MCP/Codex/AI 使用独立 service identity 和受限 scope。
- 后续规划 `HumanResourceProvider`，只读接入外部人力系统的人员、团队、能力、可用性和负载；人员卷入仍由 Owner/管理者决定。
- 第一版人员入口已支持“系统已注册用户”下拉与姓名/邮箱关键词搜索，并保留按邮箱添加；候选接口返回 `source/provider`，未来 HR/花名册接入沿用同一候选协议，不改变项目 Flex Pool 和 Assignment 语义。
- 2026-07-20 已创建“商业化插图生产 · 多人协作案例”：创意总控将商业策划、视觉草图、主视觉精修、元素拆分、多尺寸适配五阶段分别 Assignment 给三个测试成员，成员接受后生成五张下游画布；每张包含阶段职责、专业参考、LLM 执行清单、交付输出和 Owner 手动回传门。

#### D3. AI PM：参谋与助理

- **AI 参谋**：识别需求、匹配模板、分析关系、推荐可询问人员、提示风险和阻塞；不自动派人、不承诺工期。
- **AI 助理**：按人工确认的预设创建/调整画布、填充模板槽位、整理状态与摘要；只执行已授权操作并保留修改来源。
- Inbox 从单纯通知升级为决策卡片：查看依据、询问人员、邀请加入、换一批建议、暂不处理。

#### D4. Owner 门控回传与反馈循环

- 一张被接收并启动的画布对应一个需求；节点完成或画布执行成功不等于阶段结束。
- 阶段结束以画布 Owner **手动连接回传节点并执行回传**为准。
- 状态链：工作中 → 准备回传 → 已回传/等待反馈 → 收到反馈后继续修改 → 再次回传 → 上游验收。
- 下游只向上游传播状态和明确结果，不自动关闭上游。
- 反馈可来自画布、IM、电话或现场沟通；第一版提供“记录反馈”入口，不要求先打通所有沟通工具。

#### D5. 历史与可恢复性

- 使用规范：修改方案时优先打断旧连线并保留历史节点，不立即删除，以便后续接回旧方案。
- 第一版补充文本输入节点和 LLM 节点的版本历史：输入、模型、参数、输出、运行时间及恢复操作。
- 每次阶段回传自动生成画布快照；后续增加差异比较、历史分支折叠/归档和旧分支恢复。

#### D6. 个人入口、管理者视图与外部接口

- 一张激活画布对应一个需求；个人通过顶部画布页签、Inbox 推送和画布内定位管理当前任务。
- 个人只看到与自己相关且权限允许的数据关联、回传节点和状态；不另造一套个人画布。
- 管理者视图由 Template 或 PM 配置，第一版聚焦：总人员投入、时间、阶段状态、阻塞、资产产出与资产进度。
- PlotMesh 不录入工资、外包合同、采购等财务数据；有需要时通过外部 `CostProvider` 计算。
- 资产仍由 Git/Perforce 等系统管理；PlotMesh 记录仓库/depot、branch/stream、commit/changelist、路径、版本和对应画布节点。
- 规划统一 Provider：`HumanResourceProvider`、`KnowledgeProvider`、`AssetProvider`、`CostProvider`。
- WebLink 只负责单 URL / 单文档采集，不承担“通用知识库入口”。采集范围（正文/全文、刷新策略、采集预算）与 LLM 分析范围（全文预算/关键词片段）必须分离。
- IMA Copilot 等知识库应通过 PlotMesh server 的独立 `KnowledgeProvider` 适配官方 OpenAPI/MCP，并呈现为专门的知识库来源/检索节点；WorkBuddy IMA Skill 只用于开发期验证或人工代理操作，不作为 PlotMesh 产品运行依赖。
- 知识库既可来自内置流程知识，也可接 IMA Copilot 等外部应用；首个演示内置“3D 角色生产流程”知识和模板。

#### D7. MVP 演示闭环与验收

```text
输入 3D 角色需求
→ AI 匹配或生成可编辑模板画布
→ Owner 调整并确认
→ AI 推荐可询问人员
→ Owner 分配并派生最小权限
→ 人员通过页签和 Inbox 进入需求画布执行
→ Owner 手动连接并执行回传
→ 上游反馈，保留历史继续修改
→ 总控展示人、时间和资产进度
```

首批实现顺序：

1. 画布模板标识、另存为模板、模板列表、编辑模板、实例化和来源追踪。
2. 修复画布保存时扩展元数据丢失与同步覆盖风险，确保在线/离线都可用。
3. AI 建图复用、人员推荐与最小权限、Owner 门控回传。
4. 文本/LLM 历史和回传快照。
5. 页签/Inbox/定位交互统一与管理者总控指标。
6. Provider 接口和 3D 角色演示知识；IMA、Git、Perforce、人力系统按接口逐步接入。

**自检要求**：每个切片完成后执行 TypeScript、生产构建和关键流程验证；至少覆盖模板保存/编辑/实例化、权限不继承、在线/离线持久化、跨画布回传、反馈后继续修改和历史恢复。本阶段在用户试用前不提交、不推送 GitHub。

### 总预算

Phase A 4-6 天 + Phase B 5-6 天 + Phase C 6-8 天 = **约 15-20 天**（不含验收调优）；Phase D 按可试用切片推进，演示闭环约 2-3 周，包含可靠权限、历史恢复和协作异常处理的可用收口约 4-6 周单人开发量。

### 立项前置

v2.0 启动前**必须收尾 v1.7**（1-2 天）：
- v1.7.0-alpha.4 文件夹功能实测 + 修剩余 bug
- 跨画布引用 v1.7.0-alpha.2 实战回归
- v1.7 正式版 → push GitHub tag

---

## 4. 不做的事（v2.0 范围外）

- CRDT 级实时协同编辑（保持当前三向合并即可）
- 权限矩阵（暂只 owner / 共享列表）
- 端到端加密（跨用户消息走 server 明文）
- AI 生成的节点自动执行（必须人审 → 人触发）

---

## 5. 风险

| 风险 | 应对 |
|---|---|
| dry-run UI 复杂度高（虚线 + 半透明节点 + 审批栏） | MVP 先做"AI 输出文字方案 + 一键应用"，可视预览 v2.1 |
| 用户身份系统是潘多拉魔盒 | 极简：name + color + token，不做注册/登录页 |
| AI emit 质量不稳定 | 每个内置 prompt 模板（"加缓存""加重试""拆分子任务"）替代自由 prompt |
| 团队反对结构变化（怕 AI 乱改） | 默认 dry-run，永远要点 ✓ 才落盘，从未"自动应用" |

---

## 6. 立项决议（2026-05-27）

- ✅ v2.0 正式立项
- ✅ 推进顺序按"底座先行 + 最大复用"原则重排为 Phase A → B → C（替代旧的议题 1 优先方案）
- ✅ 不跳 v1.7，启动前先收尾 v1.7（1-2 天）
- ✅ 起手第一刀 = Phase A 步 1（AuthProvider builtin + users + 双模架构）
- ✅ AuthProvider 首发仅 builtin 邮箱密码，SSO/Google/LDAP 后续插拔

---

_本设计稿位置：`docs/PLAN-v2-ai-native.md`_
_腾讯在线文档同步：file_id `eBxphkKJfjxw` 第 13 章_
