# Web experience

Accounts are email and password. Sign in at `/sign-in`; Create an account
(`/sign-up`) asks for a name, email, and a password of at least ten
characters, then moves to `/verify-email` for the six-digit code sent to the
address (Send a new code issues another; a sign-in attempt on an unverified
address also sends one and lands on the same screen). Forgot your password?
(`/reset-password`) sends a code to the account's email, then takes the code
and a new password; the reset signs every other session of the account out.
Each screen redirects to the collection once a session exists, and Sign out
ends the session on the server as well as in the tab. The development
sign-in (name and email, no password) lives at `/sign-in/development` and
exists only where the web server is started with
`WEB_DEVELOPMENT_SIGN_IN=true`.

Chronelle opens into an event collection, with workspace-wide Tasks, People, Search,
and Trash alongside it. Desktop navigation stays on the left; mobile navigation
remains at the bottom with space for the device's safe area. Events, Tasks,
People, Search, and Trash remain directly accessible on both layouts. More opens one shared Workspace
settings dialog for workspace switching, appearance, and sign-out. Escape,
the close button, or a backdrop press dismisses it and returns focus to More.
Opening settings does not navigate or discard the current Event draft. On the
desktop layout the account block at the foot of the sidebar is a button that
reveals Sign out beneath it; Escape or a press elsewhere collapses it and
returns focus to the account button. The mobile layout keeps sign-out in
Workspace settings.

Appearance customization opens a second native dialog. Closing it returns to
Workspace settings; a second Escape returns to the page. A workspace or session
change dismisses both dialogs and uses the existing session boundary to cancel
pending requests and clear protected state. Workspace choices come from the
authorized session response; choosing one never grants access by itself.

## Tasks

Tasks lists every task the user may view in the workspace: tasks that live on
their own and tasks inside any event, in one place. New task creates a task
that belongs to no event and owns its own permission scope; tasks added inside
an event keep that event's scope and appear here as well. The toolbar filters
by name and carries the three quiet controls every task collection shares:
Sort (Manual, the default, the order tasks are kept in; By due, a date-only
due leading its day and undated tasks last; By name; By updated), Filter
(Open, All, or Done, then any label and any person the workspace knows, with
Clear filters; the button counts the choices that differ from Open, Any
label, and Anyone), and Layout. The sort, status, label, and assignee are
applied by the server, so a page holds only what matches. Load more tasks
extends the list page by page.

The page offers the same List, By day, By week, and Calendar layouts as the
To-dos component, from the same rows: the completion check, the name and its
details, the status, and the row menu. The week and the calendar ask the server for the tasks
due on the days shown (in the browser's time zone) and load all of them, so
Load more does not appear there; tasks with no due date are in no week or
month, and the other filters still apply. Moving the period asks again. A task inside an event names that event under its title, as a link to
the event, when the user may view the event; a task held through a direct
grant inside an event the user cannot see shows no event.

Add subtask, on any task that is not itself a subtask, opens the task editor
for a subtask: it names the parent, and the new task shares the parent's
permission scope (its event's, inside an event). Subtasks go one level deep.
In the list a subtask sits indented under its parent when both are loaded,
otherwise it reads "Part of" its parent; by day, each task sits under its own
due day with the parent named. A parent shows how many of its subtasks are
done (2/3). Completing a parent leaves its subtasks as they are; a parent
moved to Trash takes its live subtasks with it, and restoring the parent
brings back the ones that went with it (a subtask trashed on its own stays,
and cannot be restored before its parent). The To-dos component offers the
same actions and marks over the event's tasks.

Labels are workspace-wide names a task may carry any number of. The task
editor holds them behind a Labels disclosure: closed, it counts the selection;
open, it lists the workspace's labels as checkboxes and takes a new label,
which is selected as soon as it exists. Rows show labels as chips under the
title in both views. The Tasks page filters by one label from the toolbar and
opens Manage labels, where labels are renamed, added, or deleted; a deleted
label leaves its tasks. Anyone with access to the workspace sees label names;
owners and editors change them. The view is a device preference, kept in browser storage like the
event collection's grid or list choice, and applies to the loaded tasks. The
filter, sort, name query, label, and assignee belong to the tab.

## People

People are canonical records of the workspace: a name, an optional email, an
optional link to a member's account, and custom fields for anything worth
keeping (a phone, a birthday, a dietary note). The People page in the rail
shows everyone as namecards with initials, the name (marked "(me)" for the
person linked to the signed-in account), the email as a mail link, "Has an
account here" for other linked people, and the custom fields as a small
table. Shown fields lists every field any loaded person carries; unticking
one hides it on every card, a device preference kept in browser storage.
New person and Edit open the person editor: name, email, This is me (offered
when the person is unlinked or already this user's; one person per account),
and the fields as name/value rows with Add field and Remove. Editing keeps a
field's original type unless its text changes. Cards offer History and
Actions (Trash) like any record; Search and Trash filter by People, and
Trash restores them. The name query asks the server after a typing pause.

An event page can carry a People component (also an event view and an
overview card) that shows the people the event involves as the same
namecards. Add person offers everyone the workspace knows who is not yet in
the event, by name, or takes a new person's name and creates them inside the
event. A card's Actions offer Remove context link, which takes the person out
of the event and leaves them in the workspace, as well as Move to Trash.

The Sharing tab of an event, offered to its owners, grants access by email
(Collaborator email, Viewer or Owner) or to people: Share with people lists
the workspace's people who can be reached, those with an account here (other
than the user's own person) and those with an email, with the role each
already holds on the event; tick any number, choose Viewer or Owner, and
Share with N people shares with each in turn, reporting "Shared as viewer"
or the refusal (an email that matches no account, for one) beside each name
and leaving a refused person ticked for another try. A person's account is
their linked one, else the account with their email. The People component
offers owners Share with everyone here, the same control with the event's
reachable people ticked. People with access lists the accounts that hold a
grant, with Revoke.

A task may be assigned to one person as the one responsible for it. The task
editor holds the choice behind an Assignee disclosure that names the current
assignee (Unassigned when none); open, it lists the workspace's people with
Unassigned first, takes a new person by name (selected as soon as they
exist), and offers Assign to me, which creates the signed-in user's person on
first use and marks it "(me)" thereafter. Rows name the assignee under the
title in both views. The Tasks page filters by assignee from the toolbar:
Anyone, Me (when the user has a person), or a person by name. A Location
field in the task editor names where the task happens, as text; rows show it
under the title ("At ..."), and clearing the field removes it. A task due at
a time may carry a duration (1 minute to 24 hours); rows show it after the
time ("9:30 AM, 30 min", "1 h 30 min"). A task with a due may repeat (every
day, every weekday, every week, every two weeks, every month, every year),
optionally until a last date; completing it from a row moves its due to the
next occurrence and leaves the row open, and only the last occurrence marks it
done. Rows say how a task repeats after its time ("9:30 AM, repeats
weekly").

Every bounded text field in an editor (the names of events, schedule items,
tasks, expenses, reminders, pages, labels, and people; a person's email and
fields; a task's location)
counts its characters ("n / limit") as the user types and stops at the
limit: a longer paste is cut to the limit, and the count turns red when the
limit is reached.

## Workspace commands

Commands opens a focused palette from the desktop or mobile header.
Type an action or destination name or description, use Up/Down to choose a result,
and press Enter to open it. Pointer selection also works. Escape, Close, or a
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
current-page choice, including after closing the dialog. The editor-submit
checkbox controls Cmd/Ctrl + Enter using `chronelle.editor-shortcut`:
`disabled` opts out, while missing, unknown, or unreadable values enable it.
All three shortcuts share the same storage and synchronization behavior.
Reset keyboard shortcuts restores their defaults without changing appearance
or clearing other browser data. Native text undo remains available in editors.

The rail and palette share one catalog of Events, Search, and Trash routes.
On an event, a separate Event actions group offers Edit event, Share event,
Event history, Add page, Add component, and Arrange layout when their controls are
available. Viewers receive only Event history. An open event editor does not
offer Edit event again. Page actions require the Pages view, edit access, and
no pending canvas save. Insertion also requires room within layout limits;
Arrange layout requires an existing page. Add component names its
selected page. These actions open existing controls; they do not save, insert,
share, or restore data immediately.

Commands closes before focusing and activating the original button. Editors
focus their first field, sharing focuses its view, and dialogs return focus to
their original control. Removed actions do not shift keyboard selection onto
another action. Mounted owners publish explicit button references through the
workspace command provider; scope cleanup, route changes, session cancellation,
and unavailable targets prevent stale activation. The application router supplies
the scope in both Next.js and the offline sandbox.

Navigation and event actions filter immediately. Valid terms of at least two
characters also search the current workspace after a 250 ms typing pause;
composition-stage input does not issue requests. Records appear as a separate
group, with up to eight results from the existing authorized search endpoint.
Type and destination hints distinguish records from actions without displaying
object IDs. Event-scoped records open their event, using the same destination
mapping as Search. Root non-event records have no detail route yet and remain
non-actionable. Open full Search provides the existing filters and pagination;
query text is not transferred into a URL or persisted.
The results scroll independently so keyboard selection keeps the search field
visible on narrow screens.

Requests are cancelled on changed terms or dismissal. Changed inputs,
revalidation, and failed reads hide earlier records. Search failures leave
navigation available and provide an explicit retry. Result selection follows
canonical identity: an arriving record does not replace a selected navigation
action, and removing a selected record does not choose another one. The palette
retains no search cache after dismissal and revalidates when the window regains
focus. The session boundary aborts requests, discards protected caches, and closes
the palette on workspace or identity changes.

Availability follows the latest loaded access response, not a live subscription
to permissions. All underlying reads and mutations require backend authorization.
Denied event queries remove their context actions. The backend retains its
existing full-text matching; the offline sandbox uses sample-name substring
matching with bounded pages. Neither provides a new search index or record copy.
Destructive commands are not included.

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
  optional. Cancel, close, and Escape dismiss an untouched form immediately.
  After editing, choose **Keep editing** or **Discard** in the same dialog.
  Keep editing preserves the name, schedule, calendar position, and focus;
  Escape from confirmation also returns to the draft. Saving locks dismissal.
  Supported browsers warn before leaving the document with an edited or saving
  creation form. This warning is not autosave and may not appear on mobile.
  Session changes clear the draft immediately without confirmation.
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
  Reload and browser Back/Forward preserve the selected view. A mobile view
  selector provides direct access to views beyond the visible tab strip.
  Close the Event inspector before using background page navigation.
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
movement controls and instructions appear only in Arrange layout mode. Viewers see
read-only explanations without instructions to use unavailable controls.

Add a page offers Blank (the default), Gathering (To-dos, Calendar as an
agenda, Expenses), and Multi-day (Calendar, Files). The preview shows the page name and
ordered components before saving. Choosing a preset supplies a suggested name
until the name is edited; switching presets preserves a custom name. Each
selection appends one page, preserving existing pages and canonical records.
These views cover the whole event; Multi-day does not invent dates or filter
activities to separate days. Reusing a preset creates fresh layout identities,
not new planning records. Page/component limits are validated with the shared
layout schema before submission; existing backend checks remain authoritative.
The append is one versioned layout mutation, recoverable through Page options.
Preview and cancellation perform no writes. Save failures preserve the name
and preset; after a conflict, close and reopen to review the latest layout.

Arrange layout reveals page ordering, component move buttons, cross-page moves,
and drag handles. Done arranging hides these tools without saving again; each
move saves immediately through the existing versioned layout API. Page options
remains available for removal, undo/redo, and saved layout history. Add page,
Add component, and insertion shortcuts work in either mode.

The component catalog names its destination page and searches all seven kinds
by name, description, or ordinary terms such as checklist, costs, and documents.
Slash prefixes and full-width Latin characters are accepted. Arrow Down from
search focuses the selected native radio; arrow keys then select a choice.
The visible selection and Add label agree, including when filtering selects
the first matching kind. An empty result disables insertion and offers Clear
search. Composition-confirming Enter does not insert a component.

The catalog explains when the selected kind is already used on this page or
another page. Adding another view is allowed and does not copy canonical
records. Successful insertion names the component and destination. Closing the
dialog restores focus; losing Edit access discards the open catalog. Pending
saves lock selection and dismissal. Conflicts retain the selected choice and
captured source version; close and reopen to retry against the latest layout.

The mode is local to the open event and session. It survives page selection,
but resets on leaving the Pages view, reload, event/session changes, and loss
of edit access. Toggling keeps mounted components and unsaved form values.
Commands offers the same Arrange layout / Done arranging control, disabled
during an in-flight canvas save. No global Escape shortcut is added, so native
editors and dialogs retain ownership of their keys. Mode changes do not write
layout versions or audit events; layout mutations retain concurrency and
authorization checks. Removing a component never deletes its planning records.

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

## Notice tones

A boxed notice carries one tone, told by its icon as much as its color: neutral
(an information mark) for something to know, success (a check) for an action
that completed, such as a link removed or recovered, an object moved to Trash,
or a version restored; warning (an exclamation mark) for a newer version or a
blocked recovery; and danger (the same mark in the danger color) for a failed
request. Errors are announced as alerts; the other tones are announced politely
as status. An inline error under a field reads in the danger color. Loading and
empty states are not notices and keep their own quiet styling.

## Date and dialog navigation

The Event and schedule item editors set their dates behind a Dates disclosure
that reads the range as exact dates (Dates: Jul 3, 2030 to Jul 12, 2030, or
not set), open until a start is chosen. Open, it holds a Start date and an End
date field that take typed dates in the shapes the Due control reads, the
shortcuts a weekday allows (Today, Tomorrow, Later this week, This weekend as
Saturday to Sunday, Next week) with No dates, and the same month list as the
Due control: one six-week month at a time, extending as it is scrolled, with the
month and year chooser above it. The first day chosen on the list starts the
range and the second ends it; pressing on a day and dragging across others
chooses the span between them (mouse or pen; touch scrolls the list); a start
typed after the end clears the end, and an end before the start is refused
with a note until it is fixed. Arrow keys move by day or week; Home/End move
to the week's edges; Page Up/Down moves one month, or one year with Shift,
clamping to the last day of the target month; Enter or Space chooses. One day
in the list participates in Tab order. Moving through the list never changes
the selection or submits the editor.

Add times starts with empty fields until times are explicitly entered. Switching
back to dates retains entered times in the current form but does not save them.
Clearing the End date field also clears its time, including a temporarily
hidden time.
For a timed plan on one day, the end time can remain unspecified even when both
selected dates are the same. A multi-day timed plan requires an end time.
Pending saves disable the entire schedule. Existing date ordering, local-time
validation, optimistic concurrency and authorization remain unchanged.

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

Edit event opens a right-side modal inspector on wide screens and a full-width
editor on narrow screens. The underlying page stays in place but is inert.
Fields scroll independently from save actions. Escape, Cancel and Close confirm
changed fields with Keep editing or Discard; unchanged or reverted fields close
immediately. Confirmation retains field values, calendar navigation and focus.
Saving locks dismissal; success closes the inspector and restores focus.
Session changes or authoritative access loss remove private drafts immediately.
The inspector edits the same canonical Event using its pinned source version.
History is available inside the inspector without dismissing the draft. Closing
history returns focus to its inspector control. Restoring a version leaves
unsaved fields intact and requires explicitly loading the latest source to save.

Calendar Edit opens the same inspector for the selected schedule item, including
Calendar components on Event pages. The item is a canonical Event; its current
data and edit permission are checked separately from the parent. Cached access
is not sufficient to open it. Its name and schedule share one draft across
contexts, and saving refreshes the Calendar and Timeline projections.
Temporary item-read failures hide the editor until an explicit retry; the kept
draft can then be resumed.

Add schedule item opens a focused creation dialog without moving the Calendar
list. Dates start enabled with no selected date or invented time; they can be
turned off. Cancel and Escape confirm dismissal of changed fields. Keep editing
preserves the form, calendar position and focus. An in-flight save disables
editing and dismissal. Failed saves retain input; unchanged retries reuse the
linked-create command identity, including after draft recovery. Successful creation closes the
dialog and refreshes the Calendar and Timeline.

Schedule creation keeps one draft per parent Event in authenticated tab memory.
After navigation, Add schedule item offers Resume / Discard. Resume checks fresh
parent access before displaying the fields. The draft retains its linked-create
attempt, so an unchanged retry after a lost response can return the existing
canonical item. Pending saves stay tracked while away without late navigation.
Discard, reload, session changes, or eviction clear the attempt. Changing the
submitted values starts a new command; check the Calendar before doing either
after an uncertain save. This is not durable storage or an exactly-once guarantee
across those boundaries. The offline design sandbox supports draft recovery but
does not implement backend command replay.

Event, schedule-item, task, expense, and reminder forms keep their draft after a
failed save. Submit again explicitly to retry; Refresh latest only fetches data
and does not save changes. A failed refresh leaves the save error visible.
Loading a newer version requires the explicit discard-draft action.

Every task list ends with a quiet Add task row, on the rows' own grid: a
plus where the check sits and the words where a name sits. Choosing it turns
the words into a name field in place; Enter creates the task with that name
and nothing else, then keeps the field open and empty for the next one;
Escape, or leaving the field empty, puts the row back. In the by-day view each
day group has its own row, and a task added there is due on that day (the No
due date group adds one without a date; Overdue has none). The Tasks page has
the same row, and a task added there stands on its own. A refused name stays
in the field under the usual error notice. An empty collection shows the row
under its empty state, so the first item is added the same way. Reminders end
with an Add reminder
row that works the same way: a reminder added under a day is due at 9:00 that
day, one added to the list at the next 9:00; the editor changes the time.
Viewers see no such rows.

To-dos uses Add task to open a focused creation dialog and Edit to open a Task
inspector. Both keep the underlying list in place and confirm dirty dismissal;
Create task and Save task commit explicitly. Completion and reopening remain
direct row actions through the check, a filled circle whose tick previews
faintly on hover. The inspector checks fresh canonical Task data and its own
edit permission before exposing fields, even when a cached copy is present.
Temporary refetch failures preserve mounted input; denied access hides it.
History remains available inside the editor, and changed source versions require
an explicit refresh/load-latest decision. The editor's Due control reads the
choice when closed as the exact date (Due: No date, or Sep 21, 2026, with
"(today)" or "(tomorrow)" as a hint and the time when one is set) and opens
to a Due date field that shows the exact date and takes a typed one (an ISO
date, today, tomorrow, next week, Sep 21 or 21 Sep with an optional year, or
9/21, with a hint for text it cannot read); shortcuts for the days a weekday
allows (Today, Tomorrow, Later this week, This weekend, Next week, No date),
all of them always listed with the one matching the choice marked; and the
months as one continuous list showing a month at a time, Sunday-first
headings, today outlined, past days and weekends muted, the chosen day
marked, extending as it is scrolled, with the schedule picker's keyboard moves (arrows by day and week, Page Up and
Down by month, Home and End to the week's edges, Enter to choose). The month
heading names the month at the top; Previous, Today, and Next move it, and
choosing the heading opens a focused chooser over the list: a typed field
(October 2027, 2027-10, 10/2027) above a month grid and a scrollable year
grid with the current ones marked. The month and the year are chosen
independently and the list behind follows each choice until Done, Enter,
Escape, or a click outside closes the chooser. Add time reveals the Due time field and a Duration select (No duration,
15 min to 8 h), which waits for a time; Remove time clears both. A Repeat
select (Does not repeat, Every day, Every weekday, Every week, Every 2 weeks,
Every month, Every year) waits for a date; a rule reveals an Until field that
takes a typed date, optional, refused with a note when it comes before the
due, and dropped when the due moves past it; the closed control reads the
rule ("Sep 19, 2026, every week until Oct 31, 2026"). No date clears
everything. A date alone makes the task due that
whole day (shown as the date, ahead of timed tasks that day, and in the
Timeline as a dated entry); a date with a time makes it due at that local
instant. Name-only edits preserve the exact stored due instant, and
unavailable local times are rejected. Task drafts survive client-side navigation within the authenticated
tab. Add task or Edit offers Resume / Discard before exposing retained values.
Creation drafts belong to their parent Event; edits follow the canonical Task
across contexts. Resume checks fresh parent access for creation and the Task's
own access for editing. Layout or projection access denial clears parent-scoped
drafts without changing independently authorized canonical Task drafts.

An unchanged Task creation retry retains its command across navigation and
recovery. Pending saves cannot be resumed or discarded until they settle;
completion clears the draft without navigating. Check the current Task before
retrying an uncertain edit. Discard, eviction, reload, sign-out and workspace
changes clear retained fields and retry identity. This is session-local recovery,
not durable offline storage.

Cmd/Ctrl + Enter submits the focused native field in these editors, including
the New event dialog. The save button shows a hint and exposes the binding to
assistive technology. The shortcut requests a normal form submission through
that button: required fields, amount patterns, schedule validation, pinned
versions, mutation commands, and backend permissions all remain in effect.
It also works when the save button itself has focus.

Only explicitly opted-in editor forms participate. Calendar navigation, Cancel,
custom text controls, nested dialogs, portaled content, and other forms keep
their existing keys. Consumed events, IME composition, repeats, extra modifiers,
pending saves, and disabled save buttons cannot trigger shortcut submission.
Unmodified Enter is unchanged. Disabling the shortcut in Commands does not
disable the visible save button or discard drafts.

Inputs and submission controls are disabled during a save. Mounted forms announce
pending and successful saves; starting another edit clears the success message.
Schedule validation clears when the schedule changes. Viewer empty states do not
direct readers to unavailable creation forms.

Temporary network, timeout, rate-limit, and server read failures retain mounted
Event editors, page layouts, and planning components with an error notice.
Permission denial, missing resources, and unexpected response errors hide affected
content even when a cached copy exists. Backend authorization and version checks
still apply to every mutation. Retained data is not a freshness guarantee.
Unsaved drafts are not durable storage or offline synchronization. Confirming
document navigation, changing sessions, or closing the browser can discard them.
Event creation, schedule creation, Event inspectors, Task, Expense and Reminder editors guard edited-form dismissal. Other
planning editors retain their existing navigation behavior.
Client-side browser Back/Forward transitions are not intercepted. Save or close
the inspector to finish explicitly, or navigate and reopen Edit event to recover
its unsaved name and schedule. New event offers the same recovery. Up to twenty
recently changed Event, Task, Expense and Reminder drafts stay in the current authenticated tab's memory;
older non-pending drafts can be evicted. Drafts are never written to browser
storage. Reload, sign-out and workspace changes clear them. Calendar navigation
itself is not retained across routes. Schedule creation shares this limit with
Event creation, Event/schedule-item editing, Task, Expense and Reminder creation/editing.

Resume draft checks current access before displaying private values and preserves
the original version for conflict detection. Temporary access failures allow an
explicit retry; definitive access loss removes the draft. Pending saves remain
tracked after navigation: reopening cannot submit them twice, and completion
clears recovery without moving the user to another page. Failed saves retain the
draft. Event creation is not idempotent, so check the saved Events before retrying
an unknown outcome. If all twenty retained entries are pending, another draft
cannot be retained or saved until a slot becomes available; keep that editor open.
The best-effort unload warning covers kept drafts even away from an editor, but
browser support varies.

Production browser tests check explicit task retries with the same creation
command, disabled pending controls, draft retention, and success feedback in
desktop/mobile Chromium and WebKit. The offline Chromium suite also checks
Viewer empty states. Live-region semantics have automated coverage, but actual
screen-reader announcements require manual assistive-technology validation.

## Component views

The seven Event components share one frame. Each opens with its title, one
line on what the view is for, and at most one action: Add task, Add schedule
item, Add expense, or Add reminder for members who can edit; Files takes its
file through the form below its heading instead, and holds that form and the
target choice while an upload runs. Every component's states use the same
pieces: one loading line, one empty state whose viewer wording says the event
is read-only, and one error notice with a retry (or, for a failed upload or
download, Dismiss). Attachments outside the viewer's permission scope are
counted in a Private attachments note, as the Overview counts private related
items. Calendar, Expenses, and Files rows carry their actions in
one group and one order across views: the row's own action first (Edit, or
Download for a file), then History, then Actions, which opens the move-to-Trash
dialog. Viewers see only History and Download.

Task and Reminder rows keep their further options behind one menu button at
the row's end (Actions for the row's name), shown on hover or focus and
faintly on touch. The menu is one narrow list: Edit, Complete or Reopen (for
a reminder, Dismiss while it is pending), Move up and Move down, then Due
(for a reminder, Snooze), which swaps the day shortcuts into the same list
(Today, Tomorrow, Later this week, This weekend, Next week, and for a task No
date) with the current one marked and a line saying the current day; a
timed task or reminder keeps its time of day on the new day. Then Add subtask
(on a task that is not itself a subtask), Duplicate (the task's fields and
labels, not its subtasks, placed just after it), Copy link (the row's address
on its event page, or on the Tasks page for a task outside any event),
History, and Move to Trash, which opens the recovery dialog. Arrow keys move
through the menu and skip a disabled entry, Home and End jump, Escape or Arrow
Left leaves the shortcuts, Escape or a press outside closes the menu, and
focus returns to the menu button, which is also where a dialog opened from the
menu returns focus. A viewer's menu offers Copy link and History.

Tasks and Reminders hold a manual order: a new record goes last, and the
To-dos and Reminders components list by it, as does the Tasks page under its
Manual sort. Under manual order a row can be dragged by pressing anywhere on
it and moving a few pixels (on touch, by holding it first), so a click on the
check, the name, or the menu keeps its meaning and the click that ends a drag
does nothing; a ghost of the name follows the pointer and a line marks the
place. Dropping between two rows takes the midpoint of their positions, so
only the moved record is written, as one versioned update the history and
undo cover. In the by-day view a drop under another day's rows moves the due
(or the reminder's time) to that day, keeping the time of day; a drop under
No due date clears the due; Overdue takes only its own rows back. Move up and
Move down do the same one step at a time from the keyboard, announcing the
new position, and a status line reads out every move, due change, and copied
link. Under another sort on the Tasks page rows do not drag and the steps
are not offered.

Calendar and Reminders mark each row with the same date tile as the Events
collection, the month above the day. Task and reminder statuses read as
labels (To do, In progress, Done, Cancelled; Pending, Triggered, Dismissed),
and the Timeline names each entry's kind the way the other views do (Scheduled
event, Task, Expense, Reminder). Calendar, Expenses, and Reminders rows keep
their date mark, text, and actions on one line and wrap the actions under the
text on narrow screens.

A component's kind decides which records it holds; its layout decides how
they are laid out, and the heading carries one Layout control, an icon with
the current layout's name, that opens the templates a kind offers when it
offers more than one. To-dos offers List, the table; By day, which groups
tasks under Overdue, one heading per due date (Today and Tomorrow named, with
the weekday), and No due date, showing each timed task's due time and nothing
for a task due on the date itself; By week, seven columns Monday to Sunday
with today marked and each task in its due day's column, scrolling sideways
where the panel is narrow; and Calendar, the month's weeks as a grid of day
cells with the weekday names and day numbers at the right, today a filled
circle, the days of other months muted and the first of a month named, and
the grid ending with the week that holds the month's last day. Each calendar
cell holds its tasks as compact rows (a dot, the name clipped, the time at
the right, done ones struck through), three of them and then "+n more",
which opens the rest in place. Calendar offers List; Agenda, the numbered
running order of its items with the same Edit, History, and Actions on each;
and By week and Calendar, a scheduled item sitting on every day it covers.
Expenses and Reminders offer List, By day, By week, and Calendar as well: a
transaction sits on the day it happened and a reminder on the day it is due;
an expense day heading carries the day's totals by currency, and a calendar
cell shows each amount or time with the name (a dismissed or triggered
reminder struck through). A page that carries an Itinerary component (a
retired kind) shows the Calendar in its Agenda view, and choosing another
layout on it saves it as a Calendar. The event's own tabs (To-dos, Calendar,
and the rest) offer the same Layout control; a tab's choice lasts for the
session, while a page component's is saved with the layout. Above a week or
a calendar, open tasks whose due has passed sit in an Overdue strip and tasks
with no due date or unscheduled items in a second strip, since neither has a
cell. The period's title sits at the left of the grid, the month in bold
with the year after it, and three quiet icon buttons at the right move it:
previous, this week or month (a plain ring), next; the period opens on today,
is not saved, and returns to today when the layout changes. The rows in a
column or a cell are the list's rows with the same check and actions, and the
filters apply to every layout.

Beside Layout, the To-dos component carries Sort and Filter. Sort orders the
tasks by Manual (their kept order), By due, By name, or By updated, and the
button reads the chosen order when it is not the default. Filter opens one
menu: Open, All, or Done; Has a time and Overdue; the labels the event's
tasks carry (Any label and the labels on at least one task); the people
assigned (Anyone, Me when the user's person is assigned, and the assigned
people by name); and Clear filters. Choices keep the menu open and combine,
the button counts the choices that differ from the defaults, the count
beside the title reads "2 of 7 open" while any are on, a choice the tasks no
longer carry falls back to any, and these choices last for the session rather
than being saved with the layout. On a page, the choice of layout is part of
the layout: it saves at once for everyone on the Event, shows in layout
history, and undo covers it. Viewers see the saved layout without a control.

## Recorded reminders

Add reminder opens a focused dialog with a name and required Reminder time.
Record reminder and Save reminder submit explicitly. No notification is sent;
the form states this limitation before saving. Edit loads the canonical Reminder
and its current access, not an editable copy of a projection row. Name-only edits
preserve the original precise instant, and metadata edits do not reset status.
The existing Dismiss action remains available for pending reminders.

Reminder drafts share the same tab-local recovery, parent creation keys,
canonical edit keys, original versions and unchanged-retry identity as other
planning editors. They do not survive reload or sign-out. Temporary access
failures retain approved drafts; definitive denial clears them. Confirmed saves
settle independently of slow projection refreshes.

## Expense amounts

Add expense opens a focused dialog; Edit reads the canonical Expense and its own
current access before showing fields. Record expense and Save expense are explicit
actions. Pending saves disable fields and dismissal, failed saves preserve input,
and dirty dismissal offers Keep editing or Discard. History remains available in
the editor. Cmd/Ctrl+Enter follows the shared shortcut preference and native
validation, including required transaction time and exact decimal input.

Expense creation drafts belong to the parent Event; edit drafts follow their
canonical object across contexts. Recovery checks fresh access before displaying
fields and keeps the original version until an explicit load-latest action.
An unchanged creation retry reuses its command after navigation. Changed input,
discard, reload, eviction or session changes end that retry guarantee. Unknown
edit outcomes require checking the current record before another save.

Confirmed Event, Task, Expense and Reminder saves settle before background projection refreshes.
A slow access or list refresh does not keep a completed write marked as pending;
each view continues to own its loading and error state. Linked creation uses the
same completion rule for scheduled Events and recorded reminders. A confirmed Event
save also publishes the acknowledged record to the editor's canonical read before
that refresh completes, so reopening Edit event shows the saved name and version
rather than an earlier cached copy; a newer version already loaded is kept.

Name-only edits preserve the complete transaction instant. Explicit time changes
use the browser timezone and reject unavailable daylight-saving times. New dialogs
start with USD and the current time; these are entry defaults, not inferred facts
about another transaction. Physical mobile decimal-keyboard entry, including
negative adjustments, still needs device testing.

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
