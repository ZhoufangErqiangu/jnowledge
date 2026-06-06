# @jnowledge/server 部署镜像（同镜像多入口）。
# 同一镜像两种用法：
#   - 服务容器：   node dist/main.js
#   - 迁移容器：   node dist/db/migrate.js latest   （部署时作一次性 init/job 先跑）
# 二者共享同一套环境变量与 config.json（migrate 也走完整 loadConfig）。
#
# 关键约束：@jnowledge/shared 以「裸 TS 源码」被消费（package.json main 指向 src/*.ts），
# 运行期依赖 Node 24 的原生类型擦除直接加载。类型擦除对 node_modules 内的 .ts 不生效，
# 故必须保留 pnpm 的 workspace 布局：packages/shared 作为真实目录留在 node_modules 之外，
# 由 node_modules 里的 symlink 指过去（realpath 落在 node_modules 外 → 擦除生效）。
# 因此运行阶段「整体搬运 workspace」而非 pnpm deploy（后者会把 shared 实体拍进 node_modules，破坏擦除）。

# syntax=docker/dockerfile:1
FROM node:24-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

# ---- 构建：装全量依赖 + 编译 server -> dist ----
FROM base AS build
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
# 先构建 shared（产出 dist/*.js，供 server 运行期按 default 条件解析），再构建 server。
RUN pnpm --filter @jnowledge/shared build && pnpm --filter @jnowledge/server build

# ---- 运行：仅搬运 server 运行所需，保留 pnpm symlink 布局 ----
FROM base AS runtime
ENV NODE_ENV=production
# workspace 根标识 + 根 node_modules（含 .pnpm 实体存放区，apps/server 的 symlink 指向此处）
COPY --from=build /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=build /app/node_modules ./node_modules
# shared 作为真实目录留在 node_modules 之外（类型擦除需要）
COPY --from=build /app/packages/shared ./packages/shared
# server：编译产物 + 运行期 node_modules(symlink) + 包清单 + LLM 路由表
COPY --from=build /app/apps/server/node_modules ./apps/server/node_modules
COPY --from=build /app/apps/server/dist ./apps/server/dist
COPY --from=build /app/apps/server/package.json ./apps/server/package.json
COPY --from=build /app/apps/server/config.json ./apps/server/config.json

WORKDIR /app/apps/server
EXPOSE 3000
# 默认起服务；迁移容器在编排里覆盖为 ["node","dist/db/migrate.js","latest"]
CMD ["node", "dist/main.js"]
