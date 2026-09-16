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
| `itinerary` | Retired: a saved one shows as the Calendar in its `agenda` view           |
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

### Views

A component's kind says which records it shows; its view says how they are
laid out. Every kind offers `list`. `todos` also offers `by-day`, which groups
tasks under Overdue (open tasks due before today), one heading per due date
with Today and Tomorrow named, and No due date, with the task's due time on
each row; `week`, seven columns of one local week, Monday first, each task in
the column of its due day; and `month`, a six-week grid of one month in which
each day shows up to three tasks and counts the rest, with the selected day's
tasks listed under the grid. `calendar` offers `agenda`, the numbered running
order of its items with the same row actions, and `week` and `month` in the
same shape as the to-dos, a scheduled item sitting on every local day it
covers. `expenses` and `reminders` offer `by-day`, `week`, and `month` too: a
transaction sits on the local day it happened, a reminder on the local day it
is due, and an expense day (a by-day heading or the day under a month) carries
the day's totals by currency. Tasks without a due date and unscheduled items
are listed under the week or the month. The period shown opens on today, moves with Previous,
Today, and Next, and is not saved; only the view is. A layout may still carry
the retired `itinerary` kind: it renders as the Calendar in its `agenda` view,
the picker does not offer it, and choosing a view on it saves the component
as `calendar` with that view under the same id (earlier layout versions keep
what they stored). Members who can edit choose the view from a View
control in the component heading, outside Arrange mode. The choice is saved on
the layout component, so everyone on the Event sees the same view, it appears
in layout history, and undo and restore cover it. Viewers see the saved view
and no control. A component without a stored view uses its kind's default.

## Composition controls

Owners and Editors can search the component picker by label or command name
(for example, `/calendar`). Press `/` while focus is inside the Event pages
area to open it, or use Add component. Commands > Keyboard shortcuts offers
`/`, `Cmd/Ctrl + /`, or Off for insertion. The button and hints reflect the
current binding. Shortcuts ignore text fields, custom editors, dialogs,
composition (including key code 229), held keys, and events already handled by
another control. The actual slash character is used, allowing keyboard layouts
that require Shift. Alt/AltGr and combined Ctrl+Meta are not insertion bindings.
The picker names its destination page. Enter inserts the selected result;
no matching result disables insertion. Full pages, full layouts, Viewers, and
pending layout saves cannot open the picker through the shortcut.

Component handles support desktop drag-and-drop before another component, at
the end of the current page, or onto a page tab. Up/Down buttons and Move to
page provide equivalent keyboard and touch operations. Move page earlier/later
changes page order. A full destination is unavailable. Repeated components are
distinguished by their IDs, not their kinds. External drag payloads are ignored.

Each completed action sends one existing layout PATCH, preserving component
identities and canonical records. Dragging alone, cancelling, and unchanged
moves do not write. The drag source pins its layout version until drop; a stale
save fails without overwriting a newer layout. Refresh latest loads the saved
layout before an explicit retry. In-flight saves block overlapping layout
mutations; success announces completion and restores keyboard focus when needed.
Cross-page moves select the destination. Components keep local state while
mounted. Components absent from the selected page unmount; their local controls
are reset. Event/schedule and Task editor drafts remain eligible for explicit
session-local recovery; other unsaved planning drafts are not retained.

Each action saves atomically. Free-form positioning, touch dragging, and
cross-Event moves are outside this interface. Native drag
behavior is browser-dependent; move controls do not depend on drag support.

## Removal and recovery

Page options opens a focused dialog for removing components or entire pages.
Each removal requires confirmation and checks the layout version captured when
the dialog opened. No canonical object or relationship is deleted. A conflict
keeps the proposed change visible; Refresh latest loads the saved layout and
requires a new confirmation.

Layout history lists saved arrangements with dates and page/component counts.
Preview shows page names and component kinds before restoration. Restoring an
arrangement appends a new revision; previous revisions remain immutable. The
initial layout is an empty arrangement at version zero. Viewers can read and
preview history, including layouts saved before they received access, but only
Owners and Editors can restore or remove. Share event opens the existing
sharing view when the user has Share access.

Undo and redo cover up to 50 layout changes made during the current browser
session. They reference saved revisions and use the same restore endpoint.
Editing or manually restoring clears redo. A newer layout from another client
invalidates the local chain; stale writes fail with HTTP 409. Reloading or
switching sessions clears the undo/redo chain, but saved history survives.
Layout undo is separate from planning-record command undo. Removing a component
unmounts its local controls. Eligible Event/schedule and Task drafts can be
recovered when their editor is reopened elsewhere in the same authenticated tab.

## Persistence

`event_page_revisions` stores immutable layout snapshots, keyed by workspace,
Event ID and layout version. Each row references an audit event. The newest
version is the current layout; an Event without revisions has version zero and
an empty pages array. Reads do not create rows. Layout updates do not advance
the canonical Event's object version or alter its metadata.

The API validates a strict structure: at most 20 pages, 20 components per page,
100 components overall, page names of 1-80 characters, unique UUIDs across the
layout, recognized component kinds, and an optional `view` of `list`,
`by-day`, `week`, or `month` per component. Configuration contains no business records, arbitrary
scripts or style definitions. Supported component kinds are listed above;
unrecognized kinds, unrecognized views, and extra fields are rejected.

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
        {
          "id": "00000000-0000-4000-8000-000000000003",
          "kind": "todos",
          "view": "by-day"
        }
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

`GET /api/events/:id/layout/history?limit=10&beforeVersion=12` requires View.
It returns `{ items, nextBeforeVersion }`, with full snapshots in descending
version order. The limit defaults to 10 and is bounded to 20; omit beforeVersion
for the newest page. Every page rechecks current Event access.

`POST /api/events/:id/layout/restore` requires Edit:

```json
{ "expectedVersion": 12, "targetVersion": 3 }
```

The response is the appended layout snapshot at version 13. Target zero restores
an empty layout; a missing target returns HTTP 404. An `event.layout_restored`
audit event records previousVersion, version, and restoredFromVersion in the
same transaction. Permissions, canonical Event versions, and planning records
are unchanged. No additional migration or runtime grant is required.

Typed client equivalents:

```ts
await client.getEventLayoutHistory(eventId, { limit: 10, beforeVersion: 12 });
await client.restoreEventLayout(eventId, {
  expectedVersion: 12,
  targetVersion: 3,
});
```

Deploy the API before or alongside the web UI that calls these endpoints.

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
server audit evidence. Production validation requires the real API and
PostgreSQL integration tests.

Saved layout revisions persist in browser storage, bounded to 2,000 revisions
and the existing overall snapshot size limit. A full store rejects the write
and preserves the saved data. Current-only saved snapshots remain readable;
revisions that were never retained cannot be recovered. Reload clears the
in-memory undo/redo references but leaves saved layout history intact.

The sandbox can insert every component and edit its fictional planning data.
Files previews empty attachment lists; actual file storage and downloads are
not simulated. Unsupported transfers return an explicit error. Existing
browser-local layouts remain usable with this expanded catalog.
