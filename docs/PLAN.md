# jnowledge 知识库系统 — 方案与一期计划

> 状态：一期已实现并通过端到端验证；二期（RAG）方案收敛、基建打通、待开工。本文件是项目的权威计划记录。
> 最后更新：2026-06-02

---

## 1. 项目目标

构建一个**知识库平台**，覆盖四类场景（按交付顺序）：

1. **知识管理 / 编辑**（一期）— 文档入库、组织、版本、权限。
2. **文档问答 RAG**（二期）— 检索 + 引用溯源的问答。
3. **知识图谱 / 多跳推理**（三期）— GraphRAG。
4. **Agent 任务执行**（四期）— 动态编排前三期能力。

定位是**平台而非单点功能**，因此一期虽只做 CRUD，但设计的是整个平台的数据契约与抽象骨架，避免后续返工。

---

## 2. 技术栈与工程

| 维度 | 选型 |
|---|---|
| 运行时 | Node 24（自带 type stripping） |
| 语言 | TypeScript 5.9 |
| 包管理 / 仓库 | pnpm + monorepo |
| 后端 | Koa + TypeScript |
| 前端 | Vue3 + Less + Element Plus + Pinia + Vite |
| 数据库 | PostgreSQL 单主库（pgvector + tsvector + Apache AGE） |
| 数据访问 | Kysely（类型安全查询构建器，避开重 ORM 以便写 pgvector/AGE 原生 SQL） |
| 对象存储 | MinIO / S3 |
| 任务队列 | pg-boss（Postgres 原生，不引 Redis） |
| 鉴权 | JWT（`@liuhlightning/jwt`）+ bcrypt（`@liuhlightning/bcrypt`），单 HS256 密钥 |
| 校验 | zod（v4，自带 `z.toJSONSchema`） |
| API 文档 | 从 zod 生成 OpenAPI + Swagger UI |
| 流式 | SSE（具体实现待定） |
| 工具链 | ESLint 9（flat config）+ typescript-eslint 8 + Prettier 3 |

### Monorepo 结构

```
jnowledge/
├─ pnpm-workspace.yaml
├─ package.json          # 根:工具链 devDeps
├─ tsconfig.base.json    # 共享 compilerOptions
├─ eslint.config.js      # 单一 flat config
├─ .prettierrc
├─ apps/
│  ├─ server/            # Koa 后端
│  └─ web/               # Vue3 前端
└─ packages/
   └─ shared/            # 前后端共享:zod schema + 类型 + 常量
```

---

## 3. 数据库与数据模型

### 横切约定

- 主键 **UUIDv7**（时间有序 + 不可枚举）。
- 时间戳全 `timestamptz`，每表 `created_at / updated_at / deleted_at`（软删除）。
- 审计字段 `created_by → users`。
- 易变属性进 `metadata jsonb`（按需 GIN 索引）——以此换取 schema 敏捷性（替代 MongoDB）。
- **单租户**，无 `tenant_id`。

### 一期表

| 表 | 要点 |
|---|---|
| `users` | email(unique) / password_hash / role(admin\|user) / status |
| `collections` | 顶层知识库，`parent_id` 自嵌套做文件夹；owner_id；settings jsonb |
| `collection_members` | ACL，(collection_id, user_id) 主键，role owner\|editor\|viewer |
| `files` | 对象存储元数据：storage_bucket / storage_key / file_size / mime_type / checksum(去重) |
| `documents` | collection_id / title / source_type / current_version_id / status / status_error |
| `document_versions` | document_id / version_no / content(规范 Markdown) / content_format / checksum / source_file_id→files(nullable) / author_id |
| `chunks` | 绑 document_version_id / seq / content / token_count / char_start / char_end(溯源偏移) / heading_path text[]。**一期不带 tsv 列** |

**血缘**：`files`(物理文件) → `document_versions`(内容快照) → `chunks`(分块)。
chunk 绑 `document_version_id`，文档一改即生新版本新 chunk，检索时 join `documents.current_version_id`。

### 预留表（设计好，对应期建）

- `chunk_embeddings`（P2）：chunk_id / model / dim / embedding vector(N) / unique(chunk_id, model) / HNSW 索引。**embedding 独立成表**以支持换模型、A-B、可重建。
- `conversations` + `messages`（P2）：messages 带 `citations jsonb → chunk_ids` 做溯源。
- `entities` + `edges`（P3，或交给 AGE 图）。
- `agent_runs` + `agent_steps`（P4）：续跑 + 轨迹展示。

### 隔离接口（应对部署不确定性）

- 向量访问抽象成 `VectorStore` 接口（实现 = PgVectorStore），规模到千万再局部迁 Qdrant。
- 图谱访问抽象成 `GraphStore` 接口（实现 = AgeGraphStore），若托管云 PG 不支持 AGE 则退回边表 + 递归 CTE 或独立 Neo4j。
- embedding 记录 model/version 保持**可重建**（迁移 = 重建而非搬运）。

### 中文全文检索（二期接线）

目标 **zhparser / pg_jieba**（原生 tsvector + ts_rank，可与向量在一条 SQL 做 RRF 融合）；pgroonga 作召回不够时升级；pg_trgm 作装不了扩展的兜底。一期 CRUD 用不到，故 `chunks` 一期不固化 `tsv` 生成列，二期迁移再加。

---

## 4. Ingestion 流水线与 Chunking

### 解析：按魔数路由 + 归一化

- **靠 magic number 检测真实类型**（不信扩展名 / 客户端 MIME，兼做安全边界；纯文本格式无魔数需内容启发式兜底）。
- **Parser Registry** 注册表式分发：PdfParser / DocxParser / HtmlParser / PlainTextParser / ...
- **归一化中间表示是关键**：所有 Parser 输出收敛到**规范 Markdown**（或 block 树：heading / paragraph / list / table / code + heading_path）→ 存 `document_versions.content`（`content_format` 固定 `markdown`）。无论源格式，chunking 前都已是结构化 Markdown，消解"非 md 输入"问题。

### Chunking：递归切分（已定）

切分器结构感知（正文已是 Markdown），分隔符层级（高→低）：

```
1. Markdown 标题 (\n#  \n##  …)   ← 章节边界优先,保住整节
2. 段落 \n\n
3. 行 \n
4. 句末   。！？ / . ! ?
5. 分句   ；， / ; ,
6. 空格
7. 字符(兜底)
```

- 尺寸按 **token** 量：目标 ≈512，下限 ≈100（更小碎片向上合并），硬上限 ≈1024。
- 重叠 ≈12%（~64 token），只在句边界重叠。
- 每个 chunk 带 `heading_path`。

**父子分块**：一/二期用**隐式 small-to-big，零 schema 改动**——只存小 chunk，查询时用 `char_start/end` + `heading_path` 回 `document_versions.content` 还原章节或按 `seq±k` 取邻块作大上下文。保留 `parent_chunk_id` 作"评测证明不够时再加"的预留项。

### 输入分析 Agent（二期可选增强）

复用统一 Agent Runtime 的一个 B 档节点。是**增强层非替代层**（确定性 Parser 是底座，agent 只兜底扫描件 / 脏版面 / 标题重建）；必须**分级**（质量分诊：干净文件走确定性 Parser，难啃文件才升级 agent，避免每文件无脑跑 LLM）；顺带是生成 contextual retrieval 上下文的天然落点。

### 不用的方案

- ❌ 固定 token 切（盲切劣解）。
- ❌ 纯 Markdown 结构切（多数输入非 md）。
- ❌ 一期上语义切（评测显示性价比/稳定性多数场景输给递归切，且依赖句子 embedding 质量——PDF/Word 转文本噪声大正是其脆弱点）。语义切留作二期评测证明边界是瓶颈时的可选增强，且大概率是"递归切候选边界 + 语义微调"混合形态。

---

## 5. LLM 业务抽象（两层）

两层叠成统一 facade，业务 / agent 只跟最上层打交道。

```
业务 / Agent Runtime
   │  llm.tier('light').object(schema, prompt)
   ▼
① 层级路由 Tier Router      tier → (provider, model, 参数)   ← 配置驱动
   ▼
② 能力层 Capability         text / json(zod) + 降级阶梯 + 校验重试
   ▼
   供应商适配 Adapters       OpenAI 兼容 / 其它   (归一化错误 + 用量统计)
```

### ① 能力层

```ts
interface LLMCapability {
  text(opts): Promise<string>
  textStream(opts): AsyncIterable<string>
  object<T>(schema: ZodType<T>, opts): Promise<T>   // zod 是单一真相源
  embed(input): Promise<number[][]>
}
```

- **zod 单一真相源**：`z.infer` 出 TS 类型 + 转 JSON Schema 喂结构化输出 + 返回值运行期校验。
- **降级阶梯**（应对供应商差异）：原生 json_schema → tool calling → json_object → 纯 prompt 解析。接口不变，按 capability 描述符自动选档。
- **校验失败 → 回喂错误修复重试**（有界）。
- 发给模型的 schema 要"结构化输出友好"（复杂 refine 放拿到对象后再验）。
- 流式与 JSON 分开（不强行流式 JSON）。
- 统一错误 taxonomy + 每次调用记 token 用量。

### ② 层级路由（成本分级）

把"任务多重"与"用哪个模型"解耦，业务只声明 tier，**tier→具体模型绑定集中在配置**（业务代码永不出现模型名）。

| Tier | 典型任务 |
|---|---|
| `heavy` | 复杂 agent 规划、多跳综合、最终答案合成 |
| `standard` | RAG 主答案生成、对话 |
| `light` | 摘要 / 打标签 / 实体抽取 / contextual 上下文 / 输入分析 agent |
| `nano` | 意图分类 / 查询路由 / 解析质量分诊 / 护栏 |

- tier 配置带默认参数（temperature / max_tokens / timeout / 重试策略）。
- `light` 校验反复失败可**自动升档**重试；供应商挂了 fallback 备用供应商。
- 调用打 `tier + 任务` 标签做**成本归因**。

### 与 Agent Runtime 组合

每个 agent / tool 声明自己的 tier（query 改写走 nano，答案合成走 standard，Orchestrator 走 heavy）——成本分级是声明字段而非散落的 if。

**一期范围**：只落能力层（text + json + zod + embed 接口及 OpenAI 兼容适配）；tier 路由留接口，二期真正用 LLM 时再接。

---

## 6. 多 Agent 架构（分层，二期起逐步落地）

核心：把"单个 agent 怎么跑"与"多个 agent 怎么协作"彻底分开。

- **底座 = 统一 Agent Runtime**：标准 ReAct / tool-calling 循环（A 档能力）。工具（vector_search / graph_traverse / fulltext_search / rerank …）是知识库能力的最小单元，纯 `(输入)→输出` 函数。
- **编排层 = 自研轻量图执行器**：每个 agent 包装成统一签名节点 `(state) → state`。
  - **B 档（静态图）**：节点连线写死（如 RAG 流水线：改写→检索→重排→生成→校验）。
  - **C 档（动态图）**：加 Orchestrator 节点，运行时决定走哪条边。**增量演进，不推倒重来。**
- **不引入 LangGraph.js。**
- **C 档硬问题**：state 持久化（`agent_runs` / `agent_steps`）+ 三重熔断（最大步数 / token / 超时）。

场景映射：

```
文档问答  → B 档:改写→混合检索(vector+fulltext+graph)→重排→生成→引用校验
知识管理  → 后台异步 agent:入库触发摘要/打标签/实体抽取
图谱多跳  → B 档变体:向量召回种子实体→graph_traverse 多跳→汇总
Agent任务 → C 档:Orchestrator 拆解任务,动态调度上面这些能力作 sub-agent/tool
```

---

## 7. 后端结构（apps/server）

经典 MVC：controller / service / model。

```
apps/server/src/
├─ main.ts            # 入口:加载配置→建容器→建app→启动
├─ app.ts             # 建 Koa、挂全局中间件、调 registerControllers
├─ container.ts       # 组合根:显式实例化所有 service 并接线
├─ config/            # env 加载 + zod 校验配置
├─ middleware/        # 全局:错误处理、auth、request-id、日志
├─ controllers/       # 每个 controller 自带 route
│  ├─ index.ts        #   registerControllers():显式 import + 静态数组挂载
│  └─ *.controller.ts
├─ services/
│  ├─ domain/         # DocumentService / CollectionService / AuthService / IngestionService
│  └─ infra/          # LLMClient / VectorStore / GraphStore / storage / jobs (+ 未来 Agent Runtime)
└─ models/            # Kysely 数据访问(repository + 行类型)
```

### 关键约定

- **route 藏在 controller 内**：controller 导出工厂函数 `createXController(c: Container): Router`，只管 HTTP（zod 校验入参 → 调 service → 整形响应）。
- **显式注册（硬约束）**：禁止动态 require / fs 扫描。`registerControllers` 显式 import 每个 controller、放静态数组挂载。依赖图静态可见、类型安全、tree-shaking、加载顺序确定。
- **组合根接线**：`buildContainer(config)` 启动时实例化 db → models → infra → services 单例，手动构造注入，**不引 DI 框架**。`type Container = ReturnType<typeof buildContainer>`。
- `LLMClient / VectorStore / GraphStore` 归在 `services/infra/`——从后端视角都是基础设施 service。
- **鉴权（保持简单，非关键路径）**：AuthService（bcrypt 哈希 + JWT 签发，**先不做 refresh token**）；auth 中间件验 JWT 塞 `ctx.state.user`；权限用小帮手 `requireCollectionRole('editor')` 查 collection_members，不搞复杂 RBAC。

---

## 8. 前端结构（apps/web）

Vue3 官方范例式划分：

```
apps/web/src/
├─ apis/        # import shared 类型,给每个接口上请求/响应类型
├─ components/  # 通用组件
├─ hooks/       # 组合式逻辑
├─ stores/      # Pinia,state 用 shared 领域类型
├─ utils/       # 含对 shared zod schema 的表单校验封装
└─ views/       # 页面
```

---

## 9. packages/shared 联动

**zod schema 是唯一契约真相源。** 一份 schema 三用：

```
                    packages/shared (zod schema)
                   /          |             \
          后端校验请求    z.infer→TS类型      前端表单校验
       (controller.parse)  (前后端共享)    (Element Plus rules)
```

```
packages/shared/src/
├─ schemas/        # zod schema(请求/响应 DTO)——唯一真相源
├─ types/          # z.infer 出的类型 + 纯领域类型/枚举
├─ constants/      # 枚举(status/role/tier)、错误码 taxonomy
└─ index.ts        # barrel 导出
```

### 联动机制

- **workspace 引用**：`"@jnowledge/shared": "workspace:*"`。
- **shared 直接导出源码 .ts，不单独构建**：`exports` 指向 `./src/index.ts`，前端 Vite / 后端 Node 24 strip types / `tsc --noEmit` 三方直接消费 TS 源码。改 shared 即时生效。
- **zod 版本全仓锁死单一版本**（`pnpm.overrides`），避免多实例类型不兼容。
- **shared 必须同构（isomorphic）**：只放类型 / zod schema / 常量 / 纯函数，**绝不 import Node-only 或浏览器-only 的东西**。

### OpenAPI（路线 A）

- **OpenAPI 从 zod 生成**（`zod-to-openapi` 或 zod v4 `z.toJSONSchema` 自拼），只作人读文档 + Swagger UI + 外部消费者。
- **前端直接 import shared 类型，不走 OpenAPI codegen**（monorepo 红利）。
- `swagger-jsdoc` / `openapi-types` 从"类型管道"降级为"文档产物"。

---

## 10. 路线图

| 期 | 内容 | 关键产出 |
|---|---|---|
| **一期** | 知识管理 CRUD 底座 | 数据模型 + 后端骨架 + 确定性 ingestion(魔数路由→归一化 Markdown→递归切) + 能力层 LLMClient + 前端管理界面 |
| 二期 | 文档问答 RAG | 回填 embedding(chunk_embeddings) + 中文 FTS 接线 + tier 路由 + B 档检索流水线 + SSE 问答 + 引用溯源 |
| 三期 | 知识图谱多跳 | GraphStore + 实体抽取 + GraphRAG |
| 四期 | Agent 任务执行 | 图执行器动态选边 + agent_runs 持久化 + 三重熔断 |

---

## 11. 一期执行计划（Phase 1 — 知识管理 CRUD）

> **状态：✅ 已实现并通过端到端验证（2026-06-02）。** 真实 Postgres + MinIO + pg-boss 下跑通注册→建库→手动文档/文件上传→异步解析分块至 ready→分块（带 heading_path 与精确 char 偏移）→编辑生成新版本（同内容 checksum 跳过）→成员管理→软删除，21 项断言全通过。全仓 typecheck + lint 绿、server 可产出 dist。
>
> 目标：纯工程、不依赖 LLM 推理即可跑通"上传 → 解析 → 分块 → 入库 → 管理"的完整闭环；同时把全平台数据契约与抽象骨架就位。

### 11.1 仓库与工程脚手架
- [x] pnpm workspace + 根 package.json（工具链 devDeps）。
- [x] `tsconfig.base.json`、`eslint.config.js`（flat）、`.prettierrc`。
- [x] `packages/shared` 包骨架（exports 指向 src/index.ts，zod 依赖，全仓锁版本）。

### 11.2 packages/shared
- [x] 常量：status / role / tier 枚举、错误码 taxonomy。
- [x] zod schema：auth、collection、document、file 的请求/响应 DTO。
- [x] 由 schema 导出的 TS 类型（z.infer）。

### 11.3 后端骨架
- [x] Koa app + 全局中间件（错误处理、request-id、日志、auth）。
- [x] `container.ts` 组合根。
- [x] `config/` env 加载 + zod 校验（env 经 Node24 `process.loadEnvFile`）。
- [x] OpenAPI 从 zod 生成（`z.toJSONSchema`）+ Swagger UI 挂载（/docs）。

### 11.4 数据层（Kysely）
- [x] DB 连接 + 迁移工具接入（显式注册迁移表，非目录扫描）。
- [x] 一期 7 张表迁移：users / collections / collection_members / files / documents / document_versions / chunks。
- [x] 各表 model（repository + 行类型 + row→DTO mapper）。

### 11.5 基础设施 service
- [x] 对象存储 service（MinIO/S3，含启动幂等 ensureBucket）。
- [x] pg-boss 任务队列骨架。
- [x] `VectorStore` / `GraphStore` 接口定义（一期 null 占位，不实现检索）。
- [x] `LLMClient` 能力层（text / textStream / object(zod) / embed + 降级阶梯 + 校验重试）+ OpenAI 兼容适配；tier 路由留接口（无 key 时为未配置态）。

### 11.6 鉴权
- [x] AuthService（注册 / 登录，bcrypt + JWT，邮箱枚举防护）。
- [x] auth 中间件 + collection 级授权帮手（CollectionService.assertRole）。

### 11.7 Ingestion 流水线（确定性，无 LLM）
- [x] 魔数检测（file-type + 文本启发式）+ Parser Registry。
- [x] Parser：PDF / docx / HTML / 纯文本 → 归一化 Markdown。
- [x] 递归切分器（标题→段→行→句→分句→空格→字符 + token 预算 + 句边界 overlap）→ 写 chunks（含 heading_path / char 偏移，offset 精确性已验证）。
- [x] `documents.status` 状态机 + pg-boss 编排（embedding 步骤一期留桩，二期接）。

### 11.8 Controllers
- [x] auth.controller（注册 / 登录 / me）。
- [x] collection.controller（CRUD + 文件夹树 + 成员管理）。
- [x] document.controller（手动建/上传 / 列表 / 详情 / 版本历史 / 版本全文 / 分块 / 编辑 / 删除）。

### 11.9 前端
- [x] Vite + Vue3 + Element Plus + Pinia 脚手架，apis 层基于 shared 类型。
- [x] 登录页（登录/注册，复用 shared zod schema 做表单校验）。
- [x] 知识库（collection）管理：树形 + CRUD + 成员对话框。
- [x] 文档管理：上传、列表（状态轮询）、详情、版本历史、编辑器、分块查看。
- [x] stores：auth / collections / documents。

### 一期完成标准（DoD）✅
用户能登录 → 建知识库 → 上传 PDF/Word/HTML/文本 → 系统自动解析为规范 Markdown 并递归分块入库 → 在前端浏览/编辑/版本管理文档与 chunk。全程不依赖任何 LLM 推理。

**实现补记（踩坑与决策）**：
- 运行时用 **tsx**（esbuild）跑 `.js` 说明符指向 `.ts`，避开 Node 原生 type-stripping 的扩展名摩擦；CI 用 `tsc --noEmit`，生产 `tsc` 出 dist。
- koa 2.16 的 `exports` 把 `.` 指向 ESM dist（无 `.d.mts`），与 @types/koa 的 CJS `export =` 错位；但真正卡点是一个 `koa-multer.d.ts` 误以"脚本"形式 `declare module 'koa'` 整体**替换**了 koa 类型——改为只声明 `@koa/multer`、上传文件类型在 controller 内局部标注后，NodeNext + `verbatimModuleSyntax:false` 即干净通过。
- 后端因 koa/@koa 系列为 `export =`，server tsconfig 关 `verbatimModuleSyntax`（前端与 shared 仍开）。

---

## 12. 二期执行计划（Phase 2 — 文档问答 RAG）

> **状态：已实现（2026-06-02）。全仓 typecheck + lint 通过；后端流水线（FTS→RRF→小到大组装→SSE→引用落库）已无 key 实测端到端打通；向量/rerank/真生成路径已接线并类型校验，仅待填 `DEEPSEEK_API_KEY` / `SILICONFLOW_API_KEY` 联调。**
> 目标：在一期 CRUD 底座上接入 RAG —— embedding 回填 + 中文全文检索 + **完整混合检索**（向量 + 全文 + RRF 融合 + rerank 精排）+ SSE 流式问答 + 引用溯源。抽象与表结构沿用一期预留，不返工。

### 12.0 本期定型决策

| 维度 | 决策 |
|---|---|
| chat/生成 供应商 | **DeepSeek 官方**（OpenAI 兼容）。模型 `deepseek-v4-flash` / `deepseek-v4-pro`（旧 `deepseek-chat`/`deepseek-reasoner` 为兼容别名）。两模型均支持 function calling + JSON + 上下文缓存 + thinking 开关。 |
| embedding + rerank 供应商 | **SiliconFlow（硅基流动）**：`BAAI/bge-m3`（1024 维）+ `BAAI/bge-reranker-v2-m3`，免费、一个 key、OpenAI 兼容（rerank 为 Jina 形状 `/rerank`）。 |
| tier→模型 | `heavy → v4-pro`，`standard / light / nano → v4-flash`。**是否开 thinking 由调用层每次决定**（`thinking?` 选项，默认关；`object()` 默认关求结构化稳定），不进 tier 配置。 |
| 检索 | **完整混合**（一步到位，非分阶段）。 |
| 入库 | 启用 **Contextual Retrieval**（每 chunk 生成定位上下文再 embed）。 |
| 向量索引 | pgvector **HNSW + cosine**，`vector(1024)`。 |
| 中文 FTS | **zhparser**（tsvector + ts_rank），自托管 PG 自构建镜像。 |

### 12.1 基建（PG 扩展镜像）✅
- [x] `infra/postgres/Dockerfile`：基于 `pgvector/pgvector:pg16`，源码编译 SCWS + zhparser。
- [x] `docker-compose.yml`：postgres 由 `image` 改 `build: ./infra/postgres`。
- [x] 验证：`vector 0.8.2` + `zhparser 2.3` 可启用、中文分词正确、cosine 距离正常；换基础镜像后 `REFRESH COLLATION VERSION` + `REINDEX` 消除 collation 警告。

### 12.2 LLM 抽象改造 ✅
- [x] `config.llm` 拆 `chat` / `embedding` / `rerank` 三套（+ `config.rag` 入库/检索参数）；`.env.example` 加 `DEEPSEEK_API_KEY` / `SILICONFLOW_API_KEY` 与各默认值。
- [x] 能力层：`embed` / `rerank(query, docs, topN)` 提到 `LLMClient` 顶层（走 SiliconFlow）；`object()` 降级到 json_object 时**注入 JSON Schema 文本**；`TextOptions.thinking?` 透传；`textStream` 产出 `StreamChunk{type:'reasoning'|'text'}` 分两路。
- [x] tier→模型 v4 映射（heavy=pro，余=flash）；thinking 开关字段名集中在 `config.llm.chat.thinkingField`（唯一待官方确认点）。

### 12.3 数据层（migration 002）✅
- [x] `CREATE EXTENSION vector / zhparser` + `chinese_zh` 配置（zhparser parser + 实词词性映射）。
- [x] `chunk_embeddings`：`chunk_id / model / dim / embedding vector(1024)`，PK(chunk_id, model)，HNSW(cosine) 索引。
- [x] `chunks` 加 `tsv` 生成列 + GIN 索引。
- [x] `conversations` / `messages`（`messages.citations jsonb`，数组显式 `JSON.stringify`）。
- [x] 各新表 model（repo + 行类型 + mapper）；migration 已对运行库实跑通过并校验对象。

### 12.4 基础设施 service ✅
- [x] `PgVectorStore`（pgvector + Kysely 原生 SQL，HNSW cosine 近邻；查询按 collection 当前版本作用域）。`createInfra` 接入 `db`。
- [x] embedding 批量写入（`upsertMany` on conflict 覆盖）。
- [x] rerank 收敛在 `LLMClient.rerank()`。

### 12.5 入库流水线增强 ✅
- [x] 接上 embedding 桩：`chunking` → 批量 embed → 写 `chunk_embeddings` → `ready`（未配置 embedding 则内部跳过，不阻塞 CRUD）。
- [x] **Contextual Retrieval**：light 为每 chunk 生成定位上下文拼前缀再 embed；文档正文作稳定前缀走 DeepSeek 自动上下文缓存控成本；失败逐 chunk 回退无上下文。
- [x] 存量重建：`embed:backfill` 脚本 + `backfillMissing()`（按当前版本补缺 embedding，不重跑解析/分块）。

### 12.6 检索流水线（B 档静态图）✅
- [x] query 改写（nano，结合最近会话历史消代）。
- [x] 混合召回（并行）：向量（bge-m3 → HNSW）∥ 全文（zhparser tsvector + ts_rank，**OR 语义提升召回**）。
- [x] RRF 融合（`1/(k+rank)`，免调参）。
- [x] bge-reranker-v2-m3 精排 → topK（未配置则 RRF 次序兜底）。
- [x] small-to-big 组装：按 `char_start/end` 回 `document_versions.content` 扩展上下文窗口。
- [x] 生成（standard，`textStream`，系统提示要求带 `[n]` 引用标记；未配置生成模型则降级列出检索片段）。
- [x] 引用校验：解析答案 `[n]` → 仅保留命中 → 落 `messages.citations`。

### 12.7 Controllers + SSE ✅
- [x] `chat.controller`：建会话 / 列表 / 详情 / 删除 / 提问（SSE）。ACL 复用 `CollectionService.assertRole`（viewer+）。
- [x] SSE 手写（`ctx.respond=false` + `text/event-stream`：`token`/`reasoning` 增量 → `citations` → `done`/`error`；客户端断开即停）。

### 12.8 前端 ✅
- [x] 问答视图 `ChatView`：会话列表 + 消息流 + 流式打字（光标）+ 引用气泡（点开跳 `DocumentDetailView` 原文 tab 高亮，复用精确 char 偏移）。
- [x] `chat` store + `apis/chat`（fetch 读 SSE 流）；`CollectionsView` 加「问答」入口、路由 `collections/:id/chat`。
- [x] thinking 推理过程折叠展示（`el-collapse`）。

### 二期完成标准（DoD）
用户在某知识库内提问 → 系统混合检索（向量 + 中文全文）+ RRF + rerank 得到相关 chunk → 流式生成带引用标记的答案 → 点击引用跳转原文对应区间高亮。

---

## 13. 四期切片执行计划（Phase 4 起步 — Agent Runtime 底座 + RAG 工具化 + Agent SSE）

本切片落 Agent 底座，刻意**不上 C 档 Orchestrator**（留下期）。锁定决策：① 底座 + RAG 封工具；
② 新增独立 agent 端点，现有 `/ask` 不动；③ 两层工具 primitive+composite；④ 建表 + 落轨迹，
**续跑(resume) 留下期**；⑤ 中间决策步不流 token，仅最终答复流 token；⑥ 复用 conversations/messages，
终答落 messages、轨迹落 agent_steps。**本期 agent 代码定义（组合根注册，不做 CRUD 实体）。**

### 13.1 agent 的定义（校准）
agent = 受约束的控制循环：目标 + 一组手段(affordances) + 约束(prompt 软约束 + 代码硬围栏 + 熔断)，
由「决策策略」反复选下一步直到终止。**自主度是节点属性而非系统属性**：B 档=写死的边（RAG 流水线，零自主），
ReAct=LLM 在工具集里选（中），C 档=Orchestrator 选边（有界高）。原则：**能确定就别自主**。

### 13.2 LLM 能力层：tool-calling 原语 ✅（唯一新基建）
`LLMCapability.generateStream({messages, tools})` 产 `AgentChunk`（reasoning/text/tool_calls）。
`openaiAdapter` 加 `toApiMessages`（AgentTurnMessage→OpenAI 形状，含 assistant.tool_calls / tool 角色）
+ `parseToolStream`（累积 `delta.tool_calls[].function.arguments` 分片，结束时拼齐 yield）。
天然满足决策⑤：调工具的 turn 只产 tool_calls，最终 turn 才流 text。

### 13.3 两层工具框架 ✅
`Tool = {name, description, paramsSchema(zod), tier?, handler}`；`paramsSchema` 复用 `z.toJSONSchema` 喂模型
+ 调 handler 前 `safeParse` 校验回填参数（失败回喂模型纠正）。唯一 `ToolRegistry`（`createToolRegistry`）
组合根构建；agent 按 `toolNames`「**授予**」可见子集（非共享工具箱）。
- composite：`knowledge_search` 包整条 `retrieval.retrieve`（不改检索逻辑），命中以全局 marker 进 `ctx.citations`，输出带 [序号]。
- primitive：`get_document`（受 ctx.collectionId 范围约束，最小权限示例）。

### 13.4 Agent Runtime ✅
`runAgent(def, input, ctx)` 标准 ReAct 循环，产 `AgentEvent`（step_start/tool_result/reasoning/text/final/error）。
**四重熔断**：maxSteps / MAX_AGENT_DEPTH(防 agent-as-tool 递归) / charBudget(近似 token) / deadline(wall-clock)。
`agentAsTool(def)` 把子 agent 包成工具（depth+1、消息隔离）——本期**留接口**，未注册第二个 agent。
Runtime 是 infra 纯机制；工具接线由 domain/agent.service 用其依赖完成（避免 infra 反向依赖 domain）。

### 13.5 持久化（migration 003）✅
`agent_runs`（绑 conversation，message_id 完成回填，status running|completed|failed）+
`agent_steps`（append-only 轨迹，input/output jsonb，与 SSE 事件同形）。repo/mapper 照既有惯例。

### 13.6 service + controller ✅
`domain/agent.service.ts`：鉴权(viewer) → 落 user 消息 → 建 run → 跑 `runAgent` → 翻 `AgentEvent` 成
`AgentStreamEvent` + 落 steps + 聚合 citations → 终答落 messages + complete run。
`!llm.configured` 降级直接列检索片段（对齐 chat.service）。`controllers/agent.controller.ts`：
`POST /conversations/:id/agent`（SSE），复用 chat.controller 的 `ctx.respond=false` 传输层。

### 13.7 共享契约 ✅
`schemas/agent.ts`：`AgentRun`/`AgentStep`/`agentAskRequest` + `AgentStreamEvent`(ChatStreamEvent 超集)；
`enums.ts` 加 `AGENT_RUN_STATUSES`/`AGENT_STEP_KINDS`；补齐 types barrel 的 chat/agent 导出。

### 13.8 前端 ✅
`apis/sse.ts` 抽出通用 SSE 读流（chat/agent 共用）；`apis/agent.ts`；`stores/chat` 加 `agentMode` + `streamSteps`；
`ChatView` 加 RAG/Agent 开关 + 流式期间可折叠执行轨迹。引用复用既有跳 DocumentDetail 高亮。

### 四期切片完成标准（DoD）
typecheck/lint/web build 全绿；migration 003 up/down 干净；**无 key 降级路径端到端实测通过**
（鉴权→落 user 消息→SSE token/citations/done→agent_runs=completed 且回填 message_id）。
填 key 后联调（待）：需检索问题出 step_start→tool_result→citations→流式 token 轨迹；闲聊不检索；熔断 → run=failed。

---

## 14. 五期执行计划（Phase 5 — 多阶段推理 + 上下文真相源原则）

> **状态：地基已落（2026-06-06）——统一上下文事件日志 `context_items` + 投影引擎 + 一源三视图 debug 页 + 思考过程持久化（meta.reasoning）+ RAG 检索结果写回。本节在其上把单次推理演进为分阶段 / 嵌套推理，并钉死真相源原则。**
> 设计依据见 `DESIGN.md §8`。本期不追求一次做满，按 §14.0 顺序逐切片推进。

### 14.0 定型决策

| 维度 | 决策 |
|---|---|
| 真相源边界 | **按确定性切**：LLM 边界实际 I/O（含代码生成的 system 输入）= 原始事实，必落库；对「已落库 raw」的呈现视图 = 派生逻辑，用时重算（DESIGN §8.2）。 |
| 推理形态 | **固定管线 + LLM stage**，非自主多 agent；每 stage 类型化契约 + zod 校验失败即降级。 |
| 意图处理 | 收敛为**动态 system prompt 组装**，不单设意图推理塞回 prompt（推翻"独立意图 agent"初想）。 |
| RAG 过滤 | **抽取式**（保留 / 丢弃整段，不改写）以保引用 verbatim 溯源；per-chunk 并行 + 小规模跳过；定位为 reranker 之后的语义守门员。 |
| system prompt 可观测性 | 实际发送值随轮快照落库（`internal`, `stage=system`），debug 读快照——**不重算重建**（assembler/模板是会迭代的代码，重算随版本漂移）。解 `chat.service.getContextDebug` 的 TODO。 |
| 安全判级 | **已存在**（`safetyClassifier` + `gate` + `pending_operations`），本期补落 verdict + 评估升级，**不推倒重来**。 |

### 14.1 已落地基 ✅
- [x] migration 006 `context_items`（统一事件日志，取代 messages + agent_steps；`run_id` nullable，run 删除置 null）。
- [x] 投影引擎 `projection.ts`（`projectForLlm` / `projectForChat` / `projectForUser` 纯函数，跨轮不回放 tool_result）。
- [x] 一源三视图 debug 页（raw / llmView / userView，`GET /conversations/:id/context/debug`）。
- [x] RAG 检索结果写回 context_items（`tool_result`：content = 资料块=模型实际所见，meta.output = 结构化 chunks）。
- [x] 思考过程持久化（assistant 轮 `meta.reasoning`，落库消息与流式一致渲染）。

### 14.2 使能原语：context_items 第三状态 + run 树 ⏳
- [ ] context_items 增"persisted-but-view-excluded"判别（`kind` 扩展或 `meta.role` + `flags`）；三投影函数据此过滤（纯函数单测覆盖：raw 见、LLM/用户视图不见）。
- [ ] `agent_runs` 加 `parent_run_id`；子 run 分配**独立 runId**（`agentAsTool` 不再复用父 runId、不再整条丢弃）。
- [ ] debug 页支持按 run 树展开嵌套推理。

### 14.3 子推理落库（首个试金石）⏳
- [ ] `safetyClassifier` 的 verdict 补落 context_item（第三状态，stage=safety，含 input / output / reason）——零成本堵现有可观测性洞。
- [ ] `agentAsTool` 子 run 全过程按第三状态落库。

### 14.4 RAG 抽取式过滤（首个新 stage）⏳
- [ ] 检索命中后、`buildContextBlocks` 拼生成上下文前插入过滤 stage（nano/light，per-chunk 并行二分类，保留 / 丢弃**整段**，不改写）。
- [ ] 小规模（命中 ≤ N）直接跳过过滤（工程取巧，省调用）。
- [ ] 过滤决策落 context_item（第三状态）；`tool_result` content 反映过滤后结果（=模型实际所见），原始命中 + 丢弃理由入 meta 供审计。

### 14.5 动态 system prompt ✅
- [x] 取代 `GENERATION_SYSTEM` / `agentDef.system` 静态常量，按上下文确定性组装（assembler 在请求时**生产** system）。
- [x] **实际发送值随轮快照落 context_item（`state=internal`, `meta.stage=system`）**；debug 页读快照重现任意历史轮的 system——**不事后重算**（assembler/模板是会迭代的代码，重算随版本漂移；落实 §8.2 修订）。
- [x] 稳定前缀前置、动态片段后置，保 DeepSeek 上下文缓存命中。

### 14.7 单一 agent + 作用域沿 run 树委派 ✅（2026-06-06 增补，DESIGN §8.7）
动态 system prompt 就位后，"按会话类型分 `knowledge_assistant` / `global_assistant`"已退役——差异退化为散文 + 一个工具开关，作用域与 agent 身份无关。
- [x] 塌缩为唯一 agent（`assistant`）；作用域提为 **run 的属性** `RunContext.scope = { ceiling: 'principal' | string[] }`。
- [x] **顶层 agent 不绑库**，`ceiling` 恒 `'principal'`（实权由 `assertRole` 守）；限定某库由用户在对话中声明（选择器层），不设 `default`。
- [x] **硬收窄只经 `agentAsTool` 委派产生**：`narrow(parentScope, requested)` 做交集、只收窄、不信 LLM 的 scope 参数；子 agent 越界须显式回报。
- [x] 四个触库工具（`knowledge_search` / `get_document` / mutations / `list_collections`）按 `inCeiling` 强制 + `assertRole` 实权——边界是代码，prompt 只影响软选择。`scope.ts` 纯函数 + 单测。
- [x] UX：全局聊天是唯一 agent 入口（删 `ChatComposer` 的 agent/RAG 开关）。
- 边界（dormant）：数组天花板只被子 agent 触发，仓库尚未注册第二个 agent，故 B/C 端到端待注册子 agent；顶层 `ceiling:'principal'` 使校验恒真（顶层零行为变化）。

### 14.8 库内 RAG 问答退役 + 全局检索（无 LLM）✅（2026-06-06 增补，DESIGN §8.8）
§14.7 把 agent 收敛为唯一入口后，库内单轮 RAG（`chat.service.ask`）与 agent 仅差一层编排、能力被 `knowledge_search` 覆盖，故退役；检索职责一分为二。
- [x] 删 `chat.service.ask` 整条 RAG 链路（改写/相关性过滤/生成/引用校验）+ 死码 `retrieval.rewriteQuery`、`RAG_GENERATION_TEMPLATE`；`chat.service` 收敛为会话 CRUD + 调试，会话统一为全局。
- [x] 删 `/conversations/:id/ask` 与 `/collections/:id/conversations` 路由；前端去库内问答入口（`CollectionsView` 问答按钮、`collections/:id/chat` 路由、`isGlobal` 分支）。
- [x] 新增**全局检索** `POST /search`：纯检索、零 LLM。`retrieval.searchGlobal`（每库召回→库内 RRF→轮转交错→单次 merged rerank→小到大→文档级聚合）+ `search.service`（跨 `listAccessible` 聚合）+ `SearchView`/`searchApi`。
- 口径：**rerank 保留**（相关性信号本身 + 跨库可比次序的唯一来源，缺席回退交错）；排除生成式 LLM（改写/过滤/作答）。无会话、无落库。

### 14.6 安全判级升级为 audit-and-rewrite ⏳
- [ ] verdict schema 升级：`{ decision: allow|confirm|reject, reason, revised?: {toolName, args} }`，替换 `{risk: low|high}`；`gate()` 按 decision 分流。
- [ ] **reject 档（双来源）**：① 确定性硬规则——已知灾难性操作（删非空库等）由代码直接 reject，不经 LLM（安全边界抗注入）；② 分类器软 reject 补充。reject 回执要求用户 UI 手动操作，**不建 pending op**。
- [ ] **modify**：审计可改写参数 / 换工具；`revised` 非空 → **强制走确认流、不二次送审**；原始 → 改写 op 落 context_item（第三状态，§14.3）。
- [ ] **deep context（有界）**：`gate` 先采集确定性事实（子项数 / 大小 / 可逆性）+ 有界意图（当前用户轮 ±1）+ 目标对象紧凑描述（非正文全文），喂判官；tier nano/light。**不喂整段会话 + 全文**（避免重新引入上下文撑爆）。
- [ ] `pending_operations` 快照含**改写后**的 op（沿用现有防篡改回放，确认期不可被改）。

### 五期完成标准（DoD）
- **第三状态 + run 树**：嵌套推理（safety verdict、子 agent、RAG 过滤决策）全部留痕于 raw 视图与 run 树，且 LLM / 用户视图不受污染——投影纯函数单测覆盖此不变式。
- **RAG 过滤 stage** 端到端：低相关命中被抽取式丢弃，引用 verbatim 溯源不破坏；小规模命中跳过过滤。
- **动态 system prompt**：实际发送值随轮快照落库（internal/stage=system）；debug 页读快照重现任意历史轮的 system（不重算、抗版本漂移）。
- **audit-and-rewrite**（§14.6）：删非空库等灾难性操作被确定性硬规则 reject 并提示手动；判官改写的操作强制经用户确认且不二次送审、留痕 context_item。
- typecheck / lint / web build 全绿；新增 migration up/down 干净。

---

## 待定项

- ~~五期 §14.6 安全判级升级范围~~ → **已定（2026-06-06）**：升级为 audit-and-rewrite，三点（reject 双来源 / modify 须确认不二次送审 / 有界 deep context）见 §14.6 + DESIGN §8.5。
- ~~部署形态~~ → **自托管 PG 确定**（镜像/容器在己方控制，可装扩展；同利好三期 AGE）。
- ~~SSE 具体实现~~ → 二期 Koa 手写 `text/event-stream`。
- ~~中文分词器选型~~ → **zhparser** 确定（自构建镜像已验证）。
- DeepSeek v4 的 thinking 开关具体 API 参数名 + 实时价格：实现时按官方 doc 现拉确认（绑定集中在配置，单点关注）。
- 三期 AGE（图谱）镜像与 `GraphStore` 落地形态。
