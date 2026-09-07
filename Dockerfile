FROM node:24-bookworm-slim AS build
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.server.json vite.config.ts ./
COPY src ./src
RUN pnpm build

FROM node:24-bookworm-slim AS deps
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod

FROM node:24-bookworm-slim
RUN apt-get update \
  && apt-get install -y --no-install-recommends cups-ipp-utils ghostscript ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=8080
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./
COPY entrypoint.sh /usr/local/bin/printmax-entrypoint
RUN mkdir -p /data/uploads && chown -R node:node /data
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["printmax-entrypoint"]
CMD ["node", "dist/server/index.js"]
