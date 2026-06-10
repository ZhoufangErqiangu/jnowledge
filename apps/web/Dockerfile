# @jnowledge/web 前端镜像：构建 SPA 静态产物，交 nginx 托管（纯静态，不反代 API）。
# 构建走 monorepo：先建 shared（vite 按 default 条件解析其 dist），再 vite build。

# syntax=docker/dockerfile:1
FROM node:24-slim AS build
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH
# 后端基址：vite build 时烘焙进静态产物（缺省空 = 同源，交上游网关反代）。
ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN corepack enable
WORKDIR /app
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile
RUN pnpm --filter @jnowledge/shared build && pnpm --filter @jnowledge/web build

# 运行阶段：纯静态，nginx 托管
FROM nginx:alpine AS runtime
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
# 沿用 nginx:alpine 默认 CMD（前台启动 nginx）
