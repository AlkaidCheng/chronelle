# Event pages

An Event opens on its saved pages. Owners and Editors can add named pages and
choose components through a focused picker. Viewers can use the saved layout
and read authorized records but cannot change either. Browse event data opens
secondary planning views, including Calendar, Expenses, Files and Sharing.

Page and component IDs identify presentation elements, not canonical objects.
Each component queries the owning Event's authorized projection. The same
record can appear in several components or pages; editing it refreshes active
projections and invalidates inactive ones. Removing a page or component from
the layout does not delete business objects or relations.

## Components

| Kind        | Content                                                                   |
| ----------- | ------------------------------------------------------------------------- |
| `todos`     | Tasks with completion controls and independent local filters              |
| `calendar`  | Scheduled Events, including date-only ranges, with creation and editing   |
| `timeline`  | Dated Events, Tasks, Expenses, and Reminders in chronological order       |
| `itinerary` | The same scheduled Events in running order                                |
| `expenses`  | Historical transactions with totals kept separate by currency             |
| `reminders` | Recorded reminders with editing and dismissal; notifications are not sent |
| `files`     | Authorized private attachments for the Event and its Tasks and Expenses   |

Only components on the selected page are mounted. Repeated components share
query results and in-flight requests, while controls such as task filters and
attachment targets remain independent. A failed projection shows its own retry
control without replacing neighboring components. Secondary data views use
the same renderer and query keys.

Adding a component changes presentation only; it does not create or grant
access to its contents. In particular, Files loads authorized attachment
targets and checks access again when requesting upload or download transfers.

## Persistence

`event_page_revisions` stores immutable layout snapshots, keyed by workspace,
Event ID and layout version. Each row references an audit event. The newest
version is the current layout; an Event without revisions has version zero and
an empty pages array. Reads do not create rows. Layout updates do not advance
the canonical Event's object version or alter its metadata.

The API validates a strict structure: at most 20 pages, 20 components per page,
100 components overall, page names of 1-80 characters, unique UUIDs across the
layout, and recognized component kinds. Configuration contains no business
records, arbitrary scripts or style definitions. Supported component kinds
are listed above; unrecognized kinds and extra fields are rejected.

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

The expanded component catalog requires no additional SQL migration. Deploy
the API and web together before saving these kinds: clients and servers that
only recognize `todos` reject layouts containing the other kinds. Rollback
must preserve existing snapshots and use a version that understands their
component kinds; do not rewrite layouts merely to satisfy an older client.

## Browser sandbox

The browser-only sandbox implements the same layout request/response contracts
with fictional browser-local data. It validates stored layouts and preserves
existing snapshots without a layout field. It previews Viewer controls and
checks versions, but does not establish production authorization or retain
server audit/history evidence. Production validation requires the real API and
PostgreSQL integration tests.

The sandbox can insert every component and edit its fictional planning data.
Files previews empty attachment lists; actual file storage and downloads are
not simulated. Unsupported transfers return an explicit error. Existing
browser-local layouts remain usable with this expanded catalog.
