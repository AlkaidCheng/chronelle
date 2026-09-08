# Object Model

Chronelle combines a common canonical envelope with typed domain tables. The
first vertical slice uses `Event`, `Task`, `Expense`, `Reminder`, and `Document`
objects to support event planning.

## Canonical envelope

Every first-class object has one row in `objects` containing its UUIDv7,
workspace, type, display name, creator, canonical permission scope, timestamps,
version, archive and delete markers, custom properties, and metadata. Typed
tables use the object ID as their primary key and repeat only the workspace and
constant object-type discriminators required for declarative integrity checks.

PostgreSQL enforces that each typed row belongs to an object of the same type in
the same workspace. A typed row cannot exist independently of its canonical
object.

## Personal workspaces

`workspaces.personal_owner_id` identifies a user's personal workspace. The
column is nullable for future collaborative workspaces, unique when populated,
and constrained so the personal owner is also the workspace creator. First
sign-in creates the corresponding owner membership in the same transaction.

## Initial typed objects

- `Event` stores the minimum scheduling facts needed for planning projections:
  start, end, date precision, timezone, and all-day state. An unscheduled Event can represent
  the overall plan; scheduled child Events represent itinerary occurrences.
- `Task` stores status, due time, and completion time.
- `Expense` stores an amount, ISO-style currency code, and occurrence time as
  an independent historical fact.
- `Reminder` stores reminder time and delivery state. V1A supports durable
  reminder intent and in-product alerts; delivery providers remain deferred.
- `Document` stores private object-storage metadata: provider, opaque storage
  key, original filename, MIME type, byte size, SHA-256 checksum, and the
  provider's encryption mode. File bytes never enter PostgreSQL, and storage
  keys never enter public API responses.

These fields make the first capabilities executable without freezing a richer
event-planning schema. Additional details can use `custom_properties` until a
stable system-level meaning justifies a typed migration.

The current browser workspace intentionally exposes only these fields. Richer
venue, participant, budgeting, notification, and itinerary attributes remain a
future object-model decision rather than being embedded in projection-specific
client records.

## Event schedules

Events support three schedule states on the same canonical object:

- Undecided: `startsAt`, `endsAt`, `startsOn`, and `endsOn` are null.
- Dates only: `startsOn` is an ISO calendar date (`YYYY-MM-DD`); optional
  `endsOn` is inclusive. Both timestamps are null. These facts use PostgreSQL
  `date`, with years 1 through 9999, and are never converted into stored midnight
  timestamps. Omitting the end leaves it unspecified.
- Dates and times: `startsAt` is an instant; optional `endsAt` must not precede
  it. Both date-only fields are null. These facts use `timestamptz`.

Both scheduled states can span multiple days. An end requires a start. Partial
updates validate the merged state, so switching precision must explicitly clear
the opposite pair. `isAllDay` remains available for existing timestamp-based
records; it does not imply date-only precision.

Date-only display is independent of the viewer's timezone. The optional IANA
`timezone` determines the current calendar day for Upcoming/Past filters; UTC is
the fallback. The inclusive last day is upcoming until that timezone's next day.
Timed display and input use the browser's local timezone. Nonexistent local
times at a daylight-saving transition are rejected; ambiguous repeated times use
the browser's Date interpretation. Choosing an arbitrary input timezone remains
a future editor capability.

Calendar and itinerary responses contain the same Event fields. Timeline entries
carry either `occursAt` (instant) or `occursOn` (date), with the other null. A date
is ordered at its UTC day boundary for deterministic mixed-precision ordering;
this is a projection key, not an asserted occurrence time. Event list keyset
pagination uses the same ordering convention and authorizes before pagination.

Date fields participate in optimistic concurrency, audit, revisions, restoration,
and Event content commands. Older revision snapshots without these fields read
them as null; immutable stored snapshots are not rewritten.

## Relationships and projections

Reversible commands reference before/after versions in `object_revisions` and
keep canonical identity unchanged. They store no duplicate typed content. Undo
and Redo each advance the live version and append another snapshot. The current
allowlist covers Event/Task content, not security state or historical financial
facts. See [Reversible content commands](commands.md).

`object_relations` connects canonical identities and carries contextual
metadata. The initial relation vocabulary is:

- an Event `includes` a scheduled Event, Task, Expense, Reminder, or Document;
- a Reminder `reminds_about` an Event or Task;
- a Document is `attached_to` an Event, Task, or Expense;
- any two compatible resources may be `related_to` each other.

Removing a relationship removes only that contextual link. Database foreign
keys explicitly prevent a relation deletion from cascading to either endpoint.

Active relation pages select existing links by immutable ID descending, with
optional direction, type, and opposite-endpoint filters. Both endpoint View
decisions and the returned metadata belong to one read-only snapshot. The
lifecycle dialog locates its exact Event inclusion, rather than treating the
first page as the complete list; its cache is keyed by both endpoint identities.

Event detail, calendar, timeline, itinerary, expense, reminder, and to-do
queries resolve canonical objects at read time. Each resource keeps the same ID
and version in every response. These projections own ordering and selection,
never copied business fields.

`EventPlanningObjectService.listVisibleObjects(principal, ids)` resolves a
collection through the same authorization policy as `getObject()`. It omits
unavailable IDs, preserves input order and duplicates, and loads visible typed
states in bounded batches within one snapshot. Detail projections and
attachment lists reuse it. The low-level `readObjectStates()`
also supports tombstones for recovery; callers must authorize it explicitly.

The Event collection is a read-time projection: its pages hydrate existing
typed Event rows, not new collection records. Only active self-scoped Events are collection roots;
an inheriting itinerary Event remains in its canonical parent's projections.
Changing a name, schedule, or update time changes subsequent collection reads
and can move a record across page boundaries. The client deduplicates IDs when
accumulating pages, without creating another business identity.

Search is another read-time projection over `objects`, backed by a partial
PostgreSQL full-text index on active display names. A search result is not a
stored search document: it carries the same canonical ID, type, permission
scope, version, and update time as the object row. Object-type filtering changes
selection only and never creates another container. Search pages are ordered
by relevance descending, update time descending, then canonical ID ascending.
The cursor preserves database timestamp precision even though public resource
timestamps are serialized as JavaScript dates. Removing the boundary object
does not invalidate the remaining keyset position.

An attachment is one canonical Document plus one `attached_to` relationship.
The Document uses its parent's canonical permission scope, so a file attached
to an Event or inheriting child follows the same Event grant. A self-scoped
Task or Expense gives its attachment that resource as the scope. Unlinking
soft-deletes only the relationship; the canonical Document metadata and stored
bytes remain for a future retention or reattachment workflow.

`document_transfer_authorizations` is operational state, not a business
object. It binds a hashed one-time credential to one upload or download,
resource, storage key, expected metadata, actor, and expiry. Upload rows also
record consumption and finalization so the same authorization cannot create
two Documents.

The [storage inventory](storage-reconciliation.md) reads these references without
creating another object or projection table. It includes all Document lifecycle
states and document revision keys. A consumed upload remains recoverable after
expiry; an expired authorization alone does not authorize file removal.

A related child normally uses its root Event ID as `permission_scope_id`, so a
grant on the Event applies through one level of inheritance. Changing the child
to its own ID makes it private without deleting the object or its `includes`
relationship. That change increments the same canonical version used by every
projection.

## Lifecycle

Objects begin at version 1. Application updates require `expectedVersion`,
increment it atomically, and return HTTP 409 rather than overwrite a newer
value. Ordinary deletion also checks the expected version and sets
`deleted_at`; permanent purge is a separate future workflow. Reads and
projections exclude soft-deleted objects.

Owner recovery clears only the tombstone and advances the canonical version,
recording a `recovered` snapshot and audit. Current content, scope, grants, files,
and links stay unchanged. Relations have an independent `version` for unlink
and recovery, with immutable endpoints and collision-safe reactivation.
See [Recovery](recovery.md) for lifecycle and scope ordering.

Every supported object mutation appends a schema-versioned, immutable typed
snapshot in `object_revisions`, linked to the same canonical ID and version.
Existing objects receive only an explicit baseline of their available state.
See [Object revisions](revisions.md) for serialization and history contracts.

Content restore advances the live version and appends a `restored` revision
referencing an earlier revision of the same object through `source_revision_id`.
Per-type policies preserve Expense transaction facts, Reminder delivery status,
Document file metadata, and all security/lifecycle fields.

An Expense amount is stored as its own historical fact. Relating an Expense to
another object neither derives nor synchronizes the amount with that object.

`event_context_commands` is an immutable receipt keyed by workspace, user, and
command ID. It records the normalized request hash, original request ID, Event,
created object, and relationship IDs. It stores no second copy of content: a
retry obtains its response from the object's creation revision after current
authorization. Editing or unlinking the resource never changes this receipt.
