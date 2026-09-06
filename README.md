# Chronelle

Chronelle is a life-journey platform for connecting the people, places, plans,
events, travel, finances, documents, collections, and memories that make up a
person's life.

This repository contains a runnable Next.js web surface, a Fastify API,
provider-independent identity, centralized object authorization, shared
runtime-validated schemas, and the canonical PostgreSQL persistence kernel for
the event-planning vertical slice.

The implemented architecture is documented in
[`docs/architecture.md`](docs/architecture.md).

The API supports [reversible Event/Task content commands](docs/commands.md),
including atomic edits and conflict-safe Undo/Redo. Web command controls and
reversible trash/link actions are not yet implemented.

## Stack

- Next.js, React, and strict TypeScript for the responsive web client
- TanStack Query and TanStack Table for server state and planning tables
- Fastify and Zod for the typed REST API boundary
- PostgreSQL with immutable SQL migrations and Drizzle query mappings
- PostgreSQL full-text search with per-result authorization
- Provider-neutral private storage with a safe local filesystem adapter
- pnpm workspaces in a modular monorepo
- Vitest, Playwright, Biome, Prettier, and container builds in CI

## Repository layout

```text
apps/
  api/                  Fastify API application
  web/                  Next.js web application
packages/
  api-client/           Typed, runtime-validated REST client
  authorization/        Central policy and PostgreSQL permission lookup
  db/                   Migration runner, typed schema, IDs, and DB tests
  object-model/         Canonical object, relation, projection, and search services
  schemas/              Shared runtime and TypeScript contracts
  storage/              Private-object storage port and local adapter
infrastructure/
  migrations/           Ordered SQL migrations
docs/                   Implementation-facing documentation
```

Presentation components stay with the web application until another client
creates a concrete reason for a shared UI package.

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

`ENABLE_DEVELOPMENT_AUTH=true` enables the local in-memory identity adapter.
Its opaque sessions expire and are lost when the API restarts. A production
deployment must compose a production identity provider instead of enabling
this adapter.

## Install and run

Install dependencies once:

```bash
pnpm install
```

Then use the three-command development workflow to start PostgreSQL, apply any
pending migrations, and run both apps:

```bash
docker compose up -d
pnpm db:migrate
pnpm dev
```

The web app listens on <http://localhost:3000>. The API health endpoint is
available at <http://localhost:4000/api/health>.

Open <http://localhost:3000/sign-in> to create a development session, then use
the Events workspace to build an event plan. The web server forwards `/api`
requests to `API_INTERNAL_URL`, which defaults to the local API.

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

For an existing database, stop all API writers and run `pnpm db:baseline-revisions`
after migration and before restart. The command captures the available state of
existing live and deleted objects without inventing earlier history. Startup
checks that every current object version has a snapshot. See
[Object revisions](docs/revisions.md) for the deployment barrier and history API.

History actions provide paginated versions, typed comparisons, and confirmed
content restoration. Restoring advances the canonical version while preserving
current permissions and immutable financial/file facts. See the
[restore policy](docs/revisions.md#content-restoration) before deploying the
restoration migration; API and web must be upgraded together.

Workspace Trash provides Owner-authorized deleted-object previews and recovery.
Event Actions distinguish unlinking a context from deleting a canonical object;
Removed links restores independently removed relationships. Migration 0008 adds
relation versions and requires API/web deployment together with old writers
stopped. See [Trash and recovery](docs/recovery.md) for the new versioned relation
contract and recovery guarantees.

The first migration creates the common object layer plus typed `Event`, `Task`,
`Expense`, `Reminder`, and `Document` tables. SQL owns database constraints;
Drizzle maps the accepted schema for typed application queries.

The second migration adds the unique personal-workspace owner link and an
index for principal-side grant lookup.

The third migration adds durable, expiring document-transfer authorizations.
Only credential hashes are persisted; file bytes remain outside PostgreSQL.

The fourth migration adds a partial PostgreSQL full-text index for active
canonical object names.

## Development authentication

Create a development session and personal workspace:

```bash
curl --request POST http://localhost:4000/api/auth/development/sign-in \
  --header 'content-type: application/json' \
  --data '{"displayName":"Alex Example","email":"alex@example.com"}'
```

Use the returned token to resolve the current session:

```bash
curl http://localhost:4000/api/auth/session \
  --header 'authorization: Bearer <access-token>'
```

Pass `x-workspace-id` to select another workspace. Selection succeeds only for
a workspace where the user has membership or an active resource grant.

## Event-planning API

The API can create, read, update, and soft-delete canonical Events, Tasks,
Expenses, and Reminders. First-class relationship endpoints compose them into
an event plan. Event detail, to-do, calendar, timeline, itinerary, expense, and
reminder endpoints are authorized read-time projections over those same object
IDs. See [`docs/api.md`](docs/api.md) for routes and examples.

Owners can share a root Event directly with an existing Chronelle user as
Owner, Editor, or Viewer. Child resources inherit through the Event's canonical
permission scope, not through their relationship. A versioned scope change can
make one child private while leaving both the object and relationship intact.

## Event-planning workspace

The web client provides development sign-in, an event list, event editing,
to-dos, calendar, timeline, itinerary, expenses, and reminders. Creating a
schedule item creates one canonical Event. Its ID is preserved in the calendar,
timeline, and itinerary projections, and an edit invalidates every affected
view. Optimistic-concurrency conflicts show a refresh action instead of
silently overwriting newer data. The Sharing view manages Owner and Viewer
access, lists inheriting resources, and can stop inheritance. A workspace
selector exposes workspaces reached through active grants; Viewer panels remain
read-only and inaccessible references render without protected details.

The Files view attaches private files to Events, Tasks, and Expenses. Uploads
and downloads use short-lived, one-time transfer authorizations. Finalization
creates one canonical Document and an `attached_to` relationship; unlinking
removes only that relationship. Local files live below `LOCAL_STORAGE_ROOT`
with restrictive permissions, and public API responses never expose storage
keys or permanent URLs.

The Search view queries canonical object names with an optional object-type
filter. Results are restricted to the active workspace and independently
authorized before the API returns them. Search stores no projection copy and
does not expose a count of protected matches.

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

Install the pinned Chromium build once, then run the real-browser release gate
against the PostgreSQL service:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

The browser gate runs the same canonical Event creation and search path at
desktop and narrow-mobile widths. It also checks tab-keyboard behavior, the
skip link, and horizontal overflow. CI installs Chromium and runs this gate in
a dedicated required job.

The API suite contains a fresh-database release test for the complete event
slice. It covers canonical projections, Owner and Viewer behavior, hidden
relations, search isolation, version conflicts, soft deletion, private
attachments across an API restart, and audit request IDs.

## Known V1A limitations

- Development authentication is in-memory and is not a production identity
  provider.
- Search covers canonical display names and one object-type filter within a
  500-candidate window; pagination and richer filters are deferred.
- PostgreSQL RLS is deferred until the runtime uses a separate least-privilege
  database role and transaction-local workspace context. Application
  authorization and workspace constraints remain mandatory.
- Local filesystem storage is the development adapter; Tencent COS remains a
  provider implementation milestone.
- Reminder delivery providers, invitations, anonymous links, recurrence, and
  the travel object slice remain deferred.

## Containers and delivery

The web experience includes responsive event collections, grid/list layouts,
date and name filters, bookmarkable planning views, and mobile account controls.
See [Web experience](docs/web-experience.md) for behavior and accessibility, and
[Deployment](docs/deployment.md) for exact standalone/container commands.
The UI is deployable for trusted previews; unverified development sign-in blocks
public production launch.

Build either application from the repository root:

```bash
docker build -f apps/api/Dockerfile -t chronelle-api:local .
docker build -f apps/web/Dockerfile -t chronelle-web:local .
```

CI validates formatting, lint, types, tests, application builds, the responsive
browser smoke path, and running containers with a disposable private database.
Version tags and manual releases run these same gates before publishing the
tested images to GitHub Container Registry. Full commit SHA tags identify the
validated source; publication does not rebuild images. A runtime deployment
target is intentionally not selected yet.

Repository policy requires pull-request review and passing `quality`, `browser`,
and `containers` checks for `main`. When host-side branch rules are unavailable,
maintainers enforce the same policy through the review workflow.
