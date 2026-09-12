# Object revisions

Every supported object create, content update, restoration, permission-scope change, and soft
deletion appends one immutable snapshot. This includes Document creation during
upload finalization. Canonical and typed state, the revision, and its audit event
commit or roll back together. Mutation responses use the same transaction's
typed state. A revision is historical evidence, never a live object or a source
for calendar, search, or other planning projections.

## Storage and serialization

`object_revisions` identifies the canonical workspace, object, and version. It
also records mutation kind, actor, request ID, capture time, snapshot schema
version, and its audit event ID. `(workspace_id, object_id, object_version)` is
unique. PostgreSQL rejects revision UPDATE, DELETE, and TRUNCATE operations.
These guards protect application use, not a database administrator who can alter
the schema. Backups remain necessary.

The object-model package owns serialization. Schema 1 captures the canonical
envelope and all supported typed fields; timestamps use UTC ISO strings and
decimals and byte counts use strings without numeric rounding. Internal Document
snapshots include their storage key but never file bytes or transfer credentials.
Public history uses a typed allowlist that excludes permission scopes, system
metadata, storage providers, encryption configuration, and storage keys. User
custom properties remain content, so they must not contain server credentials.
Unsupported snapshot schema versions fail closed.

Audit events describe actions, including sharing and file transfers that do not
change canonical content. Revisions describe object states. A grant or relation
mutation does not increment an object's version or append a content revision.
Each revision references its own audit event; neither ledger replaces the other.

## Retrieval and authorization

`GET /api/objects/:id/revisions` returns newest-first summary rows, with `limit`
defaulting to 25 and capped at 100. `nextBeforeVersion` is the exclusive keyset
boundary for the next request. No counts or full snapshots are loaded for a
list. New writes do not shift older pages. Fetch one snapshot with
`GET /api/objects/:id/revisions/:version`.

Both endpoints use the central View decision against the current resource, not
historical grants. Newly invited Viewers can read earlier saved content. The
Sharing screen discloses this. Stopped inheritance, revoked grants, workspace
isolation, and deleted resources apply to history just as they do to live reads.
Unauthorized and nonexistent revisions have the same response. Tombstones are
retained internally but have no history access route until an Owner recovery
policy is implemented.

History authorization and retrieval share one repeatable-read, read-only
transaction. A request already authorized in that database snapshot may finish
while a concurrent revocation commits; subsequent requests see the revocation.
This is not permission to restore or replay historical security state.

## History interface and comparisons

History is available on Events, Tasks, Expenses, Reminders, and Documents. One
shared drawer stays open when restoration moves a resource out of a filtered
view. It loads 20 summaries at a time, showing version, action, time, and the
actor's current display name when available. Actor IDs provide durable
attribution; display names are not historical snapshots.

Choose two loaded versions for a typed comparison, or preview a revision against
current content. Custom properties are compared by top-level key, distinguishing
missing values from nulls and ignoring object-key ordering. Security fields and
storage details are never comparison inputs or output values.

## Content restoration

`GET /api/objects/:id/revisions/:version/restore-preview` shows current and
historical values, flags preserved fields, and returns the current version.
Viewers can inspect it but cannot restore.
`POST /api/objects/:id/revisions/:version/restore` accepts only
`{ expectedVersion }`, requires current Edit, and applies eligible historical
content as version current + 1 of the same canonical object.

| Object    | Restorable content                                | Preserved typed facts                                                                       |
| --------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| All types | Name and custom properties                        | Identity, permissions, relations, lifecycle state, system metadata                          |
| Event     | Start/end dates or times, time zone, all-day flag | Common exclusions                                                                           |
| Task      | Status, due time, completion time                 | Common exclusions                                                                           |
| Expense   | Common content only                               | Amount, currency, transaction date                                                          |
| Reminder  | Reminder time                                     | Delivery status                                                                             |
| Document  | Common content only                               | Original filename, MIME type, size, checksum, file bytes, provider, encryption, storage key |

Expense corrections use the explicit Expense editor. Generic restore does not
rewrite financial facts, re-arm Reminder delivery, or replace Document files.
Unknown snapshot schemas, deleted states, and requests with no eligible changes
are rejected.

A `restored` revision references its earlier source through
`source_revision_id`, enforced against the same canonical object in PostgreSQL.
Its typed `*.restored` audit records the source revision, source version, and
previous current version. Later history remains readable. A failed write rolls
back canonical state, typed fields, revision, and audit together.

Confirmation is pinned to the displayed preview. Stale versions return HTTP 409
without writing; refreshing requires fresh confirmation. Retrying an uncertain
successful response with the consumed version also conflicts instead of creating
another revision. Open drafts are preserved and need explicit reconciliation
after canonical refresh. Drafts and confirmation do not survive page reloads.

## Permission ordering for restoration

`withStableAuthorization` locks the workspace row using `FOR NO KEY UPDATE`
before checking permission. Canonical writes, context/link creation, document
finalization and local download consumption, restores, grant mutations,
scope changes, and soft deletion all participate. If a permission mutation wins
the lock, restore sees its committed state. If restore wins, it commits before
the waiting permission mutation. Ordinary content edits also check optimistic
versions after acquiring the fence. Storage I/O stays outside the lock.

This serializes those operations within one workspace, not across workspaces.
The lock permits foreign-key key-share locks, avoiding an unnecessary conflict
with unrelated object/audit inserts. Administrative SQL and future membership
or other authorization writers must follow this application protocol. Existing
membership creation only bootstraps new workspaces. Grant expiry is evaluated
after lock acquisition.

## Atomic creation in an Event

`POST /api/events/:id/resources` creates an Event, Task, Expense, or Reminder and
its `includes` relationship in one transaction. The parent must be a self-scoped
Event the caller can Edit. The service assigns that Event as the child's scope.
Document creation uses the separate authorized upload/finalization workflow.

Supply a UUID `commandId` and retain it until the outcome is known. The receipt
is scoped by user and workspace; a PostgreSQL transaction lock serializes matching
commands. A matching retry returns HTTP 201 with the original creation result,
not the current live state. Altered input with the same ID returns HTTP 409
`command_conflict`. Object-key ordering does not change the normalized request
hash; changed values do. Current Edit on the parent and View on the created
object are required for replay. Deleted or inaccessible resources fail closed.

The receipt refers to the creation revision and relation; it duplicates no
business content. Retries append no extra audits or snapshots and never undo
later edits or revive a removed relationship. A failed object, relation, revision,
audit, or receipt write rolls back the entire command. The original request ID
correlates its object-created and relation-created audit events.

Browser create forms retain a command ID for unchanged retries and start a fresh
command after success or changed input. Schedule and Task creation also retain
it across client-side navigation through explicit draft recovery. Other forms
retain it only while mounted. Discard, eviction, reload, sign-out and workspace
changes clear the retained attempt; durable offline draft and command storage is
not implemented. API clients needing recovery across restarts must retain their
own command ID. Receipts are retained indefinitely for now.

## Upgrading an existing database

Stop every API writer, apply the migrations, and capture baselines before
restarting the updated API. Do not run old and new API binaries together.

```sh
pnpm db:migrate
pnpm db:baseline-revisions
pnpm dev
```

The baseline command takes a write-conflicting lock over canonical, typed, and
revision tables for its entire transaction. It reads bounded batches, includes
tombstones, and creates only the presently available version with mutation kind
`baseline` and a system audit. It never invents earlier versions. Repeating it
does nothing for complete chains. A partially recorded chain is an error, not
permission to fabricate a replacement baseline.

The API refuses to start if any current canonical version lacks a snapshot;
object updates also require the previous revision. A fresh empty database needs
no baselines. The browser release gate runs the idempotent baseline command so
its retained development database can be upgraded safely. Table locks can block
writes and baseline capture can take time on a large database; schedule an outage
and retain a tested backup. Downgrading to an API that does not record revisions
is unsafe without a coordinated database restore.

Migration `0007_add_revision_restoration.sql` adds restore provenance and ledger
guards without changing existing revisions or requiring new baselines. Deploy
API and web together with old writers stopped; older history clients reject
the added `restored` action and must reload or upgrade. Mixed API versions do not
share the permission-ordering guarantee.

Deleted-object recovery appends a `recovered` revision and matching audit, without
a source revision or content replay. See [Trash and recovery](recovery.md).
Content restore never clears tombstones or replays links. Undo/Redo remains
a separate planned capability.
