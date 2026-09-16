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
by name, sorts by due date (a date-only due leads its day, undated tasks come
last), recent update, or name, and the Open tasks / All tasks / Completed
filter is applied by the server, so a page holds only what matches. Load more
tasks extends the list page by page.

The page offers the same List, By day, Week, and Month views as the To-dos
component, from the same rows: the completion check, Edit (the Task
inspector), History, and Actions. Week and Month ask the server for the tasks
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
under the title ("At ..."), and clearing the field removes it.

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

## Date and dialog navigation

The Event date picker has independent month and year controls. Arrow keys move
by day or week; Home/End move to the week's edges. Page Up/Down moves one month,
or one year with Shift, clamping to the last available day in the target month.
Navigation stays within years 0001-9999 and does not change the selection until
Enter, Space, or a pointer click. One day in the grid participates in Tab order.

The year picker also accepts a direct year jump. Go or Enter moves the calendar
without selecting a date or submitting the event. An unfinished year entry does
not prevent saving an otherwise valid event. Date-range summaries count both
endpoints, including leap days, and leave an unspecified end optional. Clear end
date keeps the start and returns focus to the end-date control.

Add times starts with empty fields until times are explicitly entered. Switching
back to dates retains entered times in the current form but does not save them.
Clearing an end date also clears its time, including a temporarily hidden time.
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

To-dos uses Add task to open a focused creation dialog and Edit to open a Task
inspector. Both keep the underlying list in place and confirm dirty dismissal;
Create task and Save task commit explicitly. Completion and reopening remain
direct row actions. The inspector checks fresh canonical Task data and its own
edit permission before exposing fields, even when a cached copy is present.
Temporary refetch failures preserve mounted input; denied access hides it.
History remains available inside the editor, and changed source versions require
an explicit refresh/load-latest decision. The editor takes a due date and,
once a date is set, an optional due time: a date alone makes the task due
that whole day (shown as the date, ahead of timed tasks that day, and in the
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
file through the form below its heading instead. Rows carry their actions in
one group and one order across views: the row's own action first (Edit, or
Download for a file), then a state change (Dismiss for a pending reminder),
then History, then Actions, which opens the move-to-Trash dialog. Viewers see
only History and Download.

Calendar and Reminders mark each row with the same date tile as the Events
collection, the month above the day. Task and reminder statuses read as
labels (To do, In progress, Done, Cancelled; Pending, Triggered, Dismissed),
and the Timeline names each entry's kind the way the other views do (Scheduled
event, Task, Expense, Reminder). Calendar, Expenses, and Reminders rows keep
their date mark, text, and actions on one line and wrap the actions under the
text on narrow screens.

A component's kind decides which records it holds; its view decides how they
are laid out, and the heading carries a View control when a kind offers more
than one. To-dos offers List, the table; By day, which groups tasks under
Overdue, one heading per due date (Today and Tomorrow named, with the weekday),
and No due date, showing each timed task's due time and nothing for a task due
on the date itself; Week, seven columns Monday to Sunday with today marked and
each task in its due day's column; and Month, a six-week grid in which each
day shows up to three tasks (time and name, done ones struck through) and
"+n more", and the selected day's tasks are listed under the grid, today's
until another day is chosen. Calendar offers List; Agenda, the numbered
running order of its items with the same Edit, History, and Actions on each;
and Week and Month, a scheduled item sitting on every day it covers. A page
that carries an Itinerary component (a retired kind) shows the Calendar in
its Agenda view, and choosing another view on it saves it as a Calendar. The
event's own tabs (To-dos, Calendar, and the rest) offer the same View
control; a tab's choice lasts for the session, while a page component's is
saved with the layout. Tasks with no due date and
unscheduled items are listed under the week or the month. On a narrow screen
the week's days stack and a month cell marks a day that holds something with a
dot instead of listing it. Previous, Today, and Next move the period; it opens on today, is not saved, and returns to
today when the view changes. The rows in a column or under the grid are the
list's rows with the same actions, and the open/all/done filter applies to
every view. On a page, the choice of view is part of the layout: it saves at
once for everyone on the Event, shows in layout history, and undo covers it.
Viewers see the saved view without a control.

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
