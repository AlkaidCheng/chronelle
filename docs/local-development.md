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
and the runtime role needs no change. Migration
`0048_add_user_time_preferences.sql` adds `users.time_zone`, `hour_cycle`,
and `week_start` (each null until chosen, with check constraints) and
replaces `chronelle_user_locale_update` with
`chronelle_user_preferences_update(user_id, preferences jsonb)`, one merging
write for every account preference; the function count is unchanged and the
runtime role needs no change. Apply 0048 before deploying an API built from
this change: the API's startup readiness check requires the new function,
and an API built before it fails only the language change until it is
redeployed. Migration `0049_add_user_rail_preference.sql` adds `users.rail`
(`{}` by default, checked as an object whose `order` and `hidden` are arrays
of strings) and redefines `chronelle_user_preferences_update` to merge it;
the function count is unchanged and the runtime role needs no change. Migration `0050_add_person_fields.sql` adds `persons.nickname`
and `persons.description`, the `person_contacts` table (typed contacts in
kept order, with one email contact backfilled per person that had an email)
and the `person_labels` table, keeps `persons.email` as the first email
contact through `chronelle_person_set_contacts`, and replaces the Person
step functions in place; `chronelle_person_create` and
`chronelle_person_update` keep their signatures, so the readiness check is
unchanged, but the runtime role grants must be reapplied for the two new
tables. Migration `0051_add_user_connections.sql` adds `user_connections`
and `user_invitations`, the `chronelle_friend_*` functions (list, invite,
respond, withdraw, remove, resend, invitations_claim; the readiness check
requires the seven), and replaces `chronelle_assert_person_state` in place
so a person may be linked to a friend of a workspace member; the runtime
role grants are reapplied for the two new tables. Friend invitation emails
link to `WEB_PUBLIC_URL` (`http://localhost:3000` when unset). Migration
`0052_queue_shares_for_invited.sql` adds `pending_shares` (a share waiting
on a request or invitation, granted when it is accepted), redefines
`chronelle_resource_share` with `friend_id` as a third grantee argument,
adds `chronelle_pending_share_create`, `_list`, and `_revoke` and
`chronelle_workspace_member_list`, `_add`, and `_remove` (the readiness
check requires the six), and replaces `chronelle_friend_respond`,
`chronelle_friend_withdraw`, and `chronelle_friend_invitations_claim` in
place so answering a request settles the shares waiting on it; the runtime
role grants are reapplied for the new table and for deleting workspace
members. Migration `0053_add_user_event_tabs_preference.sql` adds
`users.event_tabs` (`{}` by default, checked as an object keyed by event id
whose values are objects with `order`, `hidden`, and `removed` arrays of up
to 40 strings) and redefines `chronelle_user_preferences_update` to merge it
one event at a time; the function count is unchanged and the runtime role
needs no change. Migration `0054_add_person_shares_list.sql` adds
`chronelle_person_shares_list`, the read behind `GET /api/persons/:id/shares`
on the rpc path (the readiness check requires it); it changes no table, and
the runtime role, which reads the same rows through the PostgreSQL store,
needs no change. Migration `0055_add_username_and_discovery.sql` adds
`users.username` (required, unique without regard to case, checked for
shape; every existing account gets one from its display name, oldest first,
and a trigger gives one to any insert that brings none), `users.find_by_name`,
and `users.find_by_email` (true by default); replaces
`chronelle_identity_sign_in` with one that takes the username sign-up chose
(the old five-argument function is dropped, so the API built from 0055 must
start after it); and adds `chronelle_username_available`,
`chronelle_account_update`, `chronelle_users_search`,
`chronelle_user_lookup`, and `chronelle_friend_request`, which the readiness
check requires. It also installs the `pg_trgm` and `unaccent` extensions
(both trusted, so the migrating role needs no superuser), adds
`chronelle_search_fold` and two trigram indexes on `users` for Find people,
and the runtime role script grants `EXECUTE` on the fold, `unaccent`, and
`similarity` functions, so the script is reapplied after this migration.
Migration 0056 adds `users.onboarded_at` (the Welcome step; every existing
account counts as completed), redefines `chronelle_identity_sign_in` and
`chronelle_account_update` in place (a password account starts with the
step ahead; the name and the step's completion are set through the
account update), and replaces `chronelle_password_credential_lookup` with
one that takes a login, an email or a username. The API built from it
starts after it. Migration `0057_resolve_persons_by_contacts.sql` drops
`persons.email` (the mirror of the first email contact) with its check
constraint and the `chronelle_person_first_email` and
`chronelle_person_contacts_with_email` helpers; adds
`chronelle_person_account`, the account a card stands for (the linked one,
else the one account whose email equals any email contact of the card and
that can be found by email), which the readiness check requires; redefines
`chronelle_resource_share` and `chronelle_person_shares_list` in place to
use it, and the person insert, validate, serialize, contact, and request
helpers in place without the column; and replaces the four-argument
`chronelle_assert_person_state` with a three-argument one (the old one is
dropped). The API built from it starts after it; the runtime role needs no
change.

Migration `0058_add_invitation_links.sql` makes `user_invitations.email`
nullable and adds `channel` (email or link) and the token itself; it
replaces `chronelle_friend_invite` and `chronelle_friend_resend` with
versions that take the token and the channel (the API built from 0058 must
start after it), redefines `chronelle_friend_invitation_json` and
`chronelle_friend_invitations_claim` in place, and adds
`chronelle_friend_link`, `chronelle_friend_invitation_peek`, and
`chronelle_friend_invitation_accept`, which the readiness check requires;
the runtime role needs no change. Invitation links point at
`WEB_PUBLIC_URL` (`http://localhost:3000` when unset).

Migration `0059_add_event_location.sql` adds `events.location` (null, or 1
to 240 trimmed characters, the same rule as a Task's) with
`chronelle_assert_event_location`, redefines `chronelle_serialize_event`
and the Event insert, validate, and apply functions in place to carry it,
and redefines `chronelle_command_content` so a reversible Event command
carries the place. The API built from it can start before or after it (an
older API leaves the column null); the runtime role needs no change.

Migration `0060_add_notes.sql` adds the Note object type: `objects_type_valid`
admits `note`, the `notes` table holds the text (at most 20,000 characters),
`chronelle_assert_note_state` and the `chronelle_note_*` steps supply the
family to the write core, `chronelle_note_list` is the Notes projection the
readiness check requires, and the write core, restore, search, and relation
rule are redefined in place to admit the type. The API built from it starts
after it, and the runtime role script is reapplied for its grants on `notes`.

Migration `0061_add_event_and_task_descriptions.sql` adds `events.description`
and `tasks.description` (null, or 1 to 2,000 trimmed characters) with
`chronelle_assert_description`, redefines the Event and Task serialize,
insert, validate, and apply functions in place to carry them, and redefines
`chronelle_command_content` so a reversible command carries the description.
The API built from it can start before or after it (an older API leaves the
column null); the runtime role needs no change.

Migration `0062_add_view_sections.sql` adds the `sections` table (a named
group in an Event's To-dos or Expenses view, with a description and a rank
in the scheme Tasks use), `tasks.section_id` and `expenses.section_id`
(cleared when the section is deleted), the `chronelle_section_create`,
`chronelle_section_update`, `chronelle_section_delete`, and
`chronelle_section_list` functions the readiness check requires,
`chronelle_rank_between` (the shared package's `rankBetween()` in SQL),
`chronelle_assert_section_member` (a record carries only a section of the
matching view of the Event whose scope it inherits), and redefines the Task
and Expense serialize, insert, validate, and apply functions in place to
carry `sectionId`. The API built from it starts after it, and the runtime
role script is reapplied for its grants on `sections`.

Migration `0063_narrow_grants_to_views_and_sections.sql` adds
`resource_grants.scope` (a view of the Event, or `all`), `section_id`, and
the generated `scope_key` that widens the unique key to one grant per scope;
a trigger keeps a narrowed grant on an Event and its section in that view;
`chronelle_grant_admits` decides what a narrowing reaches, and
`chronelle_can_view`, `chronelle_can_edit`, `chronelle_can_edit_live`,
`chronelle_can_delete`, `chronelle_can_recover`, `chronelle_held_role`,
`chronelle_person_shares_list`, and `chronelle_section_list` are redefined
in place to apply it (`chronelle_section_visible` narrows the section
listing); `chronelle_resource_share` is replaced with one that takes the
scope, the section, and an already granted account by id, so the API built
from it starts after it. The runtime role needs no change. Existing grants
read as whole (`scope = 'all'`).

Migration `0064_add_user_workspace_recency_preference.sql` adds
`users.workspace_recency` (`{}` by default, checked as an object keyed by
workspace id whose values are strings) and redefines
`chronelle_user_preferences_update` to merge it one workspace at a time,
keeping the 50 most recent instants; the function count is unchanged and
the runtime role needs no change.

Migration `0065_add_share_leave_function.sql` adds
`chronelle_resource_share_leave`, the function the CloudBase sharing
adapter calls when a grantee leaves an Event: it deletes every grant the
account holds on the resource in the workspace and writes one
`resource.share_left` audit event. The readiness check requires it, so the
API built from it starts after it. It changes no tables, needs no
baseline, and the runtime role needs no change.

Migration `0066_resolve_identity_session.sql` adds the read-only
`chronelle_identity_session_resolve` function. CloudBase session requests use
it to resolve the user and reachable workspace in one snapshot, while resource
authorization remains separate. Apply it with `pnpm db:migrate` locally, or
through the CloudBase console SQL editor, before starting the updated API:
readiness requires the function. It changes no tables, needs no revision
baseline or runtime role changes, and is compatible with older API versions.

Migration `0067_add_list_candidate_functions.sql` adds the read-only
`chronelle_event_list_candidates`, `chronelle_task_list_candidates`, and
`chronelle_person_list_candidates` functions and their shared collection
helper. They select visible IDs and lightweight metadata before page hydration.
Apply it with `pnpm db:migrate` locally, or through the CloudBase console SQL
editor, before starting the updated API: readiness requires the three public
functions. It changes no tables, needs no revision baseline or runtime role
changes, and is compatible with older API versions.

Migration `0068_remove_redundant_grant_index.sql` drops only
`resource_grants_resource_principal_idx`. The wider
`resource_grants_principal_unique` index retains its lookup prefix and scoped
uniqueness constraint; application records and history are unchanged. Apply it
with `pnpm db:migrate` locally, or through the CloudBase console SQL editor.
It briefly locks `resource_grants`, so use a quiet period. No revision baseline,
runtime role changes, or API redeployment are needed.

Migration `0069_add_task_list_hydration.sql` adds the read-only
`chronelle_task_list_hydrate` function. CloudBase Task lists use it after
candidate selection to load canonical rows, typed state, labels, visible Event
contexts, parents, and subtask progress in one gateway request. Apply it with
`pnpm db:migrate` locally, or through the CloudBase console SQL editor, before
starting the updated API: readiness requires the function. It changes no tables,
needs no revision baseline or PostgreSQL runtime-role changes, and is compatible
with older API versions. On CloudBase it revokes browser-role execution and
grants execution to `service_role` when those managed roles exist.

Migration `0070_add_person_list_hydration.sql` adds the read-only
`chronelle_person_list_hydrate` function. CloudBase Person lists use it after
candidate selection to load canonical rows, typed state, contacts, and labels
in one gateway request. Apply it with `pnpm db:migrate` locally, or through the
CloudBase console SQL editor, before starting the updated API: readiness
requires the function. It changes no tables, needs no revision baseline or
PostgreSQL runtime-role changes, and is compatible with older API versions. On
CloudBase it revokes browser-role execution and grants execution to
`service_role` when those managed roles exist.

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

The WeChat Mini Program is built separately from the browser development pair:

```bash
pnpm build:weapp
pnpm dev:weapp
```

Open the `apps/wechat` directory in WeChat DevTools. `project.config.json`
points DevTools at `dist/weapp` and uses `touristappid` for a credential-free
shell preview. Put a real AppID and developer-only settings in
`apps/wechat/project.private.config.json`; the repository ignores that file.
The visible shell makes no network requests until W03 provides a verified
identity and revocable token storage. W02's Taro transport can already run the
shared production client; its contract covers cancellation, deadlines, public
health, protected session reads, and credential headers:

```bash
pnpm --filter @chronelle/api-client test
pnpm --filter @chronelle/wechat test
```

Future live configuration must provide an HTTPS API origin registered in the
Mini Program request-domain allowlist. Never place a CloudBase API key, WeChat
AppSecret, or other server credential in Mini Program source or local project
configuration.

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

## Test accounts and data

`pnpm seed:test-data` creates three accounts with representative data on
whichever backend the environment names, through the API's own HTTP
contract (the app is injected in-process, so validation, authorization,
audit, and revisions apply as for any client). The password comes from
`SEED_PASSWORD` (or `--password`), at least ten characters; `WEB_PUBLIC_URL`
is the origin the invitation link points at (`http://localhost:3000` by
default). Against the local database:

```bash
SEED_PASSWORD='choose a long one' pnpm seed:test-data
```

| Sign in as   | Name       | Language, time zone, clock                        |
| ------------ | ---------- | ------------------------------------------------- |
| `mei-lin`    | Mei Lin    | the browser's, Asia/Shanghai, 24-hour             |
| `kai-tanaka` | Kai Tanaka | Simplified Chinese, Asia/Tokyo, 24-hour           |
| `ana-souza`  | Ana Souza  | Traditional Chinese, America/Los_Angeles, 12-hour |

Mei plans Kyoto in November (five days of schedule items with their
places, an all-day day, tasks with subtasks and an assignee, expenses in
two currencies, reminders, three people, three notes, one of them with
two versions, a task in Trash) and a Team offsite that spans the day the
seed runs, so Today, Due today, and the Itinerary's now bar show
something; she also has a plain dated event, tasks outside any event, one
of them repeating, three labels, Kai as a friend with Kyoto shared as
viewer, a share for the Tanakas waiting on an emailed invitation, an open
invitation link (printed at the end, for the claim page), and Ana's
pending friend request. Kai reads Simplified Chinese and shares his
birthday dinner with Mei as editor; Ana has a trip and the request to
Mei. Every account is past the Welcome step and can be found by email.

The set is idempotent by username: when the accounts exist the seed signs
them in and leaves their data alone (it says so); to seed again, start from
an empty database. An account that exists with another password stops the
run with a message.

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

The gate builds the workspace packages once, then runs every package's
`typecheck:unit` four at a time, every package's `test:unit` one package at a
time (the browser-side suites time out when they share the runner's CPUs with
the database suites), and builds the three applications last. The WeChat build
fails when the main package exceeds 1.5 MB, any subpackage exceeds 1.5 MB, or
the combined package exceeds 15 MB. Run `pnpm wechat:bundle` to print the last
production build's byte counts. Run `pnpm --filter @chronelle/<pkg> test` for one
package (it rebuilds its upstream packages first) or `pnpm test:units` after
`pnpm build:packages` for all of them at once.

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
path in desktop and narrow-mobile Chromium projects. The WebKit projects run
the tests that opt in by a tag in the test title: `@webkit-desktop` for
WebKit desktop, `@webkit-mobile` for WebKit mobile, and a test may carry both
(`test("title @webkit-desktop @webkit-mobile", async ...)`). A new journey
adds its tags in its own file; `playwright.config.ts` needs no edit. On
Linux, use `playwright install --with-deps` to install the required system
libraries as well. The journeys start their servers on ports 3000 and 4000;
`E2E_WEB_PORT` and `E2E_API_PORT` move them, so the suite can run beside a
local deployment that holds the defaults.

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

The web app's strings live under `apps/web/messages/<locale>/`, one JSON
file per feature namespace (`nav.json`, `settings.json`, ...), keyed by
identifier, never by English text. `pnpm --filter @chronelle/web messages`
assembles them into one catalog per locale (`apps/web/messages/en.json` and
the others), which is a build output: it is ignored by git, and the `build`,
`dev`, `sandbox`, `test`, and `typecheck` scripts of the web package run the
generator first. The bare `vitest run` form does not, so run the generator
once before it, or any of those scripts. The generator refuses a namespace
file present in one locale and missing in another, and a file whose top
level is not an object. Two changes touch the same file only when they touch
the same namespace, which keeps parallel work free of catalog conflicts.
`apps/web/i18n/` holds the locale list, the request-time negotiation, the
cookie preference, and the catalog loader. Adding a language is one
directory of namespace files plus one entry in `apps/web/i18n/locales.ts`:

```ts
{ tag: "ja", native: "<the language's name in itself>", fallbacks: ["en"] }
```

The Language control, `<html lang>`, the Accept-Language negotiation (extend
`localeForTag` when a new language needs region rules), the `Intl` helpers,
and the fallback chain all read that list. A key the new catalog lacks renders
from the next locale in `fallbacks`, so a partial catalog never shows a bare
key, but `apps/web/test/i18n-catalogs.test.ts` fails the build until every key
of the English catalog exists in the new one with the same ICU parameters and
no extras, and every locale carries the same namespace files. Keep messages in ICU: plurals as
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
