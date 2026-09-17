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

Migrations `0012_add_event_write_functions.sql` through
`0029_add_revision_baseline_function.sql` add the Event, Task, Expense, and
Reminder create and update functions, relation creation, removal, and
recovery, linked creation, object deletion and recovery, revision restore,
sharing and permission-scope changes, Event page layout changes, reversible
command execution, undo, and redo, the command state read, the storage
reference read, the document transfer records, the identity sign-in, the
backend readiness check, and the revision baseline used by the CloudBase
rpc path; 0013 also introduces the shared object write core the family
functions delegate to. They change no tables and need
no baseline; a PostgreSQL deployment carries the functions unused.

Migration `0030_add_user_sessions.sql` adds the `user_sessions` table and the
`chronelle_session_create`, `chronelle_session_resolve`,
`chronelle_session_revoke`, and `chronelle_sessions_revoke_all` functions the
CloudBase rpc path uses for the same session rules; `0031` redefines the two
revocation functions to date a revocation no earlier than the session's
creation. Migration `0032_add_password_credentials.sql` adds
`user_credentials` and `email_verifications` with the
`chronelle_password_*`, `chronelle_email_verified`, and
`chronelle_verification_*` functions; `0033` redefines the issue function
with the rate limit on emailed codes. Migration `0034_add_task_due_date.sql`
adds `tasks.due_on` (a calendar date, exclusive with `due_at`) and redefines
the Task functions and `chronelle_command_content` to carry it. Migration
`0035_add_task_parent.sql` adds `tasks.parent_task_id` with
`chronelle_assert_task_parent` and redefines the Task functions to carry it.
Migration `0036_add_task_labels.sql` adds `labels` and `task_labels` with the
`chronelle_label_*` functions and redefines the Task functions to carry
`labelIds`; reapply `infrastructure/database/runtime-role.sql` after it, since
the runtime role needs the two new tables. Migration `0037_add_persons.sql`
adds the Person object type: the `persons` table, the `chronelle_person_*`
functions, and the write core, restore, and search functions admitting the
type; reapply the runtime role after it as well. Migration
`0038_add_task_assignee.sql` adds `tasks.assignee_person_id` with
`chronelle_assert_task_assignee` and redefines the Task functions to carry
`assigneeId`. Migration `0039_add_task_location.sql` adds `tasks.location`
with `chronelle_assert_task_location` and redefines the Task functions to
carry `location`. Migration
`0040_include_people_in_events.sql` lets an Event include People
(`chronelle_relation_compatible`). Migration
`0041_cascade_subtasks_in_trash.sql` adds `objects.deleted_with` and
redefines `chronelle_object_delete` and `chronelle_object_recover` so a
task's live subtasks go to Trash and come back with it. Migration
`0042_add_object_create_commands.sql` adds the append-only
`object_create_commands` table and redefines `chronelle_object_create` to
replay a standalone creation by `commandId`; reapply the runtime role after
it. Migration `0043_share_with_person.sql` redefines `chronelle_resource_share`
to take the grantee as `principal_email` or `person_id` (the old six-argument
function is dropped); reapply the runtime role after it. Migration
`0044_add_task_duration.sql` adds `tasks.duration_minutes` with
`chronelle_assert_task_duration` and redefines the Task functions to carry
`durationMinutes`; the functions are replaced in place, so the runtime role
needs no change. Migration `0045_add_task_repeat.sql` adds `tasks.repeat_rule`
and `tasks.repeat_until` with `chronelle_assert_task_repeat`, the next-due
functions, and `chronelle_task_repeat_changes`, which `chronelle_task_update`
now applies to a completion; the Task functions are replaced in place, so the
runtime role needs no change. Migration `0046_add_collection_rank.sql` adds
`tasks.rank` and `reminders.rank` (numbering existing rows by creation order)
with `chronelle_assert_rank`, `chronelle_next_task_rank`, and
`chronelle_next_reminder_rank`, and replaces the Task and Reminder functions
in place; the runtime role needs no change. Migration
`0047_add_user_locale.sql` adds `users.locale` (a language tag or null) with
`chronelle_user_locale_update`; the user row is serialized whole by the
identity, session, and credential functions, so no other function changes
and the runtime role needs no change.

Migration `0021_add_object_search_function.sql` adds `chronelle_object_search`,
the read-only function the CloudBase search adapter calls. It changes no
tables and needs no baseline.

Migration `0011_add_event_page_layouts.sql` adds independently versioned Event
page configuration. Run `pnpm db:migrate` and reapply runtime role provisioning
before deploying the API and web. Existing Events start with an empty layout;
their business data remains available through Browse event data. See
[Event pages](event-pages.md) for the layout API and sandbox behavior.

Migration `0010_add_event_calendar_dates.sql` adds nullable `date` columns and
schedule integrity checks. Stop old API writers, run `pnpm db:migrate`, and
deploy API and web together. Timeline clients must accept nullable `occursAt`
and the new nullable `occursOn` field. Existing timed Events and revision chains
need no data rewrite or new baseline. See [Event schedules](object-model.md#event-schedules)
for precision, timezone, and inclusive-end semantics.

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

A phone or another computer on the same private network can open the dev
server at the host's LAN address, for example `http://192.168.1.20:3000`. The
dev server accepts origins on `192.168.*.*`, `10.*.*.*`, and `*.local`; any
other host renders the page without its scripts, so nothing on it responds.
Production builds do not use this allow-list.

The API reads `.env` from the repository root. Development authentication is
fail-closed: `ENABLE_DEVELOPMENT_AUTH=true` must be set explicitly before the
development sign-in endpoint is registered. A sign-in of any kind records a
session in `user_sessions` (migration 0030) and hands out a random bearer
token whose SHA-256 digest is the only thing stored; the session survives an
API restart until it expires (`AUTH_SESSION_TTL_MINUTES`, fourteen days by
default) or is revoked by `DELETE /api/auth/session` (this credential) or
`DELETE /api/auth/sessions` (every session of the user). Development sign-in
asserts an identity without a password and is not suitable for a deployed
environment; email and password sign-up, verification, sign-in, and reset
(`docs/api.md`) are always available. With `EMAIL_PROVIDER=log` (the
default) the verification codes are written to the API log as
`Email written to the log` entries; with `EMAIL_PROVIDER=file` each message
is appended as one JSON line (`writtenAt`, `to`, `subject`, `text`) to
`EMAIL_FILE_PATH`, for an instance whose log is not collected but whose shell
is reachable. `AUTH_VERIFICATION_TTL_MINUTES` (15) bounds a code's lifetime.

Private development attachments are stored below `LOCAL_STORAGE_ROOT`, which
defaults to `.chronelle/storage` and is ignored by Git. Keep this root private
and outside any directory served by a web server. The adapter creates folders
with mode `0700` and files with mode `0600`. `DOCUMENT_TRANSFER_TTL_SECONDS`
sets the lifetime of one-time upload and download authorizations; the default
is five minutes.

Local uploads require a trusted, application-owned POSIX filesystem with hard-link
support. In-progress files live in private `.upload-*` staging directories and
cannot be addressed through storage keys. Completed files are published without
overwriting an existing object. An interrupted upload can be retried using its
unconsumed, unexpired authorization; a published upload retry must match the
authorized size and checksum.

An abrupt process exit can leave staging files. Do not remove staging entries
while writers are active or automatically replace incomplete final files from
an older installation. Retention and reconciliation require a separate policy.
File data is flushed before publication; power-loss durability of directory
entries and hostile local writers are outside this adapter's guarantees.

The Owner-only [storage inventory](storage-reconciliation.md) is available after
the private storage root exists. A missing workspace document directory returns
an empty report without creating files. A missing root returns unavailable;
the inventory never creates or repairs the configured storage tree.

`DOCUMENT_STORAGE_PROVIDER` defaults to `local-filesystem`. The optional
`tencent-cos` adapter uses direct signed transfers; see [Storage](storage.md)
for server-side environment variables, bucket constraints, and the live
deployment validation gate. No cloud credentials are needed for local tests.

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
object-type selector to exercise the structured filter. With more than 20
matches, select **Load more results** to request another visible page. The
count shows loaded canonical objects, not a workspace total. Changing search
filters starts a separate query; reloading the page discards pagination state.

The Events screen loads 20 canonical records at a time. **Load more events**
continues the current collection; its count means loaded records, not a total.
The name filter is debounced, and all name/period filters and sort modes apply
to the full accessible collection on the server. **Refresh events** discards
loaded pages and starts a new period reference time. A failed continuation can
be retried without discarding earlier cards. Grid/list layout stays local to
the browser; Event data and ordering remain server-owned.

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
harness. Use a disposable test cluster and its administrative role, never a
production connection. Database privilege tests also create, alter, and remove
uniquely named test roles, including tests that reject elevated role attributes.
The local Compose superuser has the required permission. Install PostgreSQL's
`psql` client (17 recommended) on the host and put it on `PATH`; these tests
execute the same provisioning SQL as the private container stack. Role operations
are cluster-wide, even when application tables live in disposable databases;
the harness restricts these operations to its uniquely named test roles.

The final API integration test starts from a newly migrated disposable
database, exercises the complete event-planning slice, rebuilds the Fastify app
against the same database and storage root, then verifies persisted data and a
previously authorized private download.

Install the pinned Playwright browsers once and run the responsive browser gate:

```bash
pnpm exec playwright install chromium webkit
pnpm test:e2e
```

`pnpm test:e2e` builds both applications, applies pending migrations, starts
the production entry points, and runs the canonical Event creation and search
path in desktop and narrow-mobile Chromium projects. Targeted WebKit projects
cover Event scheduling, date formatting, and creation-dialog keyboard focus at
desktop and mobile widths. On Linux, use `playwright install --with-deps` to
install the required system libraries as well.

Production browser specs import `test` from `apps/web/e2e/fixtures.ts`.
Its independent API verification client closes connections between requests,
so a long interactive journey cannot outlive a retained verification socket.
Browser requests and server keep-alive settings remain unchanged; the fixture
does not retry requests or assertions.

CI runs the browser gates inside the digest-pinned Ubuntu Playwright image in
`.github/workflows/ci.yml`. That image already includes the browser engines and
system libraries; no package-repository refresh is needed during the job. Update
its version and digest together with `@playwright/test`; a workflow test enforces
the version match. The container reaches the PostgreSQL service at `postgres`,
while tests and application servers communicate over loopback inside the job.

For Linux reproduction, use that same image with Node.js 24, the repository's
pinned pnpm version, a frozen-lockfile install, and a disposable PostgreSQL 17
service. Run `pnpm check`, `pnpm test:e2e`, and `pnpm test:sandbox` with `CI=true`.
The quality gate also needs a `psql` client; the GitHub runner provides it and
the workflow checks its availability explicitly. Native macOS browser results
do not replace Linux validation. On ARM hosts, amd64 emulation matches CI's
userspace architecture but not its hardware or timing.

The macOS WebKit keyboard case uses Option-Tab to include native buttons in
focus navigation. It does not change system keyboard preferences. This is
distinct from date-grid arrow and Page Up/Down navigation, which is the same
in each engine.

## Adding a language

The web app's strings live in one catalog per locale under
`apps/web/messages/` (`en.json`, `zh-Hans.json`, `zh-Hant.json`), keyed by
feature namespace and identifier, never by English text. `apps/web/i18n/`
holds the locale list, the request-time negotiation, the cookie preference,
and the catalog loader. Adding a language is one catalog file plus one entry
in `apps/web/i18n/locales.ts`:

```ts
{ tag: "ja", native: "<the language's name in itself>", fallbacks: ["en"] }
```

The Language control, `<html lang>`, the Accept-Language negotiation (extend
`localeForTag` when a new language needs region rules), the `Intl` helpers,
and the fallback chain all read that list. A key the new catalog lacks renders
from the next locale in `fallbacks`, so a partial catalog never shows a bare
key, but `apps/web/test/i18n-catalogs.test.ts` fails the build until every key
of `en.json` exists in the new catalog with the same ICU parameters and no
extras. Keep messages in ICU: plurals as
`{count, plural, one {# task} other {# tasks}}`, named parameters, no string
concatenation in components. Components read strings with `useTranslations`;
helpers outside React use `tr()` from `apps/web/i18n/active-locale.ts`, which
follows the provider through `LocaleSync` and defaults to English in unit
tests and the sandbox build.

Unit tests render inside the English provider automatically
(`apps/web/test/setup.ts` wraps `render` and `renderHook`); a test that needs
another locale renders its own `NextIntlClientProvider` with `loadMessages`.

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
