FROM node:26-bookworm AS builder

WORKDIR /app
ARG PNPM_VERSION=10.33.0
RUN npm install --global "pnpm@${PNPM_VERSION}"

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json

RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages packages

RUN pnpm install --frozen-lockfile --offline

RUN pnpm --filter @tavi/config build \
  && pnpm --filter @tavi/schemas build \
  && pnpm --filter @tavi/api prisma:generate \
  && pnpm --filter @tavi/api build

USER 1000:1000

CMD ["pnpm", "--filter", "@tavi/api", "start"]
