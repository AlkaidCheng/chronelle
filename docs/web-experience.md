# Web experience

Accounts are email and password. Every account screen is one column: the
brand, a card with the form, where there is one a line pointing to the
other screen below it, and a footer with the Language and Theme menus, each
a chip naming its choice ("Theme: System") that opens the choices. Sign
in (`/sign-in`) takes the username or the email address of the account and
the password, with Forgot password? beside the Password label and New to
Chronelle? Create an account below. Create your Chronelle account
(`/sign-up`) asks for the email, a password of at least ten characters, and
a username (3 to 30 letters, digits, hyphens or underscores, starting with a
letter; unique without regard to case), which is the handle friends find
the account by and cannot be changed later; the line under the field says
whether what it holds is available, not available, or not a valid
username, and every hint on these screens is a rule in a full sentence.
Create account moves to `/verify-email`, which names the address in its
sentence and takes the six-digit code sent to it (Send a new code issues
another; a sign-in attempt on an unverified address also sends one and
lands on the same screen; the screen opened by hand asks for the address
too). The first sign-in of a new account then opens Welcome (`/welcome`),
once: the account's `@username` and email at the top, then the Name
(required), the Language (Browser default, or one of the languages), the
Time zone and the Clock (the device's until changed), and Continue, which
opens the workspace; the step comes back until it is completed, and the
account is named as its username until then. An account created any other
way (the development sign-in today; other sign-in methods later) brings its
name, gets a username from it, numbered when that is taken, and has no
Welcome step. Reset your password (`/reset-password`) takes the email
address, then the code sent to it and a new password; the reset signs every
other session of the account out. Each screen redirects to the collection
once a session exists, and Sign out ends the session on the server as well
as in the tab. The development sign-in (name and email, no password) lives
at `/sign-in/development` and
exists only where the web server is started with
`WEB_DEVELOPMENT_SIGN_IN=true`.

Chronelle opens into an event collection, with workspace-wide Tasks and People
alongside it. Desktop navigation stays on the left: Search at the top, then a
Collections section (Events, Tasks, People) in the order the account keeps,
then the profile block with a More control beside it. Mobile navigation
remains at the bottom with space for the device's safe area, in the same
order, and the More and account controls sit in a slim bar at the top. There
is no other header: each page starts with its own title. Search in the rail
opens the one palette (records, destinations including Trash, and the current
page's actions); the Search page stays reachable from the palette.

The Collections section is the person's to arrange: a pencil beside the
heading (shown on hover or focus), or More then Customize sidebar, opens
customize mode, where each row gains a grip and an eye. Dragging a row with
a mouse, dragging its grip with a finger (the row lifts and follows the
finger; lifting the finger drops it where it rests, Escape or a cancelled
touch puts it back; the grip alone refuses the browser's touch gestures, so
the rest of the rail still scrolls), or the up and down arrow keys on the
grip, reorders the collections; the eye hides a collection from the rail or
shows it again (a hidden collection stays dimmed in customize mode, and
still shows while it is the open page). Each change is kept on the account
at once, so the order and the hidden set follow the person across devices,
and Done ends customize mode. A collection that ships later appends in its
default place. The bottom bar on a phone lists the collections in the kept
order and offers no arranging; More does not offer it there.

More holds what acts on the app rather than on records: Trash, Theme,
Customize sidebar, Keyboard shortcuts, and Help. Theme opens a panel beside
the rail with the mode (System, Light, Dark), the palette, density, and
motion choices, and a reset. Keyboard shortcuts opens the command palette at
its Keyboard shortcuts section, expanded with its first choice focused, so
the shortcut settings and their reset are reached without typing; Help has
no surface yet and says so in a passing notice. The
profile block at the foot of the rail opens the account menu: the account,
the workspaces the person can open (the current one checked), Settings, and
Sign out. Escape or a press elsewhere closes any of these and returns focus to
its control; none navigates or discards the current Event draft. A
workspace or session change uses the existing session boundary to cancel
pending requests and clear protected state. Workspace choices come from the
authorized session response; choosing one never grants access by itself.

The Events page is one row: the title, an inline name filter, then quiet
Filter (All, Upcoming & ongoing, Unscheduled, Past), Sort (Event date, Recently
updated, Name A-Z), and Layout (Grid, List) menus, Refresh, and the single
filled New event control. The count of loaded events is announced to assistive
technology and not shown.

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

People are canonical records of the workspace: a name, an optional nickname
shown in its place wherever the person is named, contacts (email, phone, or
other, in the order kept), labels from the workspace's label vocabulary, a
description, an optional link to a member's account, and custom fields for
anything else worth keeping (a birthday, a dietary note). The People page in
the rail is a collection like Tasks: one heading row with an inline name
search (asked of the server after a typing pause), Filter (Account: everyone,
friends, invited, those with an account, those without; then any label),
Sort (by name, the
default, or by the latest change), Layout (List or Namecards, a device
preference kept in browser storage), Refresh, and the filled plus for New
person, which opens the person editor. The list shows one row per person:
initials (the first character of a name written in Han, kana, or Hangul), the
nickname over the full name (or the name alone) as the link to the person's
page, the contacts (an email as a mail link, a phone as a call link), the
labels, a badge for the account behind the person ("This is me" for the
signed-in account's own, "Friend" for a friend's, "Has an account" for
another account here, "Invited" while a request or invitation sent from the
card waits), and the row menu (Edit, History, Move to Trash). Namecards show the same people as cards with the contacts under
their icons, the description, and the badge and labels at the foot; the menu
shows on hover or focus. A press on a row or card opens the person's page.
Both layouts end with Add a person, a quick add row like the task lists':
Enter creates a person with the typed name and keeps the field open for the
next; among namecards a dashed card opens the same row. At a phone width the
rows keep the avatar, the names, and the menu.

A person's page (People, then a row or card) shows the nickname as its title
with the full name, the badge, and the labels under it; Edit (the person
editor), Share with them (for anyone but the user's own card), History, and
More (Copy link, Move to Trash); then four tabs: Overview, Shared, Events,
Tasks. Overview is two columns. Details is a key-value list of what the
person has (Nickname, each contact by kind, the custom fields, Labels) and
nothing for what they lack, or one line, No details yet; Description appears
only when there is one. Connection names the account behind the card: a
friend ("Linked to your friend Mei Lin", friends since when, and "Member of
this workspace as editor" when they are), an account that is not a friend,
a request sent from the card ("Request sent to ben@example.test", with
Withdraw), an invitation sent from the card ("Invitation sent to
ben@example.test" or "Invitation link created 18 Sep 2026", "One use. Valid
until 2 Oct 2026.", with Copy link, Send by email when the card has an
address, New link, and Withdraw), or "Not linked to an account" with Link
to a friend and Invite a friend; Unlink person sits there for a linked
card. Shared, under
Connection, lists what is shared each way with the person, newest first:
one line per record with its mark (event, task, expense, reminder, file,
person), its name (a link when the record has a page), the role, and who
shared it ("you shared", "Mei shared", or "queued" for a share that waits
on the person's invitation). The panel shows the newest five with a count
and "All 8 in Shared", which opens the Shared tab, where the same rows run
in full; "Nothing shared yet" stands in for an empty list. The person here
is the account the card is linked to, or the one account that any of the
card's email contacts reaches and that lets itself be found by email (a
card whose contacts reach two accounts, or only accounts that hide from
email, reaches none), so a share made from an event's Sharing tab, and one
the person made to this account, both appear. A card reached through a share (another
workspace's) has no Shared panel, tab, or Share action. Events lists the
events the person is part
of, each a link with its dates. Tasks lists the tasks assigned to them, open
and done, each a link to where it lives. The editor takes the name, nickname,
This is me (offered when the person is unlinked or already this user's; one
person per account), the contacts as kind/value rows with Add contact and
Remove, Labels (the same picker tasks use, with a field to add one), the
description, and the custom fields as name/value rows with Add field and
Remove. Editing keeps a field's original type unless its text changes.
Assignee chips, the assignee and share pickers, and the event People
component all name a person by their nickname when one exists. Search and
Trash filter by People, and Trash restores them.

Share with Mei (the share mark in the page's actions) shares one of the
account's events with the person without leaving their page: a dialog with
a search for the event (asked of the server after a typing pause, newest
change first), the matches as a list to pick one from with its dates, a
role (Viewer or Editor), and Share. A friend, a linked card, or a card one
of whose email contacts is a friend's is granted at once ("Kyoto in
November shared as viewer"); a card with an email contact and no account
is invited at its first email and the share waits ("Kyoto in November
queued; access follows when they join"), as from the event's Sharing tab;
a card with neither is queued behind an invitation link the sharer hands
on ("Kyoto in November queued; waiting on the link", with Copy link). The
outcome stays in the dialog so another event can follow; Done closes it,
and the Shared panel already lists the new row.

An event page can carry a People component (also an event view and an
overview card) that shows the people the event involves as the same
namecards, each opening the person's page. Add person offers everyone the workspace knows who is not yet in
the event, by name, or takes a new person's name and creates them inside the
event. A card's Actions offer Remove from this event, which takes the person out
of the event and leaves them in the workspace, as well as Move to Trash.

Notes (a gallery card, "Free text kept with the event: plans, addresses,
what to remember.") lists the event's notes as cards: the title, the first
two lines of the text, and "Edited today, 09:12 by Mei", who wrote the
note's current version. Pressing the title opens the note in place, the
whole text with its line breaks and each web address a link that opens in
a new tab; a second press folds it. Last edited first; Sort offers By
title. A card's Actions offer Edit, History, and Move to Trash (a viewer
sees History alone). Add note opens the editor every record has: Title,
Text (a growing field with the hint "Plain text. Line breaks are kept and
links open when the note is read."), Cancel, Save. A note is an object of
the event like a task: it is versioned (a stale save is a conflict, never
an overwrite), kept as a draft in the tab until saved, listed in History
with the text as the changed field, moved to Trash and recovered from it,
and found by Search by its title only.

The Sharing tab of an event, offered to its owners, is one box headed by
the event's name, with a note that everything on the event (pages, to-dos,
expenses, files) follows a share, and three groups. Friends lists the
account's friends (by their card's name when the workspace has one), each
with a mark, the role they already hold under the name, and a role beside
it; Others in People lists the workspace's other people: one with an
account here, one already invited from their card, one with an email and
no account, whose row says an invitation goes out, or one with no email,
whose row says "No email; you send them the link" (a row that waits on an
invitation is dimmed until ticked); By email is one row: the
address, a role, and Add, which grants at once. Tick any number, choose
Viewer, Editor, or Owner beside each (an editor can change the event but
not delete or share it), and Share with N people applies every row in turn;
Copy link beside it copies the event's address. A friend or
an account is granted at once ("Shared as Viewer"), a person with an email
contact is invited at the first one and the share waits ("Invitation sent;
access follows when they join"), a person without one gets an invitation
link the sharer passes on ("Waiting on the link", with Copy link), an
invited person's share waits on the invitation already sent ("Waiting for
them to join"), and a refusal stays beside the name with the row ticked for
another try. A waiting share is granted the moment the request or the link
is accepted and lapses when it is declined or withdrawn. The People
component offers owners Share with everyone here, the same control with the
event's own people ticked. People with access lists the accounts that hold a
grant, each with what the grant gives under the name ("Also this event's
pages, to-dos, expenses, files, and earlier versions"), and the shares still
waiting ("Access follows when they join"), each with Remove. A whole
workspace is shared by making a friend a member (see Settings).

Where access comes from is named on the record when it is not the reader's
own workspace. Under the heading of an event, a person's page, or a task's
editor, one quiet line reads "Shared with you by Mei as editor" for a grant
on that record, or "Through Kyoto in November, shared by Mei" for a record
that inherits its access from an event's scope. The inherited line opens that
event, at its Sharing view when the role allows sharing; on an event page the
direct line opens the event's own Sharing view for an owner and is plain text
otherwise. A record of the reader's own workspace shows no line. A record the
reader has no role on is not shown at all: an event's views count such
included records as locked rather than listing them.

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

## Friends

Friends (`/friends`, from the profile menu, whose entry carries the number
of requests waiting and whose profile block shows a dot then) belong to the
account, not to a workspace. The page opens with a line on what friends are
for, then three panels with counts: Requests (who wants to connect, their
address and how long ago, their note; Accept, Decline), Friends (name and
address on one line, since when, Remove friend), and Sent (the person of
this workspace the invitation went from, the address, or "Invitation link";
a line Request, Email, or Link with how long ago or "One use. Valid until 2
Oct 2026."; a badge, Sent how long ago for a request or No account yet for
an invitation; Copy link for an invitation, Resend for a request or an
emailed invitation or New link for a link, Withdraw). Invite a friend opens a dialog with two
ways in. Find people, at the top, searches the accounts as each lets itself
be found: a name (two characters or more, contained, case-insensitively), an
@username (starting so), or an exact email; the searcher is never in the
results. Each result shows the name and username with one action: Add friend
sends the ordinary request (with the note below when there is one, and from
a card, linking the card when they accept), or the state that already holds
(Friends, Request sent, Wants to connect). Nothing matching says so and
points at the section below, Not on Chronelle yet?: a person of the current
workspace without an account link, or Someone new, an optional email, and
an optional note, then Send by email or Create link. An invitation is a
link: Send by email emails it to the address (an address with an account
gets a request instead and the dialog closes); Create link needs no
address. Either way the dialog then shows the link, its QR code, "One use.
Valid until 2 Oct 2026.", how it was sent ("Sent by email to ..." or "Send
it in WeChat, a message, or any way you like."), Copy link, and Done.

The link opens the claim page (`/invite/<token>`), in the one-column account
frame: who invited you ("Ana invited you to be friends on Chronelle" with
the username), the note, and what becomes visible once accepted ("Kyoto in
November as viewer"). Signed out, it offers Sign in and Create an account,
both returning here (a new account completes the Welcome step first, and
the sign-up carries the token as `/sign-up?invitation=...`). Signed in, it
names the account ("You are signed in as Ben", "Not you? Switch account")
and offers Accept or Not now; nothing happens without Accept. Accepting says
"You and Ana are now friends." or "You were already friends.", then what
became shared ("Kyoto in November is shared with you as viewer.") and what
the account already had ("You already had access to ..."), with Open
Chronelle; the card the invitation came from is linked, as after an
accepted request. The account's own link says "This is your own invitation
link."; a used one "This invitation was already accepted."; a withdrawn one
"This invitation is no longer open."; an expired one "This invitation
expired on 2 Oct 2026."; an unknown one "No invitation has this link."
In the person editor, Link to a friend offers the account's
friends beside This is me, so a card of any workspace can be the friend;
accepting a request that came from a card links the card by itself. From a
card's Invite a friend, the search starts with the card's name.

Your code, beside Invite a friend, shows the account's QR code and profile
link (`/u/<username>`) with Copy link; anyone who scans or opens it sees the
name and username with Add friend, or how the two already stand, after
signing in (the page returns there after the sign-in) and never their own
code as anything but their own.

## Workspace commands

## Workspace commands

Search in the rail opens a focused palette. Type an action or destination
name or description, use Up/Down to choose a result, and press Enter to open
it. Pointer selection also works. Escape, Close, or a backdrop press dismisses
the palette and restores focus. Opening or closing it keeps the current draft;
choosing another destination has the same draft behavior as the navigation rail.

Cmd/Ctrl + K opens Search outside text editors and dialogs. It ignores
composition, repeated keydown, consumed events, and extra modifiers. Keyboard
shortcuts inside the palette explains the controls and lets users disable this
binding. The Search entry remains available. The preference is a
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

Two undo stacks, each named for what it takes back. Content edits of Events and
Tasks (a rename, a due date, a completion, a move in manual order) run as
reversible commands, and the page's More menu on an event or a person offers
Undo edit and Redo edit for the account's stack in this workspace: the item
reads the command this browser ran ("Undo: rename Kyoto in November"), and is
disabled with the reason when the head is not reachable (Nothing to undo, or
Changed by someone else since, when another account edited the record). After
a reload the items still work but name nothing. Cmd/Ctrl + Z and Shift +
Cmd/Ctrl + Z run them outside text fields and dialogs, and each item shows its
keys for the platform at its end; while arranging a page,
or inside the Page options dialog, the same keys move the layout stack instead
(Undo layout change, Redo layout change, as the dialog's controls read). The
palette's shortcut list names both.

The rail and palette share one catalog of Events, Search, and Trash routes.
On an event, a separate Event actions group offers Edit event, Share event,
Event history, Add page, Add component, and Arrange components when their controls are
available. Viewers receive only Event history. An open event editor does not
offer Edit event again. Add page needs edit access and no pending layout save;
Add component and Arrange components also need the Pages view. Insertion also requires room within layout limits;
Arrange components requires an existing page. Add component names its
selected page. These actions open existing controls; they do not save, insert,
share, or restore data immediately.

The palette closes before focusing and activating the original control;
Arrange components runs from the page menu and lands focus on Done arranging. Editors
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
The mode control offers System, Light, and Dark. It is available on sign-in
and in the rail's Theme panel on desktop and mobile.
Native radio controls support Tab and arrow-key navigation. System follows
operating-system changes; Light and Dark override them without reloading the
page or resetting a draft.

Appearance is a device-local, same-origin browser preference, independent of
the account, workspace, and palette. It persists across reloads and sign-out,
and synchronizes across tabs. System removes the saved override. Invalid or
unreadable storage falls back to System; failed writes leave the current page
usable but cannot guarantee persistence. Sandbox file storage depends on the
browser and file location.

The Theme panel previews Ink & Paper, Celadon, and Modern Neutral in the
current light/dark mode; outside a session the account screens' footer
offers the mode alone. Choosing a palette does not change that mode. Comfortable/Compact
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

## Settings

Settings (`/settings`, from the profile menu) lists its sections at the left
and opens one at the right; each section has its own address. Account holds
the Name, changed here with Save name, the username as chosen at sign-up,
which cannot be changed, and the email as the account holds it; Who can
find you, with By username always on,
and By name and By email as switches the account turns off to be left out of
Find people by that key (By email is off for an account without one); links
to the password screen; and Sign out everywhere, which ends every session of
the account, this one included, and returns to sign-in. Under Preferences, Language & time holds the language, the time
zone, the time format, and the first day of the week, all kept on the
account and applied at once; Appearance repeats the Theme panel's mode,
palette, density, and motion choices, which stay on the browser. Under
Workspace, Members lists the current workspace's members with their roles
(the personal owner first, marked Personal workspace, and Friend beside a
member who is one); an Owner adds a friend as Viewer or Editor from the
friends list (adding a member again changes their role) and removes any
member but the personal owner and themselves. A member sees the workspace
under Workspaces in the profile menu and reaches everything in it by role.

The time zone is Device (named, with its offset) or any zone the browser
knows, grouped by region with its current offset; a search field narrows the
list by name or offset. Times are formatted in that zone and days are placed
in it: a task due at an instant, a timed Event's span, an expense, a
reminder, and today all fall on the zone's calendar day, and the date-time
fields of the editors read and write on the zone's wall clock. The time
format is From language (the language's convention: 12-hour for English and
Traditional Chinese, 24-hour for Simplified Chinese), 12-hour, or 24-hour.
Week starts on is From language (Sunday for English and Traditional Chinese,
Monday for Simplified Chinese), Monday, or Sunday; the week strip, the month
grid, the date pickers, and the period labels start on that day. An Event's
own time zone field is unchanged; a new Event or schedule item takes the
account's zone as its default.

## Language

The web app speaks English, Simplified Chinese, and Traditional Chinese. The
Language group under Settings, Preferences, Language & time offers System,
English, and the two Chinese variants, each named in its own language; the
sign-in, sign-up, verification, and reset screens carry a compact language
menu at the bottom of the form column. System follows the browser's
languages: `zh-TW`, `zh-HK`, `zh-MO`, and any `zh-Hant` tag read as
Traditional, other Chinese tags as Simplified, English tags as English, and
anything else as English. Choosing a language re-renders the page in place,
sets the document's `lang`, and keeps the URL; the locale is a preference,
never a path segment.

The choice lives in the `chronelle.locale` cookie, which the server reads to
render the first paint and the `lang` attribute in the right language, with a
localStorage mirror for the same browser. System clears both. Signed in, the
choice is also kept on the account: sign-in puts the account's language on
the browser before the workspace renders, an account without a language
learns the choice this browser already made (a language picked on the sign-in
screen follows the person from then on), sign-up sends the browser's choice,
and a session found through the cookie reconciles the two the same way.

Traditional Chinese is written, not converted from Simplified; Files, Trash,
and sign in each carry their own Traditional wording. Dates, times, durations, money, and name
sorting follow the active language through `Intl`, so Chinese names sort by
pinyin under Simplified and by stroke under Traditional as ICU defines. Under
Traditional Chinese the display and body stacks prefer the TC faces; Chinese
body text takes a taller line and uppercase labels drop their Latin tracking.
Notices word the API's known error codes (version conflict, unavailable
workspace, network failure, wrong credentials, unverified email, ended
session) in the active language and show the API's English message only for
codes without a translation.

Every screen of the web app reads in the chosen language: the shell and
rail, the command palette and its shortcut settings, the Events page, the
event page with its strip, Overview, pages, and layout controls, every panel
(To-dos, Calendar, Timeline, Itinerary, Expenses, Reminders, Files, People,
Notes, Sharing, Removed links), the Tasks and People collections, the person page, the event,
schedule item, task, expense, reminder, and person editors with the Due and
date-range pickers, the month list, the period navigation, the label and
assignee pickers, the page and component dialogs, layout and draft recovery,
History, Trash and the deletion dialog, Search, the Friends page and the
invitation dialog, Settings with Members, the sign-in screens, the not-found
and error pages, notices, and the validation messages the editors raise. The
Due field's typed date understands the active language as well as English:
its words for today, tomorrow, and next week, its month names, and a Chinese
"9月21日" with an optional year. The offline sandbox carries all three
catalogs and renders in the language chosen in Settings. Verification emails
and friend invitations are localized. English by design: the product name,
key names in shortcut choices (`/`, `Cmd/Ctrl + /`), the sample names in the
development sign-in form, the offline sandbox's own banner, and the component
picker's English search terms, which sit beside each component's localized
name so either finds it.

Browser checks switch the language from Settings on desktop and mobile
Chromium and WebKit, verify `lang`, the rail, the Events heading, the event
strip, and a date range in both Chinese variants, open a new task's Due
control and type "tomorrow" in Simplified Chinese, reach Trash, Search, the
event's History, and the command palette in it, add a person to an event's
People view and open the person editor, open the Share view and read its
groups, return to System, and render
the sign-in screen from a `zh-TW` browser, choosing English from its compact
menu. An account journey (Chromium and WebKit desktop) creates an account
with a username, reads the code from the journeys' mailbox file, completes
Welcome with a name and a 24-hour clock, finds both in Settings, and signs
in again by username. A Settings journey (Chromium and WebKit desktop) opens Settings from the
profile menu, changes the language and back, chooses a 24-hour clock, the UTC
zone, and a Monday week, sees a timed task and the week strip follow, reads
every choice back after a reload, and signs out everywhere. Unit tests hold
every catalog to the English key set and parameter names. A native reader has
not yet reviewed the two Chinese catalogs; wording may change.

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
  selector lists the views on the strip (and the one shown, if it is off the
  strip). A view reached by its address shows even while hidden from or
  removed off the strip. Close the Event inspector before using background
  page navigation.
- Named pages use the independent `page` query parameter. Selecting a view
  preserves the selected page; reload and browser Back/Forward restore it.
  A missing page shows an explanation and the first available page. This is
  navigation state, not an Event or layout mutation, and conveys no access.
- The event strip holds the pages first, a plus to add one (the Add page
  dialog), a bar, then the views the account keeps on the event, and a plus
  that opens the gallery. The strip never wraps: the tabs that do not fit
  fold, from the end, into one chip ("+N more") that lists them; the current
  tab never folds. The page heading retains its full name, and the quiet
  Events link above the title returns to the collection. An undated event
  shows no date line; Set dates opens the editor on the schedule.
- The gallery (Add a view, or Add view in Manage tabs) shows every
  specialized view as a card with a mark, a name and one line: To-dos,
  Calendar, Timeline, Itinerary, Expenses, Reminders, Files, People, Notes,
  and Sharing for an account that may share. A card is a switch: pressing it puts the view on
  the strip, at the end, or takes it off the event again; the dialog stays
  open. To-dos and Sharing are always on. Taking a view off changes no
  records; it comes back with everything in it.
- Manage tabs (the event's More menu; on a touch screen, a tab or the fold
  chip held for half a second, a lift before that being the tap and a move
  the scroll) lists the pages and the views in two lists, each capped in
  height and scrolling. A row drags to reorder, or its
  grip moves it with the arrow keys; the eye hides a tab but keeps it listed;
  the cross takes a view off the event. Overview, To-dos, Sharing and Removed
  links can be hidden but not removed; pages are removed through their own
  options. New page opens the Add page dialog; Add view opens the gallery.
  Page order is the event's layout, shared by everyone with access and undone
  like any layout change; the views' order and the hidden and removed sets
  are the account's own, kept per event with the account preferences and
  applied on every device. A hidden view is still reached from the Overview
  rows and from its address.
- The Overview lists what the event holds as rows (Open to-dos, Scheduled
  items, Expenses, Reminders, Files, People), each with its count and a way
  into that view, then Next up as one row; there is no introduction above
  them. Overview counts and Next up use the authorized Event detail response.
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
movement controls and instructions appear only in Arrange components mode. Viewers see
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
The append is one versioned layout mutation, recoverable through Page options
in the active page's menu.
Preview and cancellation perform no writes. Save failures preserve the name
and preset; after a conflict, close and reopen to review the latest layout.

Arrange components, in the event's More menu and in the active page's menu,
reveals page ordering, component move buttons, cross-page moves, and drag
handles, including dropping a component on another page in the strip; from the
More menu it also brings the Pages view forward. Done arranging, in the page heading,
hides these tools without saving again and returns focus to the page menu;
each move saves immediately through the existing versioned layout API. Page
options (Layout history for viewers) stays in the same menu for removal,
undo/redo, and saved layout history. Add page, Add component, and insertion
shortcuts work in either mode. An event with no pages offers Add a page; a
page with no components offers Add component; neither explains itself.

The component catalog names its destination page and shows the seven kinds
as the gallery's cards (a mark, the name, one line), narrowed by a search
over name, description, or ordinary terms such as checklist, costs, and
documents. Slash prefixes and full-width Latin characters are accepted.
Pressing a card adds that component to the page and closes the dialog;
Enter in the search adds the first card shown, and Arrow Down from the
search focuses it. An empty result shows no cards and offers Clear search.
Composition-confirming Enter does not insert a component.

A card says "On this page" or "On another page" when the page or another
page already holds that kind; adding another view is allowed and does not
copy canonical records. Successful insertion names the component and
destination. Closing the dialog restores focus; losing Edit access discards
the open catalog. A pending save locks the cards and dismissal. A conflict
keeps the dialog open with the captured source version; close and reopen to
retry against the latest layout.

The mode is local to the open event and session. It survives page selection,
but resets on leaving the Pages view, reload, event/session changes, and loss
of edit access. Toggling keeps mounted components and unsaved form values.
The palette offers the same Arrange components / Done arranging action, withheld
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
that completed, such as a link recovered or a version restored; warning (an
exclamation mark) for a stale write compared with the newest version or a
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
Each history row names its kind, Edited (content) for a saved edit, when it was
saved ("Today, 09:12", "Yesterday, 18:40", then "Sep 12, 21:05", with the year
only when it differs) and by whom, and previews its change: up to three changed
fields as "Due date: Oct 3, 2030 to Oct 4, 2030", the earlier value struck
through, the values in the display language and zone (people and labels by
name, a status by its label), then how many more fields changed; the Created
row lists the content the record started with. The list carries the summary,
so no row asks the server before Compare. Layout history rows in Page options read Arranged (layout) and
say what moved: "Moved Calendar above To-dos", "Added page Packing", "Removed
component Map".

Calendar Edit opens the same inspector for the selected schedule item, including
Calendar components on Event pages. The item is a canonical Event; its current
data and edit permission are checked separately from the parent. Cached access
is not sufficient to open it. Its name and schedule share one draft across
contexts, and saving refreshes the Calendar and Timeline projections.
Temporary item-read failures hide the editor until an explicit retry; the kept
draft can then be resumed.

Add schedule item opens a focused creation dialog without moving the Calendar
list. Dates start enabled with no selected date or invented time; they can be
turned off. Under Set dates, Place takes where the item happens as one line
of up to 240 characters ("Where it happens, as you would tell someone. The
itinerary shows it beside the time."); it is optional, trimmed on save, and
the same field opens in Edit. A Calendar row with a place shows it after the
schedule, with a pin, on its list rows. Cancel and Escape confirm dismissal of changed fields. Keep editing
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

Event, schedule-item, task, expense, reminder, and person forms keep their
draft after a failed save. Submit again explicitly to retry; Refresh latest
only fetches data and does not save changes. A failed refresh leaves the save
error visible.

## A stale write, compared

A save refused because the record changed since the draft was opened reads
the newest version at once, and a newer version arriving while a draft is
open is shown the same way: a comparison at the top of the form's fields
headed Saved elsewhere while you edited, with the author of the newest
version and how long ago it was saved ("Mei, 4 minutes ago. Your draft is
kept until you choose."). Its table lists only the fields that differ, one
column for the draft and one for the newest version, named by the editor's
own labels (a task's labels and assignee by name, an event's schedule mode in
words); a field only the draft changed is marked kept, and one only the
newest version changed reads unchanged on the draft's side. Three ways out:
Keep mine saves the draft over the newest version as a new version, so
History keeps theirs; Take theirs loads the newest version and drops the
draft; Merge fields turns the table into a choice per field, where a field
only one side changed is kept from that side, a field both sides changed
starts on theirs, and Save merged version saves the result as one version. A
newer version is never announced alone.

## Removing things

One vocabulary names every removal by what reverses it. Move to Trash (a
record; an Owner restores it from Trash), Remove from this event (a context
link; recovered from Removed links), Unlink person, Remove share, Remove
member, Remove friend, Withdraw invitation, and Remove label are reversed by
doing the opposite. Delete appears nowhere. A one-line question stands in for
a confirmation dialog, and only where other people lose access (Remove share
names who loses what, Remove member the workspace, Remove friend that shares
stay) or Trash is involved (Move to Trash offers Trash as the way back);
removing a context link, a field, a contact, or a queued share asks nothing.
The record's Actions dialog is the two verbs with a one-line note each.

The outcome is a short notice at the foot of the page, posted only once the
API has answered, in the past tense (Moved to Trash, Removed from this event,
Share removed, Member removed, Friend removed, Invitation withdrawn), with
Undo where the API can reverse it: a record back from Trash, a link recovered,
a share given again. It leaves after a while or on its close control. A
refused action keeps its row and explains under it; no notice is posted.

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

## The Itinerary

The Itinerary answers "what does Tuesday look like": one day at a time,
the running order with start and end, where each item happens, and the
free time between items. Its card reads "One day at a time: the running
order with times, places and the gaps between." Under the heading ("Day 2
of 5") sit the Layout control with Day and All days, and Copy day; then the
day line: Previous day, the day name ("Tue, Nov 3"), Next day, and Today
(enabled when today is one of the itinerary's days). The days it turns are
the event's own dates and every day a schedule item falls on; it opens on
today when that is one of them, else on the first.

The sheet lists, in order: date-only items that span several days or are
all-day as pills at the top; the timed items as rows with the start over
the end in a tabular time column, the name, the place with a pin on the
meta line, and the duration at the right ("2 h", "30 min"), the item
happening now carrying the accent bar at the left; free time of fifteen
minutes or more between two rows as one faint italic line ("30 min free",
"2 h free"; shorter gaps are not shown); Due today, the tasks whose due
falls on the day as check rows with the assignee and "2 of 3 subtasks done"
or "due 18:00", ticking completing the task as in To-dos; Not yet timed,
the date-only items on that one day with a dash for a time; and Add
schedule item, the Calendar's dialog. A day with nothing on it says
"Nothing scheduled this day."

All days stacks every day's sheet under a sticky day line, for reading the
whole trip. Copy day puts the shown day on the clipboard as plain text (the
day name, the all-day items, then one line per row as
`09:30-11:30  Fushimi Inari, the lower loop - Fushimi Inari Taisha, main gate`,
and the untimed items with a dash) and says "Day copied."; a browser without
a clipboard says nothing. On a phone the time column narrows, the duration
folds under the times, and a horizontal swipe across the sheet turns a day.
Reminders are not on the sheet; they have their own view.

## Component views

The seven Event components share one frame. In a tab view it has no box of
its own (the tabs frame it); on an event page it keeps its card. Each opens
on one head line: its title in body type, a faint count where the component
keeps one, and its Layout, Sort, and Filter controls as quiet words at the
right. A component that lists records (To-dos, Timeline, Itinerary,
Expenses, Reminders, Files, Notes, and the Calendar in its list and by-day
layouts) keeps to one 800px column, heading and rows alike, so a name and
what sits at the row's end stay close; the week and month grids and the
namecards take the page, as do the Events, Tasks, and People collections'
lists and their search rows. Nothing sits under the heading, and no Add button sits beside it: a
collection adds through the row at its end. To-dos and Reminders have a
quick add row that takes a name in place, and while it is open a pencil
beside the field (Add task with details, Add reminder with details) opens
the full editor with what was typed and the row's day; Calendar, Expenses
and People end on a quiet row (Add schedule item, Add expense, Add person)
that opens their editor. Every component's states use the same pieces: one
loading line, one empty state that is its title alone for a viewer and the
add row alone for an editor, and one error notice with a retry (or, for a
failed upload or download, Dismiss).

A task row is its check, its name, and one meta line under the name: the
due date or time with a calendar mark (in the danger tone when overdue, the
accent when today), how many subtasks are done, how it repeats, In progress
or Cancelled when that is its state, its location, the parent it is part of,
and, outside the event, the event it belongs to as a link; the assignee and
the labels sit faint at the row's right, and the row menu appears on hover.
There are no column headers and no status chip: an empty circle is to do, a
filled one is done, and a done row is struck through. Attachments outside the
viewer's permission scope are counted in a Private attachments note, as the
Overview counts private related items. Calendar and Expenses rows carry their
actions in one group and one order across views: the row's own action first
(Edit), then History, then Actions, which opens the record's Actions dialog.
Viewers see only History.

Files is its rows: the file's name, its size and the day it was added, a
Download icon, and a row menu (Actions for the file's name) with Download,
History, and, for members who can edit, Move to Trash, which opens the
Actions dialog with Remove from this event beside it. The heading's Attached to menu chooses
whose files are shown (the event, or one of its tasks or expenses). The row at
the end, Attach a file, opens the file picker; a chosen file is sent at once,
the row reads Uploading with the file's name until the upload settles, and a
refused file leaves a notice with the limit (25 MB) and the checks a file
goes through (filename, type, size, and checksum). Viewers get the rows and
Download only.

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
History, and Move to Trash, which opens the Actions dialog. Arrow keys move
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
event, Task, Expense, Reminder); a Timeline entry's history is in its row
menu, shown on hover or focus. Calendar, Expenses, and Reminders rows keep
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
reminder struck through). The Itinerary offers Day and All days (below).
The event's own tabs (To-dos, Calendar,
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
