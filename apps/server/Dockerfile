# 题本 Quizbook server：单容器，同时提供 API 和 Web 静态产物。
# 构建上下文必须是仓库根目录：
#   docker build -f apps/server/Dockerfile -t quizbook-server .
FROM node:24-alpine

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.32.1 --activate

# 先只复制 workspace 清单，利用 Docker 层缓存安装依赖
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/desktop/package.json apps/desktop/package.json
COPY apps/mobile/package.json apps/mobile/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/storage/package.json packages/storage/package.json

# server 运行 + web 构建所需依赖（core/storage 作为 workspace 依赖一并安装）
RUN pnpm install --frozen-lockfile --filter @quiz/server... --filter @quiz/web...

# 源码与题库
COPY packages/core/src packages/core/src
COPY packages/storage/src packages/storage/src
COPY data data
COPY apps/server apps/server

# 构建 Web 单文件产物（server 会托管 apps/web/dist）
COPY apps/web apps/web
COPY tsconfig.json tsconfig.json
RUN pnpm --filter @quiz/web build

WORKDIR /app/apps/server
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8787

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://127.0.0.1:8787/api/health >/dev/null || exit 1

CMD ["pnpm", "exec", "tsx", "src/index.ts"]