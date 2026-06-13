# LLM Agent 自管理上下文机制设计方案

> 2026-06-06 增补：新增 **§8 多阶段推理与上下文真相源原则**，是下文 §1–§7（flag/视图机制）的形式化地基，并细化了 §3.3 审计、§6 意图/RAG 工具的现状与边界。把单次 LLM 推理演进为多阶段/嵌套推理时，请以 §8 的原则为准。

## 1. 核心理念

采用**全量存储 + 可操纵视图**模式解决长上下文信息密度问题。模型通过调用工具动态调整每条历史消息的标记（flag），系统根据标记实时派生出两种视图：

- **推理视图 (Agent Context)**：供 LLM 推理使用的上下文
- **用户视图 (User Display)**：呈现给用户的聊天记录

该设计使模型能够自主管理注意力窗口，同时保留完整历史以满足审计、追溯和长尾需求。特别适用于**知识库管理 Agent**，需要长期维护信息一致性和可追溯性。

## 2. 架构总览

系统采用分层架构：底层不可变存储 → 核心上下文服务 → 工具层 → 应用编排层，并辅以多个横切模块。

```
┌────────────────────────────────────────────┐
│              编排层 (Agent 推理循环)         │
│  - 接收用户输入                              │
│  - 调用工具 (经模型路由器)                   │
│  - 更新上下文 → 派生视图 → 生成响应          │
│  - 触发审计与记忆生命周期管理                │
└────────────────────────────────────────────┘
                    ↓ 调用
┌────────────────────────────────────────────┐
│                工具层                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐     │
│  │用户交互  │ │知识库操作│ │审计工具  │     │
│  │工具集    │ │工具集    │ │          │     │
│  └──────────┘ └──────────┘ └──────────┘     │
└────────────────────────────────────────────┘
                    ↓ 写入/读取
┌────────────────────────────────────────────┐
│           上下文管理服务层 (核心)             │
│  - 消息不可变存储 (仅追加与标记修改)         │
│  - 标志管理工具 (单条/批量/带摘要)          │
│  - 视图派生引擎 (按策略生成两种视图)         │
│  - 自动保护规则引擎 (关键消息不可隐藏)       │
└────────────────────────────────────────────┘
                    ↓ 持久化
┌────────────────────────────────────────────┐
│              存储层 (全量历史)                │
│ 消息: id, role, content, timestamp, flags   │
│       (如 {active, pinned, summarized,      │
│              hidden, canonical, deprecated}) │
└────────────────────────────────────────────┘
```

横向支撑模块：

- **模型路由器 / 任务分级调度器**：根据操作风险与复杂度将工具调用分发到不同规模/成本的模型
- **审计与一致性守护模块**：独立后台任务，复核标记决策，检测知识库冲突
- **用户反馈与覆写接口**：接收前端指令，允许用户手动调整标记，提供变更日志
- **记忆生命周期管理器**：定时触发整理、摘要、清理过期标记

## 3. 关键机制详解

### 3.1 标志系统

每条消息维护一个标志字段（JSON），常用标志：

| 标志 | 含义 | 派生影响 |
|------|------|----------|
| `active` | 当前活跃，进入推理视图 | 包含在 agent_context 中 |
| `hidden` | 内部隐藏，不出现在用户视图 | 推理视图可配置是否包含 |
| `summarized` | 已生成摘要，原文可折叠 | 推理时用摘要替代原文（节省token），用户视图可展开 |
| `pinned` | 置顶保留，不受自动清理影响 | 始终置顶于视图 |
| `background` | 背景信息，低优先级 | 低优先级处理，不主动展示 |

以及知识库专用标志（见第5节）。

**标志管理原则**：
- 所有操作仅修改标志，从不物理删除消息
- 模型通过专用工具执行标记变更，并可附带简要理由
- 支持批量操作（如“将最近10条无关消息标记为background”）

### 3.2 视图派生引擎

从同一份全量存储根据标志实时生成两种视图：

- **推理视图**：选取 `active == true` 的消息；对于 `summarized` 消息使用其摘要文本；可选择性包含 `hidden` 消息（如系统内部推理链）。动态注入当前标志状态提示，让模型知晓哪些历史已被激活。
- **用户视图**：过滤掉 `hidden` 和内部工具调用细节；将部分工具调用结果转换为自然语言说明；对于 `summarized` 消息展示摘要并提供“查看原文”入口。

派生逻辑集中管理，便于测试和调试。开发者可启用“完整日志模式”查看未被过滤的全量信息。

### 3.3 审计与一致性守护

为避免标志错误导致关键信息丢失，引入独立的审计机制：

- **审计模型**：使用专门 prompt（可与执行模型相同的大模型，但仅在必要时调用），输入完整上下文和待审批的标记变更提案，输出 `approve / reject / modify`。
- **执行模式**：
  - **软实时审计**：低风险操作（如标记背景）直接执行，异步入队审计；高风险操作（隐藏知识条目、设置 deprecated）同步等待审计结果。
  - **事后审计**：由记忆生命周期管理器定期触发，大模型回溯近期变更，自动修复明显错误标记。
- **知识关键度辅助**：入库时评估条目的关键度（1-5），高关键度条目默认禁止隐藏，变更需强制审计。
- **冲突检测**：审计模块定期检查 `contradicts` 关系完整性、`derived_from` 来源有效性。

### 3.4 分层模型调度

根据任务复杂度和风险将标记相关操作路由到不同模型，与自管理上下文机制协同：

- **轻量级操作 → 小型/免费模型**：标记明显重复内容、闲聊归类、批量短期记忆清理
- **重量级决策 → 强模型**：判断技术信息是否过时、生成知识摘要、重组条目结构
- **批量打包**：小模型收集“建议操作”，大模型定期批量审核并执行，兼顾效率与成本

模型路由器作为工具调用的中间层，透明地分配执行资源。

### 3.5 记忆生命周期管理

定时任务或事件触发，维护上下文健康度：

- 检查久未触达的 `active` 消息，建议降级为 `background` 或生成摘要后标记 `summarized`
- 清理冗余 `deprecated` 条目，合并可合并的知识片段
- 根据对话轮次或时间，将旧短期记忆转换为背景摘要
- 触发审计回溯，确保近期标记变更的合理性

## 4. 用户感知与前端协作

系统提供多层可见性，使用户理解和掌控上下文管理过程：

1. **轻提示**：当模型自动隐藏/摘要内容时，在聊天界面给出类似“已整理 3 条历史消息”的提示，点击可展开。
2. **记忆仪表盘**：独立面板展示所有消息的标记状态、标记原因（由模型生成），允许用户手动覆盖标记（如强制保持某条知识为 `active` 并锁定）。
3. **变更日志与回滚**：记录所有标记变更，支持用户查看历史整理记录，并一键回滚到之前状态。
4. **完整历史开关**：高级用户可查看未经过滤的全量上下文，包括内部工具调用和隐藏消息。

用户手动标记操作通过“用户反馈与覆写接口”直接写入上下文管理服务，并与模型自动操作具有同等效力。

## 5. 知识库场景专用标志

针对知识库管理需求，扩展以下标志：

| 标志 | 含义 | 派生与保护规则 |
|------|------|----------------|
| `canonical` | 官方确定的最终答案 | 始终 active，禁止隐藏，不可自动修改，审计时特殊保护 |
| `deprecated` | 信息已过时但保留备查 | 默认不进入推理视图，用户查询历史版本时可恢复 |
| `contradicts` (pointer) | 指向与本条冲突的其他消息ID | 推理时同时展示冲突条目，避免模型被过时信息误导 |
| `derived_from` (pointer) | 摘要/知识条目提取自哪些原始对话 | 用户可顺链追溯原始讨论，增强可信度 |

这些标志使知识更新、冲突管理完全可追溯，并为审计模块提供明确判断依据。

## 6. 工具集划分

### 6.1 用户交互工具
- 分析用户意图（结果可写入上下文标志，如 `intent`）
- 生成/重写面向用户的回复（通过视图引擎输出）
- 请求用户对重要操作确认

### 6.2 知识库操作工具
- RAG 检索并总结（结果写回上下文，标记 `derived_from` 来源）
- 新增知识条目（可同时设 `canonical`、`active` 等标志）
- 标记过时（将旧条目标记为 `deprecated`，同时可生成替代条目）
- 冲突标记（建立 `contradicts` 关联）
- 复杂重组（通过批量标记操作与新增条目组合实现）

### 6.3 上下文管理工具（直接面向模型）
- `update_flag(message_id, changes)` — 单条标记修改
- `bulk_mark_by_topic/filter(criteria, changes)` — 批量操作
- `summarize_and_flag(ids, summary)` — 生成摘要并替换显示，原消息标记 `summarized`
- `pin_message(id)` / `set_canonical(id)` — 语义化快捷操作

## 7. 实施路径建议

1. **基础搭建**：实现全量存储、基础标志（active, hidden, summarized）及视图派生引擎。
2. **开放简单工具**：允许模型调用基本的 `update_flag`，观察行为，收集中高频错误模式。
3. **引入审计雏形**：对高风险操作（隐藏、deprecated）启用独立审计 prompt，验证可行性。
4. **分层模型集成**：接入模型路由器，轻量标记用小型模型，复杂决策用大模型。
5. **前端面板与用户覆写**：构建记忆仪表盘和变更日志，闭合人工干预回路。
6. **记忆生命周期自动化**：部署定时整理与事后审计任务，实现长期无人值守运行。
7. **高级标志与冲突管理**：逐步启用 `canonical`、`contradicts` 等知识库专用特性。

---

该设计以**上下文管理服务**为核心，通过标志系统和视图派生实现模型自主治理，辅以审计、分层调度、用户协同，形成一套适合知识库 Agent 的高可靠、可演进的长期记忆管理方案。

---

## 8. 多阶段推理与上下文真相源原则（2026-06-06 增补）

> 本节是上面 §1–§7「flag 自管理上下文」机制的**形式化地基**。前文回答"视图怎么派生"，本节回答更底层的问题：**什么算原始上下文（真相源），什么算派生逻辑（投影）**——这是把单次 LLM 推理演进为多阶段 / 嵌套推理时必须先钉死的本体论决策（原 `chat.service.ts` `getContextDebug` 里 deferred 的 TODO 即指此）。它同时细化了 §3.3（审计 approve/reject/modify）与 §6（意图分析、RAG 总结写回）的现状与边界。

### 8.1 背景：从单次推理到多阶段推理

当前每个用户回合是**单次 LLM 推理**（RAG 路径 `chat.service.ask` / Agent 路径 `agent.service` 的 ReAct 循环）。为提升质量与可控性，按职能把推理拆成**固定管线里的若干 LLM 驱动 stage**。

关键定性：**这是「分阶段推理」，不是「自主多 agent」**——调用图固定、每 stage 有类型化契约、可单测、可独立降级（真正的自主 agent 只有 `runtime.ts` 那个 ReAct 循环）。三个 stage：

1. **动态 system prompt 组装**（取代"意图分析独立推理"）——按当前上下文确定性地拼装 system，而非静态常量。意图理解收敛进此处，不单设一次推理塞回 prompt。
2. **RAG 相关性过滤**——检索命中后、拼进生成上下文前，用廉价推理做**抽取式**筛选（保留 / 丢弃整段，不改写），防止低相关内容撑爆上下文。注意：检索已有 BGE-reranker 精排（`retrieval.ts`），此 stage 定位为"reranker 抓不住的语义判断"，非重复打分。
3. **写操作合理性判级**（**已实现**，见 §8.5）——增删改前由推理判级，高风险走人工确认。

### 8.2 核心原则：按「确定性」切真相源 / 投影

> **凡 LLM 边界的实际 I/O（含代码生成的输入，如 system prompt）→ 原始事实，产生/发送即落库，永不重算。**
> **凡对「已落库 raw」的呈现重组（投影视图）→ 派生逻辑，不入库，用时（含 debug）由纯函数重算。**

理由：投影引擎（`projection.ts`）的全部价值建立在"派生是纯函数、可重放、结果一致"之上。但"可重算"有个**隐含前提**：内容来源已落库、纯函数只做*呈现选择*（选哪些条目、裁剪、格式化）；这种投影逻辑随版本演进无妨，因为它消费的 raw 不变。

反例正是 **system prompt**：它的内容不源于任何已落库 raw，而是由**会迭代的代码**（模板 + assembler）现场生成。"纯函数"只在*单一代码版本内*成立——用新版代码重建旧轮，同样的 facts 会产出不同的 system，**漂移**。且 system prompt 是发给 LLM 的**实际输入**、是"第 N 轮实际发生的事"的一部分，与 LLM 输出同理不可事后忠实复现。

> ⚠️ 修订（2026-06-06，原"system 不整体入库、靠 assembler 重算"的提法已废）：最初把 system 归为"纯代码组装→可重算"，是错把"会迭代的代码常量"当成了"稳定的纯函数输入"。

推论（system prompt 的可观测性）：

- **system prompt 的实际发送值随轮快照落库**（context_item，`state=internal`，`meta.stage=system`），debug 直接读快照 → 对发送当时忠实，之后改模板也不影响历史轮。**不靠事后重算重建**。
- assembler 仍在请求时**生产** system（消费静态模板 + 已落库事实，如未来的意图摘要——那份 LLM 产出须先落 context_item）；但其产物一经发送即被快照为不可变事实，审计读快照、不再调 assembler。
- 代价：每轮多存几百字的 system（append-only 日志接受这种冗余换忠实，与逐轮存 tool_result 同理）。比"给模板上版本号 + 维护不可变版本表"简单且不易出错（后者一旦忘了 bump 版本就静默漂移）。
- 相关较弱隐患：`llmView`（推理视图）debug 也是重跑投影，投影改版会变；但它漂移的只是*呈现*（选取/裁剪/格式），**内容来源（user/assistant 文本）已落库**，故属合法的"当前投影视图"语义，非"那轮字面发送"。若要连完整发送 payload 都钉死，是另一可选项（逐次 LLM 调用快照整个 messages 数组），范围更大、暂不做。

#### 8.2.1 system 内容按缓存切前缀 / 后缀（2026-06-09 增补）

快照保证了"忠实可观测"，但 system 内容在**消息序里的位置**还有第二重约束：**前缀缓存**。LLM 上下文缓存按"最长公共前缀"匹配——system 是整请求前缀，**其中任何一字节变化使其之后的全部内容（含整段对话历史，最贵的那部分）缓存全失效**。故易变内容塞进 system 前缀，等于每次变化都打掉历史缓存。

按「作用域易变性」切两路放置（`systemPrompt.ts`）：

- **稳定前缀**（`assembleSystemPrompt`，置消息序最前、长期可缓存）：稳定模板 +（仅子 agent）**固定**作用域约束——子 agent 的 ceiling 在 `agentAsTool` 构造时锁死、整 run 不变，属稳定前缀，且语义上是不可逾越的硬边界。
- **易变后缀**（`buildScopeSuffix`，独立 `{role:'system'}` 消息，经 `projectForLlm` 的 `scopeSuffix` 插在历史之后、最新 user 轮之前）：顶层 agent 的**易变**可访问库列表——跨轮可由用户收窄；放后缀使其变化只让小尾部失效、不动历史前缀。recency 上也更靠近问题、注意力更强。

> 两种 agent 想要**相反**的放置位置，而这恰恰正确：易变性相反。子 agent scope 冻结 → 前缀（缓存最优）；顶层 scope 跨轮可变 → 后缀。

实测背书（真 `DEEPSEEK_API_KEY` 打 `api.deepseek.com`）：① DeepSeek **接受非首位 / 末尾 system 消息**（HTTP 200 且 `reasoning_content` 证明模型确实读取）；② 同一长前缀改一次作用域——易变片段在**前缀中间** `prompt_cache_hit=0`（历史缓存全废），在**末尾后缀** `hit≈1536/1643 ≈93%`。**位置决定缓存，与角色无关。**

与 §8.2 快照原则一致：后缀仍是 LLM 实际输入 → 仍随轮快照落库（`state=internal`，但 `meta.stage='scope'`，与前缀的 `stage='system'` 区分）。`getContextDebug` 的 systemView 两条都收并带 `stage` 标签。可观测性不丢，只是拆成两条。

通用推论：**凡跨轮易变的上下文注入，一律放贴最新 user 轮的后缀，勿塞进 system 前缀。**（子 agent 前缀注入当前 dormant/TODO，待注册第二个 agent 再接线。）

### 8.3 使能原语：context_items 的「第三状态」

现状条目只有两种命运：作为 `user`/`assistant`/`tool_result` **流过投影**（会污染 LLM / 用户视图），或像 `agentAsTool` 子 run 那样**整条丢弃**（不可见，见 `agentAsTool.ts` "不落 context_items"）。"全部写入原始上下文"这块基石需要第三种状态：

> **已落库、但被各视图按需排除（persisted-but-view-excluded）。**

实现：新增条目判别（`kind` 扩展或 `meta.role` + `flags`），三个投影函数各自过滤。所有子推理（意图摘要、RAG 过滤决策、安全判级、子 agent 全过程）据此**既留痕于 raw 视图、又不进 LLM / 用户视图**。这是 §8.1 三个 stage 共同的地基，须**先建**。

### 8.4 嵌套推理与 run 树

`agentAsTool` 已支持 agent 调 agent（`MAX_AGENT_DEPTH=3`），但当前：子 run **复用父 runId**（`childCtx = { ...ctx, depth: ctx.depth + 1 }`，runId 未变）、且**不落 context_items**。要在 debug 页重建"agent → 子 agent → 工具"调用树，需要：

- `agent_runs` 加 `parent_run_id`；
- 子 run 分配**独立 runId**（不再复用父）；
- 子 run 过程按 §8.3 第三状态落库。

仅靠 context_items 的 `created_at` 全序重建不出层级关系。

> **✅ 已实现（2026-06-06）**：`agent_runs.parent_run_id`（migration 008）落地；`agentAsTool` 子 run 分配**独立 runId**、记 `parent_run_id`、全过程以第三状态（internal）落库。并据 §8.7 在委派边界做作用域交集（`childCtx.scope = narrow(parentScope, requested)`）。

### 8.5 写操作合理性判级（已实现，本期升级为 audit-and-rewrite）

**已实现（非新建）**：`safetyClassifier.ts` 本身是一次 LLM 推理（standard tier，`object(verdictSchema)` 输出 `{risk: low|high, reason}`，temperature 0）；`mutations.ts` 的 `gate()` 是所有写工具的统一闸口：低风险直接执行；高风险落 `pending_operations`（migration 005）走**跨回合两阶段确认 + 防篡改快照回放（执行回放 pending 快照参数而非本次 args）+ 防同 run 自确认**；fail-safe：模型未配置 / 分类失败一律判 high。

**本期升级（决策 2026-06-06）**：把纯分类器 `{risk}` 升级为**审计-改写 stage（audit-and-rewrite）**，输出结构化决策（替换原 verdict）：

```
{ decision: 'allow' | 'confirm' | 'reject', reason, revised?: { toolName, args } }
```

- **reject（直接拒绝，要求用户手动操作）**：高危操作不提供确认通道，回执要求用户到 UI 手动完成，不建 pending op。
  - 配套铁律——**reject 双来源**：已知灾难性操作（如删非空知识库）由**确定性硬规则（代码）直接 reject**，不依赖 LLM；分类器只做"软 reject"补充。安全边界须确定性、抗注入——**最硬那道闸不交给 LLM 独断**（呼应"LLM 非安全边界"）。
- **modify（改写参数 / 更换函数）**：审计可改写操作参数、甚至换用别的工具（如把"删整库"降级为"删指定文档"）。
  - 配套铁律：① 凡 `revised` 非空，**强制走用户确认，绝不静默自动执行**——用户没见过的改写（尤其"换函数"的语义大变）不能自动落地；② 改写后的操作**不再二次送审**（防审计成环），直接进确认流；③ 原始 op → 改写 op 按 §8.2 落 context_item 留痕。
  - **正名**：加 modify 后本 stage 不再是单纯"安全判官"，而是"审计 + 改写"，命名与心智模型据此对齐。
- **deep context（判官读上下文，性能/效果平衡）**：判官不再只看一行 `describe()`，但**不喂整段会话 + 全文正文**（否则把 §8.1·2 要消灭的"撑爆上下文"请回来）。喂料配方：**确定性事实（廉价 DB 查询：子项数 / 大小 / 可逆性）+ 有界意图（当前用户轮 ±1 轮）+ 目标对象紧凑描述（标题 / 类型 / 规模，非正文全文）**。判官"事实在手"判级，tier 走 nano/light。

verdict 落 context_item 见 §8.3 / PLAN §14.3（第三状态首个试金石）。

### 8.6 落地顺序（建议）

1. **先建使能原语**（§8.3 第三状态 + §8.4 run 树）——三个 stage 都要往里写，地基的地基。
2. **补落安全 verdict**（§8.5）——近零成本堵现有可观测性洞，兼作第三状态的首个验证。
3. **RAG 抽取式过滤**（§8.1·2）——价值最确定、不碰安全语义、可独立验证，作第一个新 stage。
4. **动态 system prompt**（§8.1·1）——原语与原则就位后再做。
5. **安全判级升级为 audit-and-rewrite**（§8.5）——reject（确定性硬规则 + 软分类）/ modify（改写须确认、不二次送审、留痕）/ 有界 deep context。

### 8.7 作用域是 run 的属性：单一 agent + 沿 run 树委派（2026-06-06 增补）

有了动态 system prompt（§8.1·1）后，原"按会话类型分 `knowledge_assistant` / `global_assistant` 两个 agent"的做法已**退役**：两者的差异退化为"散文 + 一个工具开关"，而作用域本就由会话派生、权限由 `assertRole(principal)` 按人校验，与 agent 身份无关。故塌缩为**唯一 agent**（`assistant`），把作用域提为 **run 的属性**。

**模型：作用域 = 沿 run 树委派的能力（capability delegation），单调收窄。** 规则在每个节点都一样：

> 调用方发给你一个**天花板**；你可在天花板内自由选择/收窄，但**永不能自己加宽**；够不着的（超天花板）**显式回报**给调用方。

- `RunContext.scope = { ceiling: 'principal' | string[] }`。`'principal'` = principal 有权访问的全部库；`string[]` = 被收窄到的库集。
- **顶层 agent 必然不绑库**，`ceiling` 恒为 `'principal'`。"限定某库"只发生在**选择器层**（用户在对话中声明 / agent 推理决定查哪个库），天花板纹丝不动。`default`（预选库）不设。
- **数组天花板（硬收窄）只可能经 `agentAsTool` 委派产生**：父 agent 在工具参数里传 `scope`，`childCtx.scope = narrow(parentScope, requested)`（交集，只收窄）。系统里没有第二个数组天花板来源。
- **边界是代码，不是 prompt**：每次触库都过 `inCeiling`（ceiling 成员校验）+ `assertRole`（principal 实权）。`agentAsTool` 委派时父（LLM）给的 `scope` 参数**不可信**——`narrow` 做交集，即便父被注入也无法把超过自身的权限交给子。system prompt 里的作用域措辞只影响**软选择**，不构成隔离。
- **UX**：全局聊天是唯一 agent 入口；要限定某库，用户第一句话声明即可（库内 RAG 单轮已于 §8.8 退役）。

实现：`infra/agent/scope.ts`（`inCeiling` / `narrow` / `outOfScope`，纯函数 + 单测）；四个触库工具（`knowledge_search` / `get_document` / mutations / `list_collections`）按 ceiling 强制。dormant 边界：数组天花板路径只被子 agent 触发，仓库尚未注册第二个 agent，故 B/C 端到端待注册子 agent，顶层 `ceiling:'principal'` 使校验恒真（顶层行为零变化）。

### 8.8 库内 RAG 问答退役 + 全局检索（无 LLM）（2026-06-06 增补）

§8.7 把 agent 塌缩为唯一入口后，库内单轮 RAG 问答（`chat.service.ask`）也失去价值——它与 agent 的差别只是"少一层编排"，而 agent 的 `knowledge_search` 已覆盖同样的检索+引用能力。故**退役库内 RAG 问答**：`chat.service` 收敛为会话 CRUD + 调试，`ask` 整条链路（改写 / 相关性过滤 / 生成 / 引用校验）连同 `retrieval.rewriteQuery`、`RAG_GENERATION_TEMPLATE` 一并删除；会话统一为全局 agent 会话。

腾出的位置由两个职责分明的入口接管：

- **agent**（`/chat`）——需要推理 / 编排 / 多步时用，跨库自主检索作答并标注引用。
- **全局检索**（`/search`，新增）——只想"按相关性找文档"时用。**纯检索、零 LLM 推理**：无查询改写、无相关性过滤、无生成。流水线 = 每库并行混合召回（向量∥全文）→ 库内 RRF → 轮转交错汇成候选池 → **单次 merged rerank 给出跨库次序** → 小到大组装 → **文档级聚合**（保序去重 + `hitCount`）。

判断口径：**rerank 保留**——它是 cross-encoder 相关性模型、是"按相关性"本身的信号，且是跨库可比次序的唯一来源（缺席则回退轮转交错）；被排除的是"生成式/推理式"LLM（改写、过滤、作答）。无会话、无落库。`retrieval.searchGlobal` + `search.service`（跨 `listAccessible` 聚合）+ `POST /search`。

### 8.9 流式传输 = 原始上下文事件日志，投影下沉前端（2026-06-13 增补）

§8.2 把"真相源 / 投影"钉死在**落库 / 重算**两侧，但只覆盖了**静态读取**路径（reload、debug）。`streaming`（SSE）一直是个**漏网的平行实现**：`topLevelAgent.stream` 手工把 `AgentEvent` 重塑成一套有损的 bespoke `AgentStreamEvent`（`reasoning`/`token`/`step_start`/`tool_result`/`citations`/`done`），**绕过投影**，且把子 agent（internal）事件整段 `drain` 丢弃。结果是同一份"用户视图"有**两套派生逻辑**：reload 走 `projectForUser`（纯函数、含子 agent 留痕的全量 raw），live 走手捏的 SSE——两者必然漂移，子 agent 在 live 里彻底不可见。

> **原则推广**：§8.2 的真相源 / 投影分界对**所有**视图路径成立，**streaming 不例外**。流式传输传的是**原始上下文事件日志**（raw context event log），用户视图（及轨迹 / 子 agent 视图）由**前端**对增量到达的 raw 跑投影派生。reload 与 live 的唯一区别是 raw 的**来源**（DB 全量 vs 增量流），投影函数同一份。

**张力：raw 落定在边界上，live 要边界之前的增量。** `context_items` 一行只在回合 / 工具边界才存在（assistant 等本轮带齐 content + toolCalls + `meta.reasoning` 才写，tool_result 等工具返回才写），而 live 体验要的恰是**条目落定之前**的逐 token / reasoning 增量。故"传 raw"的准确含义是传两类事件：

- **item settled**：一个 context 条目诞生 / 落定，携带与**落库完全相同**的字段（`kind` / `runId` / `state` / `meta` / `content` / `citations` / `id`）；
- **open-item patch**：当前未落定条目的增量（`text` delta / `reasoning` delta）。

前端维护一份逐步生长的 raw 模型（已落定条目 + 一个正在累积的 open 条目），对它跑 `projectForUser` 出消息视图、跑一个新投影出轨迹与子 agent 参与方泳道。这是把今天 `streamSteps` / `streamText` / `streamReasoning` 那套**临时累加**升格为有原则的"open item"。

**构造即正确的保证：** `driveAndRecord`（`recordedAgent.ts`）本就是**单一 `AgentEvent` 源**同时喂 recorder（落库）与 SSE mapper（下发）。只要让 wire 格式**镜像 recorder 的每一次写入**，落库与下发即成同一事件流的两个消费者，于是——

> **live 流的顺序 ≡ DB 回放的顺序**（两者都是 recorder 的 append 顺序）。子 agent internal 条目以独立 `runId`、`internal` 态，在父 `assistant(toolCalls)` 与父 `tool_result` 之间被实时写入；reload 按 `created_at` 读回是同一串。**live 与 reload 无法发散，因为在投影同一序列。** 子 agent 可见性于是从"后端特例"变成**前端投影的选择**。（次序稳定性靠 `(created_at, id)`；`id` 为 uuidv7 时间序，同毫秒可破。）

**三项已锁定的决策（2026-06-13）：**

1. **投影下沉 `packages/shared`，单一真相。** `projectForUser` 已是纯函数（仅依赖 `Message` 形状 + `ContextItemView`），连同 `ContextItemView` / flags / 相关 `meta` 形状搬入 shared，server（reload / debug）与 client（live）**共用同一份**，根除"两套投影漂移"。`toContextItemView`（碰 Kysely Row）留 server；client 从流事件直接构 `ContextItemView`。
2. **完整 raw（含 internal）全量下发，不设 server 隐私地板。** 依据：`active` / `internal` 是"视图整洁 / LLM 上下文管理"标记，**非保密标记**；且 `getContextDebug` 已把全量 raw（含 internal、含 meta）下发前端（`chat.service.ts:104`），故 live 携带 internal **不新增泄露面**。会话级鉴权（SSE 已是 per-conversation authed）即边界。渲染与否由前端投影决定。
3. **`citations` / `done` 折叠进"assistant 条目落定"事件。** 终答 citations（`validateCitations` 用运行期 `ctx.citations` 过滤）与 `done(messageId)` 不再是独立 bespoke 事件——落定的 assistant 条目本就带 `citations` 列与 `id`。client **不重算** citations（它没有 `ctx.citations`），直接读落定条目。

**落地顺序（每阶段可单独上线、可测）：**

1. 抽 `projectForUser` + `ContextItemView` / flags / meta 形状进 `packages/shared`；server 行为不变、测试照过——纯重构。
2. 在 shared 定义原始上下文事件线格式（item-settled + open-item-patch）；recorder 与 SSE 流共用同一事件源，SSE 流变成"含子 agent(internal) 的原始上下文日志"。
3. 前端用流事件维护增量 raw 模型，跑共享 `projectForUser` 出消息视图，另跑投影出轨迹 + 子 agent 参与方泳道；替换 `streamSteps` / `streamText` 的 ad-hoc 累加。
4. **（最后，达成完全对称）** reload 也下发 raw、client 投影，server 停发 `Message[]`；至此 reload 与 live 唯一区别只剩 raw 来源，投影路径彻底归一。

> **✅ 已落地（2026-06-13）**：四阶段全部实现。投影下沉 `packages/shared/src/projection/userView.ts`（`projectForUser`/`ContextItemView`/`viewFromDebug`）；线格式 `RawContextStreamEvent`（`run`/`item`/`patch{runId}`/`error`）；后端 recorder 经 `ctx.sink` 发事件、`agent.service.ask` 经 `streamChannel` 推→拉、**`TopLevelAgent.stream` 删除（顶层/子 agent 收敛成对称 `drive`＝`drain(driveAndRecord)→complete`）**；`conversationDetailSchema` 改为 `{conversation, raw, runs}`，前端 `stores/chat.ts` 单一 raw 模型 + `turns` 统一派生，`AssistantTurn.vue` + `SubAgentLane.vue`（方案 B 参与方泳道）。子 agent 泳道跨刷新持久。e2e（真 LLM）验证含阶段 4 reload 对称（客户端 `projectForUser` 重建用户视图与服务端一致）。