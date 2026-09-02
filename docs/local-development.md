# Local Development

## Setup

Use Node.js 24 or newer, pnpm 11.25, and Docker. From the repository root:

```bash
cp .env.example .env
docker compose up -d
pnpm install
pnpm db:migrate
pnpm dev
```

The web app is served at <http://localhost:3000>. The API health endpoint is
served at <http://localhost:4000/api/health>.

## Services

Docker Compose starts PostgreSQL on the configured `POSTGRES_PORT`. Application
processes run on the host for fast reloads. Database state persists in the
`chronelle-postgres` named volume.

To stop PostgreSQL while retaining its data:

```bash
docker compose down
```

To inspect service health:

```bash
docker compose ps
curl --fail http://localhost:4000/api/health
```

## Quality gates

Run the same aggregate gate used by CI:

```bash
pnpm check
```

Tests are organized by workspace under `test/`. Database integration tests in
future slices will use an isolated database and apply migrations from scratch.

## Migrations

Migration filenames use `NNNN_description.sql`. Applied migration checksums are
immutable: add a new migration instead of editing one already used by a shared
environment.

Apply pending migrations:

```bash
pnpm db:migrate
```
