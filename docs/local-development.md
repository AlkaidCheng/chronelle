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

Open <http://localhost:3000/sign-in> and enter a name and email to create the
local identity, then create an Event from the workspace. The browser talks only
to the web origin. The Next.js route handler forwards `/api` to
`API_INTERNAL_URL`, which defaults to `http://localhost:4000`.

The API reads `.env` from the repository root. Development authentication is
fail-closed: `ENABLE_DEVELOPMENT_AUTH=true` must be set explicitly before the
development sign-in endpoint is registered.
`DEVELOPMENT_AUTH_SESSION_TTL_MINUTES` controls the lifetime of its in-memory
sessions. These sessions disappear when the API restarts and are not suitable
for a deployed environment.

Private development attachments are stored below `LOCAL_STORAGE_ROOT`, which
defaults to `.chronelle/storage` and is ignored by Git. Keep this root private
and outside any directory served by a web server. The adapter creates folders
with mode `0700` and files with mode `0600`. `DOCUMENT_TRANSFER_TTL_SECONDS`
sets the lifetime of one-time upload and download authorizations; the default
is five minutes.

## Development sign-in

Create or reuse a development identity and its personal workspace:

```bash
curl --request POST http://localhost:4000/api/auth/development/sign-in \
  --header 'content-type: application/json' \
  --data '{"email":"alex@example.com","displayName":"Alex"}'
```

The response includes an opaque access token. Pass it as a bearer token to read
the active session:

```bash
curl http://localhost:4000/api/auth/session \
  --header 'authorization: Bearer REPLACE_WITH_ACCESS_TOKEN'
```

Use `x-workspace-id` to select a non-default workspace. Selection succeeds only
when the user is a member or holds an active grant to a live resource in that
workspace. Concurrent first sign-ins reuse one user and one personal workspace;
every sign-in still records its own audit event.

To exercise sharing locally, sign in once with two different email addresses.
Create an Event as the first user, open its Sharing tab, and grant Viewer or
Owner access to the second email. Sign back in as the second user and select the
shared workspace from the shell. The development adapter resolves recipients
only after their first sign-in; it does not send invitations or email.

An owner can make an included resource private from the Sharing tab. The
relationship stays intact, but a Viewer will see only a generic private-item
notice. Revoking the Viewer's last grant removes the shared workspace from the
next session response and returns the browser to its personal workspace.

Use that bearer token to create the root of an event plan:

```bash
curl --request POST http://localhost:4000/api/events \
  --header 'authorization: Bearer REPLACE_WITH_ACCESS_TOKEN' \
  --header 'content-type: application/json' \
  --data '{"displayName":"Launch night","timezone":"America/Los_Angeles"}'
```

Create child resources with the Event ID as `permissionScopeId`, then connect
them with `POST /api/objects/:eventId/relations`. See
[`api.md`](api.md) for the complete first-slice route map.

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
`packages/db`, `packages/authorization`, and `apps/api` create isolated,
disposable databases and apply migrations from scratch. PostgreSQL must be
running before `pnpm test` or `pnpm check`.

`TEST_DATABASE_URL` is an administrative connection used only by the test
harness. Its role must be allowed to create and drop databases. The local
Compose role has the required permission.

## Migrations

Migration filenames use `NNNN_description.sql`. Applied migration checksums are
immutable: add a new migration instead of editing one already used by a shared
environment.

Apply pending migrations:

```bash
pnpm db:migrate
```

The migration runner applies the SQL files in lexical order, records their
SHA-256 checksums, and rejects a file that changed after being applied. Drizzle
schema definitions map these tables for typed queries; SQL remains the migration
authority.
