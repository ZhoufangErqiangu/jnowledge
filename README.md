# jnowledge

知识库系统。前后端分离的 pnpm monorepo。完整方案见 [`docs/PLAN.md`](docs/PLAN.md)。

一期（知识管理 CRUD）已落地：登录 → 建知识库 → 上传 PDF/Word/HTML/文本或手写 Markdown → 后台确定性流水线解析为规范 Markdown 并递归分块入库 → 前端浏览/编辑/版本管理。全程不依赖 LLM 推理。

## 技术栈

- **后端** `apps/server`：Koa + TypeScript（Node 24，tsx 跑），Kysely + PostgreSQL，pg-boss 队列，S3/MinIO 对象存储。
- **前端** `apps/web`：Vue3 + Vite + Element Plus + Pinia + Less。支持暗色主题切换（跟随系统初值，localStorage 持久化）。
- **契约** `packages/shared`：zod schema 单一真相源（后端校验 + 前后端类型 + 前端表单校验），源码直出不构建。

## 目录

```
apps/server   Koa 后端（controller / service{domain,infra} / model，显式注册，组合根接线）
apps/web      Vue3 前端（apis / components / hooks / stores / utils / views）
packages/shared  zod schema + 类型 + 常量（isomorphic）
docs/PLAN.md  权威方案与一期执行计划
```

## 本地启动

前置：Node 24、pnpm 9、Docker。

```bash
pnpm install

# 1) 起基础设施（Postgres + MinIO）
docker compose up -d

# 2) 配后端环境变量
cp apps/server/.env.example apps/server/.env

# 3) 建表（迁移到最新，并幂等创建引导管理员 admin@admin.com / admin12345）
pnpm --filter @jnowledge/server migrate

# 4) 起后端（:3000，API 文档在 /docs）
pnpm dev:server

# 5) 另开终端起前端（:5173，已代理 API 到 :3000）
pnpm dev:web
```

## 常用脚本

```bash
pnpm typecheck     # 全仓类型检查
pnpm lint          # ESLint
pnpm format        # Prettier 写入
pnpm --filter @jnowledge/server migrate        # 迁移到最新
pnpm --filter @jnowledge/server migrate:down   # 回退一步
```

## 账号与注册

- **引导管理员**：数据库初始化（migrate）时固定创建 `admin@admin.com` / `admin12345`（idempotent）。
- **注册验证码**：注册需填验证码，一期为固定码，由环境变量 `REGISTER_CAPTCHA` 指定（默认 `123456`）。注册不再填昵称。

## 关键约定

- **显式注册**：controller / 迁移均显式 import + 静态数组挂载，禁止动态 require/扫描。
- **组合根**：`apps/server/src/container.ts` 显式实例化并接线全部 service，不引 DI 框架。
- **chunk 绑版本**：文档一改即生新版本与新 chunk；检索 join `documents.current_version_id`。内容 checksum 未变则跳过重新分块。
- **隔离接口**：`VectorStore` / `GraphStore` 一期为占位，二期/三期落地，调用方不变。

## 路线图

一期 知识管理 CRUD（本期）· 二期 RAG · 三期 知识图谱多跳 · 四期 Agent 任务执行。详见 `docs/PLAN.md` §10。
