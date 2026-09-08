# Event pages

An Event opens on its saved pages. Owners and Editors can add named pages and
insert a To-dos component through focused dialogs. Viewers can use the saved
layout and read tasks but cannot change either. Browse event data opens the
existing planning views, including Calendar, Expenses, Files and Sharing.

Page and component IDs identify presentation elements, not canonical objects.
Every To-dos component queries the owning Event's authorized task projection.
The same task can appear on several pages; editing it updates every projection.
Removing a page or component from the layout does not delete a task or relation.

## Persistence

`event_page_revisions` stores immutable layout snapshots, keyed by workspace,
Event ID and layout version. Each row references an audit event. The newest
version is the current layout; an Event without revisions has version zero and
an empty pages array. Reads do not create rows. Layout updates do not advance
the canonical Event's object version or alter its metadata.

The API validates a strict structure: at most 20 pages, 20 components per page,
100 components overall, page names of 1-80 characters, unique UUIDs across the
layout, and recognized component kinds. Configuration contains no business
records, arbitrary scripts or style definitions. The initial component kind is
`todos`.

## API

`GET /api/events/:id/layout` requires View on the Event and returns:

```json
{
  "eventId": "00000000-0000-4000-8000-000000000001",
  "version": 0,
  "updatedAt": null,
  "pages": []
}
```

`PATCH /api/events/:id/layout` requires Edit and replaces the layout:

```json
{
  "expectedVersion": 0,
  "pages": [
    {
      "id": "00000000-0000-4000-8000-000000000002",
      "name": "Preparation",
      "components": [
        { "id": "00000000-0000-4000-8000-000000000003", "kind": "todos" }
      ]
    }
  ]
}
```

The response has the same shape as GET, with an incremented version and a save
timestamp. A stale expectedVersion returns HTTP 409, including concurrent first
saves. Layout mutations use the workspace authorization fence and commit the
snapshot with an `event.layout_updated` audit event in one transaction. Missing
and unauthorized resources return the same HTTP 404 response. Layout history is
retained when an Event is soft-deleted, but ordinary reads then deny access.

The typed client exposes `getEventLayout(id)` and
`updateEventLayout(id, { expectedVersion, pages })`. Install migration 0011 and
reapply the runtime database role grants before starting the updated API.

## Browser sandbox

The browser-only sandbox implements the same layout request/response contracts
with fictional browser-local data. It validates stored layouts and preserves
existing snapshots without a layout field. It previews Viewer controls and
checks versions, but does not establish production authorization or retain
server audit/history evidence. Production validation requires the real API and
PostgreSQL integration tests.
