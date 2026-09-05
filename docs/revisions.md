# Object revisions

Every supported object create, content update, permission-scope change, and soft
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

History display, typed comparisons, restoration, Trash, and Undo/Redo are separate
capabilities. Snapshot availability alone does not make those actions safe.
