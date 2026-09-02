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
  start, end, timezone, and all-day state. An unscheduled Event can represent
  the overall plan; scheduled child Events represent itinerary occurrences.
- `Task` stores status, due time, and completion time.
- `Expense` stores an amount, ISO-style currency code, and occurrence time as
  an independent historical fact.
- `Reminder` stores reminder time and delivery state. V1A supports durable
  reminder intent and in-product alerts; delivery providers remain deferred.
- `Document` stores private object-storage metadata. File bytes never enter
  PostgreSQL.

These fields make the first capabilities executable without freezing a richer
event-planning schema. Additional details can use `custom_properties` until a
stable system-level meaning justifies a typed migration.

## Relationships and projections

`object_relations` connects canonical identities and carries contextual
metadata. The initial relation vocabulary is:

- an Event `includes` a scheduled Event, Task, or Expense;
- a Reminder `reminds_about` an Event or Task;
- a Document is `attached_to` an Event, Task, or Expense;
- any two compatible resources may be `related_to` each other.

Removing a relationship removes only that contextual link. Database foreign
keys explicitly prevent a relation deletion from cascading to either endpoint.

Event detail, calendar, timeline, and itinerary queries resolve the same Event
IDs at read time. Event detail and to-do queries resolve the same Task IDs.
These projections own layout and filter state, never copied business fields.

## Lifecycle

Objects begin at version 1. Application updates will require an expected
version, increment it atomically, and report conflicts rather than overwrite a
newer value. Ordinary deletion sets `deleted_at`; permanent purge is a separate
future workflow.
