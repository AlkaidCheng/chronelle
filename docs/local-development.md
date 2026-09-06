# Local Development

History actions open a paginated drawer from planning objects and Documents.
Compare two versions, preview historical content, and confirm restoration only
after reviewing eligible fields. Open drafts are preserved. A conflict requires
refreshing the preview and confirming again.

Migration `0007_add_revision_restoration.sql` adds restoration. Stop old API
writers, run `pnpm db:migrate`, and deploy the updated API and web together.
Complete revision chains need no new baseline. The browser gate exercises
confirmation, keyboard focus, responsive layout, drafts, and reload persistence.

When upgrading a database with existing objects, stop all API writers, run
`pnpm db:migrate` and `pnpm db:baseline-revisions`, then restart the API. The
server refuses startup if current object versions lack snapshots. A fresh empty
database requires no baseline rows. See [Object revisions](revisions.md) for the
deployment barrier and rollback limits.

Trash is available in workspace navigation. Use an Event or resource's Actions
to remove its context link or move the canonical object to Trash. Preview and
confirm recovery in Trash; recover independently removed links from the Event's
Removed links tab. Current Owners can revoke direct grants while an object is
trashed. See [Recovery](recovery.md) for scope-first recovery and limitations.

Migration `0008_add_trash_recovery.sql` adds relation versions and recovery.
Stop old API writers, migrate, and upgrade API/web together: unversioned relation
DELETE requests and older history clients are incompatible.

## Setup

Migration `0009_add_reversible_commands.sql` adds the optional Event/Task command
API. Run `pnpm db:migrate` before deploying that API; no new baseline is needed.
Existing web editors remain unchanged and do not yet record reversible commands.
See [Commands](commands.md) for typed client examples and retry handling.

Use Node.js 24 or newer, pnpm 11.25, and Docker. Install dependencies once from
the repository root:

```bash
cp .env.example .env
pnpm install
```

The repeatable three-command workflow is:

```bash
docker compose up -d
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

The Owner-only [storage inventory](storage-reconciliation.md) is available after
the private storage root exists. A missing workspace document directory returns
an empty report without creating files. A missing root returns unavailable;
the inventory never creates or repairs the configured storage tree.

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

Sign-out, sign-in, and workspace changes discard the previous query cache, open
drawers, and unsaved drafts, and cancel its pending reads and document transfers.
Save work before switching. A mutation already received by the API may still
commit; cancellation does not undo it. Refresh after returning to inspect the
canonical result before submitting a new operation.

If browser storage is unavailable, development sign-in and workspace switching
still work in memory. A reload may lose that session. If removal of an existing
stored credential fails, sign-out clears the current UI but cannot guarantee
that the stored credential will not be read again on reload. Clear site data
before reusing a shared browser. Development sign-out does not revoke server
tokens; production authentication, revocation, and credential storage remain a
separate launch requirement.

Use that bearer token to create the root of an event plan:

```bash
curl --request POST http://localhost:4000/api/events \
  --header 'authorization: Bearer REPLACE_WITH_ACCESS_TOKEN' \
  --header 'content-type: application/json' \
  --data '{"displayName":"Launch night","timezone":"America/Los_Angeles"}'
```

Create and include a child atomically with `POST /api/events/:eventId/resources`
and a stable `commandId` for retries. The backend assigns its canonical Event
scope. Standalone creation and independent linking are also supported. See
[`api.md`](api.md) for the complete first-slice route map.

The Search view uses `GET /api/search`. Search responses contain only active
objects in the selected workspace that pass the central View decision. Use the
object-type selector to exercise the structured filter.

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

The final API integration test starts from a newly migrated disposable
database, exercises the complete event-planning slice, rebuilds the Fastify app
against the same database and storage root, then verifies persisted data and a
previously authorized private download.

Install the pinned Playwright browser once and run the responsive browser gate:

```bash
pnpm exec playwright install chromium
pnpm test:e2e
```

`pnpm test:e2e` builds both applications, applies pending migrations, starts
the production entry points, and runs the canonical Event creation and search
path in desktop and narrow-mobile Chromium projects.

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
