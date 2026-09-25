FROM node:24-alpine AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/authorization/package.json packages/authorization/package.json
COPY packages/object-model/package.json packages/object-model/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/storage/package.json packages/storage/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/authorization packages/authorization
COPY packages/object-model packages/object-model
COPY packages/db packages/db
COPY packages/schemas packages/schemas
COPY packages/storage packages/storage
RUN pnpm --filter @livtales/api build
RUN pnpm --filter @livtales/api deploy --prod --legacy /runtime
RUN find /runtime/node_modules -type d -name .claude -prune -exec rm -rf '{}' +

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
ENV LIVTALES_MIGRATIONS_DIR=/app/migrations
WORKDIR /app
COPY --from=build /runtime/dist ./dist
COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /runtime/package.json ./package.json
COPY infrastructure/migrations ./migrations

RUN mkdir -p /app/.chronelle/storage && chown -R node:node /app/.chronelle

USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.API_PORT || 4000) + '/api/health', {signal: AbortSignal.timeout(2000)}).then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "dist/server.js"]
