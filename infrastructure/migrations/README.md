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
