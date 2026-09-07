# Web experience

Chronelle opens into an event collection, with workspace-wide Search and Trash
alongside it. Desktop navigation stays on the left; mobile navigation remains
at the bottom with space for the device's safe area. The mobile account menu
contains workspace switching and sign-out. Escape closes it and returns focus.

## Planning workflow

- Choose **New event** to open the focused creation form. A start date is
  optional. Cancel closes the form and discards its draft.
- Filter the authorized event collection by name and date, and sort by date,
  last update, or name. Upcoming includes events still in progress. Events with
  no end date move to Past once their start time passes.
- Choose grid or list layout. Only this preference is saved in local browser
  storage; no object data, search text, or permissions are persisted there.
  Storage restrictions do not prevent using either layout.
- Event views have bookmarkable URLs, such as `/events/OBJECT_ID?view=calendar`.
  Reload and browser Back/Forward preserve the selected view. Changing views
  keeps the event-header editor mounted; navigating to another page does not
  preserve unsaved drafts. A mobile view selector provides direct access to
  views beyond the visible tab strip.
- Overview counts and Next up use the authorized Event detail response.
  Next up excludes past dates, completed/cancelled tasks, dismissed/triggered
  reminders, and expenses. Time-dependent views refresh every minute and when
  returning to the tab. An ongoing schedule item remains on the Calendar but
  is not a future start in Next up.

Display dates and date-entry controls use the browser's local timezone. Stored
timezone and all-day attributes are retained; specialized all-day and
event-timezone display are a follow-up.

## Expense amounts

Expense rows and totals retain all nonzero digits of the stored four-decimal
amount. Currency formatting uses the browser's locale and the currency's usual
minimum fractional digits; it does not round away finer stored precision. For
example, USD 1.0001 displays as $1.0001 in an English-US locale.

Overview shows an exact sum when visible transactions share one currency,
otherwise their transaction count. The Expenses view labels a separate total
for each currency. Only authorized, returned transactions contribute; there
are no exchange rates or cross-currency grand totals. A total can exceed the
per-transaction database range without losing precision.

The monetary helpers use fixed-scale integer addition and native ECMA-402
decimal-string formatting. Stored amounts and edit values remain decimal
strings. Aggregates are presentation data, not new canonical records, and do
not modify historical Expense facts. The supported modern-browser runtime
must support exact decimal-string input to Intl.NumberFormat.

## Design boundaries

The interface uses restrained green accents, warm neutral surfaces, system
body fonts, and a serif heading family. Shared controls use existing CSS tokens;
collection and shell layout rules live in `apps/web/app/collections.css`.
SVG icons are code-native and require no external asset service. Reduced-motion
preferences disable decorative motion. There is no theme engine or component
framework dependency.

Presentation selectors are pure functions in `apps/web/lib`; network mutations,
concurrency handling, and query invalidation remain in the query layer. Grid,
list, Calendar, and Timeline retain canonical object IDs. Client filtering is
only a presentation step over server-authorized records, never an access check.
The current event collection is unpaginated; server pagination is required
before large-workspace scaling.

The manifest and vector app icon provide standalone presentation metadata.
This release does not promise offline support or cross-browser installation.
Private API responses are not cached and no service worker is registered.

See [Deployment](deployment.md) for the production-build workflow and public
launch requirements.
