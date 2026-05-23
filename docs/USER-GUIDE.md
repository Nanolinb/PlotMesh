# PlotMesh 用户指南 · 高级用法

## 总控画布模式（v1.7 P2-A）

### 这是什么
一种**多画布协调**的用法约定，不是独立功能。底层依赖 v1.7 的"跨画布引用 (Cross-Canvas Reference)"——`crossOutput` / `crossInput` 两个新节点。

### 适用场景
- **项目管理**：一个总画布派任务到多个子画布；子画布跑完结果自动汇总回总画布
- **子系统隔离调试**：某个子流程在独立画布上验证完整再接到主画布，**主画布不用每次重跑整条链**
- **状态监控**：总画布看到 crossInput 节点的 status（waiting / received）就知道哪个子任务在跑/堵了
- **避免巨型画布**：单画布啥都做体感能用，但子系统不能并行验证；多画布协调把这个问题解决了

### 节点
- **🌐 crossOutput**（投出方）：把上游内容投递到另一个画布的 crossInput
- **🌐 crossInput**（接收方）：接收远端 crossOutput 的回写；source 字段（来自哪里）由 server 自动填，readonly

### "我在等结果"开关（核心交互）
**这是 P2-A 的精髓**：

- **同画布内** crossOutput → crossInput **有连线** = "我在等结果，远端跑完自动继续我这边"
  - server 检测到这条边 → crossOutput 投出去后**自动 cascade 触发**远端画布运行
  - 远端跑完 → crossOutput 写到本画布 crossInput → 本画布继续跑下游
- **没连线** = "我只是把数据丢出去，你那边什么时候跑、跑不跑我不管"
  - 适合调试 / 手动闭环 / 架构里的"开关"

类比：连了线就是"我在等你电话"，没连就是"我把任务给你，你自己决定何时做"。

### 配置流程
1. **A 画布上加 `crossOutput` 节点** → 双击或点节点上的"配置目标画布 →"
2. 弹窗里**选目标画布 B**
3. 关联方式：
   - 🆕 **自动新建**（默认）：server 在 B 上自动 create 一个 crossInput，关系自动建立
   - 🔗 **接收已有**：选 B 上某个未关联的 crossInput
4. 确认后：A 上的 crossOutput 显示 `🌐 → 画布B / 节点Y`；B 上对应的 crossInput 显示 `🌐 ← 画布A / 节点X`（不可改）
5. 配反向通道：B 跑完结果回到 A → 在 B 上加 `crossOutput`，目标选 A 上某个空的 crossInput；同样自动配对

### 总控画布搭建模板
**A = 主画布**
```
[textPrompt 任务参数] → [crossOutput 派任务给B] → [crossInput 等结果B] → [next]
                       └──── 这条边就是"我在等"开关 ────┘
```
**B = 子画布**
```
[crossInput 接收A任务] → [子流程节点 ...] → [crossOutput 回报A]
```

### 状态监控
A 画布上：
- `crossOutput` 节点显示**最近一次投出**（output 字段）
- `crossInput` 节点显示**最近一次收到**（text 字段 + 时间戳 receivedAt）+ 状态：⏳ 等待 / ✓ 已接收
- 如果 crossInput 长时间是 ⏳ → 子画布堵在哪里了（去 B 画布看节点 status）

### 多对多 / 一对多场景
跨画布层面的关联**永远是 1 对 1**。多对多通过画布内连边组合实现：
- **一份任务派给多人** → A 上加多个 crossOutput，每个投到不同画布；它们的上游连同一个 textPrompt
- **多个子任务汇总** → A 上加多个 crossInput，分别接 B/C/D 的回报；它们的下游连同一个汇总节点（textTransform / LLM 等）

### 循环检测
A.crossOutput → B → C → A 形成环时，server 会按 traceDepth 计数，**超过 10 层深度自动停止**（防无限触发）。

### 解除关联
- 在 crossInput 节点上点 "🔗 解除关联"
- 解除后：crossInput 的 source 字段清空、status 回到 waiting
- 远端 crossOutput 上的 target 字段也同步清空

### 已知限制
- v1.7 第一版：每个 crossOutput 只能投一个目标画布。要"投多画布"用户建多个 crossOutput
- 多源汇入 crossInput 在跨画布层面不存在（每个 crossInput 只能由一条 connection 写入）；要在画布内用边连接组合
- 触发链路全靠 server runner，**断网时跨画布不工作**（前端 ▶️ 跑到 crossOutput 时也走 server）

---

## 其他高级用法（待补）

- 分叉节点 + LLM 多版本对比
- Splitter 自动派生 OutputNode 链（v1.6.0）
- 输入模式切换（鼠标 / 触摸板）
- 远端访问开关 + Docker 部署（v1.6.3）
- 一键 NAS 部署脚本（v1.6.4）
