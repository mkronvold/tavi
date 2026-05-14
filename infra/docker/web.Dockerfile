FROM node:24-bookworm AS builder

WORKDIR /app
ARG PNPM_VERSION=10.33.0
RUN npm install --global "pnpm@${PNPM_VERSION}"

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/config/package.json packages/config/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY infra/docker/web-entrypoint.sh infra/docker/web-entrypoint.sh

RUN pnpm install --frozen-lockfile

COPY apps/web apps/web
COPY packages packages
RUN chmod +x infra/docker/web-entrypoint.sh

RUN pnpm install --frozen-lockfile --offline

RUN pnpm --filter @tavi/config build \
  && pnpm --filter @tavi/schemas build \
  && pnpm --filter @tavi/web build

RUN mkdir -p /app/apps/web/node_modules/.vite-temp \
  && chown 1000:1000 /app/apps/web/node_modules/.vite-temp \
  && rm -f /app/apps/web/dist/runtime-config.js \
  && ln -s /tmp/tavi-runtime-config.js /app/apps/web/dist/runtime-config.js

USER 1000:1000

ENTRYPOINT ["bash", "infra/docker/web-entrypoint.sh"]
CMD ["start"]
