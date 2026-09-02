FROM node:24-alpine AS build

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/authorization/package.json packages/authorization/package.json
COPY packages/schemas/package.json packages/schemas/package.json
COPY packages/db/package.json packages/db/package.json
RUN pnpm install --frozen-lockfile

COPY apps/api apps/api
COPY packages/authorization packages/authorization
COPY packages/db packages/db
COPY packages/schemas packages/schemas
RUN pnpm --filter @chronelle/api build

FROM node:24-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app /app

USER node
EXPOSE 4000
CMD ["node", "apps/api/dist/server.js"]
