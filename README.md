# Chronelle

Chronelle is a life-journey platform for connecting the people, places, plans,
events, travel, finances, documents, collections, and memories that make up a
person's life.

This repository contains a runnable Next.js web surface, a Fastify API health
endpoint, shared runtime-validated schemas, and the canonical PostgreSQL
persistence kernel for the event-planning vertical slice. Authentication and
application services build on this foundation in subsequent pull requests.

The implemented architecture is documented in
[`docs/architecture.md`](docs/architecture.md).

## Stack

- Next.js, React, and strict TypeScript for the responsive web client
- Fastify and Zod for the typed REST API boundary
- PostgreSQL with immutable SQL migrations and Drizzle query mappings
- pnpm workspaces in a modular monorepo
- Vitest, Biome, Prettier, and container builds in CI

## Repository layout

```text
apps/
  api/                  Fastify API application
  web/                  Next.js web application
packages/
  db/                   Migration runner, typed schema, IDs, and DB tests
  schemas/              Shared runtime and TypeScript contracts
infrastructure/
  migrations/           Ordered SQL migrations
docs/                   Implementation-facing documentation
```

Additional authorization, object-model, API-client, and UI packages will be
introduced when the first working slice gives each package concrete behavior.

## Prerequisites

- Node.js 24 or newer, below Node.js 27
- pnpm 11.25
- Docker with Docker Compose

## Environment

Copy the development defaults before starting services:

```bash
cp .env.example .env
```

The checked-in values are local-only defaults. Production credentials must be
provided through managed secret storage.

## Install and run

Start PostgreSQL, install dependencies, apply migrations, and run both apps:

```bash
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
```

The web app listens on <http://localhost:3000>. The API health endpoint is
available at <http://localhost:4000/api/health>.

Stop local infrastructure without deleting its named database volume:

```bash
docker compose down
```

## Database migrations

Add immutable, ordered SQL files to `infrastructure/migrations` using the
`NNNN_description.sql` convention. Apply all pending migrations with:

```bash
pnpm db:migrate
```

The runner records each filename and SHA-256 checksum. It refuses to continue
if an already-applied migration has changed.

The first migration creates the common object layer plus typed `Event`, `Task`,
`Expense`, `Reminder`, and `Document` tables. SQL owns database constraints;
Drizzle maps the accepted schema for typed application queries.

## Development commands

Run API and web development servers:

```bash
pnpm dev
```

Run the complete local quality gate:

```bash
pnpm check
```

The database tests create and drop disposable PostgreSQL databases. Start the
Compose service first and provide `TEST_DATABASE_URL` when not using the local
defaults.

Individual checks are available as `pnpm format:check`, `pnpm lint`,
`pnpm typecheck`, `pnpm test`, and `pnpm build`.

## Containers and delivery

Build either application from the repository root:

```bash
docker build -f apps/api/Dockerfile -t chronelle-api .
docker build -f apps/web/Dockerfile -t chronelle-web .
```

CI validates formatting, lint, types, tests, application builds, and both
containers. Version tags publish API and web images to GitHub Container
Registry; a runtime deployment target is intentionally not selected yet.

Repository policy requires pull-request review and passing `quality` and
`containers` checks for `main`. When host-side branch rules are unavailable,
maintainers enforce the same policy through the review workflow.
