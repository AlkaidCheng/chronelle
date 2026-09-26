# Web experience

Accounts are email and password. Every account screen is one column: the
LivTales logo, a card with the form, where there is one a line pointing to
the other screen below it, and a footer with the Language and Theme menus,
each a chip naming its choice ("Theme: System") that opens the choices. Sign
in (`/sign-in`) takes the username or the email address of the account and
the password, with Forgot password? beside the Password label and New to
LivTales? Create an account below. Create your LivTales account
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
opens the app; the step comes back until it is completed, and the
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

LivTales opens into an event collection, with space-wide Tasks and People
alongside it. Desktop navigation stays on the left: Search at the top, then a
Collections section (Events, Tasks, People) in the order the account keeps,
then the account block (the account's name with the current space
under it) with a More control beside it. A phone (under 760px) has no rail
and no bottom bar: an app bar fixed at the top of every page holds a menu
control at the left, the current space beside it (its mark and name),
and the account's avatar at the right, with space for the device's safe
area. The menu control opens the sidebar as a drawer from the left edge (the
logo with a close control, Search, and the Collections in the kept order,
the open page current as on the rail) over a scrim; choosing a collection
opens it and closes the drawer, Escape, the scrim, or the close control
closes it, and focus returns to the menu control. There is no other header:
each page starts with its own title. Search in the rail, or in the drawer,
opens the one palette (records, destinations including Trash, and the
current page's actions); the Search page stays reachable from the palette,
and on a phone closing the palette returns focus to the menu control.

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
default place. The phone's drawer has no pencil: a finger held half a
second on a collection enters customize mode in place (the tap that follows
stays on the page), the Collections heading reads "Collections - Done" until
Done is chosen, and Customize sidebar in the account sheet opens the drawer
already customizing.

On a window wide enough for the sidebar, a control beside the logo collapses
it: the sidebar slides off the left edge as the content follows (at once when
motion is reduced), leaves the tab order, and a single control at the
content's top-left brings it back; each hands focus to the other, so the
keyboard keeps its place. Cmd/Ctrl + \ does the same outside text fields and
dialogs, and Settings > Keyboard names it. The choice is
kept on this device under `chronelle.sidebar` (absent while open, `collapsed`
otherwise) and applied before the first paint like the theme, so a reload
never shows the sidebar first; Reset display settings opens it again with the
other display choices. A phone never folds: below the sidebar width the
app bar and its drawer stand in, neither control shows, the shortcut does
nothing, and a choice kept from a wide window waits until the window is wide
again.

More holds what acts on the app rather than on records: Trash, Theme,
Customize sidebar, Keyboard shortcuts, and Help. Theme opens a panel beside
the rail with the mode (System, Light, Dark), the palette, density, and
motion choices, and a reset. Keyboard shortcuts opens Settings at Keyboard
over the page and shows only on a device with a keyboard; Help has no
surface yet and
says so in a passing notice. The
account block at the foot of the rail (the account's avatar and name, the
current space in small text under it, a caret) opens the account menu: the current space as one row (its mark, name, and
role), which opens the space switcher, then Friends, Settings, and Sign out.
The switcher replaces the menu until Escape leads back. Its top row is its
search field, which narrows the list by name or owner, with New space and
Manage space beside it as icons named by their tooltips; under it the
account's own space first, then the others by when they were last opened,
those never opened after them by name. Every row has the same columns: the
mark, the name over when it was last opened, and the account's role there;
the current space carries the rail's active treatment (a soft accent
background, its name in the accent, its mark a solid accent tile). The list
scrolls under the pinned search field, about seven rows at a time, and opens
with the current space in view. A space reads by its name: the account's own
is "Personal" with a home symbol as its mark; a named space shows its name
and its initials; one still called by its owner's name ("Ana's workspace")
reads the owner's name with the owner's initials. The account's own initials
appear on its round avatar alone. The switcher lists memberships alone: a
space reached only through an event shared with the account is absent,
since that event shows in the account's own Events list.

New space opens a dialog over the page: Name (up to 80 characters) and
Members, where the account is listed as its Owner and Add a friend adds a
friend as an Editor, whose role (Owner, Editor, or Viewer) can be changed or
who can be taken off again before Create space. Creating it opens the new
space; a friend who could not be added is counted in a notice and the space
stays. Manage space opens a dialog over the page for the current space: the
space's mark and name above its sections (General, Members, Danger zone),
the chosen one at the right, and closing it returns to the page as it was.
General shows the name, which an Owner of a shared space renames (a Personal
space keeps its name), and the account's role. Members lists the members with
their roles; an Owner changes any member's role (a Personal space has one
Owner), adds a friend with a role, and removes any member but the personal
owner and themselves, while the personal owner's role and the last Owner's
role are fixed. Danger zone offers Leave space, with a confirmation, to any
member but the Owner of a Personal space; the last Owner makes another member
an Owner first. Leaving opens the account's own space.

Cmd/Ctrl+Shift+K opens the switcher from anywhere in the app. Opening
a space notes the moment on the account, so the order follows the person
across devices. Escape or a press elsewhere closes any of these and returns
focus to its control; none navigates or discards the current Event draft. A
space or session change uses the existing session boundary to cancel
pending requests and clear protected state. Space choices come from the
authorized session response; choosing one never grants access by itself.

On a phone these surfaces are sheets that rise from the bottom edge and
never leave the screen, each a modal dialog with a scrim and a handle at
its top (a pull down on the handle, a press on it or on the scrim, or Escape
closes it, and focus returns to the control that opened it). The space
control in the app bar (the current space's mark and name) opens the
switcher's list as a sheet, without the way
back the rail's list has; Cmd/Ctrl+Shift+K opens and closes it too. The
avatar opens the account sheet: the account's name and email, Friends (with
the requests waiting), Settings, Sign out, then More's entries as a second
group of the same menu (Trash, Theme, Customize sidebar, Help, and Keyboard
shortcuts on a keyboard device), so the arrow keys walk the whole list.
Theme opens its own sheet with the same controls as the rail's panel, and
Customize sidebar opens the drawer customizing.

The Events page is one row: the title with the inline name filter beside
it at the left, then, at the right edge, quiet Filter (All, Upcoming &
ongoing, Unscheduled, Past), Sort (Event date, Recently updated, Name A-Z),
and Layout (Grid, List) menus, Refresh, and the single filled New event
control; on a phone the title and the controls share the first row and the
filter takes the whole second. Under the head one row of chips, All, Mine,
Shared with me, Upcoming, and Past, each with its count for the typed name
(the counts come with the list's first page); one chip is pressed at a
time, All meaning no scope and no period, and Clear filters resets the
chips with the name. The count of loaded events is announced to assistive
technology and not shown.

The list holds the events shared with the account beside its own, from
whichever space they live in, so a share needs no space switch to
be found: a card shared with the account is the same card, its third line
carrying the tag "Shared by Mei Lin" and the role held (Viewer when every
grant is narrowed to a view); one of the account's own that others hold
reads "Shared with 2" there; the rest keep the line empty so every card
keeps its height. Opening a shared card opens the event page directly, in
the event's own space, with the access line under the title naming the
sharer; the rail stays on the account's space, and its Tasks and People
collections stay the space's own. A shared card's Share control shows
only when the role allows sharing, and its menu offers Leave this event in
place of Move to Trash: the card goes at once and a notice offers Undo for
a few seconds; the account's grants are dropped once the notice has gone
without it, so an Undo costs nothing and needs no share to be given back.

Each event is one compact card of a fixed height: a date tile (the month
over the day; TBD for an event without a date; muted for a past one), the
name on one line, the dates on a muted line under it ("Date to be decided"
for an undated event), and the third line for sharing. The whole card is
the link; there is no period label and no arrow. The Grid layout is two
columns of cards in a wider column than the lists; the List layout is the
same object as rows in the lists' column, ruled like the other lists. Two
controls surface at a card's right edge on hover or focus (and stay
visible on touch): Share, which opens the sheet that shares the whole
event with friends and members at a role, and the row menu with Edit event
(the event editor as a dialog), History, Share, and Move to Trash. The
menu offers only what the account may do with that event, which it reads
once the card is hovered or focused.

A control's tooltip (the name of an icon control, on hover or focus) is
placed under the control, centred when that fits and pulled inside the
viewport by a small margin when the control sits near an edge; it is fixed
to the viewport, so a strip that clips its overflow never cuts a tip.

## Tasks

Tasks lists every task the user may view in the space: tasks that live on
their own and tasks inside any event, in one place. New task creates a task
that belongs to no event and owns its own permission scope; tasks added inside
an event keep that event's scope and appear here as well. The toolbar filters
by name and carries the three quiet controls every task collection shares:
Sort (Manual, the default, the order tasks are kept in; By due, a date-only
due leading its day and undated tasks last; By name; By updated), Filter
(Open, All, or Done, then any label and any person the space knows, with
Clear filters; the button counts the choices that differ from Open, Any
label, and Anyone), and Layout. The sort, status, label, and assignee are
applied by the server, so a page holds only what matches. Load more tasks
extends the list page by page.

The page offers the same List, By day, By week, Board, and Calendar layouts
as the To-dos component, from the same rows: the completion check, the name and its
details (a button that opens the row in place as the composer), the status,
and the row menu. The week and the calendar ask the server for the tasks
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

Labels are space-wide names a task may carry any number of. The task
editor holds them behind a Labels disclosure: closed, it counts the selection;
open, it lists the space's labels as checkboxes and takes a new label,
which is selected as soon as it exists. Rows show labels as chips under the
title in both views. The Tasks page filters by one label from the toolbar and
opens Manage labels, where labels are renamed, added, or deleted; a deleted
label leaves its tasks. Anyone with access to the space sees label names;
owners and editors change them. The view is a device preference, kept in browser storage like the
event collection's grid or list choice, and applies to the loaded tasks. The
filter, sort, name query, label, and assignee belong to the tab.

## People

People are canonical records of the space: a name, an optional nickname
shown in its place wherever the person is named, contacts (email, phone, or
other, in the order kept), labels from the space's label vocabulary, a
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
Both layouts end with Add a person, a quick add row that takes a name in
place: Enter creates a person with the typed name and keeps the field open
for the next; among namecards a dashed card opens the same row. At a phone width the
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
this space as editor" when they are), an account that is not a friend,
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
space's) has no Shared panel, tab, or Share action. Events lists the
events the person is part
of, each a link with its dates. Tasks lists the tasks assigned to them, open
and done, each a link to where it lives. The editor is one column: the
name with the nickname beside it, then rows in the idiom of the event
editor's schedule rows (the field's symbol, its name while unset, its value
with a clear once set). The Name field is also the account lookup: while it
has focus and the card is unlinked, the accounts the card can be linked to
list under it, the signed-in user's own first (tagged You, offered while no
other card of the space is theirs) and then the friends whose name or
email contains the typed text; arrow keys walk the list, Enter or a click
picks, Escape closes it. A pick links the card, fills the name, and adds
the account's email as a contact unless the contacts already carry it; the
field then shows a mark at its right reading You or Friend whose clear
unlinks and keeps the name (a card linked to another account reads Linked
without a clear). The contact rows each carry their kind's symbol and open
in place as kind + value when pressed; Add contact appends one already
open, and a row left empty when editing ends goes. Labels opens the same
checklist tasks use under its row and reads the chosen names; the
description is a growing field; the custom fields are name/value rows with
a remove, and Add field appends one with its name focused. Editing keeps a
field's original type unless its text changes.
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
namecards, each opening the person's page. Add person offers everyone the space knows who is not yet in
the event, by name, or takes a new person's name and creates them inside the
event. A card's Actions offer Remove from this event, which takes the person out
of the event and leaves them in the space, as well as Move to Trash.

Notes (a gallery card, "Free text kept with the event: plans, addresses,
what to remember.") lists the event's notes as cards: the title, the first
two lines of the text, and "Edited today, 09:12 by Mei", who wrote the
note's current version. Pressing the title opens the note in place, the
whole text with its line breaks and each web address a link that opens in
a new tab; a second press folds it. Last edited first; Sort offers By
title. A card's Actions offer Edit, History, and Move to Trash (a viewer
sees History alone). Add note opens the editor every record has: Title,
Text (a growing field; the editor's help explains that the text is plain,
line breaks kept and links opening when the note is read), Cancel, Save. A
note is an object of
the event like a task: it is versioned (a stale save is a conflict, never
an overwrite), kept as a draft in the tab until saved, listed in History
with the text as the changed field, moved to Trash and recovered from it,
and found by Search by its title only.

The Sharing tab of an event, offered to its owners, is one box headed by
the event's name, with a note that everything on the event (pages, to-dos,
expenses, files) follows a share, and three groups. Friends lists the
account's friends (by their card's name when the space has one), each
with a mark, the role they already hold under the name, and a role beside
it; Others in People lists the space's other people: one with an
account here, one already invited from their card, one with an email and
no account, whose row says an invitation goes out, or one with no email,
whose row says "No email; you send them the link" (a row that waits on an
invitation is dimmed until ticked); By email is one row: the
address, a role, and Add, which grants at once. Tick any number, choose
Viewer or Editor beside each (an editor can change the event but
not delete or share it; owning belongs to the space the event lives in, and a
share made as Owner before keeps its role and reads Owner: sharing with that
person again leaves it as it is, and removing it offers no Undo), and Share with N people applies every row in turn;
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
space is shared by making a friend a member (see Settings).

A share can be narrowed to one view of the event, or to one section of
To-dos or Expenses. Share ends the head row of To-dos, Calendar, Timeline,
Itinerary, Expenses, Reminders, and Notes for whoever may share the event,
after Export (on a phone, its symbol alone like the other head-row
controls). It opens a sheet under the control named "Share To-dos" (or the
view's name): a line saying that everyone here sees that view of the event,
and its sections unless a section is shared on its own; the people who see
it, each with an avatar, a role (Viewer or Editor) that changes in place,
and a remove; Add people, which unfolds the same picker of friends and
people with an account; and Done. Share section in a section's menu opens
the same sheet for that section alone ("Share Venue"), with the line that
everyone here sees this section's records and the rest of the view stays as
shared. Escape or a press outside closes the sheet; on a phone it rises from
the bottom edge. Someone who holds only narrowed shares of an event opens
its page with the shared views alone on the strip (a view holding a shared
section counts), no pages, and no controls that share; the views show the
records the share admits and nothing else, and a section shared on its own
appears with its rows while the view's other rows stay out. Such a share
gives view on the event itself whatever its role: the role applies to the
records. People with access in the Sharing view names what a narrowed share
opens under the person ("Shared: To-dos", "Shared section: Venue"), whole
shares first. The same person may hold several narrowed shares of one event
at different roles; a whole share stands beside them. Deleting a section
ends the shares narrowed to it.

Where access comes from is named on the record when it is not the reader's
own space. Under the heading of an event, a person's page, or a task's
editor, one quiet line reads "Shared with you by Mei as editor" for a grant
on that record, or "Through Kyoto in November, shared by Mei" for a record
that inherits its access from an event's scope. The inherited line opens that
event, at its Sharing view when the role allows sharing; on an event page the
direct line opens the event's own Sharing view for an owner and is plain text
otherwise. A record of the reader's own space shows no line. A record the
reader has no role on is not shown at all: an event's views count such
included records as locked rather than listing them.

A task may be assigned to one person as the one responsible for it. The task
editor holds the choice behind an Assignee disclosure that names the current
assignee (Unassigned when none); open, it lists the space's people with
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
fields; a task's location) stops at its limit: a longer paste is cut to the
limit. The count ("n / limit") shows only once the text is within the last
twenty characters of the limit, and turns red when the limit is reached; a
field far from its limit carries no number. The editors' footers carry no
line under their buttons: neither a note that drafts stay in the tab (the
recovery dialog says so when it matters) nor the submit shortcut's keys
(the button's tooltip and its `aria-keyshortcuts` name them).

## Friends

Friends (`/friends`, from the profile menu, whose entry carries the number
of requests waiting and whose profile block shows a dot then) belong to the
account, not to a space. The page opens with a line on what friends are
for, then three panels with counts: Requests (who wants to connect, their
address and how long ago, their note; Accept, Decline), Friends (name and
address on one line, since when, Remove friend), and Sent (the person of
this space the invitation went from, the address, or "Invitation link";
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
points at the section below, Not on LivTales yet?: a person of the current
space without an account link, or Someone new, an optional email, and
an optional note, then Send by email or Create link. An invitation is a
link: Send by email emails it to the address (an address with an account
gets a request instead and the dialog closes); Create link needs no
address. Either way the dialog then shows the link, its QR code, "One use.
Valid until 2 Oct 2026.", how it was sent ("Sent by email to ..." or "Send
it in WeChat, a message, or any way you like."), Copy link, and Done.

The link opens the claim page (`/invite/<token>`), in the one-column account
frame: who invited you ("Ana invited you to be friends on LivTales" with
the username), the note, and what becomes visible once accepted ("Kyoto in
November as viewer"). Signed out, it offers Sign in and Create an account,
both returning here (a new account completes the Welcome step first, and
the sign-up carries the token as `/sign-up?invitation=...`). Signed in, it
names the account ("You are signed in as Ben", "Not you? Switch account")
and offers Accept or Not now; nothing happens without Accept. Accepting says
"You and Ana are now friends." or "You were already friends.", then what
became shared ("Kyoto in November is shared with you as viewer.") and what
the account already had ("You already had access to ..."), with Open
LivTales; the card the invitation came from is linked, as after an
accepted request. The account's own link says "This is your own invitation
link."; a used one "This invitation was already accepted."; a withdrawn one
"This invitation is no longer open."; an expired one "This invitation
expired on 2 Oct 2026."; an unknown one "No invitation has this link."
In the person editor, the Name field's lookup offers the account's
friends after the account's own entry, so a card of any space can be
the friend; accepting a request that came from a card links the card by
itself. From a
card's Invite a friend, the search starts with the card's name.

Your code, beside Invite a friend, shows the account's QR code and profile
link (`/u/<username>`) with Copy link; anyone who scans or opens it sees,
under the LivTales logo, the name and username with Add friend, or how the
two already stand, after signing in (the page returns there after the
sign-in) and never their own code as anything but their own.

## Commands

Search in the rail opens a focused palette: the field at the top, with the
close control beside it, and the results grouped under it (the current
page's actions, Navigation, Records). Type an action or destination name or
description, use Up/Down to choose a result, and press Enter to open it.
Pointer selection also works. Escape, Close, or a backdrop press dismisses
the palette and restores focus. On a keyboard device a footer names the
keys (Up/Down to choose, Enter to open, Esc to close); the palette carries
no settings. Opening or closing it keeps the current draft; choosing
another destination has the same draft behavior as the navigation rail.

Shortcut symbols follow the keyboard: the Search entry's Cmd/Ctrl + K badge,
the switcher's Cmd/Ctrl + Shift + K, and the palette's footer render only
on a device with a fine pointer that can hover (`(hover: hover) and
(pointer: fine)`); a touch phone shows none, while the shortcuts stay bound
for a phone with a keyboard attached.

Cmd/Ctrl + K opens Search outside text editors and dialogs. It ignores
composition, repeated keydown, consumed events, and extra modifiers.
Settings > Keyboard, offered on keyboard devices only (More's Keyboard
shortcuts item leads there), is one table of the shortcuts: Open Search
(Cmd/Ctrl + K) with its switch, Undo the last edit (Cmd/Ctrl + Z, always on),
Collapse or expand the sidebar (Cmd/Ctrl + \, always on), Add a component
with its key choice, and Submit an editor (Cmd/Ctrl + Enter) with its
switch; Reset keyboard shortcuts at the foot restores the defaults. On a
touch device the Settings list omits the section; its address still opens
it, listed while it is open, and it says it appears on devices with a
keyboard. The Search entry remains available
without the shortcut. The preference is a browser-local
`chronelle.command-shortcut` value: `disabled` opts out; absence or an
unknown value enables the default. Same-origin tabs synchronize it. Blocked
storage allows a current-page choice without guaranteeing persistence.
Display reset does not change shortcut preferences.

Add a component offers `/`, `Cmd/Ctrl + /`, or Off. This action opens the
existing picker only from within an editable event's page area; it does not
insert immediately. Its independent browser-local key,
`chronelle.component-shortcut`, accepts `slash`, `modified-slash`, or `disabled`.
Missing, invalid, or unreadable values default to slash. Changes synchronize
between mounted controls and same-origin tabs; blocked writes retain a
current-page choice. The Submit an editor switch controls Cmd/Ctrl + Enter
using `chronelle.editor-shortcut`: `disabled` opts out, while missing,
unknown, or unreadable values enable it. All three shortcuts share the same
storage and synchronization behavior. Reset keyboard shortcuts restores their
defaults without changing appearance or clearing other browser data. Native
text undo remains available in editors.

Two undo stacks, each named for what it takes back. Content edits of Events and
Tasks (a rename, a due date, a completion, a move in manual order) run as
reversible commands, and the page's More menu on an event or a person offers
Undo edit and Redo edit for the account's stack in this space, or, on an
event or a person shared from another space, for the account's stack
where that record lives, since its edits are kept there: the item
reads the command this browser ran ("Undo: rename Kyoto in November"), and is
disabled with the reason when the head is not reachable (Nothing to undo, or
Changed by someone else since, when another account edited the record). After
a reload the items still work but name nothing. Cmd/Ctrl + Z and Shift +
Cmd/Ctrl + Z run them outside text fields and dialogs, and each item shows its
keys for the platform at its end; while arranging a page,
or inside the Page options dialog, the same keys move the layout stack instead
(Undo layout change, Redo layout change, as the dialog's controls read). The
palette's shortcut list names both, and Cmd/Ctrl + \, which collapses or
expands the desktop sidebar (see the rail above); none of the three has a
setting.

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
characters also search the current space after a 250 ms typing pause;
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
the palette on space or identity changes.

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
the account, space, and palette. It persists across reloads and sign-out,
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

Settings opens from the account menu as a dialog over the page you are on,
and closing it returns you there as you left it: the page stays mounted
underneath, so an event's view, its filters, and anything open on it are
unchanged. At the left, under the title Settings, each section is a row
with its icon (General; under Preferences, Language & time, Appearance, and
on a keyboard device Keyboard; under Space, Members), the current one
marked as the rail marks its current page; at the right, the section's
title with the close control at its edge, then its content, which scrolls
inside the dialog. On a narrow screen (up to 640px) the dialog fills the
screen and the sections become a row that scrolls sideways above the
section, without the title and group captions; a 320px screen never
scrolls sideways. Focus starts on the current section's row and returns,
on closing, to the control that opened Settings (the account block, More,
or the avatar on a phone).

Each section has an address on the page underneath: a `settings` query
parameter (`general`, `language`, `appearance`, `keyboard`, or `members`)
added to the page's own, so `/events/<id>?view=todos&settings=language` is
an event's To-dos with Settings open on Language & time. The entries that
open Settings (Settings in the account menu, Keyboard shortcuts in More,
Members in the space switcher) link to the current page with that
parameter, so a new tab or a copied link opens the same; a plain click
opens Settings in place as a history entry of its own, choosing another
section rewrites that entry, and closing (the close control, Escape, or
Back) steps back to the page. Settings reached by its address (a link, a
reload) closes by taking the parameter out of the address in place. The
address changes through the history API, never a navigation, so nothing
underneath remounts. The old addresses (`/settings`, `/settings/language`,
`/settings/appearance`, `/settings/keyboard`, `/settings/members`) redirect
to Events with that section open. The offline sandbox keeps the same
address in its fragment (`#/events/<id>?view=todos&settings=language`).

General holds
the Name, changed here with Save name, the username as chosen at sign-up,
which cannot be changed, and the email as the account holds it; Who can
find you, with By username always on,
and By name and By email as switches the account turns off to be left out of
Find people by that key (By email is off for an account without one); links
to the password screen; and Sign out everywhere, which ends every session of
the account, this one included, and returns to sign-in. Under Preferences, Language & time holds the language, the time
zone, the time format, and the first day of the week, all kept on the
account and applied at once; Appearance repeats the Theme panel's mode,
palette, density, and motion choices, which stay on the browser, and
carries the Install app control (see Install as an app); Keyboard, on a
keyboard device, holds the shortcut table described under Search. Under
Space, Members lists the current space's members with their roles
(the personal owner first, marked Personal space, and Friend beside a
member who is one); an Owner adds a friend as Viewer or Editor from the
friends list (adding a member again changes their role) and removes any
member but the personal owner and themselves. A member sees the space
in the space switcher and reaches everything in it by role.

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
the browser before the app renders, an account without a language
learns the choice this browser already made (a language picked on the sign-in
screen follows the person from then on), sign-up sends the browser's choice,
and a session found through the cookie reconciles the two the same way.

Traditional Chinese is written, not converted from Simplified; Files, Trash,
and sign in each carry their own Traditional wording. Dates, times, durations, money, and name
sorting follow the active language through `Intl`, so Chinese names sort by
pinyin under Simplified and by stroke under Traditional as ICU defines. Under
Traditional Chinese the display and body stacks prefer the TC faces; Chinese
body text takes a taller line and uppercase labels drop their Latin tracking.
Both Chinese variants name access as a permission, the words the Mini Program
uses: 所有者/擁有者 for Owner, 可编辑/可編輯 for Editor, and 仅查看/僅查看 for
Viewer; a space is 空间/空間.
Notices word the API's known error codes (version conflict, unavailable
space, network failure, wrong credentials, unverified email, ended
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
account menu over Tasks, changes the language and back, chooses a 24-hour
clock, the UTC zone, and a Monday week, closes to a timed task already
following them and a week strip starting Monday, reads every choice back
after a reload through the old Language & time address, and signs out
everywhere. A second journey (desktop and mobile Chromium and WebKit) opens
Settings over an event's filtered To-dos, changes section in place, and
returns to the same view with the close control, Escape, and Back (Forward
opens it again), checking that the page underneath was not remounted, that
focus returns to the account block, and that an address-opened Settings
closes without a history entry; it also follows an old address and checks
a 320px screen for sideways scrolling. The offline sandbox runs the same
opening, switching, closing, and Back through its fragment. Unit tests hold
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
  storage. Reload, sign-out, identity replacement, and space changes reset
  them. These temporary preferences are not saved views or shared bookmarks.
- Choose grid or list layout. Only this preference is saved in local browser
  storage; no object data, search text, or permissions are persisted there.
  Storage restrictions do not prevent using either layout.
- Event views have bookmarkable URLs, such as `/events/OBJECT_ID?view=calendar`.
  Reload and browser Back/Forward preserve the selected view. A phone keeps
  the strip, folded past its width into the chip, with no separate view
  select. A view reached by its address shows even while hidden from or
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
  shows no date line; Set dates opens the editor on the schedule. On a phone
  the head is compact: the Events link and the actions share the first row,
  the title sits under them, and a share reads as a tag beside the date
  ("Shared by Chen Li" and the role) in place of the access line; the Events
  page's chips sit closer above the cards.
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
  options (the dialog's help says so; the list itself carries no notes).
  New page opens the Add page dialog; Add view opens the gallery.
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

Every editor is a centred dialog. Its header ends in its controls: any the
dialog adds (History), a quiet question mark, then the close. The question
mark is the one place for exposition ("About this editor", or "About this
dialog" for Add a page and Manage tabs): it opens a popover under the header's
right edge of short titled entries about that dialog (what linking a person
to an account does, what fields are for, how drafts behave, that a reminder
sends no notification, what a page preset adds, how tabs reorder and which
cannot be removed), none of them needed to use the dialog. Escape and a press
outside close it, Escape returning focus to the control; the dialog stays
open either way. The pages and panels that are always in view carry no help
control, so the default screen shows none.

The Event and schedule item editors carry
their schedule as three rows, each with its symbol: the dates (a calendar),
the times (a clock) and the place (a pin). A row reads what is set (Dates:
Jul 3, 2030 to Jul 12, 2030; Times: 9:30 AM to 6:00 PM; the place as typed)
with a clear at its end, or, while unset, what it is for (Set dates; Set
times with "All day" under it; Add a place). The dates and times rows open
the date panel beside the row, on that part; the place row
edits its text in place (up to 240 characters, trimmed on save, Enter or
Escape returning to the row).

The date panel is the one control every date field opens, under its row on
wide screens and as a sheet from the bottom of the screen under 600px. At the
top a typed field takes a date in the shapes the panel reads (an ISO date,
today, tomorrow, next week, Sep 21 or 21 Sep with an optional year, 9/21) or a
span as "Sep 21 to Sep 23", with a note for text it cannot read or an end
before its start; Enter applies and closes. Under it, four shortcuts always
listed with the day they mean (Today, Tomorrow, Next week as the coming
Monday, Next weekend as the coming Saturday, which a span takes through
Sunday), the one matching the choice pressed. Then the months as one
continuous list: one six-week month at a time, Sunday-first headings, today
outlined, past days and weekends muted, the chosen days marked and a span
tinted, extending as it is scrolled, with the month heading's Previous,
Today and Next and its month and year chooser (a typed field such as October
2027, 2027-10 or 10/2027 above a month grid and a year grid, the list behind
following each choice until Done, Enter, Escape or a click outside closes it).
For a single date a day press sets it and closes the panel; for a span the
first press starts it and the second ends it, and pressing on a day and
dragging across others chooses the days between (mouse or pen; touch scrolls
the list). Arrow keys move by day or week; Home/End move to the week's edges;
Page Up/Down moves one month, or one year with Shift, clamping to the last
day of the target month; Enter or Space chooses. One day in the list
participates in Tab order, and moving through the list never changes the
selection or submits the editor. At the foot, Time (Times for a span)
unfolds the time fields in place once a day is set, a single Time for a
moment or Start and End for a span, with Remove time folding them back and
clearing the times; the times row opens the panel with them unfolded. Escape,
or a press outside, closes the panel, and a keyboard close returns focus to
the row.

An end time on one day keeps that day as the span's end; a multi-day timed
plan requires an end time, refused with a note on save until both are given.
Pending saves disable the entire schedule. Existing date ordering, local-time
validation, optimistic concurrency and authorization remain unchanged.

Selected grid cells expose the actual date range, not a tentative hover preview.
Weekday headers have full accessible names, and a polite status reports the
displayed month/year. Keyboard focus moves with the rendered calendar rather
than waiting for a later animation frame. The form body scrolls independently;
programmatic date scrolling cannot move or clip the dialog header and actions.

New event focuses its opener before showing the native dialog, including on
browsers that do not focus buttons on pointer clicks. Closing a session-bound
dialog returns focus to its opener; if it cannot receive focus, the page
content is the fallback. Session changes still close dialogs.

The production browser gate includes desktop and mobile WebKit checks for Event
date formatting, schedule editing, keyboard selection, and creation-dialog focus.
These are engine tests, not verification on physical Apple devices or with a
screen reader. Manual Safari/VoiceOver and other assistive-technology review
remain necessary. The offline sandbox gate continues to use Chromium: WebKit's
emulated offline mode fails to load local files before the application runs.

## Editor feedback and refresh

Edit event opens a right-side modal inspector on wide screens and a full-width
editor on narrow screens. Under the name, Description takes plain text of up
to 2,000 characters, line breaks kept; it shows under the event's date line
and at the top of the Overview, and an emptied field clears it. The same
field sits under the name in the schedule item and task editors. The
underlying page stays in place but is inert.
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
list. Its dates, times and place rows start unset, with no invented date or
time. The place row takes where the item happens as one line of up to 240
characters ("Where it happens, as you would tell someone. The itinerary shows
it beside the time."); it is optional, trimmed on save, and the same row
opens in Edit. A Calendar row with a place shows it after the
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
error visible. A save refused because the record is no longer within reach
(its share was withdrawn, or it went to Trash) closes the editor and says so
in a notice: "Your changes were not saved: this item is no longer available
to you."

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
names who loses what, Remove member the space, Remove friend that shares
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
plus where the check sits and the words where a name sits. Choosing it opens
the composer in its place, empty, with the name focused. Enter creates the
task with what the composer holds and keeps it open and empty for the next
one, "Added." read to assistive technology; Escape or Cancel closes it. In
the by-day view each day group has its own row, and a task added there
starts with that day on its Due chip (the No due date group adds one
without a date; Overdue has none). The Tasks page has the same row, and a
task added there stands on its own. A refused save keeps the composer under
the usual error notice. An empty collection shows the row under its empty
state, so the first item is added the same way. Reminders end with an Add
reminder row that opens the reminder's composer the same way: a reminder
added under a day starts due at 9:00 that day, one added to the list at
the next 9:00, the moment on its Remind at chip. Calendar and Expenses
rows end on Add schedule item and Add expense, which open their kinds'
composers (below). Viewers see no such rows.

A task row is a button: its name and meta line, named "Edit <name>", open
the row in place as the composer, prefilled with the task, on the To-dos
list, its day groups, and the Tasks collection (the week and month grids
keep the dialog through the row menu). The check, the assignee and labels
at the row's end, and the row menu keep their own actions, and the menu's
Edit opens the composer too. The composer is a card in the list: the name
(bold, one line), the description under a dashed rule, then one chip per
field, and a foot with More, the keys hint "Enter saves, Esc cancels",
Cancel, and Save (Add task on the add row). A chip is the field's control,
the one the dialog uses, opened under the chip when pressed: Due opens the
date panel with Time and Repeat at its foot; Assignee lists the space's
people with Unassigned, a new person, and Assign to me; Labels is the
checklist with a field for a new label; Location is a text field, Enter
closing it. A set chip reads its value ("Due: Nov 3, 2030 (tomorrow)",
"Labels: Travel, Venue") with a clear at its end, and a due today reads in
the accent; an unset chip reads the field's name, muted, so every field is
in view without a dialog. Escape closes an open chip's control first, and
the composer next, handing focus back to the chip or the row. Under 600px
the chips wrap and a chip's control opens as a sheet from the bottom of
the screen.

Enter or Save writes one update carrying the row's version, "Saved." read
to assistive technology; a stale save (the task saved elsewhere while the
row was open) shows the comparison above the chips with Keep mine, Merge
fields, and Take theirs, as the dialog does. Esc or Cancel closes the row
unchanged. One row is open at a time: pressing another closes the first,
and when the first holds unsaved changes it asks "This row has unsaved
changes. Discard them?" with Discard (the other opens) and Keep editing.
An open composer's fields are a draft in the tab of its own: leaving the
view and coming back finds the row open with the text, and the same for
an add row left with text. The dialog keeps its drafts as before, apart
from the composer's: a dialog left with text, a save still in flight, or a
save whose answer was lost is offered as Resume / Discard when More
reaches the dialog again, so the retry keeps the same command.

More at the composer's foot opens the task dialog with the composer's
fields, for what the composer does not carry: the duration, a subtask, the
full history. The dialog keeps the underlying list in place and confirms
dirty dismissal; Create task and Save task commit explicitly, and when it
closes focus returns to the row it came from, or to the add row.

Schedule items, reminders, and expenses open in place the same way. A
Calendar row (in the list, agenda, and by-day layouts; the week and month
cells open the dialog), a Reminders row, an Expenses row (inside its
section too), and a Timeline entry are buttons named "Edit <name>" that
swap the row for the kind's composer, and their row menus keep Edit with
History and Move to Trash (a reminder's menu keeps Dismiss, Snooze, and
its moves). A schedule item's composer carries the name and description
with two chips: Dates opens the date panel as a span, its times at the
foot ("Dates: Nov 3, 2026, 8:00 AM to 9:00 AM"), and Place is a text
field. A reminder's carries the name and Remind at, the date panel with
the time unfolded. An expense's carries the name, Amount, whose panel
holds the amount and its three-letter currency ("Amount: JPY 48,000"),
and Paid on, the date panel with the time; an expense with no amount is
refused before any request, the Amount panel opening on the notice. A
Timeline entry reads its record before the composer takes the entry's
place. Each kind's More opens its dialog (Add schedule item or Edit
schedule item, Add reminder or Edit reminder, Add expense or Edit
expense) with the composer's fields. Each composer keeps its drafts apart
from its dialog's, as the task's does: an add row's composer left with
text is found open again, and a draft left in the dialog (or a save on
its way there) is the dialog's, offered as Resume your draft when More
reaches it again. The rows read as the To-dos rows do: the name over one
meta line with its symbols (the dates and the place; the moment; the day
paid, the amount at the row's end).
Completion and reopening remain direct row actions through the check, a
filled circle whose tick previews faintly on hover. The inspector checks
fresh canonical Task data and its own edit permission before exposing
fields, even when a cached copy is present. Temporary refetch failures
preserve mounted input; denied access hides it. History remains available
inside the editor, and changed source versions require an explicit
refresh/load-latest decision. The editor's Due row reads the
choice as the exact date (Sep 21, 2026, with "(today)" or "(tomorrow)" as a
hint, the time when one is set, and the rule: "Sep 19, 2026, every week until
Oct 31, 2026") with a clear at its end, or Set due date with "A day, a time,
and a rule" while unset, and opens the date panel with Time and Repeat at its
foot. Time unfolds a single time field; Repeat unfolds a select (Does not
repeat, Every day, Every weekday, Every week, Every 2 weeks, Every month,
Every year) that waits for a date, and a rule reveals an Until field that
takes a typed date, optional, refused with a note when it comes before the
due, and dropped when the due moves past it. Duration is its own field under
the row (No duration, 15 min to 8 h), waiting for a time and cleared with it.
Clearing the due clears its time and rule. A date alone makes the task due that
whole day (shown as the date, ahead of timed tasks that day, and in the
Timeline as a dated entry); a date with a time makes it due at that local
instant. Name-only edits preserve the exact stored due instant, and
unavailable local times are rejected. Task drafts survive client-side navigation within the authenticated
tab: a row's composer opens again with its text, and the dialog (opened
from the header's New task, or through a composer's More) offers Resume /
Discard before exposing retained values. Creation drafts belong to their parent Event; edits follow the
canonical Task across contexts. Resume checks fresh parent access for creation and the Task's
own access for editing. Layout or projection access denial clears parent-scoped
drafts without changing independently authorized canonical Task drafts.

An unchanged Task creation retry retains its command across navigation and
recovery. Pending saves cannot be resumed or discarded until they settle;
completion clears the draft without navigating. Check the current Task before
retrying an uncertain edit. Discard, eviction, reload, sign-out and space
changes clear retained fields and retry identity. This is session-local recovery,
not durable offline storage.

Cmd/Ctrl + Enter submits the focused native field in these editors, including
the New event dialog. The save button names the binding in its tooltip and
exposes it to assistive technology. The shortcut requests a normal form submission through
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
storage. Reload, sign-out and space changes clear them. Calendar navigation
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
keeps one, and its Layout, Sort, Filter, and Export controls as quiet words
at the right, each with its symbol; on a phone (under 600px) the symbols
show alone, a touch larger, and the words stay as the buttons' names. A
component that lists records (To-dos, Timeline, Itinerary,
Expenses, Reminders, Files, Notes, and the Calendar in its list and by-day
layouts) keeps to one 800px column, heading and rows alike, so a name and
what sits at the row's end stay close; the week and month grids and the
namecards take the page, as do the Events, Tasks, and People collections'
lists and their search rows. Nothing sits under the heading, and no Add button sits beside it: a
collection adds through the row at its end. To-dos' row opens the
composer, whose chips carry the task's fields and whose More opens the full
editor with them; Calendar, Reminders, and Expenses end on the same kind of
row (Add schedule item, Add reminder, Add expense) opening their kinds'
composers, and People on a quiet row (Add person) that opens the person
editor. Every component's states use the same pieces: one
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
Overview counts private related items. Calendar, Expenses, and Reminders
rows carry their actions in one row menu, in one order across views: Edit
first, then History, then Move to Trash, which opens the record's Actions
dialog. Viewers see only History.

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
does nothing; a six-dot grip in the gutter at the row's left edge, shown on
hover and focus (and always on touch), lifts the row at once. The lifted row
leaves the list as a card of its own line, with a shadow and a slight tilt,
that follows the pointer; a gap of its height marks where it will land and
the other rows make room, so nothing overlaps. The gap follows the pointer's
height alone: the nearest row, before or after its middle, or an empty group
under the pointer, so dragging along the grips' column or past the list's
edge still moves it. Letting go fills the gap. Dropping between two rows
takes the midpoint of their positions, so only the moved record is written,
as one versioned update the history and undo cover. In the by-day view a
drop under another day's rows moves the due (or the reminder's time) to that
day, keeping the time of day; a drop under No due date clears the due;
Overdue takes only its own rows back. The grip is a button (Reorder, then the
name): its arrow keys move the gap a place, Enter or Space drops the row
there, and Escape puts it back; Move up and Move down in the menu do the
same one step at a time, announcing the new position, and a status line
reads out every move, due change, and copied link. Under another sort on the
Tasks page rows do not drag and the steps are not offered.

### Sections

An Event's To-dos (in the list layout) and Expenses (list and by day) can be
split into sections. The rows outside any section come first, without a
heading; then each section: its name in bold with its description muted
under it, a faint figure at the right (the open count of a To-dos section,
the total by currency of an Expenses section), a quiet menu on hover or
focus with Edit section, Move up, Move down, and Delete section, the
section's rows, and the section's own add row, so a task or an expense added
there lands in that section (the add row reads "Add a task to {section}",
and an expense's editor opens with the section chosen). Add section is a
thin accent line with a pill, shown on hover and focus after the loose rows
and after each section; it opens an editor in place with a name field, a
description field, Save and Cancel: Enter saves, Escape cancels, and an
empty name cannot save. Edit section opens the same editor prefilled in the
head's place. Delete section removes the heading and leaves its records in
the list, loose; the status line says so.

Sections belong to one view of one Event, so the Tasks page and the other
views ignore them, and a record carries at most one, offered as a Section
choice in the task and expense editors (No section, or one of the view's).
Dragging a row's grip moves it within its section, into another, or to the
end of an empty one, in one write that carries the task's rank and section
(an expense keeps its order by date, so only its section changes); dragging
a section's grip moves the section among the sections, and the grip's arrow
keys do the same. A section is not versioned and not in Trash: restoring an
older revision of a task leaves it where it is, and a deleted section is
gone.

Calendar, Reminders, and Expenses rows read as the To-dos rows do: the
name over one meta line with a symbol for the dates or the moment and one
for the place, the amount at an expense row's end, a reminder's status as
a label (Pending, Triggered, Dismissed), and the row menu on hover. Task
statuses read as labels too (To do, In progress, Done, Cancelled), and the
Timeline names each entry's kind the way the other views do (Scheduled
event, Task, Expense, Reminder); a Timeline entry's history is in its row
menu, shown on hover or focus, and the entry opens in place as its
record's composer.

A component's kind decides which records it holds; its layout decides how
they are laid out, and the heading carries one Layout control, an icon with
the current layout's name, that opens the templates a kind offers when it
offers more than one. To-dos offers List, the table; By day, which groups
tasks under Overdue, one heading per due date (Today and Tomorrow named, with
the weekday), and No due date, showing each timed task's due time and nothing
for a task due on the date itself; By week, seven columns Monday to Sunday
with today's head in the accent and each task a bordered card in its due
day's column (the check at the left, the title beside it on two lines at
most, the due time or a label under it; cards 6px apart with no rule between
them, the row menu at the card's top right and the grip at its left edge on
hover or focus, the title keeping the menu's gutter free so nothing moves
when they appear), each column at least 180px wide so the grid takes the
page's full measure and scrolls sideways below seven such columns, a card
dragged to another column taking that day as its due date, the menu's Edit
opening the full editor, and each day ending in an Add task row that shows
on hover and presets the day; Board, one column per day that holds a task,
in date order and scrolling sideways (260px columns; a phone shows one and a
half), with two fixed columns first: Overdue, the open tasks whose day has
passed, oldest first, with Reschedule at its head moving them all to today
(one write per task, said once as "Moved n tasks to today."), and Today,
which stays even when empty so its add row has a home; the days between are
absent, so a month of tasks reads in one sweep; the columns hold the week's
cards, an overdue task sitting in Overdue alone, a card dragged to another
column taking that day, each column ending in an Add task row that presets
its day, and tasks with no due date closing the board as a last column; and
Calendar, the month's weeks as a grid of day
cells with the weekday names and day numbers at the right, today a filled
circle, the days of other months muted and the first of a month named, and
the grid ending with the week that holds the month's last day. Each calendar
cell holds its tasks as compact rows (a dot, the name clipped, the time at
the right, done ones struck through), three of them and then "+n more",
which opens the rest in place. Calendar offers List; Agenda, the numbered
running order of its items with the same Edit, History, and Actions on each;
and By week, Board, and Calendar, a scheduled item sitting on every day it
covers, the week's columns holding the same cards as To-dos (the time or the
place under the name).
Expenses and Reminders offer List, By day, By week, Board, and Calendar as
well: a transaction sits on the day it happened and a reminder on the day it
is due; an expense day heading carries the day's totals by currency, and a
calendar cell shows each amount or time with the name (a dismissed or
triggered reminder struck through). The Board of Reminders has an Overdue
column too (a pending or triggered reminder whose day has passed), with
Reschedule moving them to today; the Calendar's and the Expenses' boards
start at the earliest day with content, Today among their columns. The
Itinerary offers Day and All days (below).
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

### Export

Export ends the head row of To-dos, Calendar, Timeline, Itinerary, Expenses,
Reminders, and Notes, a quiet word with the download mark beside Sort, Filter,
and Layout, for editors and viewers alike. It opens two plain items. Export
as PDF prints the view as it is shown, through the browser's print dialog
(which offers Save as PDF): the page holds the event's name and dates, the
view's title and count, a line naming the sort and filter where the view
has them ("Sort: By due. Show: Open, Venue."), and the rows, black on white,
each row kept whole across pages; the sidebar, the tabs, the other
components on the page, the controls, the add rows, and the row menus are
left off. Export data (CSV) saves the same rows as a comma-separated file
named "Event - View - date" (a character a file system refuses becomes a
space), opening with a byte-order mark so a spreadsheet reads it as UTF-8,
its column headings in the shown language, dates as YYYY-MM-DD and times on
the 24-hour clock in the shown time zone. What is exported is what is shown:
the To-dos file follows Sort and Filter, and names the assignee and the
labels; the Calendar, Expenses, and Reminders files hold the list, by-day, or
the shown week or month (with the undated rows the grid lists apart); the
Itinerary file holds the shown day, or every day in All days, each day in
the order its page reads (the items running over the day, the timed rows
with their start and end, the tasks due, then the items without a time);
the Timeline file holds each record's kind, name, and moment; the Notes file
holds each note's title, whole text, last edit, and editor. A description on
a task or a schedule item is a column once the record carries one.

## Recorded reminders

Add reminder opens the reminder's composer in the list; More on it opens
the focused dialog with a name and required Reminder time. Record reminder and Save reminder submit explicitly.
No notification is sent; the dialog's help states this limitation.
Edit loads the canonical Reminder and its current access, not an editable
copy of a projection row. Name-only edits preserve the original precise
instant, and metadata edits do not reset status. The existing Dismiss
action remains available for pending reminders.

Reminder drafts share the same tab-local recovery, parent creation keys,
canonical edit keys, original versions and unchanged-retry identity as other
planning editors. They do not survive reload or sign-out. Temporary access
failures retain approved drafts; definitive denial clears them. Confirmed saves
settle independently of slow projection refreshes.

## Expense amounts

Add expense opens the expense's composer in the list; More on it opens
the focused dialog. Edit in the dialog
reads the canonical Expense and its own current access before showing
fields. Record expense and Save expense are explicit actions. Pending
saves disable fields and dismissal, failed saves preserve input,
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

## Brand

Users see the product as LivTales. The logo is the LivTales lockup: the
Foam Crest mark, an open book whose right page rises into a sail, beside
the two-tone word (Liv and Tales). `components/brand-logo.tsx` draws it as
inline SVG from `brand/logo/header-logo-light.svg`, 26 px tall in the
sidebar, the phone drawer, and above the heading of the not-found and error
pages, and 40 px on the account screens and the code page. It is always a
link (to Events, or to Sign in on the account screens), named "LivTales" by
the image. The logo takes its colours from the chosen palette and
appearance through the `--brand-*` tokens in `app/tokens.css`: the sail
bands and the left page are three strengths of the accent mixed toward the
canvas, Liv takes the lighter band's colour, and Tales the ink. In Light the
lower band is the strongest; in Dark the upper band is the brightest. So
the logo is terracotta on Ink & Paper, green on Celadon, and blue on Modern
Neutral. The favicon, app icons, link preview, and Mini Program art keep the
fixed brand colours. With forced colours the whole logo takes the link
colour, as the one-colour logo does. The tab title is "LivTales".

The browser tab shows `app/icon.svg`, the flat mark on a blue tile, with
`app/favicon.ico` (16, 32 and 48 px) for browsers without SVG icons. A
shared link previews as the site (site name and title LivTales, the
description) with `app/opengraph-image.jpg`, the lockup on a night sky at
1200 × 630, and its description from `app/opengraph-image.alt.txt`. The
image's absolute URL uses the origin the page was requested at: the first
`X-Forwarded-Host` (else `Host`), over https when `X-Forwarded-Proto`
names it.

Every brand file the app serves is a copy of a source in `brand/`: the
SVGs byte for byte, the rasters rendered by `pnpm brand:export --web`.
Change the source and export again rather than editing a copy;
`test/brand-assets.test.ts` fails when an SVG copy or the logo drifts from
its source, and checks the rasters' sizes and opacity. The export records
in `app/brand-rasters.json` the SHA-256 of each raster, of the sources it
was drawn from, and of the export script, and the test fails when any of
them has changed since. The
[brand guide](../brand/README.md) says which file serves which use and
lists the clear space, minimum sizes, and colours.

## Install as an app

The app installs from its own control rather than from the browser's
timing. Where the browser can install web apps (Chrome and its relatives
on Android and the desktop), More offers Install app as soon as the
browser has made its prompt available, and Settings > Appearance carries
the same control; choosing it raises the browser's prompt, and once
accepted the control goes. Safari on iPhone and iPad never prompts, so
there the control opens the two steps instead, in a dialog titled Install
LivTales: Share in Safari's toolbar, then Add to Home Screen. Other
browsers install from their own menu, which the Settings row says.
Installed, the app opens from the home screen as its own window
(standalone display on both platforms); the account, the data, and
everything else are unchanged.

The manifest (`id`, `scope`, and `start_url` at the root, standalone
display, the name and short name LivTales, the icons) and the app icon
provide the presentation metadata. The app icon is the LivTales tile, the
mark in white and aqua on a night sky. The "any" icons are one rounded
tile with transparent corners: `public/icons/pwa-icon.svg` at any size, and
`icon-192.png` and `icon-512.png` drawn from it. A maskable
`icon-maskable-512.png` keeps the mark inside the central safe circle, and
`app/apple-icon.png` at 180 is opaque and full-bleed, which iOS rounds. The
SVG copies `brand/icon/pwa-icon.svg` and the PNGs come from
`pnpm brand:export --web`, as the Brand section says. This release does
not promise offline support. Private API responses are not cached and no
service worker is registered.

See [Deployment](deployment.md) for the production-build workflow and public
launch requirements.
