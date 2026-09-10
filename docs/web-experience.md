# Web experience

Chronelle opens into an event collection, with workspace-wide Search and Trash
alongside it. Desktop navigation stays on the left; mobile navigation remains
at the bottom with space for the device's safe area. Events, Search, and Trash
remain directly accessible on both layouts. More opens one shared Workspace
settings dialog for workspace switching, appearance, and sign-out. Escape,
the close button, or a backdrop press dismisses it and returns focus to More.
Opening settings does not navigate or discard the current Event draft.

Appearance customization opens a second native dialog. Closing it returns to
Workspace settings; a second Escape returns to the page. A workspace or session
change dismisses both dialogs and uses the existing session boundary to cancel
pending requests and clear protected state. Workspace choices come from the
authorized session response; choosing one never grants access by itself.

## Workspace commands

Commands opens a focused navigation palette from the desktop or mobile header.
Type a destination name or description, use Up/Down to choose a result, and
press Enter to navigate. Pointer selection also works. Escape, Close, or a
backdrop press dismisses the palette and restores focus. Opening or closing it
keeps the current draft; choosing another destination has the same draft
behavior as the navigation rail.

Cmd/Ctrl + K opens Commands outside text editors and dialogs. It ignores
composition, repeated keydown, consumed events, and extra modifiers. Keyboard
shortcuts inside the palette explains the controls and lets users disable this
binding. The visible Commands button remains available. The preference is a
browser-local `chronelle.command-shortcut` value: `disabled` opts out; absence
or an unknown value enables the default. Same-origin tabs synchronize it.
Blocked storage allows a current-page choice without guaranteeing persistence.
Display reset does not change shortcut preferences.

The same help section offers `/`, `Cmd/Ctrl + /`, or Off for Add component.
This action opens the existing picker only from within an editable event's
page area; it does not insert immediately. Its independent browser-local key,
`chronelle.component-shortcut`, accepts `slash`, `modified-slash`, or `disabled`.
Missing, invalid, or unreadable values default to slash. Changes synchronize
between mounted controls and same-origin tabs; blocked writes retain a
current-page choice, including after closing the dialog. Reset keyboard
shortcuts restores both bindings without changing appearance or clearing
other browser data. Native text undo remains available in editors.

The rail and palette share one catalog of Events, Search, and Trash routes.
Filtering commands makes no object queries and stores no query text or record
data. The palette closes on workspace or identity changes. Destination screens
retain their existing backend authorization and session isolation. Contextual
editing actions and object results are not part of the navigation palette.

## Appearance

Ink & Paper uses warm ivory surfaces, charcoal text, and restrained vermilion
accents. Dark appearance uses warm charcoal surfaces with light ink text.
The Appearance control offers System, Light, and Dark. It is available on
sign-in and inside More on desktop and mobile.
Native radio controls support Tab and arrow-key navigation. System follows
operating-system changes; Light and Dark override them without reloading the
page or resetting a draft.

Appearance is a device-local, same-origin browser preference, independent of
the account, workspace, and palette. It persists across reloads and sign-out,
and synchronizes across tabs. System removes the saved override. Invalid or
unreadable storage falls back to System; failed writes leave the current page
usable but cannot guarantee persistence. Sandbox file storage depends on the
browser and file location.

Choose Customize beside the mode control to open the Appearance dialog. It
previews Ink & Paper, Celadon, and Modern Neutral in the current light/dark
mode. Choosing a palette does not change that mode. Comfortable/Compact
density changes Event-card and record-row spacing without shrinking controls.
Motion follows the device by default; Reduced minimizes transitions and
movement even when the device allows them. Device-level reduced motion always
remains effective. These settings apply immediately and require no save.

Each setting stores only one validated string under its own `chronelle.*` key.
Reset display settings removes those overrides without clearing other browser
data. Cross-tab changes apply even while the dialog is closed. Escape or Done
closes the dialog and restores focus; underlying forms remain mounted. This
dialog does not add shared layout configuration or a server-side settings API.

Semantic colors and local font stacks live in `apps/web/app/tokens.css`, shared
by the application and the browser-only sandbox. Components use role-based
tokens rather than their own light/dark overrides. Each color pairs its light
and dark values with CSS `light-dark()`; supported browsers must implement it.
Ordinary palettes must provide both appearances. A specialized single-mode
palette must declare its supported appearance, explain any unavailable mode,
and preserve the user's preferred mode for returning to a dual-mode palette.
The three supplied palettes support both modes; specialized palettes are not
implemented yet.
Display headings prefer a local serif; controls use system sans-serif fonts
with Chinese fallbacks. No
font downloads or additional theme dependencies are required. A fixed,
nonce-authorized script applies validated display preferences before rendering;
the offline sandbox authorizes the same script by hash. Stored values are never
executed or interpolated into HTML. Browser chrome follows the selected mode
after the control hydrates, including palette and OS changes. Initial browser
chrome uses Ink & Paper and follows the OS.

Browser checks cover text and control-token contrast, keyboard date selection,
visible input focus, long mixed-language names, draft preservation, saved
overrides before application hydration, blocked storage, keyboard operation,
and cross-tab changes. They do not replace manual screen-reader, physical
device, or visual acceptance testing. The installed PWA's launch background is
the light paper color; the running page follows the selected appearance.

## Planning workflow

- Choose **New event** to open the focused creation form. A start date is
  optional. Cancel closes the form and discards its draft.
- Filter the authorized event collection by name and date, and sort by date,
  last update, or name. Upcoming includes events still in progress. Events with
  no end date move to Past once their start time passes.
- Name, period, and sort selections survive in-app navigation. Returning from
  an Event restores its card position and keyboard focus after loading settles;
  interacting while waiting cancels the restoration. Removed cards fall back to
  the nearest available scroll position. Loaded pages use the existing query
  cache; after cache eviction, the list starts with one page and does not
  automatically download the remaining collection. Refresh starts at page one.
  Search waits for committed input when using an input method editor.
- Collection criteria and return references stay in memory, not URLs or browser
  storage. Reload, sign-out, identity replacement, and workspace changes reset
  them. These temporary preferences are not saved views or shared bookmarks.
- Choose grid or list layout. Only this preference is saved in local browser
  storage; no object data, search text, or permissions are persisted there.
  Storage restrictions do not prevent using either layout.
- Event views have bookmarkable URLs, such as `/events/OBJECT_ID?view=calendar`.
  Reload and browser Back/Forward preserve the selected view. Changing views
  keeps the event-header editor mounted; leaving the Event does not preserve
  unsaved drafts. A mobile view selector provides direct access to views beyond
  the visible tab strip.
- Named pages use the independent `page` query parameter. Selecting a view
  preserves the selected page; reload and browser Back/Forward restore it.
  A missing page shows an explanation and the first available page. This is
  navigation state, not an Event or layout mutation, and conveys no access.
- Page names stay in one horizontally scrollable strip. When it overflows,
  Jump to page provides a native keyboard/touch picker. The selected page stays
  visible on resize; the page heading retains its full name. Event breadcrumbs
  and wrapping title/actions keep long names readable without hiding controls.
- Overview counts and Next up use the authorized Event detail response.
  Next up excludes past dates, completed/cancelled tasks, dismissed/triggered
  reminders, and expenses. Time-dependent views refresh every minute and when
  returning to the tab. An ongoing schedule item remains on the Calendar but
  is not a future start in Next up.

Display dates and date-entry controls use the browser's local timezone. Stored
timezone and all-day attributes are retained; specialized all-day and
event-timezone display are a follow-up.

## First use and return

Start with an Event name; dates can wait. Add a named page such as Preparation,
then add only the components it needs. Empty pages explain this next step;
movement instructions appear once there is a component to arrange. Viewers see
read-only explanations without instructions to use unavailable controls.

Trash lists only objects the current user can recover. An empty type filter can
be cleared to show all accessible types. After successful Event recovery,
**Open recovered event** returns to its pages. Recovery preserves the canonical
ID and saved layout; related objects are not recovered automatically. The link
does not bypass the destination's authorization checks.

Keyboard browser tests cover creating an undated Event, adding a page and a
To-dos component, recording a task, recovering the Event, and reopening its
unchanged layout and task. Mobile engine tests include a 320px viewport.
The offline sandbox covers composition and navigation, not real recovery.
These checks do not establish physical-device or screen-reader acceptance.
Form fields can shrink inside narrow page components without pushing their
inputs or submit actions outside the form. Browser checks verify control
containment as well as document width.

## Date and dialog navigation

The Event date picker has independent month and year controls. Arrow keys move
by day or week; Home/End move to the week's edges. Page Up/Down moves one month,
or one year with Shift, clamping to the last available day in the target month.
Navigation stays within years 0001-9999 and does not change the selection until
Enter, Space, or a pointer click. One day in the grid participates in Tab order.

Selected grid cells expose the actual date range, not a tentative hover preview.
Weekday headers have full accessible names, and a polite status reports the
displayed month/year. Keyboard focus moves with the rendered calendar rather
than waiting for a later animation frame. The form body scrolls independently;
programmatic date scrolling cannot move or clip the dialog header and actions.

New event focuses its opener before showing the native dialog, including on
browsers that do not focus buttons on pointer clicks. Closing a session-bound
dialog returns focus to its opener; if it cannot receive focus, the workspace
content is the fallback. Session changes still close dialogs.

The production browser gate includes desktop and mobile WebKit checks for Event
date formatting, schedule editing, keyboard selection, and creation-dialog focus.
These are engine tests, not verification on physical Apple devices or with a
screen reader. Manual Safari/VoiceOver and other assistive-technology review
remain necessary. The offline sandbox gate continues to use Chromium: WebKit's
emulated offline mode fails to load local files before the application runs.

## Editor feedback and refresh

Event, schedule-item, task, expense, and reminder forms keep their draft after a
failed save. Submit again explicitly to retry; Refresh latest only fetches data
and does not save changes. A failed refresh leaves the save error visible.
Loading a newer version requires the explicit discard-draft action.

Inputs and submission controls are disabled during a save. Mounted forms announce
pending and successful saves; starting another edit clears the success message.
Schedule validation clears when the schedule changes. Viewer empty states do not
direct readers to unavailable creation forms.

Temporary network, timeout, rate-limit, and server read failures retain mounted
Event editors, page layouts, and planning components with an error notice.
Permission denial, missing resources, and unexpected response errors hide affected
content even when a cached copy exists. Backend authorization and version checks
still apply to every mutation. Retained data is not a freshness guarantee.
Navigating away, changing sessions, or reloading still discards unsaved drafts;
this is not offline synchronization or durable draft storage.

Production browser tests check explicit task retries with the same creation
command, disabled pending controls, draft retention, and success feedback in
desktop/mobile Chromium and WebKit. The offline Chromium suite also checks
Viewer empty states. Live-region semantics have automated coverage, but actual
screen-reader announcements require manual assistive-technology validation.

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

The interface uses restrained vermilion accents, warm neutral surfaces, system
body fonts, and a serif heading family. Shared controls use existing CSS tokens;
collection and shell layout rules live in `apps/web/app/collections.css`.
SVG icons are code-native and require no external asset service. Reduced-motion
preferences disable decorative motion. Appearance controls use native inputs
and shared CSS; there is no theme-engine or component-framework dependency.

Presentation selectors are pure functions in `apps/web/lib`; network mutations,
concurrency handling, and query invalidation remain in the query layer. Grid,
list, Calendar, and Timeline retain canonical object IDs. Event name/period
filtering and sorting run on the server with permission checks and cursor
pagination. Navigation state contains no copied canonical records and never
grants access. The session boundary owns both the query cache and collection
return state.

The manifest and vector app icon provide standalone presentation metadata.
This release does not promise offline support or cross-browser installation.
Private API responses are not cached and no service worker is registered.

See [Deployment](deployment.md) for the production-build workflow and public
launch requirements.
