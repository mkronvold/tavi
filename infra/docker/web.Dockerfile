FROM node:24-bookworm AS builder

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY infra/docker/web-entrypoint.sh infra/docker/web-entrypoint.sh

RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages packages
RUN chmod +x infra/docker/web-entrypoint.sh

RUN pnpm --filter @tavi/config build \
  && pnpm --filter @tavi/schemas build \
  && pnpm --filter @tavi/web build

CMD ["bash", "infra/docker/web-entrypoint.sh"]
