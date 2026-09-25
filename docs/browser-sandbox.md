# Browser-only design sandbox

The sandbox reuses Chronelle's Event planning screens with fictional data. It is
for reviewing layout and interactions, not for storing personal information or
validating production security.

Build from the repository root with the normal Node.js and pnpm prerequisites:

```sh
pnpm install --frozen-lockfile
pnpm sandbox
```

Open `.chronelle/sandbox/chronelle.html` directly in a modern browser. The resulting
file contains its scripts and styles and works offline, without an API,
PostgreSQL, Docker, environment variables, or a CloudBase account. Node.js is
needed only to build the file. Moving the file does not transfer saved edits.

## Available interactions

- Browse and create Events; edit Events, to-dos, expenses, and reminders.
- Create Events in a focused dialog without moving the collection. Turn on Set
  dates to choose a single day or a multi-day range, then use Done to collapse
  the calendar. Month and year open independent selection grids; arrow keys move
  between days. Page Up/Down changes months, or years with Shift, without
  selecting a date. Add times is optional. Event IDs are available
  in Details, not displayed as persistent header badges.
- Compare the Overview, Calendar (list, agenda, week, month), and Timeline
  projections of the same canonical sample objects. Search the sample workspace.
- Preview Owner and Viewer controls. Viewer mutations are rejected by the sample
  adapter, but this is not authentication or a security boundary.
- Reset fictional data with confirmation. Reset cannot be undone.

Real sign-in, sharing, file transfers, object recovery/history, trash mutations,
object undo/redo, and reminder delivery require the full application. Unsupported
mutations return an explicit error. Empty history and trash screens are only
layout previews. Sample collections are bounded and unpaginated.

Event pages support manually added, movable components, confirmed removal,
saved layout history, and session-local layout undo/redo. These change only the
arrangement; planning records stay intact. Browse event data opens the secondary
planning views. See [Event pages](event-pages.md) for limits and recovery behavior.
Event date controls are shared with the full application; Task, Expense, and
Reminder time inputs retain their existing controls.

## Persistence and isolation

Edits use the `chronelle.design-sandbox.v1` localStorage key. Browser policy for
local files varies; if storage is unavailable, edits last only until reload.
Private browsing and clearing browser storage can discard edits. Use one tab:
stale snapshots are rejected, but localStorage does not provide transactional
concurrency across tabs. Malformed saved data is preserved until explicit reset;
failed storage writes do not update the in-memory objects. The sample store is
limited to 200 objects, 400 relations, and one million serialized characters.

The build replaces routing, session, and API-provider modules only within the
sandbox bundle. The existing typed API client calls an injected local transport
with no network fallback. The HTML content security policy blocks connections
and external resources. Production builds have no sandbox mode switch and retain
their existing providers, authorization, and persistence.

## Validation

```sh
pnpm --filter @livtales/web test
pnpm exec playwright install chromium
pnpm test:sandbox
```

The dedicated browser suite opens the file offline on desktop and mobile Chromium;
it starts no web server. Store tests cover canonical projections, persistence,
stale versions, storage failures, and unsupported operations. These checks do not
establish production authorization, database integrity, or backup recovery.
Scheduling checks cover dialog focus and background isolation, independent
month/year changes, month-end and leap-day keyboard selection, optional dates and
times, selected versus hover ranges, Details disclosure, and date-only reloads in
another timezone.
Editor checks cover offline save confirmation, clearing confirmation for a new
draft, and read-only empty states without creation controls.
Chromium checks do not establish screen-reader, Safari, or
Firefox compatibility.

Full application local testing is a separate, deferred milestone after design
review. Existing instructions in [local development](local-development.md) remain
available. CloudBase service selection and production launch gates follow later.
