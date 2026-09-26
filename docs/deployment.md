# Web deployment

The Next.js UI has a standalone production build and a non-root Docker image.
It can be deployed for **trusted preview testing**. The complete application is
**not ready for public production access**: development sign-in accepts an
unverified email and can impersonate any development identity. Do not place it
on the public internet or store real personal information in a preview.

## Build and run a trusted preview

From the repository root, configure `.env` using `.env.example`, start
PostgreSQL, and prepare the application:

```bash
pnpm install --frozen-lockfile
docker compose up -d
pnpm db:migrate
pnpm db:baseline-revisions
pnpm build
```

For an existing database, stop API writers before migrating and baselining.
The empty-database baseline is a no-op. Keep a database and storage backup before
upgrades; see [Revisions](revisions.md) for the startup barrier.

Start the API in one terminal. The API reads the repository `.env`; development
sign-in must be explicitly enabled for this preview:

```bash
API_HOST=127.0.0.1 pnpm --filter @livtales/api start
```

Start the production web entry point in another terminal:

```bash
HOSTNAME=127.0.0.1 PORT=3000 API_INTERNAL_URL=http://127.0.0.1:4000 pnpm --filter @livtales/web start
```

Open `http://localhost:3000/sign-in`. Keep both processes bound to loopback or
behind a trusted network boundary. Rebuild before restarting the standalone
entry point after source changes. No development server is needed at runtime.

## CloudBase staging connectivity

The staging environment can be checked through the CloudBase PostgreSQL
gateway without changing the application database. Create a short-lived,
server-only API key in CloudBase, then place these values in the ignored root
`.env` file:

```dotenv
CLOUDBASE_ENV_ID=your-cloudbase-environment-id
CLOUDBASE_APIKEY=your-short-lived-server-api-key
CLOUDBASE_READS_ENABLED=false
CLOUDBASE_REQUEST_TIMEOUT_MS=30000
# Required only for the real read-contract harness below.
CLOUDBASE_CONTRACT_WORKSPACE_ID=staging-workspace-id
CLOUDBASE_CONTRACT_USER_ID=staging-user-id
CLOUDBASE_CONTRACT_EVENT_ID=staging-event-id
# Optional comma-separated expectations; when set, the returned set must match exactly.
CLOUDBASE_CONTRACT_EXPECTED_EVENT_IDS=event-id-1,event-id-2
CLOUDBASE_CONTRACT_EXPECTED_CALENDAR_IDS=event-id-2
# Optional: an event the principal must not be able to read.
CLOUDBASE_CONTRACT_DENIED_EVENT_ID=private-event-id
# Optional page size (1-50, default 50); a small value crosses cursor pages on a small fixture.
CLOUDBASE_CONTRACT_PAGE_LIMIT=2
```

Run the read-only probe:

```bash
pnpm cloudbase:probe
```

The probe queries an intentionally nonexistent table with a zero-row limit. A
`DATABASE_PGRST205` response confirms that the gateway authenticated and
reached PostgreSQL; it does not validate application migrations, transactions,
or native PostgreSQL TCP access. Revoke the key after testing. CloudBase API
keys map to the privileged `service_role` and must never be sent to a browser,
committed to the repository, or used as a substitute for the application's
own authorization.

The probe uses `CLOUDBASE_REQUEST_TIMEOUT_MS` (30 seconds by default, bounded to
1–120 seconds) and reports expired keys, authorization failures, timeouts, and
unexpected gateway responses without printing the key or response payload.
JWT-shaped keys are checked for local expiry before the SDK request; this is
only a diagnostic guard and does not replace CloudBase signature validation.

If the probe returns `ACCESS_TOKEN_EXPIRED`, replace `CLOUDBASE_APIKEY` with a
new short-lived server key and rerun the probe. Do not reuse an expired key or
enable CloudBase reads while the probe is failing. If the read-contract command
reports missing `CLOUDBASE_CONTRACT_*` values, provide identifiers for an
existing staging workspace, user, and visible event; the harness is read-only
and will not create those fixtures.

The current Personal plan is a staging option for this SDK path. Native TCP
access remains a separate deployment decision because it requires a database
endpoint, credentials, SSL settings, and a network route from the API service.
LivTales now exposes a small `@livtales/db` CloudBase RDB transport for
bounded, non-transactional reads. It validates table identifiers, preserves
pagination bounds, and reports the backend capabilities explicitly. The
existing `connectDatabase(DATABASE_URL)` Drizzle/PostgreSQL adapter remains the
runtime default and is intentionally unchanged.

After the read-contract harness passes against staging, set
`CLOUDBASE_READS_ENABLED=true` to opt every API read into the CloudBase
repositories: the event list, the calendar, the Event detail and the to-do,
timeline, itinerary, expense, and reminder projections, search, single
objects, relations, shares, revisions with their comparison and restoration
preview, Trash, the command state, the storage inventory's references, the
Event page layout with its history, and the identity reads behind every
authenticated request (the user, the personal workspace, and workspace
access through membership or an active grant). Search, the command state,
the storage references, and the development sign-in call
`chronelle_object_search` (migration 0021), `chronelle_command_state` (0024),
`chronelle_storage_references` (0025), and `chronelle_identity_sign_in`
(0027) through the gateway's rpc route, so those migrations must be applied
first. The identity reads of one request are sequential gateway requests
rather than one snapshot. `DATABASE_URL` remains required until the backend
mode lands: startup still connects to PostgreSQL. The flag is disabled by
default and must never be enabled solely because the SDK connection probe
succeeds.

The CloudBase transport does not replace the Drizzle adapter for
audited mutations, optimistic concurrency, or multi-table writes. Those
workloads remain on the TCP adapter until the service has a transaction-capable
PostgreSQL route. This keeps the local schema, migrations, and future dedicated
PostgreSQL deployment reusable rather than creating a second canonical data
model.

When the flag is enabled, API startup validates JWT-shaped CloudBase keys before
constructing the gateway client. An expired key therefore fails during startup
instead of allowing the API to start and serving failing read requests. Opaque
provider keys remain accepted because their expiry cannot be verified locally;
the gateway remains authoritative for those keys.

CloudBase RDB reads have a bounded 30-second request timeout by default. Set
`CLOUDBASE_REQUEST_TIMEOUT_MS` to change it within the validated 1–120 second
range when a deployment has a documented latency budget; it must not be used
to mask gateway or quota failures.

### Benchmark CloudBase reads

The API image includes a read-only benchmark over the same identity, list, and
event-panel adapters used by live requests. From a deployed API instance shell,
where the CloudBase environment variables are already available, run:

```bash
node dist/benchmark-cloudbase.js
```

Use `--workload tasks-manual` for the optimized Task list alone, or `--json` for
the full percentile and per-gateway-target report. `--samples` accepts 3-30
measured runs and `--warmups` accepts 0-5 warm-up runs. Locally, the equivalent
command builds the API first and reads the ignored root `.env`:

```bash
pnpm cloudbase:benchmark --workload tasks-manual
```

The benchmark automatically selects the populated member workspace with the
most live objects. It reports only aggregate object counts and timing data; it
does not print identities or object IDs. Its client rejects insert, update, and
delete operations. Run it in staging because the repeated reads consume gateway
quota and can add load to a production database.

### Run the real CloudBase read contract

After the schemas and read adapters are built, run the opt-in, read-only staging
harness:

```bash
pnpm cloudbase:read-contract
```

The harness requires a workspace, user, and visible event already present in the
CloudBase environment. It never inserts, updates, deletes, or grants access. It
walks every event page at the configured page size, checks canonical event
IDs, calendar projections, cursor-page non-overlap, workspace isolation on
returned resources, soft-deletion filtering, and an optional denied-event
assertion. It shares the probe's timeout and local expiry checks, so an expired
key fails before any fixture query. Do not place the API key in shell history or
commit these values to the repository. The JSON output also includes the page
count, the query count, and per-page/calendar/total latency in `timingMs` for
the R1 review and later operational-cost assessment.

### Run the CloudBase write contract

The single-object write check mutates the staging environment and therefore
requires an explicit opt-in in addition to the shared connection variables and
`CLOUDBASE_CONTRACT_WORKSPACE_ID` / `CLOUDBASE_CONTRACT_USER_ID`:

```bash
CLOUDBASE_CONTRACT_ALLOW_WRITES=true pnpm cloudbase:write-contract
```

The harness inserts one probe Event owned by the contract user, then proves
that an update with the current `version` affects one row, that the same update
with a stale version affects none, that four concurrent updates on one version
produce exactly one winner, that a predicate for another workspace matches
nothing, and that a database constraint still rejects a bad write. It deletes
the probe afterwards, also when a step fails. It writes no audit rows: the
gateway path offers neither transactions nor server-side functions, so an audit
record could only follow the update as a second request, and the JSON report
states that limitation explicitly. Run it only against staging.

### Run the CloudBase rpc contract

The rpc check proves that a database function called through the gateway runs
as one transaction. It exercises the write functions of one object family,
selected with `CLOUDBASE_CONTRACT_FAMILY`: `event` (migration 0012, the
default), `task` (0013), `expense` (0014), or `reminder` (0015). Apply the
migration to the environment first (through the console SQL editor when no
TCP route exists, recording its ledger row as for the schema). Then:

```bash
CLOUDBASE_CONTRACT_ALLOW_WRITES=true pnpm cloudbase:rpc-contract
CLOUDBASE_CONTRACT_ALLOW_WRITES=true CLOUDBASE_CONTRACT_FAMILY=reminder pnpm cloudbase:rpc-contract
```

`CLOUDBASE_CONTRACT_FORBIDDEN_USER_ID` optionally names a user without edit
access so the 403 path is exercised. The harness creates one probe object
through `chronelle_<family>_create`, updates it, then proves that a stale
version, a forbidden principal, and an invalid merged state leave nothing
behind, and that four concurrent calls on one version produce one winner. The
probe's audit and revision rows are append-only, so the harness soft-deletes
the probe instead of removing it. Run it only against staging.

### Run the CloudBase linked contract

The linked check proves the cross-object functions,
`chronelle_event_context_create` of migration 0016 and
`chronelle_relation_lifecycle` of migration 0017, through the gateway:

```bash
CLOUDBASE_CONTRACT_ALLOW_WRITES=true pnpm cloudbase:linked-contract
```

It creates a probe Event, links a Task to it in one call, replays the same
command and expects the same child and relation, replays it with different
input and expects a conflict, then calls the function with a request hash the
command table rejects and proves that the child, the relation, and the audit
rows written before that point are not persisted. It then removes the
relation, rejects a stale removal, and recovers it, deletes and recovers
the child the same way, restores the child's first revision, moves the
child to its own scope and back, saves and restores the Event's page
layout, renames both probes as one reversible command, undoes it, and redoes
it, reads the command state after the undo and the redo, and reads the
workspace's storage references, and records a document transfer without
bytes (an upload authorization, its consumption, the finalization into an
attached Document, and a consumed download authorization), reads the
layout history through the table route, and signs the contract user in
again through `chronelle_identity_sign_in`. The probes, the Document
included, end deleted through `chronelle_object_delete`. Run it only
against staging.

`CLOUDBASE_WRITES_ENABLED=true` routes the API's Event, Task, Expense, and
Reminder create and update, linked creation, relation changes, object
deletion, recovery, and revision restore, sharing and permission-scope
changes, Event page layouts, reversible commands, and document transfers
(upload authorization, consumption, finalization, and download
authorization; the storage provider is unchanged) through those functions;
it requires `CLOUDBASE_READS_ENABLED=true` and migrations 0012 through 0057
on the environment (0024, 0025, and 0027 serve reads and sign-in; 0028 the
readiness check; 0029 the revision baseline through the gateway; 0030 and
0031 the sessions a sign-in records and a sign-out revokes; 0032 and 0033
the password credentials and rate-limited verification codes; 0034 the
date-only Task due; 0035 subtasks; 0036 labels and 0037 the Person object
type, after each of which the runtime role grants are reapplied; 0038 the
Task assignee; 0039 the Task location; 0040 People in Events; 0041 subtasks
in Trash with their parent; 0042 standalone creation commands, after which
the runtime role grants are reapplied; 0043 sharing with a Person, which
replaces `chronelle_resource_share` and needs the runtime role grants
reapplied; 0044 the Task duration; 0045 the Task repeat rule; 0046 the manual order of Tasks and Reminders; 0047 the language kept on the account; 0048 the time zone, clock, and week start kept on the account, which replaces `chronelle_user_locale_update` with `chronelle_user_preferences_update` and is applied before the API built from it starts; 0049 the rail order and hidden collections kept on the account, which redefines `chronelle_user_preferences_update` in place; 0050 the Person nickname, description, contacts, and labels, after which the runtime role grants are reapplied for `person_contacts` and `person_labels`; 0051 friends (`user_connections`, `user_invitations`, the `chronelle_friend_*` functions the readiness check requires, and `chronelle_assert_person_state` replaced in place), after which the runtime role grants are reapplied for the two new tables; 0052 shares waiting on an invitation (`pending_shares`, the `chronelle_pending_share_*` and `chronelle_workspace_member_*` functions the readiness check requires, `chronelle_resource_share` redefined with a friend grantee, and the friend respond, withdraw, and claim functions replaced in place), after which the runtime role grants are reapplied for the new table and for deleting workspace members; 0053 the tabs kept on the account for each event, which redefines `chronelle_user_preferences_update` in place; 0054 what is shared each way with a person (`chronelle_person_shares_list`, which the readiness check requires); 0055 the username every account carries (existing accounts named from their display names) and the discovery switches, which replaces `chronelle_identity_sign_in` with a six-argument one and is applied before the API built from it starts, installs the trusted `pg_trgm` and `unaccent` extensions with trigram indexes on `users` for Find people, and adds `chronelle_username_available`, `chronelle_account_update`, `chronelle_users_search`, `chronelle_user_lookup`, and `chronelle_friend_request`, which the readiness check requires; after it the runtime role script is reapplied for its `EXECUTE` grants on the search functions; 0056 the Welcome step (`users.onboarded_at`, every existing account completed), `chronelle_identity_sign_in` and `chronelle_account_update` redefined in place, and `chronelle_password_credential_lookup` replaced with one that takes an email or a username, applied before the API built from it starts; 0057 cards resolved by their link, else by any email contact (`persons.email` dropped, `chronelle_person_account` added, which the readiness check requires, `chronelle_resource_share`, `chronelle_person_shares_list`, and the person write helpers redefined in place, and `chronelle_assert_person_state` replaced with a three-argument one), applied before the API built from it starts; 0058 invitation links (`user_invitations.email` nullable, `channel` and `token` added; `chronelle_friend_invite` and `chronelle_friend_resend` replaced with versions that take the token and channel, applied before the API built from it starts; `chronelle_friend_invitation_json` and `chronelle_friend_invitations_claim` redefined in place; `chronelle_friend_link`, `chronelle_friend_invitation_peek`, and `chronelle_friend_invitation_accept` added, which the readiness check requires; the link the API emails and answers is built from `WEB_PUBLIC_URL`); 0059 the place of a schedule item (`events.location`, `chronelle_assert_event_location`, the Event serialize, insert, validate, and apply functions and `chronelle_command_content` redefined in place); 0060 the Note object type (`objects_type_valid` admits `note`, the `notes` table, `chronelle_assert_note_state`, the `chronelle_note_*` write steps, `chronelle_note_create`, `chronelle_note_update`, and `chronelle_note_list`, which the readiness check requires, and the write core, restore, search, and relation rule redefined in place), applied before the API built from it starts; after it the runtime role script is reapplied for its grants on `notes`; 0061 the description of an Event and a Task (`events.description`, `tasks.description`, `chronelle_assert_description`, the Event and Task serialize, insert, validate, and apply functions and `chronelle_command_content` redefined in place); 0062 the sections of an Event's To-dos and Expenses (the `sections` table, `tasks.section_id` and `expenses.section_id`, `chronelle_rank_between`, `chronelle_assert_section_member`, the `chronelle_section_*` functions the readiness check requires, and the Task and Expense serialize, insert, validate, and apply functions redefined in place), applied before the API built from it starts; after it the runtime role script is reapplied for its grants on `sections`; 0063 shares narrowed to a view or a section of an Event (`resource_grants.scope`, `section_id`, and the wider unique key; `chronelle_grant_admits` and `chronelle_section_visible`, which the readiness check requires; the `chronelle_can_*` functions, the held role, `chronelle_person_shares_list`, and `chronelle_section_list` redefined in place; `chronelle_resource_share` replaced with one that takes a scope), applied before the API built from it starts; 0064 when each workspace was last opened, kept on the account (`users.workspace_recency`), which redefines `chronelle_user_preferences_update` in place; 0065 leaving a share (`chronelle_resource_share_leave`, which the readiness check requires), applied before the API built from it starts. With `LIVTALES_BACKEND=postgres` (the default) the two
flags are staged opt-ins and the API still connects to `DATABASE_URL` at
startup; the CloudBase backend below removes that connection.

Migration `0066_resolve_identity_session.sql` adds the read-only
`chronelle_identity_session_resolve` function for identity and workspace
resolution. Apply it through the console SQL editor before redeploying the
CloudBase API: readiness requires the function. It changes no tables, needs no
revision baseline or runtime role changes, and remains compatible with older
API versions. PostgreSQL TCP deployments apply it with `pnpm db:migrate`.

Migration `0067_add_list_candidate_functions.sql` adds the read-only
`chronelle_event_list_candidates`, `chronelle_task_list_candidates`, and
`chronelle_person_list_candidates` functions and their shared collection
helper. Apply it through the console SQL editor before redeploying the
CloudBase API: readiness requires the three public functions. It changes no
tables, needs no revision baseline or runtime role changes, and remains
compatible with older API versions. PostgreSQL TCP deployments apply it with
`pnpm db:migrate`.

Migration `0068_remove_redundant_grant_index.sql` drops only
`resource_grants_resource_principal_idx`; the wider
`resource_grants_principal_unique` index retains the same lookup prefix and
enforces scoped uniqueness. It removes no records and needs no revision
baseline, runtime role changes, or API redeployment. Apply it through the
CloudBase console SQL editor, or with `pnpm db:migrate` for PostgreSQL TCP.
The index drop briefly locks `resource_grants`, so use a quiet period.

Migration `0069_add_task_list_hydration.sql` adds the read-only
`chronelle_task_list_hydrate` function. CloudBase Task lists use it after
candidate selection to load canonical rows, typed state, labels, visible Event
contexts, parents, and subtask progress in one gateway request. Apply it through
the CloudBase console SQL editor before redeploying the API: readiness requires
the function. It changes no tables, needs no revision baseline or PostgreSQL
runtime-role changes, and remains compatible with older API versions. The
migration denies `PUBLIC`, `anon`, and `authenticated` execution and grants
`service_role` execution when those managed roles exist. PostgreSQL TCP
deployments apply it with `pnpm db:migrate`.

Migration `0070_add_person_list_hydration.sql` adds the read-only
`chronelle_person_list_hydrate` function. CloudBase Person lists use it after
candidate selection to load canonical rows, typed state, contacts, and labels
in one gateway request. Apply it through the CloudBase console SQL editor
before redeploying the API: readiness requires the function. It changes no
tables, needs no revision baseline or PostgreSQL runtime-role changes, and
remains compatible with older API versions. The migration denies `PUBLIC`,
`anon`, and `authenticated` execution and grants `service_role` execution when
those managed roles exist. PostgreSQL TCP deployments apply it with
`pnpm db:migrate`.

Migration `0071_add_linked_identities.sql` adds `user_identities` and
`identity_exchanges`, backfills all existing external identities without
changing canonical user IDs, and adds the user-session, WeChat exchange, and
explicit-link functions required by the API. Apply it before deploying an API
with `ENABLE_WECHAT_AUTH=true`. Reapply the PostgreSQL runtime-role policy for
the new tables; on CloudBase, apply it through the console SQL editor before
redeploying because readiness requires the three new functions. The migration
retains the old identity columns and resolver during the rolling deployment.

Migration `0072_add_shared_spaces.sql` adds `chronelle_workspace_create`,
`chronelle_workspace_update`, `chronelle_workspace_member_role`, and
`chronelle_workspace_leave`, and replaces `chronelle_workspace_member_add` and
`_remove` so an Owner can make other members Owners, a shared workspace keeps
at least one Owner, and each membership change locks its workspace first. It
changes no tables, needs no baseline or runtime-role change, and is
compatible with older API versions. On CloudBase, apply it through the
console SQL editor before redeploying the API, because readiness requires the
four new functions; it revokes browser-role execution and grants
`service_role` execution when those managed roles exist. Deploy the web and
the Mini Program with or after this API: the API refuses an Owner share of a
single record, which only older clients offer.

Migration `0073_carry_scoped_rows_with_objects.sql` prepares moving a record
to another workspace; nothing moves one yet. It re-adds, under the same
names, the keys by which typed rows (events, tasks, expenses, reminders,
documents, notes), relations, grants, shares waiting on an invitation, and
document transfer authorizations name their object, now `ON UPDATE CASCADE`;
replaces `sections_event_id_fkey` with `sections_event_workspace_fk` on
`(workspace_id, event_id)`, so a section lives in its Event's workspace and
follows it; and redefines `chronelle_validate_relation_version` (a relation
whose only change is its workspace keeps its version) and
`chronelle_resource_grant_scope_check` (the section's workspace is no longer
compared, the new key implies it) in place. One update of
`objects.workspace_id` over an Event's whole scope then carries those rows.
The permission scope and People cards keep `NO ACTION` keys, so an update
that leaves a scoped record behind, or moves a card, fails. Dropping a
foreign key takes ACCESS EXCLUSIVE locks on its table and on `objects`, so
apply 0073 with API writers stopped; it gives up after five seconds waiting
for a lock. The keys are added `NOT VALID`, which keeps it quick. Migration
`0074_validate_carried_keys.sql` then validates them under SHARE UPDATE
EXCLUSIVE locks, so reads and writes continue while it scans. It fails if a
section's workspace differs from its Event's; this query must return no rows
before it runs:

```sql
SELECT s.id, s.workspace_id, s.event_id
FROM sections s
LEFT JOIN objects o ON o.workspace_id = s.workspace_id AND o.id = s.event_id
WHERE o.id IS NULL;
```

Neither migration changes columns or needs a baseline or a runtime-role
change, and both are compatible with older API versions, so the API may be
deployed before or after them. On CloudBase, apply both through the console
SQL editor, 0073 with the API stopped; the readiness check is unchanged.
PostgreSQL TCP deployments apply them with `pnpm db:migrate`.

Enable the WeChat routes only after CloudBase authentication is configured:

```dotenv
ENABLE_WECHAT_AUTH=true
CLOUDBASE_ENV_ID=your-cloudbase-environment-id
CLOUDBASE_WECHAT_PROVIDER_IDS=wechat,weixin,wx,wx_openid
CLOUDBASE_AUTH_TIMEOUT_MS=10000
```

Verify the provider identifiers against `/auth/v1/user/me` in the target
environment. The API sends the end-user bearer token only to that endpoint and
exchanges it for an opaque LivTales session. Keep `CLOUDBASE_APIKEY` and any
WeChat AppSecret server-side. To roll back the route without altering linked
accounts, set `ENABLE_WECHAT_AUTH=false` and redeploy the API.

### Run on the CloudBase backend

`LIVTALES_BACKEND=cloudbase` serves every read and write from the gateway.
`DATABASE_URL` is not read; the API never opens a PostgreSQL connection, and
a service that still reached one would fail with
`PostgreSQL is not available: LIVTALES_BACKEND=cloudbase serves from the
gateway`. Both CloudBase flags are implied and may not be set to `false`.
`CLOUDBASE_ENV_ID` and a fresh `CLOUDBASE_APIKEY` are required as for the
flags, and the document storage provider is configured as before.

At startup the API calls `chronelle_backend_readiness` (migration 0028)
instead of checking the revision baseline through PostgreSQL. It refuses
to listen, logging `startup_failed` with the reason, when the function is
not callable (the migrations are not applied), when any function the
adapters call is missing (the log names them), or when an object has no
revision for its current version (`pnpm cloudbase:baseline` captures the
baseline through the gateway, as `db:baseline-revisions` does through
PostgreSQL). Every gateway request is logged as a `cloudbase`
event with its kind (`select`, `insert`, `update`, `delete`, `rpc`), target,
duration in milliseconds, and outcome (`ok`, `timeout`, `rejected` with the
gateway's status and code, or `failed`): successes at debug level,
rejections below 500 (conflicts, denials, missing records) at info level,
and timeouts, failures, and 5xx rejections at error level. Aggregate those
lines for latency percentiles, rejection counts by code, and error rates.

Switching back is configuration: set `LIVTALES_BACKEND=postgres` with a
`DATABASE_URL` for the same database. The functions stay installed and
unused; nothing else changes. The operating procedure, including the order
of migrations and the verification commands, is in
[the CloudBase backend runbook](cloudbase-backend-runbook.md).

`LIVTALES_BACKEND`, `LIVTALES_MIGRATIONS_DIR`, and `LIVTALES_RUNTIME_ROLE`
were named `CHRONELLE_*` before. The API, the migration runner, and the
runtime role script stop, naming the replacement, when a legacy name is set
without the new one or with a different value; both names with the same value
are accepted. Operator note: rename the variable on the `chronelle-api`
service at its next deploy (add `LIVTALES_BACKEND=cloudbase` before releasing
the new image, then remove `CHRONELLE_BACKEND` once no rollback to an older
image is expected).

### Seed the test accounts

After a deployment to a testing environment, `pnpm seed:test-data` creates
the three test accounts and their data (listed in
[local development](local-development.md#test-accounts-and-data)) through
the gateway, the way the deployed API serves them:

```bash
LIVTALES_BACKEND=cloudbase CLOUDBASE_ENV_ID=... CLOUDBASE_APIKEY=... \
  WEB_PUBLIC_URL=https://<the web service's public origin> \
  SEED_PASSWORD='choose a long one' pnpm seed:test-data
```

The values are the ones the API service runs with (the root `.env` holds
the staging pair; `node --env-file-if-exists=.env` loads it). The migrations
the API needs must be applied first, as for the API itself. The seed prints
the accounts, the password, what it created, and Mei's open invitation
link; on a second run it reports the accounts as existing and creates
nothing. It never runs on its own at deployment: an operator runs it once
per environment, after a data wipe when a fresh set is wanted.

## Containerized web

Build the UI image from the repository root:

```bash
docker build -f apps/web/Dockerfile -t livtales-web .
```

When the API runs on the Docker host on a trusted interface, this preview
command exposes only the web port on loopback:

```bash
docker run --rm --name livtales-web \
  --add-host=host.docker.internal:host-gateway \
  --publish 127.0.0.1:3000:3000 \
  --env API_INTERNAL_URL=http://host.docker.internal:4000 \
  livtales-web
```

An API bound only to host loopback is not necessarily reachable from a
container. On a shared container network, use the API service's internal DNS
name instead. The browser always calls same-origin `/api`; it never receives
the internal API address. `API_INTERNAL_URL` is a runtime server variable, not
a `NEXT_PUBLIC_*` value. It must name a trusted HTTP(S) API origin.

The image includes the standalone server, static bundles, and the app-router
icon, Open Graph image, and manifest routes. Link previews name the Open Graph
image by an absolute URL on the origin the page was requested at (the first
`X-Forwarded-Host`, else `Host`, over https when `X-Forwarded-Proto` says so), so
a proxy in front of the web service must pass the public host and scheme.
Local worktrees, attachment storage, test output, nested environment files,
and agent directories are excluded from the build context.
The browser release gate starts the same standalone entry point on the host.

## Private container stack

The preview stack starts PostgreSQL, applies migrations and revision baselines,
configures the restricted runtime login, then starts the API and web images.
It publishes only the web port on loopback.
API and database ports remain private on an internal Docker network. Only the
web service also joins an ingress bridge for its loopback publication. The API
image contains compiled workspace packages, production dependencies, and SQL
migrations. Neither image includes application source/tests or development
tooling. Upstream production packages retain their distributed runtime files;
dependency-local agent settings are excluded from the API artifact.

Build both images from the repository root:

```bash
docker build -f apps/api/Dockerfile -t livtales-api:local .
docker build -f apps/web/Dockerfile -t livtales-web:local .
```

Set a unique, URL-safe `POSTGRES_PASSWORD` in the private `.env` file, using
letters, digits, underscores, or hyphens. Also set a distinct
`RUNTIME_DATABASE_PASSWORD`, 24-128 characters from that same alphabet, for the
API's `chronelle_runtime` login. Set `ENABLE_DEVELOPMENT_AUTH=true`
only for trusted preview testing (the Compose file passes it to the web
service as `WEB_DEVELOPMENT_SIGN_IN`, which renders `/sign-in/development`);
email and password accounts work without it once `EMAIL_PROVIDER=smtp`,
`SMTP_URL`, and `EMAIL_FROM` name a mail transport (`EMAIL_FROM` carries
the display name users see, LivTales, as in `.env.example`; the default `log`
provider writes verification codes to the API log and is not for a
deployment; `EMAIL_PROVIDER=file` with `EMAIL_FILE_PATH` appends them to a
file on the instance for an internal test whose operator hands codes to
testers by other means). Friend invitation emails link to the web origin
in `WEB_PUBLIC_URL` (for example `https://livtales.example`); set it on
the API service, or the links point at `http://localhost:3000`. Start it from the repository root:

```bash
docker compose --env-file .env -f infrastructure/compose.preview.yaml up -d --wait
```

Open `http://localhost:3000/sign-in`. `WEB_PORT` changes the loopback port.
`API_IMAGE` and `WEB_IMAGE` can name versioned or digest-pinned images.
The API entry point inside its image is `node dist/server.js`; host workspace
start commands are unchanged. Migration and baseline commands run separately
from the API server, using compiled code rather than a TypeScript runner.

Both application containers use UID 1000, a read-only root filesystem, dropped
capabilities, and no-new-privileges. Documents live in a named volume owned by
that user; the web cache and temporary files use tmpfs. Health checks verify
HTTP availability, not continuous database or storage readiness. Do not mount
an untrusted storage tree or expose development sign-in outside the trusted
boundary. The API receives only its runtime database credential, not the owner
password used by migrations and administrative provisioning.

Stop API writers before upgrading an existing stack:

```bash
docker compose --env-file .env -f infrastructure/compose.preview.yaml stop web api
docker compose --env-file .env -f infrastructure/compose.preview.yaml run --rm migrate
docker compose --env-file .env -f infrastructure/compose.preview.yaml run --rm runtime-role
docker compose --env-file .env -f infrastructure/compose.preview.yaml up -d --wait
```

Back up the database and matching document volume before upgrades. Keep the
same password and project name for an existing database. Ordinary `down`
preserves named volumes; do not add `--volumes` to a persistent preview stack.

Upgrade the Compose file together with the images. Since the LivTales rename
the API image keeps documents in `/app/.livtales/storage` instead of
`/app/.chronelle/storage`, and the migrate command runs the `@livtales/*`
packages, so an earlier `compose.preview.yaml` mounts the `documents` volume
where the API no longer looks and its migrate step fails. The volume keeps its
name, so the new file mounts the existing documents. Any other deployment of the
API image that sets `LOCAL_STORAGE_ROOT=/app/.chronelle/storage` must set
`/app/.livtales/storage` (moving a volume mounted there) or unset it: the image
no longer creates `/app/.chronelle`, the `node` user cannot create it, and every
upload fails while the health check still passes.

### Database privilege boundary

`infrastructure/database/runtime-role.sql` is a version-controlled administrative
policy, separate from application schema migrations. It is applied transactionally
after migrations/baselines and before the API starts. The one-shot `runtime-role`
container uses PostgreSQL's client and mounts the policy read-only. Deploy this
SQL file alongside the Compose file, even when using registry-hosted images.

The policy requires a dedicated LivTales database: it revokes public schema,
table, function, sequence, and database privileges before granting the runtime
login its explicit operations. Do not apply it to a database shared with other
applications. Existing runtime roles with elevated attributes, role memberships,
owned objects, role-specific session settings, or external cluster grants
(including parameter privileges) are refused. An existing safe login is
reconfigured and its password updated; stop API writers before rotating this
secret, then recreate the API container so it receives the new value.
Never pass the owner credential
to API processes or use the runtime credential to run migrations.

Runtime can read and create application records, update mutable state
(sessions, credentials, and verification codes included: sign-out, the
last-seen touch, the failed-attempt lock, and code consumption are updates,
never deletions), and delete revoked resource grants. Audit events, revision
snapshots, and command history are read/insert only. The migration ledger is inaccessible. Runtime
cannot create schema or temporary objects, disable integrity triggers, truncate
tables, or permanently delete canonical objects/relations. Table and column ACL
drift in the public schema is reset. Default privileges apply to objects created
by the provisioning administrator, which must also run migrations; its new
tables/functions receive no automatic runtime grant. Other schemas and object
creators are outside this policy. Add explicit grants whenever a schema migration
needs new operations.

Provisioning outside Compose uses a database administrator's `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, and `PGPASSWORD` environment settings, plus the separate
`RUNTIME_DATABASE_PASSWORD`. An optional `LIVTALES_RUNTIME_ROLE` must be
`chronelle_runtime` or that prefix plus an underscore and lowercase alphanumeric
suffix, up to 63 characters total: the variable is named for LivTales, but the
PostgreSQL role keeps its `chronelle_runtime` name. The legacy
`CHRONELLE_RUNTIME_ROLE` stops the script unless it matches
`LIVTALES_RUNTIME_ROLE`. Run with startup files disabled:

```bash
psql -X --no-password --file infrastructure/database/runtime-role.sql
```

Inject credentials through private environment/secret configuration; do not
echo them or enable query/parameter tracing during provisioning. The script
does not modify cluster authentication rules, server log policy, or roles outside
the configured runtime login. Managed database administrator capabilities and
secret rotation must be verified on the deployment target.

These privileges limit a compromised API account's administrative reach. They do
not enforce per-user or per-workspace access inside PostgreSQL: every request
still needs application authorization, and RLS remains a separate defense-in-depth
task. Database owners and administrators remain trusted and can bypass this
boundary. Backup/restore, retention, production storage, and identity are separate
release requirements.

## Release validation and publication

After building the local images, run the disposable container gate:

```bash
API_IMAGE=livtales-api:local WEB_IMAGE=livtales-web:local pnpm test:containers
```

It creates a unique Compose project with synthetic credentials and an empty
database, inspects runtime contents and ownership, checks private networking and
restricted database privileges, exercises typed planning, context commands,
Undo/Redo, restoration, trash recovery and sharing/revocation,
round-trips an authorized attachment through the web proxy, rejects unauthorized
downloads, verifies persistence after API restart, and completes an accepted web
request after SIGTERM. Next.js finishes cleanup with exit code 143; the idle API
closes its database pool and exits with code 0. Sustained-load request draining
and the deployment's termination deadline still need validation on the final target.
It removes only its disposable containers, network, and volumes on completion
or failure. Docker Engine with Compose and Node.js 24 or newer are required.

The same gate runs a database-and-files recovery drill after stopping the
fixture's API and web writers. It captures a PostgreSQL custom-format dump and
the matching document volume, then restores into a second UUID-owned Compose
project with distinct, empty volumes. A deliberately truncated dump must fail
without leaving partial schema or data; the complete dump is restored in one
transaction. The normal migration and revision-baseline startup runs afterward.

The drill compares every public table before and after restore and startup,
including canonical IDs, typed records, relations, grants, audit events,
revisions, deleted objects, and the migration ledger. Restored files retain
private modes and runtime ownership. Through the web proxy, it verifies the
same identities and history, Viewer reads without writes, denied unrelated
access, live downloads, and recovery of a trashed binary attachment. Restoring
an Event revision and recovering the Document append history without changing
prior audit/revision rows or the source database. Development sessions must be
created again after restart.

This is a synthetic release test, not a backup service or an operator restore
command. Archives remain in process memory, with a 16 MiB output limit and a
three-minute timeout per Docker command. No archive is accepted from an
external path or retained as a release artifact. Only archives created by the
drill are trusted for SQL execution and file extraction. Cleanup removes only
the two disposable projects, never a persistent preview stack. Abruptly killing
the runner or losing the Docker daemon can leave its temporary resources behind.

Production recovery still requires encrypted, access-controlled off-host
backups, monitored scheduling and retention, credential/key recovery, and
deployment-scale restore timing. Database roles and ownership are provisioned
by the target environment, not imported by this drill; PostgreSQL role/ACL
recovery needs its own operational procedure. Stop all writers to obtain a
matching database/file pair unless the storage deployment provides a verified
snapshot protocol. A logical database dump alone does not make file storage
consistent. Live Tencent COS backup/version retention and point-in-time
recovery are not exercised here.

Tag and manual releases call the same CI workflow from the triggering revision.
Manual runs default to `dry_run=true`: they validate, transfer, load, and verify
the images without registry login or pushes. Set `dry_run=false` explicitly to
publish a manual release. Version-tag pushes publish after validation succeeds.
Registry write permission belongs only to the publishing job, which depends on
successful quality, browser, and running-container gates. The container job
retains the tested images as a one-day artifact; publishing loads that artifact
and verifies each image's revision label instead of building again. Missing or
expired artifacts fail the release and require a fresh validation run.

Images receive `sha-<full-commit-sha>` tags and, for a tag-triggered release,
the triggering version tag. Existing short SHA tags are not updated. Prefer
image digests for deployments: tags can be reassigned, and publishing the API
and web images is not an atomic registry operation. A failed push can leave
one validated image published without its counterpart; retry the publishing
job while the validated artifact exists. This workflow does not deploy services
or certify development authentication for public use.

## Runtime protections and limits

- Terminate TLS at the deployment ingress and enable HSTS there after HTTPS
  is confirmed. Keep PostgreSQL, storage, and API listeners private.
- Do not cache authenticated routes or `/api` at the CDN. Both API and proxy send
  `Cache-Control: private, no-store`, preserves download disposition, forwards
  only selected headers, and does not follow upstream redirects.
- The proxy preserves response content type, attachment disposition, and request
  ID. It leaves response framing to the web server, omitting upstream encoding
  and length headers because fetch can decompress the response body.
- The proxy starts one 30-second deadline at route entry, covering incoming
  body reads and upstream work, including streamed responses. A deadline before
  response headers produces 504; an observed client cancellation produces 408;
  unreachable upstreams produce 503. Errors omit internal addresses and exception
  details. After headers are sent, cancellation terminates the response stream.
  A dispatched mutation may already have committed: retain existing command IDs
  and expected versions, refresh state, and do not retry as a fresh operation.
- API and proxy permit 1 MiB ordinary request bodies and 25 MiB on the raw file
  upload route. The API's native multipart route permits one 9 MiB file plus
  64 KiB of framing. The proxy counts actual bytes, validates declared length, and
  cancels rejected or abandoned bodies before forwarding. Buffers grow with
  received bytes; declared sizes alone do not allocate them. Browser uploads
  reject oversized files before reading/hashing. This remains bounded buffering,
  not direct upload streaming or a global memory/concurrency budget.
- Enforce matching byte, header, connection, concurrency, and slow-client limits
  at ingress. The API sets a 30-second Node request-receipt timeout; its enforcement
  follows Node's connection-check schedule and does not cancel database work.
  Framework/ingress buffering and rate limits require deployment validation.
- API request logs contain generated request IDs, method, route template, status,
  and duration. They omit raw URLs, query strings, credentials, payloads, filenames,
  and arbitrary exception details. HTTP parser failures log only status. Ordinary
  API responses return `x-request-id`, which the proxy preserves for correlation.
  Configure the same privacy policy at ingress and in error-reporting integrations;
  existing logs require their own retention/access review. Startup failures emit
  a stable error code without exception text; inspect configuration through a
  controlled diagnostic workflow rather than enabling raw request logging.
- Response headers prevent framing, MIME sniffing, referrer leakage, embedded
  plugin content, and off-origin form submissions. The script policy below
  applies to HTML documents, including not-found pages.

## Script Content Security Policy

Each document response receives a fresh 128-bit random nonce. Next.js applies
that nonce to its framework, page, and inline hydration scripts. Production
uses `script-src 'nonce-...' 'strict-dynamic'` and `script-src-attr 'none'`:
initial scripts need the nonce, and trusted scripts can load their descendants.
Unapproved parser scripts, inline handlers, and string evaluation are blocked.
Only the development server permits `unsafe-eval` for framework debugging.
Caller-supplied nonce and policy headers are overwritten, including on prefetch
requests. There is no script `unsafe-inline` allowance.

The root layout forces dynamic rendering. HTML is private and non-cacheable;
do not add static export, page caching, or a CDN HTML cache without redesigning
the nonce contract. This adds server-rendering work per document request compared
with a static shell. JavaScript/CSS bundles retain Next.js immutable caching.
The framework owns cache headers; dynamic HTML errors stay non-cacheable and
missing static assets return non-executable plain text. API routes and private
transfers retain their existing body limits and cache policy, outside the page
middleware.

This follows the [Next.js nonce integration](https://nextjs.org/docs/app/guides/content-security-policy)
and is defense in depth, not a substitute for escaping or authorization. It does
not establish connection/style origin policies, TLS, provider trust, or token
revocation. Future external scripts must use a reviewed nonce-aware integration;
do not relax production policy with `unsafe-inline` or `unsafe-eval`. Revalidate
the policy through the actual ingress and run an independent security review
before public launch.

## Public launch gate

The optional [Tencent COS adapter](storage.md) requires a private bucket,
least-privilege credentials, browser CORS, and API egress. The supplied private
Compose stack uses local storage and intentionally does not enable that egress.
Simulated COS tests do not replace validation on the deployed bucket.

Before exposing the application publicly:

1. Sessions are durable and revocable, the email and password method with
   email verification exists, the browser session is an httpOnly cookie, and
   the account screens replace the development sign-in; still required:
   `ENABLE_DEVELOPMENT_AUTH` and `WEB_DEVELOPMENT_SIGN_IN` left unset in the
   deployment, and a mail transport configured.
2. Configure durable private storage, backups, restore drills, and least-privilege
   database/storage credentials. Run the authorization and attachment suites
   against the deployed topology.
3. Configure TLS, ingress limits, origin policies, monitoring, alerting, and
   secrets management. Revalidate the script CSP through ingress and conduct a
   security review.
4. Run `pnpm check`, `pnpm test:e2e`, both container builds, and smoke-test sign-in,
   shared Viewer access, uploads/downloads, recovery, and API outage behavior
   on the actual deployment target.

No cloud account, domain, infrastructure, or deployment is created by the
application.
