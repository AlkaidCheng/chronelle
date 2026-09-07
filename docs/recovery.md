# Trash and recovery

Trash recovers the current canonical object, not an earlier content snapshot.
An Owner can open **Trash**, filter by object type, preview an entry, and confirm
its expected deleted version. Event and resource **Actions** distinguish
removing a context link from moving the object to Trash. The latter affects
every normal view; neither operation deletes related objects.

## Authorization

The centralized `recover` action accepts current Owner membership, a direct
Owner grant, or an Owner grant on the object's one canonical permission scope.
It resolves tombstones deliberately; ordinary View/Edit/history/download checks
still reject them. A self-scope stops inheritance. Relations never confer access.
Expired or revoked grants cannot authorize recovery.

An unexpired Owner grant to a deleted resource also permits workspace discovery,
without granting access to anything else there. Editors and Viewers cannot list
or recover deleted objects. Trash SQL uses the same authorization-owned predicate
as `can(recover)`, before filters, pagination, or result construction. There are
no inaccessible counts or hidden-object cursors.

Current Owners may list and revoke direct grants on a deleted object. Creating
grants still requires normal Share on a live object. Recovery preserves current
grants exactly; it never replays historical permissions.

## Object recovery

`POST /api/objects/:id/recover` accepts only `{ expectedVersion }`.
It takes the shared workspace security lock, reauthorizes, checks the current
version and tombstone, and requires a live canonical permission scope unless
the object owns its scope. Recover the scope first; there is no implicit recursive
recovery or scope reassignment.

The transaction clears `deleted_at`, advances `version` and `updated_at`,
and appends a `recovered` revision with a matching typed `*.recovered` audit.
The revision has no historical source revision. Identity, typed business content,
archive state, grants, scope, file references, and all relation rows stay intact.
Audit/revision failure rolls the mutation back. A repeated successful request
conflicts rather than creating another recovery revision.

Object deletion leaves active relations untouched. Their projections reappear
only when both endpoints are live and separately authorized. Recovering a
Document retains its storage identity and bytes; download authorization is still
required, and credentials issued before deletion are rechecked on use.

## Independent link recovery

Relations have their own positive `version`, initially 1. Deletion and recovery
advance it by one and require the observed version. PostgreSQL rejects updates
that do not advance the version or that change relation identity, endpoints,
type, or creation facts.

`GET /api/objects/:id/removed-relations` lists incoming and outgoing tombstones
with live endpoints, current Edit on the source, and View on the target.
An Event's **Removed links** tab previews and confirms recovery; attachment links
can also be found from their Event parent. Task/Expense attachment parents can use
the same API; their own removed-link browser panels are not yet implemented.

`POST /api/relations/:id/recover` uses the same security fence and endpoint checks,
then clears only the link tombstone and advances its version. A stale generation
returns 409 `version_conflict`; an equivalent active link returns 409
`relation_conflict`. No object revision is created because neither endpoint
changed. The `relation.recovered` audit includes the old and new link versions.
Independently removed links never reactivate during object recovery.

## Query and concurrency limits

Trash and removed-link queries use a read-only repeatable-read snapshot. A read
already authorized in that snapshot may finish during a concurrent revocation;
mutations reauthorize after acquiring the workspace lock. Administrative and
future membership writers must follow the same lock protocol.

Trash accepts `limit` (1-100, default 20), `cursor`, `objectType`, and exact
`scopeId` filters. Return `nextCursor` unchanged to continue, or stop when it is
null. The opaque cursor belongs to one user, workspace, object type, and scope
filter. Start a fresh first page when that context changes; page size may change
between requests. Malformed or mismatched cursors return 400. Tokens convey no
permission: each page evaluates current Owner membership and direct/inherited
grants, including their expiry, before SQL LIMIT. Revocation can produce an empty
terminal page. There are two service statements (snapshot setup and selection),
and at most `limit + 1` authorized rows are read into the application. Database
filtering work is not constant-time.

Removed links accept `limit` (1-50, default 20), optional `relationType`, and
`cursor`; return `nextCursor` unchanged to continue. The opaque cursor is bound
to the user, workspace, parent object, and link-type filter. Changing these
requires a fresh first page. Malformed or mismatched cursors return 400. A cursor
is a position, not an authorization credential: each page rechecks current
parent View, source Edit, and target View in one snapshot. Centralized SQL
authorization excludes inaccessible or deleted endpoints before the page limit,
so the application reads at most `limit + 1` authorized links without repeated
candidate batches. Database filtering work can still grow with private history;
this does not guarantee constant-time queries or constant database reads.

Both lists sort by descending sortable ID (creation order), not deletion time.
Requests do not share a frozen snapshot: permission changes or recovery can
remove entries between pages. Refresh to see newly removed links above an earlier
cursor. Trash and Removed links support filtering, loading more, and refreshing;
changing filters cancels pending retrieval and starts at the first page. Inactive
filter pages are discarded; identity/workspace changes use the existing isolated
session cache. Continuation errors retain loaded entries and offer refresh.

## Deployment

Both recovery lists use `cursor`/`nextCursor`; clients using
`beforeId`/`nextBeforeId` must migrate. Trash keeps its maximum page size of 100;
Removed links allows at most 50. Deploy or roll back the API, typed client, and
web together; old query keys are rejected rather than ignored. No database
migration is needed for these pagination contracts.

Stop all old API writers, apply `0008_add_trash_recovery.sql` with
`pnpm db:migrate`, and deploy API and web together. It adds relation versions,
partial Trash/link cursor indexes, and the `recovered` revision kind.
Existing relation rows receive version 1 as an explicit generation baseline;
their earlier generations are not reconstructed. Complete object revision
chains need no additional baseline.

This is a breaking relation contract: DELETE now requires
`?expectedVersion=N`; relation responses include `version`, and attachment
responses include `relationVersion`. Old unversioned writers fail the database
guard. Older history clients also reject the new revision kind. Rolling back
only the application is unsafe; retain the upgraded API or coordinate a full
database/application rollback.

No default permanent purge, retention scheduler, attachment-byte recovery after
external storage loss, cross-tab push synchronization, or Undo/Redo is included.
Recovery keeps archived state; it is not an unarchive operation.
