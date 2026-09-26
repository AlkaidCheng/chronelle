# SQL Migrations

Store immutable PostgreSQL migrations here using names such as
`0001_create_core_objects.sql`. The migration runner applies files in lexical
order and records their SHA-256 checksums.

The first migration establishes users, workspaces, canonical objects,
relations, grants, append-only audit events, and the minimal typed tables for
the event-planning slice. SQL migrations are the schema authority; the Drizzle
definitions in `packages/db` map the accepted schema for typed queries.

The second migration adds the personal-workspace owner invariant used by the
development identity bootstrap and an index for active principal-side grant
lookups. A nullable unique owner reference permits shared workspaces while
ensuring each user can have at most one personal workspace.

The third migration stores short-lived document transfer authorizations as
hashed, one-time credentials. It binds each transfer to one canonical resource,
workspace, actor, storage key, and validated file metadata.

The fourth migration adds the partial PostgreSQL full-text index used to search
active canonical object names.

Never edit a migration after it has been applied to a shared database. Add the
next ordered migration instead.

Migration 0009 adds bounded user/workspace command stacks, immutable command
identities, canonical revision references, and idempotency receipts. It is
additive and needs no snapshot backfill. See [Commands](../../docs/commands.md)
for rollout and retention constraints.

Migration 0011 adds append-only Event page layouts with independent versions and
audit references. Reapply runtime role provisioning after migration so the API
can read and insert layout revisions; it cannot update or delete them.

Migration 0010 adds date-only Event ranges with inclusive end dates and checks
that prevent mixing date precision with timestamp precision. It preserves
existing timed records and immutable snapshots. See
[Event schedules](../../docs/object-model.md#event-schedules) for the API contract.

Migration 0071 normalizes external providers in `user_identities` and records
one-time identity proof digests in `identity_exchanges`. It backfills every
existing user without changing canonical user IDs, keeps the prior identity
columns during the rolling deployment, and adds atomic WeChat exchange and
explicit-link functions. Reapply runtime role provisioning after migration so
the API can read and write the two new tables.

Migrations 0073 and 0074 let a record change workspace with one update of
`objects.workspace_id` over its whole permission scope. The keys of typed
rows, relations, grants, pending shares, document transfer authorizations,
and sections cascade on update. The permission scope and People cards keep
`NO ACTION` keys, so an update that leaves a scoped record behind, or moves
a card, fails. 0073 adds the keys `NOT VALID` and 0074 validates them in a
separate transaction, so the validating scan does not block writes.

Migrations 0075 and 0076 keep history where it was written. Audit events,
revisions, command changes, Event page revisions, and context and create
command records keep their `workspace_id` and name their object by id alone,
so no ledger row changes when its object changes workspace. A revision is
unique per object and version, a layout revision per Event and version, and
the functions that read an object's history read it by object id. 0075 adds
the keys `NOT VALID` and 0076 validates them.

Migration 0077 moves an Event with its scope to another workspace in one
function, beside the TypeScript service that runs the same steps. A move is
the only writer that deletes relations: the ones that cross the scope are
dropped with an audit event each, a trigger refuses any delete a move did not
announce for its transaction, and a context creation's record keeps its
relation id without a key. Apply it after 0076, then rerun the runtime role
script for `DELETE` on `object_relations`, then deploy the API.

Migration 0078 lets an Owner delete a shared workspace that holds nothing but
Trash, beside the TypeScript store that runs the same steps. A deletion marks
the workspace with `deleted_at` and `deleted_by` and keeps its records and
history; it revokes the waiting shares and live grants and removes the
members. Triggers refuse a record inserted into a deleted workspace or
restored from its Trash, taking the workspace row in share mode so they wait
for a deletion in progress, and session resolution leaves deleted workspaces
out. Apply it after 0077 with API writers stopped, then deploy the API; the
runtime role needs no new privilege.
