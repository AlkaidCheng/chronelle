# Event-planning API

Most `/api` routes accept and return JSON; document transfers carry file bytes.
Protected routes require a bearer token issued by a sign-in. Send
`x-workspace-id` when operating outside the identity's personal workspace.
A route that names an object in its `id` parameter acts in that object's
workspace when the caller may enter it (a member, or an account holding an
active grant there), whatever the header says: an Event shared from another
workspace opens, with every route under it, from the caller's own session.
An object out of reach, or an identifier that is not an object's, leaves
the request where the header put it. The content command routes follow an
object the same way: `POST /api/commands` the object its first edit names,
and the stack read and its undo and redo the object named by an `objectId`
query parameter, so an edit of a shared Event or Task is saved, and undone,
where it lives.

Protected database reads evaluate permissions and assemble data in the same
snapshot. A read in progress may finish with the earlier authorized version
after a concurrent revocation, but cannot combine that access with later private
content. Subsequent reads use current policy; separate requests are not a shared
snapshot. Mutation/version preconditions remain unchanged.
See [Consistent reads](permissions.md#consistent-reads).

## Sessions

A sign-in (`POST /api/auth/development/sign-in` while development
authentication is enabled) records a session and returns
`{ accessToken, tokenType: "Bearer", expiresAt, user, workspace }`. The
token is random and opaque; the server keeps only its digest, so the
session outlives an API restart and is valid until `expiresAt` or until it
is revoked. `GET /api/auth/session` returns the principal, user, workspace,
and the workspaces the user may enter. The user carries the preferences kept
on the account, each null until chosen: `locale`, a BCP 47 language tag
(`en`, `zh-Hans`, `zh-Hant`); `timeZone`, an IANA zone name the runtime
knows (`Asia/Shanghai`, `UTC`); `hourCycle`, `h12` or `h23`; and
`weekStart`, `1` for Monday or `7` for Sunday; `rail`, how the rail
lists the workspace collections, an object with an optional `order` (collection
keys first to last) and an optional `hidden` (keys left out), `{}` until
arranged; and `eventTabs`, how each event's tab strip lists its pages and
views for this account, an object keyed by event id whose values carry an
optional `order` (view keys first to last), an optional `hidden` (view keys
and page ids kept off the strip), and an optional `removed` (view keys taken
off the event until added again), `{}` until arranged; and
`workspaceRecency`, when the account last opened each workspace, an object
keyed by workspace id whose value is an ISO 8601 instant as the client
wrote it, `{}` until a workspace is switched to, which orders the
workspace switcher on every device. `PATCH /api/auth/me` takes any subset
of the seven: a key that is present replaces the stored value, null clears
it (the rail returns to `{}`), an absent key keeps it, and an empty object
changes nothing; `eventTabs` merges one event at a time, an object
replacing that event's tabs and null dropping them while events not named
keep theirs; `workspaceRecency` merges one workspace at a time the same
way, an instant replacing when it was last opened and null dropping it,
and the 50 most recent instants are kept. The response is the user as the
next session read shows it; 400 `invalid_request` for a value of the wrong
shape (a tag that is not a language tag, a zone that is not an IANA name or
that the runtime does not know, a clock other than `h12` or `h23`, a week
start other than 1 or 7, a rail whose lists are not arrays of up to 50
collection keys of 1 to 40 characters, event tabs keyed by something other
than an event id or whose lists are not arrays of up to 40 keys of 1 to 40
characters, tabs for more than 200 events, or a workspace recency keyed by
something other than a workspace id or whose value is not an instant with
its zone). A collection or view key the web app does not know is kept as
given and ignored on read. Both backends write through one merging
function, `chronelle_user_preferences_update` (migrations 0049, 0053, and
0064).

With `ENABLE_WECHAT_AUTH=true`, `POST /api/auth/wechat` accepts
`{ accessToken, deviceId? }`. The API verifies the end-user token with
CloudBase, requires an allowed WeChat provider, consumes the proof once, and
returns the same sign-in response. An unknown, expired, invalid, replayed, or
unlinked identity returns 401 `unauthenticated`; provider failure returns 503
`identity_provider_unavailable`. The route allows ten attempts per minute per
source address. `POST /api/auth/wechat/link` accepts the same body, requires a
live LivTales bearer session, and links that verified provider identity to the
current canonical user. It returns `{ linked: true }`, permits five attempts per
minute per user, and rejects a provider already attached to either side without
revealing the conflicting account. Migration 0071 is required for both routes.

The user also carries `username`, `findByName`, and `findByEmail` (true
until switched off): the handle every account has, 3 to 30 letters, digits,
hyphens or underscores starting with a letter and unique without regard to
case, and who may find the account (by username always). Password sign-up
chooses the username (`POST /api/auth/sign-up` takes `username`; 409
`username_taken` when another account holds it in any case, 400 for the
wrong shape); an account created by any other sign-in gets one from its
display name (its letters and digits, lowercased, hyphens between, `user`
when the name gives nothing), numbered from 2 when taken.
`GET /api/auth/username-available?username=` answers `{ available }`
without a session, false as well for the wrong shape, capped per address
like a search. The username is not changed afterwards.

The user also carries `onboardedAt`: null while the Welcome step is due,
which a password account has ahead of it after its email is confirmed (it
is created named as its username); an account from any other sign-in, and
every account that existed before the step, counts as completed.
`PATCH /api/account` takes any subset of `{ displayName, findByName,
findByEmail, onboarded }` (`displayName` 1 to 120 characters, trimmed;
`onboarded` only `true`, which sets `onboardedAt` once and leaves an
earlier moment alone) and refuses a `username` key (400
`invalid_request`); a key present replaces the stored value, and the
response is the user. Both backends write through
`chronelle_identity_sign_in` and `chronelle_account_update` (migrations
0055 and 0056), and every insert into `users` gets a username from the
name when it brings none.

`GET /api/users/search?q=` finds people for the signed-in account:
`@name` matches usernames that start so; an exact address matches the one
account with that email that allows it; any other text (two characters or
more) matches, among accounts that allow it, names that contain it or come
close to it, and usernames that start so. Names and the text are folded
first (accents dropped, lowercased, one space between words; `pg_trgm` and
`unaccent`), a near miss is a trigram similarity of 0.45 or more (a typo in
a full name clears it, a shared word does not) and is tried from four
characters, and trigram indexes on the folded name and the username serve
the candidates. The answer is `{ items }` of at most ten `{ id,
displayName, username, relation }`, ranked: the exact username, a username
prefix, a name whose word starts with the text, a name that contains it,
then by similarity, then by name; the searcher is left out. `relation` is
`none`, `friend`, `requested` (a request the caller sent waits), or
`incoming` (a request to the caller waits). More than sixty searches in a
minute by one account answer 429 `search_limit`.
`GET /api/users/:username` answers the same summary for one account by
username (case-insensitively), 404 `user_unavailable` when none has it. Both
backends read through `chronelle_users_search`, `chronelle_user_lookup`,
and `chronelle_username_available`.

`DELETE /api/auth/session` revokes the presented token and
`DELETE /api/auth/sessions` revokes every session of the user, this one
included; both return `{ revoked }` with the number of live sessions that
ended and record `session.revoked` in the user's personal workspace. A
revoked or expired token is rejected with 401 `unauthenticated` from the
next request on.

Through the web origin the same routes drive the browser session: the `/api`
proxy sets the httpOnly `chronelle_session` cookie from a successful sign-in,
verification, or reset response, presents the cookie to the API as the bearer
credential when a request carries no `Authorization` header, and clears it on
either sign-out route whatever the API answers, together with a readable
`chronelle_session_present` marker that carries no secret. The sign-in body
is forwarded unchanged; the browser client does not keep the token.

### Email and password accounts

`POST /api/auth/sign-up` with `{ email, password, username, displayName?, locale?, invitationToken? }`
(password 10 to 256 characters; `displayName` optional, the account being
named as its username until the Welcome step gives the name; `locale` the
language of the sign-up screen, kept on the account; `invitationToken` the
token of the invitation link the sign-up was opened from, see Friends)
records an unverified account and emails
a six-digit code in the account's language (English when none); the response
is 202 `{ accepted: true }`, or 409 `email_taken`. The friend invitations
addressed to the email become requests on the new account, except the one
whose token was sent: that link stays open for the claim page, where the
new account accepts it explicitly.
`POST /api/auth/verify-email` with `{ email, code }` verifies the address
and signs the account in with the sign-in response above; a wrong, expired,
or exhausted code (five wrong guesses) is 400 `verification_invalid`, and
`POST /api/auth/verify-email/resend` with `{ email }` issues a fresh code
(202 whether or not the address has an unverified account). Codes are
issued at most once a minute and five times an hour per account and
purpose; a request inside those limits is accepted but sends nothing, so
the answer never reveals whether the address has an account.

`POST /api/auth/sign-in` with `{ login, password }`, `login` the email of
the account or its username in any case, returns the sign-in response, 401
`invalid_credentials` for an unknown login or wrong password, 403 `email_unverified` for an account whose address is not yet
verified (a fresh code is emailed), or 429 `credential_locked` after ten
wrong passwords, for fifteen minutes.

`POST /api/auth/password-reset` with `{ email }` emails a reset code when
the address has an account and answers 202 either way.
`POST /api/auth/password-reset/confirm` with `{ email, code, password }`
replaces the password, verifies the address if it was not, ends every
session of the user, and signs the caller in. Emails are compared after
trimming and lower-casing.

## HTTP limits and errors

Ordinary request bodies are limited to 1 MiB. Raw
`PUT /api/document-transfers/upload/:token` permits up to 25 MiB; native
`POST /api/document-transfers/upload-file/:token` accepts one multipart file up
to 9 MiB with at most 64 KiB of framing. The API checks
body limits independently of the web proxy. Invalid JSON, malformed URLs, and
invalid body lengths return 400; oversized bodies return 413
`payload_too_large`; unsupported content types return 415
`unsupported_media_type`. Unknown routes return a generic 404 without echoing
the URL. Domain conflict and authorization codes remain unchanged.

Responses use `{ error: { code, message } }` for failures and
`Cache-Control: private, no-store` for API data. Ordinary responses include a
server-generated `x-request-id`; incoming request IDs are not trusted. Raw HTTP
parser failures before routing return safe 400/408/431 responses without
reflecting request bytes.

The same-origin proxy enforces counted body lengths and a 30-second deadline
from route entry, including upload receipt and the upstream response. Before
response headers, a deadline returns 504 `request_timeout`, an observed client
abort returns 408 `request_aborted`, and an unreachable upstream returns 503
`service_unavailable`. After headers, a failed stream terminates. A timeout or
disconnect after dispatch does not prove a mutation rolled back; refresh and
retain the original command ID/version preconditions when resolving retries.

The typed client's `attachDocument` rejects oversized files before reading or
hashing and verifies that received bytes match the reported size. These client
checks are an early usability guard, not the authorization boundary. See
[Deployment](deployment.md) for logging, ingress limits, and preview constraints.

## Reversible content commands

`GET /api/commands` reads the current user's stack in a workspace: the one of
the object named by `?objectId=`, else the selected one. `POST /api/commands`
applies a bounded batch of Event/Task content edits on the stack in the
workspace of the object its first edit names; `POST /api/commands/undo` and
`POST /api/commands/redo` transition the pinned head of the stack the
`objectId` query names, as the read does. Every mutation requires an
operation ID and expected stack version. See [Commands](commands.md) for typed
examples, object preconditions, idempotency, and explicit eligibility limits.

## Event collection

`GET /api/events` returns `{ items, nextCursor, asOf, counts }`. It lists
active, self-scoped Events the caller may view: the ones of the selected
workspace when the caller belongs to it (`mine`), and the ones an active
grant shares with the caller from workspaces the caller does not belong to
(`shared`), whichever workspace they live in. Scoped itinerary Events remain
in their parent's projections. Permission and content are read in one
snapshot; private candidates cannot consume the limit.

| Parameter | Values and default                                          |
| --------- | ----------------------------------------------------------- |
| `limit`   | 1-50, default 20                                            |
| `query`   | Trimmed name substring, up to 240 characters, default empty |
| `scope`   | `all` (default), `mine`, or `shared`                        |
| `filter`  | `all` (default), `upcoming`, `past`, or `unscheduled`       |
| `sort`    | `date` (default), `name`, or `updated`                      |
| `cursor`  | Previous `nextCursor`; omit to start a new collection read  |

Each item is the Event with its `workspaceId` and an `access` object:
`sharedBy` (`{ userId, displayName }` of the account that gave the caller
the share, or null for the caller's own), `role` (the role the caller
holds through the share, `viewer` when every grant is narrowed to a view;
null for the caller's own), and `sharedWith` (for the caller's own Events,
how many other accounts hold an active grant on it; 0 for a share). The
first page carries `counts` for the typed query alone, `{ all, mine,
shared, upcoming, past }`; continuation pages carry `counts: null`. Both
backends read the same two sets: PostgreSQL through the member and shared
predicates of the authorization store, the gateway through the account's
memberships and grants across workspaces.

Name matching is case-insensitive; `%`, `_`, and backslash are literal
characters, not wildcard syntax. `unscheduled` means no start date or time. A timed
Event is past when its end (or start if there is no end) precedes `asOf`.
Date-only Events remain upcoming throughout their inclusive last date, using
the Event timezone (UTC if absent). `upcoming` includes ongoing Events and the
exact boundary. The first page's
reference time is retained across its continuation pages. It never sets the
authorization clock: every request rechecks current access and grant expiry.

Date order is start ascending, undated last, then folded name and ID. Date-only
starts use a UTC day anchor for ordering, not an asserted occurrence time. Name order
is folded name then ID. Updated order is update time descending then ID. Names
use PostgreSQL `lower(display_name) COLLATE "C"`, not browser locale collation.
Cursor timestamps retain database microseconds even though resource timestamps
are serialized in milliseconds.

Previously one call returned the whole accessible collection:

```ts
const { items } = await client.listEvents();
```

It now returns at most 20 items by default. To enumerate a filtered collection,
keep its options and follow `nextCursor` until null:

```ts
const options = {
  query: "gathering",
  filter: "upcoming",
  sort: "name",
  limit: 25,
} as const;
let page = await client.listEvents(options);
consume(page.items);
while (page.nextCursor !== null) {
  page = await client.listEvents({ ...options, cursor: page.nextCursor });
  consume(page.items);
}
```

Deploy the API and web client together. Update any external callers that assumed
one complete response; no database migration is needed. Invalid options or
malformed/mismatched cursors return 400 `invalid_request`. Cursors are bounded
to 4096 characters and bind the user, workspace, normalized query, filter, and
sort. A caller may change page size. Tokens are positions, not credentials or
permanent links, and contain only already-visible sort values.

Each page is a separate snapshot. Deleting a boundary does not prevent
continuation, but renames, rescheduling, or other edits can move records across
pages. This is not a point-in-time export: deduplicate IDs when accumulating
pages, and restart without a cursor to refresh the collection and period clock.
There is no total count. Database filtering/sorting may scan many candidates;
returned rows and typed-object hydration are bounded, not total database work.

## Atomic Event resource creation

Use `POST /api/events/:id/resources` with `commandId`, `resource`, and optional
`relationMetadata`. The resource has an `objectType` of `event`, `task`, `expense`,
or `reminder` and the corresponding create fields, excluding `permissionScopeId`.
The server assigns the Event scope. The response is `{ resource, relationId }`.

Standalone create and relation methods remain compatible. To make one inclusion
retry-safe, replace this two-request call site:

```ts
const task = await client.createTask({
  displayName: "Confirm venue",
  permissionScopeId: eventId,
});
await client.createRelation(eventId, {
  relationType: "includes",
  targetObjectId: task.id,
});
```

with one command, retaining `commandId` for retries until its outcome is known:

```ts
const commandId = crypto.randomUUID();
const result = await client.createEventResource(eventId, {
  commandId,
  resource: { objectType: "task", displayName: "Confirm venue" },
  relationMetadata: { section: "Logistics" },
});
```

Matching retries return the original HTTP 201 result; changed input with the
same command ID returns HTTP 409 `command_conflict`. Replays reauthorize current
access, create no duplicate objects, and never reverse later edits or unlinks.

## Object history

| Method | Path                                                           | Behavior                                                |
| ------ | -------------------------------------------------------------- | ------------------------------------------------------- |
| GET    | `/api/objects/:id/revisions/compare?fromVersion=N&toVersion=M` | Compare public content with current View                |
| GET    | `/api/objects/:id/revisions/:version/restore-preview`          | Preview eligible content against current state          |
| POST   | `/api/objects/:id/revisions/:version/restore`                  | Restore content with current Edit and `expectedVersion` |

History can be inspected and restored through the typed client:

```ts
const comparison = await client.compareObjectRevisions(objectId, {
  fromVersion: 1,
  toVersion: 2,
});
const preview = await client.previewObjectRestoration(objectId, 1);
// Show preview.changes and require confirmation before this call.
const restored = await client.restoreObjectRevision(objectId, 1, {
  expectedVersion: preview.currentVersion,
});
```

Retain the preview's version for confirmation; never silently replace it after
a concurrent edit. The restore response is the updated canonical resource.
Stale versions return 409 `version_conflict`; unauthorized or missing resources
return 404. Snapshots and extra body fields are rejected. See
[Object revisions](revisions.md) for content eligibility and deployment limits.

Authenticated callers with current View permission can list revision summaries
with `GET /api/objects/:id/revisions?limit=25` and fetch typed historical content
with `GET /api/objects/:id/revisions/:version`. Pass the returned
`nextBeforeVersion` as `beforeVersion` to continue; `null` ends pagination.
The limit is 1-100. Each summary carries `changedFields`, up to three public
content fields that differ from the previous revision with their before and
after values, and `changedFieldCount`, the number of all such fields, so a
history row can preview its change without a comparison request; the first
revision lists the content it started with (`beforePresent` false on each
field). No total counts, security metadata, or
private storage keys are returned. See [Object revisions](revisions.md) for
authorization semantics.

```ts
const page = await client.listObjectRevisions(objectId, { limit: 10 });
const revision = await client.getObjectRevision(objectId, 1);
if (page.nextBeforeVersion !== null) {
  const older = await client.listObjectRevisions(objectId, {
    limit: 10,
    beforeVersion: page.nextBeforeVersion,
  });
}
```

## Trash and recovery

| Method | Path                                  | Behavior                                            |
| ------ | ------------------------------------- | --------------------------------------------------- |
| GET    | `/api/trash?limit=20&objectType=task` | List authorized Owner tombstones                    |
| GET    | `/api/objects/:id/recovery-preview`   | Preview current deleted version and scope readiness |
| POST   | `/api/objects/:id/recover`            | Recover with Owner and `expectedVersion`            |
| GET    | `/api/objects/:id/removed-relations`  | List authorized removed incoming/outgoing links     |
| POST   | `/api/relations/:id/recover`          | Recover a link with `expectedVersion`               |

Trash responses use `items` and `nextCursor`; send the latter as `cursor` to
continue until it is null. Requests accept `objectType`, exact `scopeId`, and
`limit` (1-100, default 20). Cursors belong to one user, workspace, object-type
filter, and scope filter. Every page checks current recovery permission before
limiting results. Malformed or mismatched cursors return 400; the former
`beforeId` query key is rejected. Deploy API, client, and web together.

```typescript
const options = { objectType: "task", scopeId: eventId, limit: 20 } as const;
const firstTrashPage = await client.listTrash(options);
if (firstTrashPage.nextCursor !== null) {
  await client.listTrash({ ...options, cursor: firstTrashPage.nextCursor });
}
```

Removed-link responses use `items` and `nextCursor`. Requests accept `limit`
(1-50, default 20), optional `relationType`, and `cursor`. Cursors belong to one
user, workspace, parent object, and link-type filter; reuse them only with that
same context. Each page rechecks current permissions. A malformed or mismatched
cursor returns 400. The former `beforeId` query key is no longer accepted.

```typescript
const first = await client.listRemovedRelations(eventId, {
  limit: 20,
  relationType: "includes",
});
if (first.nextCursor !== null) {
  const next = await client.listRemovedRelations(eventId, {
    limit: 20,
    relationType: "includes",
    cursor: first.nextCursor,
  });
}
```

A preview does not reserve a version or grant permission for a later mutation.
Both recovery POST bodies contain only `{ expectedVersion }`.
See [Recovery](recovery.md) for authorization, pagination, and rollout semantics.

## Canonical objects

| Method   | Path                             | Behavior                            |
| -------- | -------------------------------- | ----------------------------------- |
| `GET`    | `/events`                        | List visible root Events            |
| `POST`   | `/events`                        | Create an Event                     |
| `GET`    | `/tasks`                         | List every visible Task             |
| `POST`   | `/tasks`                         | Create a Task                       |
| `POST`   | `/expenses`                      | Create an Expense                   |
| `POST`   | `/reminders`                     | Create a Reminder                   |
| `GET`    | `/persons`                       | List visible People in name order   |
| `POST`   | `/persons`                       | Create a Person                     |
| `POST`   | `/notes`                         | Create a Note                       |
| `GET`    | `/{type}/:id`                    | Read the requested typed object     |
| `PATCH`  | `/{type}/:id`                    | Update with `expectedVersion`       |
| `GET`    | `/objects/:id`                   | Read any supported canonical object |
| `DELETE` | `/objects/:id?expectedVersion=N` | Soft-delete an object               |

Create input may include `permissionScopeId`. When omitted, the object owns its
permission scope. A child can inherit from exactly one object in the same
workspace. The caller must be allowed to edit that scope.

Create input may also carry a `commandId` (UUID). The same caller's repeat of
the same input under that id returns the object it created (its current
state, HTTP 201) instead of a second one, so a retry after a lost response
cannot duplicate an object; a different input under the same id returns HTTP
409 `command_conflict`. A command id belongs to the caller across every
family, and the web client attaches one to standalone task and person
creation for the life of an unchanged draft. Deploy migration 0042 before
this API and reapply the runtime role grants, which cover the command table.

Patch input always includes the last observed positive `expectedVersion`. A
successful update increments the version. A stale update returns HTTP 409 with
the `version_conflict` code.

A Task is due on a calendar date (`dueOn`, `YYYY-MM-DD`, no time zone), at an
instant (`dueAt`), or not at all; a request that leaves both set returns HTTP
400 with `dueOn and dueAt cannot both be set.`, so moving a task between the
two forms sends both fields in one update, one of them null. Responses carry
both fields, the unused one null. Deploy migration 0034 before this API.

A Task may be a subtask of one other Task through `parentTaskId`, one level
deep: the parent must be a live Task of the workspace with no parent of its
own, a Task that has subtasks cannot become one, a Task cannot be its own
parent, and a subtask shares its parent's permission scope (`permissionScopeId`
must equal the parent's; inside an Event both are the Event). Each rule
returns HTTP 400 with its own message. `parentTaskId: null` on an update
detaches a subtask. Trashing a parent takes its live subtasks to Trash with
it (each with its own audit event and revision, marked as trashed with the
parent); recovering the parent brings back exactly those, while a subtask
trashed on its own stays in Trash. A subtask cannot be recovered while its
parent is in Trash (`Restore the parent task first.`, HTTP 400; the recovery
preview reports the same reason), and a standalone subtask's scope rule
applies first since its parent is its scope. Deploy migrations 0035 and 0041
before this API.

## People

A Person is a canonical object like the others: someone the workspace keeps
track of, with the common `displayName` and `customProperties` for whatever
else matters (a birthday, a dietary note), an optional `nickname` (1-240
characters, the name shown in place of `displayName` when present), an
optional `description` (1-2000 characters), `contacts` (at most 20
`{ kind, value }` entries with `kind` one of `email`, `phone`, `other`, kept
in the order sent; an `email` value must be an address), `labelIds` (labels
of the workspace, returned in name order; an unknown id returns HTTP 400 with
`labelIds must name labels of this workspace.`), and an optional `userId`
linking the Person to an account. `userId` must name a member of the
workspace, of any role, or a friend of one (see Friends), and each account belongs to at most
one Person of the workspace; a violation returns HTTP 400 with
`userId must name a member of this workspace or a friend of one.` or
`userId is already linked to another person.`. The contacts are the only
place a Person keeps an address: there is no `email` field on a Person,
and a request that still sends one is read without it like any unknown
key. `null` clears the nickname, description, or linked account on an
update; absent leaves each unchanged, as do absent `contacts` and
`labelIds`. People are created, read (`GET /persons/:id`), updated, trashed,
recovered, searched (`objectType=person`), and versioned like every object;
a revision restore brings back the nickname, description, and contacts but
never the linked account or the labels (a revision taken before migration
0057 still holds an `email`, which the restore ignores). Deploy migration
0050 before this API and reapply the runtime role grants, which cover the
`person_contacts` and `person_labels` tables; deploy 0057, which drops the
Person `email` column, before the API built from it starts.

`GET /persons` lists every live Person the caller may view in the active
workspace, ordered by name without regard to case, then ID; `query` matches
the name and `limit` (1-200, default 100) bounds the page. The response is
`{ items }`; there is no cursor yet, so a query narrows a large workspace.
Deploy migration 0037 before this API and reapply the runtime role grants,
which cover the new table.

An Event includes People the way it includes tasks, expenses, reminders, and
documents: `POST /objects/:eventId/relations` with `relationType: "includes"`
and a Person as the target, or `POST /events/:id/resources` with a
`{ objectType: "person", displayName, ... }` resource to create the Person
inside the Event (its scope is the Event's). `GET /events/:id/people` lists
the included live People the caller may view in name order as
`{ sourceEventId, items }`, and the event detail carries them as `persons`.
Removing the relation leaves the Person in the workspace. Deploy migration
0040 before this API.

A Task may be assigned to one Person through `assigneeId` on create and
update (`null` clears it; absent leaves it unchanged); the id must name a live
Person of the workspace, or the request returns HTTP 400 with
`assigneeId must name a live person in this workspace.`. Responses carry
`assigneeId`, null when unassigned; the Person's name comes from the People
collection. `GET /tasks?assignee=<personId>` lists only the tasks assigned
to that Person. A Person moved to Trash keeps their tasks; the assignee is not
part of a revision's restorable content. Deploy migration 0038 before this
API.

A Task may name where it happens through `location`, text of 1 to 240
characters (trimmed at the boundary; `null` clears it, absent leaves it
unchanged; the service refuses padded or longer text with
`location is 1 to 240 characters without surrounding spaces.`). Responses
carry `location`, null when unset; it is restorable content. Deploy migration
0039 before this API. A Place object may take its place once the places
family exists.

A Task due at an instant may say how long it takes through `durationMinutes`,
an integer from 1 to 1440 (`null` clears it, absent leaves it unchanged). A
duration needs a due instant: the service refuses one on a date-only or
undated task, and refuses clearing `dueAt` while a duration stands, with
`durationMinutes requires dueAt.` (`durationMinutes is 1 to 1440 minutes.`
for a value out of range), so a client clears the time and the duration
together. Responses carry `durationMinutes`, null when unset; it is
restorable content, and a restored revision without a due instant carries
none. Deploy migration 0044 before this API.

A Task with a due may repeat through `repeatRule`: `daily`, `weekdays`
(Monday to Friday), `weekly`, `biweekly`, `monthly`, or `yearly`, optionally
until a last date through `repeatUntil` (`null` clears either; absent leaves
it unchanged; clearing the rule clears its end). A rule needs a due date or
instant (`repeatRule requires dueOn or dueAt.`), an end needs a rule
(`repeatUntil requires repeatRule.`) and cannot come before the due
(`repeatUntil must be on or after the due date.`). Completing a repeating
task, that is, a `PATCH` that sets `status` to `done` on a task that is not
done and carries no `dueOn`, `dueAt`, `repeatRule`, or `repeatUntil` of its
own, keeps the task open on its next occurrence: the response has `status`
`todo`, `completedAt` null, and the due moved on (daily adds a day; weekdays
the next Monday to Friday; weekly and biweekly seven and fourteen days;
monthly and yearly a month or a year, clamped to the target month's last day;
an instant keeps its UTC time of day). The completion is one ordinary
versioned update whose revision shows the move. When the next occurrence
would fall after `repeatUntil`, the completion marks the task done as usual.
A `PATCH` that also changes the due or the rule, a reversible command, and a
revision restore apply the state they are given. Responses carry
`repeatRule` and `repeatUntil`, null when unset; they are restorable content,
and a restored revision without a due carries neither. Deploy migration 0045
before this API.

Tasks and Reminders take a place in manual order through `rank`: eleven
digits with an optional fraction and no trailing zero (`00000001000`,
`00000001500.5`), so text order is numeric order. A created record goes last
(a thousand past the workspace's highest integer part) unless the request
sends a rank; to drop a record between two others, send the midpoint of
their ranks (the `rankBetween` helper in `@livtales/schemas` computes it) as
a `PATCH` with the expected version, which moves no other record. A rank of
another shape is refused with `rank is a position in manual order.`.
Responses carry `rank`; `GET /tasks?sort=manual` lists by it. The rank is
content the revision history records but never restores. Deploy migration
0046 before this API.

## Notes

A Note is free text kept with an Event: a canonical object like the others,
with the title as its `displayName` and a plain-text `body` (at most 20,000
characters, line breaks kept as sent, empty by default), versioned, audited,
trashed and recovered, restored from history, and searched by its title. A
note is usually created inside an Event through `POST /api/events/:id/resources`
with `objectType: "note"`, which includes it in the Event and gives it the
Event's permission scope, so everyone who may edit the Event may edit the
note; `POST /api/notes` creates one on its own. `PATCH /api/notes/:id` takes
the last observed `expectedVersion` with any of `displayName`, `body`,
`customProperties`, and `metadata`; a stale version is HTTP 409
`version_conflict`, a body over the limit HTTP 400 with `body must be text
of at most 20000 characters.`. History compares the text as the field
`body` ("Text"); restoring an earlier revision brings its title and text
back as a new version. Search matches titles only. Deploy migration 0060
before this API and reapply the runtime role grants, which cover the new
table.

`GET /api/events/:id/notes?sort=edited|title` is the Notes projection: the
live notes the Event includes that the caller may view, each note with
`editedBy`, the display name of the account whose revision is its current
version (null when the account is not known). `edited`, the default, lists
the newest edit first; `title` orders by title without regard to case; ties
break by id. A caller who cannot view the Event gets HTTP 404. The
projection answers on both backends: PostgreSQL composes it from the
relations and revisions, the gateway calls `chronelle_note_list`.

## Labels

| Method   | Path                            | Behavior                             |
| -------- | ------------------------------- | ------------------------------------ |
| `GET`    | `/labels`                       | The workspace's labels in name order |
| `POST`   | `/labels`                       | Create a label (`{ name }`)          |
| `PATCH`  | `/labels/:id`                   | Rename with `expectedVersion`        |
| `DELETE` | `/labels/:id?expectedVersion=N` | Delete; its tasks lose it            |

A label is a workspace-level name of 1 to 40 characters, unique per workspace
without regard to case (`label_name_taken`, HTTP 409). Anyone with access to
the workspace, member or grantee, may list labels; owners and editors create,
rename, and delete them. A Task carries labels as a whole through `labelIds`
on create and update (absent leaves them unchanged; each id must name a label
of the workspace, HTTP 400 otherwise) and returns them as `labelIds` in name
order. `GET /tasks?label=<id>` lists only tasks carrying that label. Labels
are not part of a revision's restorable content. Deploy migration 0036 before
this API and reapply the runtime role grants, which cover the two new tables.

The Event collection query examines self-scoped planning roots in the active
workspace and applies the same `view` authorization decision to every candidate
before returning it. Directly shared Events can appear without workspace
membership; child schedule items, unrelated Events, and soft-deleted Events are
omitted.

The Task collection (`GET /tasks`) lists every live Task the caller may view in
the active workspace, whether it owns its scope or inherits an Event's, with
the same authorization decision per candidate. `filter` is `open` (todo and in
progress, the default), `all`, or `done`; `sort` is `due` (a date-only due at
the start of its day in UTC, ahead of timed tasks that day, undated tasks
last, then name and ID), `name`, `updated`, or `manual` (by `rank`, then
ID); `query` matches the name;
`label` and `assignee` keep the tasks carrying that label or assigned to that
Person; `dueFrom` and `dueTo` (calendar dates, either or both) keep the tasks
due on a day of that inclusive range, where a timed task is due on the day of
its instant in `timezone` (an IANA name, default `UTC`; an unknown name or a
`dueTo` before `dueFrom` is HTTP 400) and an undated task is in no range;
`limit` is 1-50 (default 20). Pages carry `nextCursor` and `asOf` like the
Event collection, and a cursor is bound to its caller and query: reusing one
with another `filter`, `sort`, `query`, `label`, `assignee`, due range,
`timezone`, or user returns HTTP 400. Each page
also carries `contexts`, a map from Task ID to `{ eventId, displayName }` for
the Event that includes the Task, present only when the caller may view that
Event (the earliest inclusion when several Events include one Task); a Task
held through a direct grant inside an Event the caller cannot see has no
entry. `progress` maps each listed parent Task ID to `{ done, total }` over
its live, viewable subtasks, and `parents` maps each listed subtask ID to
`{ taskId, displayName }` of its parent when the caller may view it. The
typed client exposes `listTasks(input)`.

## Sections

| Method   | Path                               | Behavior                                                               |
| -------- | ---------------------------------- | ---------------------------------------------------------------------- |
| `GET`    | `/events/:id/sections?view=<view>` | The sections of one view of the Event in their order                   |
| `POST`   | `/events/:id/sections`             | Create (`{ view, name, description?, afterSectionId? }`)               |
| `PATCH`  | `/sections/:id`                    | Rename, describe, or move (`name?`, `description?`, `afterSectionId?`) |
| `DELETE` | `/sections/:id`                    | Delete; its records stay in the view without a section                 |

A section is a named group in an Event's To-dos or Expenses view (`view` is
`todos` or `expenses`): a vocabulary of the Event the way labels are of the
workspace, not a canonical object, so it has no version, no Trash, and no
history. Its `name` is 1 to 120 characters and its `description` up to 2,000,
both trimmed at the boundary (an empty description is none). Sections keep a
manual order through `rank` in the scheme Tasks use: `afterSectionId` on
create or update names the section to place it after, `null` places it
first, and leaving it out on create places it last (on update, leaves it
where it is); naming a section of another view or Event is HTTP 400.
Whoever may view the Event lists its sections; whoever may edit the Event
creates, changes, and deletes them (HTTP 404 otherwise, as for the Event).

A Task or Expense carries at most one section through `sectionId` on create
and update (`null` clears it, absent leaves it unchanged) and returns it as
`sectionId`, null when loose. The section must belong to the matching view
(`todos` for a Task, `expenses` for an Expense) of the Event the record
belongs to, the one whose permission scope it inherits, whether the record
is created in that Event's context or through the plain routes with
`permissionScopeId`; a standalone record takes no section. Any other section
is refused with `sectionId must name a section of this view of the record's
Event.` (HTTP 400). A section is not restorable content: restoring an older
revision leaves the record where it is, and moving a record between sections
writes its `sectionId` (and, for a Task, its `rank`) in one update. The
To-dos and Expenses projections carry `sections` in order beside `items`.
Deploy migration 0062 before this API and reapply the runtime role grants,
which cover the new table.

## Search

| Method | Path      | Behavior                                   |
| ------ | --------- | ------------------------------------------ |
| `GET`  | `/search` | Search authorized active canonical objects |

`GET /search` requires a `query` of 2-120 characters containing at least one
letter or number. `objectType` may select `event`, `task`, `expense`,
`reminder`, `document`, or `person`; `limit` defaults to 20 and is capped at 50. The
response is `{ items, nextCursor }`, with compact canonical object fields and
no total. `nextCursor` is `null` when no more visible matches exist in this
page's snapshot. To continue, send it unchanged as `cursor` with the same query
and object type. Page size may change between requests.

The central View policy filters active canonical objects in the selected
workspace before PostgreSQL sorts and limits them. There is no fixed
private-candidate window. Ordering is relevance descending, update time
descending, then ID ascending. Each query fetches at most `limit + 1` visible
rows; the extra row determines whether another page exists.

Cursors are opaque, versioned base64url positions bounded to 2,048 characters.
They bind the normalized query, type filter, user, and workspace, and preserve
PostgreSQL timestamp precision. Invalid or mismatched cursors return
`400 invalid_request`. They are neither secrets nor authorization credentials:
changing a position cannot bypass the current permission decision. Clients
must not decode or construct them.

Each page uses a fresh consistent read snapshot. Grant revocation and soft
deletion take effect on subsequent requests; deleting a boundary row does not
break continuation. Unchanged matches with tied sort fields paginate without
duplicates, but edits that move an object's relevance or update time can move
it across a cursor. Restart without a cursor to obtain a fresh ordering. The
web client deduplicates canonical IDs across loaded pages; pagination is not a
long-lived snapshot or an export-completeness guarantee. Deploy the API and
typed client together because the response now requires `nextCursor`.

## Relationships

| Method   | Path                               | Behavior                                    |
| -------- | ---------------------------------- | ------------------------------------------- |
| `POST`   | `/objects/:id/relations`           | Relate the source object to a target        |
| `GET`    | `/objects/:id/relations`           | List visible active relationships           |
| `DELETE` | `/relations/:id?expectedVersion=N` | Soft-delete only the versioned relationship |

The create body contains `relationType`, `targetObjectId`, and optional
`metadata`. The initial vocabulary is `includes`, `reminds_about`,
`attached_to`, and `related_to`. Endpoint-type compatibility is enforced in
the domain service. Relationships provide context but never permission.

Relation responses include their independent `version`. Attachment responses
include `relationVersion` alongside `relationId`; it is not the Document's
version. Use `client.deleteRelation(relationId, relationVersion)` to remove a
link. A stale expected version returns HTTP 409.

Active relation lists return `{ items, nextCursor }`, ordered by immutable
relation ID descending. `limit` defaults to 20 and accepts 1-50. Optional filters
are `direction` (`both`, the default, `incoming`, or `outgoing`),
`relationType` (the vocabulary above), and `otherObjectId` (the opposite
canonical endpoint's UUID). Every returned link requires current View on both
endpoints. Hidden links do not consume page slots or expose counts, metadata,
or cursor positions. An unavailable starting object returns 404; an unavailable
opposite endpoint produces no match.

Callers that previously treated one response as the complete list must follow
`nextCursor` until it is `null`. Send the token unchanged as `cursor` with the
same object, filters, user, and workspace; the page size may change. Tokens are
bounded to 4,096 characters. Invalid or mismatched positions return 400.

Before:

```ts
const allLinks = (await client.listObjectRelations(eventId)).items;
```

After:

```ts
const page = await client.listObjectRelations(eventId, { limit: 20 });
if (page.nextCursor !== null) {
  const next = await client.listObjectRelations(eventId, {
    limit: 20,
    cursor: page.nextCursor,
  });
}
// One active source/type/target link is unique; this lookup needs no continuation.
const inclusion = await client.listObjectRelations(eventId, {
  direction: "outgoing",
  relationType: "includes",
  otherObjectId: taskId,
  limit: 1,
});
```

`ObjectRelationService.listForObject(principal, objectId, options?)` likewise
returns a page instead of an array. Deploy API and client together; no database
migration is needed. Every page uses a new authorization snapshot, not a
long-lived export snapshot. Deleted boundaries remain usable, while new or
recovered links before the boundary require a refresh. Removed-link lists and
Event detail projections retain their separate contracts.

## Event schedules

Event creation and updates accept `startsOn` and `endsOn` for dates without
times. Both are nullable ISO calendar dates. The end is inclusive and requires
a start. Both `startsAt` and `endsAt` must be null for date-only Events.

```ts
const vacation = await client.createEvent({
  displayName: "Summer vacation",
  startsOn: "2030-07-03",
  endsOn: "2030-07-12",
  timezone: "America/Los_Angeles",
});
// Once exact times are known, clear the date-only pair in the same update.
await client.updateEvent(vacation.id, {
  expectedVersion: vacation.version,
  startsOn: null,
  endsOn: null,
  startsAt: "2030-07-03T16:30:00Z",
  endsAt: "2030-07-12T01:00:00Z",
});
```

Omit an end if it is unknown. Use null for all four fields to clear the schedule.
Partial updates validate against current content; invalid ranges and mixed
precision return 400. Stale versions still return 409. See
[Event schedules](object-model.md#event-schedules) for storage and timezone semantics.

An Event may name where it happens through `location`, the same text a
Task carries (1 to 240 characters, trimmed at the boundary; `null` clears it,
absent leaves it unchanged; padded or longer text is refused with
`location is 1 to 240 characters without surrounding spaces.`). Responses
carry `location`, null when unset, and so do the calendar and itinerary
projections; it is restorable content, and a reversible command that edits
an Event carries it with the rest of the content. Deploy migration 0059
before this API.

An Event and a Task carry a `description`: plain text of up to 2,000
characters, line breaks kept, trimmed at the boundary; an empty string and
`null` alike clear it, absent leaves it unchanged; padded or longer text is
refused with `description is 1 to 2000 characters without surrounding
spaces.` Responses carry `description`, null when unset; it is restorable
content, and a reversible command carries it with the rest. Deploy
migration 0061 before this API.

## Event projections

The typed client can read just the canonical Event for a header or editor:

```typescript
const event = await client.getEvent(eventId);
```

This uses the existing `GET /api/events/:id` route and validates its response.
It does not load related collections; `getEventDetail(eventId)` provides those
when a view needs them.

The Files target selector uses `client.getEventAttachmentTargets(eventId)`
(`GET /api/events/:id/attachment-targets`). It returns `{ event, tasks, expenses }`,
with only `{ id, displayName }` for each target, in the same order as event detail.
The Event and every target require view permission. Child typed state and document
contents are not loaded; attachments are still read through their authorized
parent-specific endpoint. The full detail endpoint is unchanged.
Deploy the additive API endpoint before or together with the web bundle that
uses it; no database migration is required.

| Method | Path                    | Result                                      |
| ------ | ----------------------- | ------------------------------------------- |
| `GET`  | `/events/:id/detail`    | Event plus related typed collections        |
| `GET`  | `/events/:id/todos`     | Included Tasks by due, with `sections`      |
| `GET`  | `/events/:id/calendar`  | Included scheduled Events                   |
| `GET`  | `/events/:id/timeline`  | Dated included resources in time order      |
| `GET`  | `/events/:id/itinerary` | Included scheduled Events                   |
| `GET`  | `/events/:id/expenses`  | Included Expenses, newest first, `sections` |
| `GET`  | `/events/:id/reminders` | Included Reminders ordered by trigger time  |
| `GET`  | `/events/:id/people`    | Included People in name order               |
| `GET`  | `/events/:id/notes`     | Included Notes, newest edit first (Notes)   |

Every projection is computed from active relationships and canonical rows. It
does not create projection-owned data. Every included resource is separately
authorized; an inaccessible referenced object is omitted rather than leaked.
Event detail includes `lockedRelationCount`, which lets clients render a
generic private-item notice without exposing identities or business fields.

Focused endpoints select only their relevant `includes` target types and do not
load attachments. Calendar and itinerary omit Events without a start date or time;
timeline omits undated Events and Tasks. To-dos retain undated Tasks after dated
ones; a Task due on a date sorts at the start of that day (UTC), ahead of Tasks
due at an instant that day, and the timeline lists it with `occursOn`. Equal
timestamps are ordered by canonical ID (descending for Expenses).
The detail endpoint retains all its collections and locked-reference count.
Permission checks and canonical versions are identical across these reads.
Timeline entries contain either `occursAt` or `occursOn`, with the other null.
Date-only entries keep their precision in every projection. Deploy API and web
together after migration 0010; consumers that assume `occursAt` is always a
timestamp must handle date-only entries.

## Private documents

| Method | Path                                     | Behavior                              |
| ------ | ---------------------------------------- | ------------------------------------- |
| `POST` | `/documents/upload-url`                  | Authorize one parent-bound upload     |
| `PUT`  | `/document-transfers/upload/:token`      | Transfer the authorized private bytes |
| `POST` | `/document-transfers/upload-file/:token` | Transfer one native multipart file    |
| `POST` | `/documents`                             | Finalize one canonical Document       |
| `GET`  | `/objects/:id/documents`                 | List visible attached Documents       |
| `GET`  | `/documents/:id/download-url`            | Authorize one private download        |
| `GET`  | `/document-transfers/download/:token`    | Download authorized private bytes     |

Upload authorization accepts `parentObjectId`, `originalFilename`, `mimeType`,
`sizeBytes`, and a lowercase SHA-256 checksum. The parent must be an Event,
Task, or Expense that the caller can edit. Files are limited to 25 MiB. A
Mini Program caller may request `transferMode: "multipart"`, limited to 9 MiB;
the returned POST URL accepts exactly one `file` part. Other callers receive a
raw PUT authorization. Both tickets are short-lived and consumed once, and the
transfer must match the declared size and checksum. `POST /documents` accepts its
`uploadAuthorizationId` and creates the canonical Document plus `attached_to`
relationship in one audited transaction.

The attachment list returns the relation ID, public Document metadata, and a
generic `lockedAttachmentCount`. Delete that relation through the normal
relationship endpoint to unlink the file without deleting its Document.

Download authorization requires View on the Document and returns a short-lived
GET authorization. The local adapter consumes it once and rechecks permission;
the COS adapter issues an expiring signed GET URL. The local transfer responds
with `Cache-Control: private, no-store`.
Neither Document responses nor transfer responses expose a storage key or
permanent public URL.

## Storage inventory

| Method | Path                           | Behavior                                      |
| ------ | ------------------------------ | --------------------------------------------- |
| `GET`  | `/workspace/storage-inventory` | Count the workspace's stored files, read-only |

An Owner of the current workspace reads aggregate counts of its document
references and stored files for the configured provider; anyone else gets
`resource_unavailable` (HTTP 404). The request takes no parameters, and the
response names no key, file, or object. Files count by the records that name
them, not by the workspace prefix their storage keys carry: a Document or upload
authorization moved to another workspace keeps its file's key, so the file
counts in the workspace the record lives in; the workspace it was uploaded in
leaves it out of its counts, so it is never reported as unreferenced there. The
report deletes and repairs nothing. A busy scan is `inventory_busy` (HTTP 429); a scan beyond
its bounds or with a storage error is `inventory_unavailable` (HTTP 503). See
[Storage reconciliation](storage-reconciliation.md) for each count.

## Friends

Friends belong to the account, not to a workspace: a connection is a mutual
link between two accounts, made by one inviting the other and the other
accepting. `GET /api/friends` returns `{ friends, incoming, sent }`:
`friends` are the accepted connections (`id`, the other account's `userId`,
`displayName`, `email`, and `since`), in name order; `incoming` the requests
waiting for the caller's answer (`id`, `requester` with `userId`,
`displayName`, `email`, the `message`, `createdAt`), newest first; `sent`
what the caller sent and still waits (`id`, `kind`, `email`, `channel`,
`inviteUrl`, `message`, `personId`, `workspaceId`, `createdAt`,
`expiresAt`), newest first. A sent item is a `connection` (a request to the
account that has the address; `channel` and `inviteUrl` null) or an
`invitation`: a link, kept as its `inviteUrl` (`<WEB_PUBLIC_URL>/invite/<token>`)
so it can be copied again, with `channel` `email` when it was emailed to the
address or `link` when the caller hands it on (`email` then null unless one
was given), and an `expiresAt`. A caller cannot tell from the response
whether an address has an account except through what the recipient does.

`POST /api/friends/requests` with `{ userId, message?, personId? }` sends
a request to an account found by search or by its code: the same pending
connection an invitation to a known address makes, emailed to the account
and answered on its Friends page, with the same refusals (400
`invalid_request` for the caller's own id or a bad note, 404
`friend_unavailable` for an unknown id, 409 `friend_conflict` when a
request or connection already stands, 429 `friend_limit` within the same
daily allowance as invitations) and the sent item as the answer (201). Both
backends write through `chronelle_friend_request` (migration 0055).

`POST /api/friends/invitations` with `{ channel?, email?, message?, personId? }`
(`channel` `email`, the default, or `link`; `email` required to send by
email and kept when given on a link; message up to 500 characters;
`personId` a live, unlinked person of the current workspace the caller can
view, the card the invitation comes from) answers 201 with the sent item.
When exactly one account has the address a pending connection is made and
that account is emailed in its language, whichever channel was asked for;
otherwise an invitation is recorded with a token (kept, with its digest)
valid for fourteen days, and by email the address is emailed the link
`<WEB_PUBLIC_URL>/invite/<token>` in the caller's language, while a link is
answered for the caller to hand on. Refusals: 400 `invalid_request` for a
send by email without an address, the caller's own address (`You cannot
invite yourself.`), an untrimmed or overlong note, a card that is not an
unlinked person the caller can view, or an address that belongs to more
than one account; 409 `friend_conflict` when a request or connection
already stands (`You are already friends.`, `An invitation is already
waiting.`, `This person has already invited you.`) or an invitation from
the same card still waits; 429 `friend_limit` after fifty invitations in a
day (`Too many invitations today.`).

`POST /api/friends/invitations/:id/link` gives a pending invitation the
caller sent a fresh token and expiry, so the link handed out before stops
working, and answers the sent item with the new `inviteUrl`; when the
invitation has an address the new link is emailed again. At most once a
minute per item (429 `friend_limit`, `Wait before sending again.`).

`GET /api/invitations/:token` needs no session and answers what the claim
page shows: `{ requester: { displayName, username }, message, queued:
[{ resourceId, displayName, role }], expiresAt, status }`, `queued` the live
records with a share waiting on the invitation and `status` one of `open`,
`used`, `withdrawn`, `expired`; an unknown token is 404 `friend_unavailable`,
a malformed one 400, and one address may open at most sixty links a minute
(429 `search_limit`). `POST /api/invitations/:token/accept` (authenticated)
accepts the invitation as the caller and answers `{ friendship, shared,
alreadyHad }`: `friendship` `made` (no connection stood, or a pending
request either way became the accepted one, whose queued shares settle as
for an accepted request) or `existing`; `shared` the records the shares
queued on the invitation were granted for, by name and role; `alreadyHad`
those the caller already held with the same or a higher role (the queued
share lapses; a record in Trash lapses silently). The link is consumed, and
the card the invitation came from is linked to the caller as for an
accepted request. Refusals: 400 `invalid_request` for the caller's own link
(`This is your own invitation link.`); 409 `friend_conflict` for a link
already accepted (`This invitation was already accepted.`), withdrawn
(`This invitation is no longer open.`), or expired (`This invitation has
expired.`); 404 for an unknown token.

`POST /api/friends/requests/:id/accept` makes the two accounts friends and
answers with the friend; when the request came from a person card, that card
is linked to the accepting account as the requester in that workspace, if
the card is still unlinked and the account has no card there yet.
`POST /api/friends/requests/:id/decline` answers `{ id, status: "declined" }`.
`DELETE /api/friends/invitations/:id` withdraws a pending request or
invitation the caller sent (`{ id, status: "withdrawn" }`), and
`POST /api/friends/invitations/:id/resend` emails it again (202; an
invitation takes a fresh token and expiry and counts as emailed from then
on; one without an address is 400 `invalid_request`), at most once a minute
per item (429 `friend_limit`, `Wait before sending again.`). `DELETE /api/friends/:id`
ends an accepted connection from either side (`{ id, status: "removed" }`);
person links made through it stay, and are unlinked from the person editor.
A request, invitation, or friend that is not the caller's, or is no longer
pending or accepted, is 404 `friend_unavailable`. Every change is recorded
in the actor's personal workspace (`friend.invited`,
`friend.invitation_sent`, `friend.accepted`, `friend.declined`,
`friend.withdrawn`, `friend.invitation_withdrawn`, `friend.removed`,
`friend.resent`, `friend.invitation_resent`, `friend.invitation_linked`,
`friend.invitation_renewed`, `friend.invitation_claimed`,
`friend.invitation_accepted`).
Both backends write through the `chronelle_friend_*` functions (migration
0051). A connection exposes only display name and email to the other side;
account lookup by email happens only through an invitation.

## Access and sharing

| Method   | Path                            | Behavior                                                                        |
| -------- | ------------------------------- | ------------------------------------------------------------------------------- |
| `GET`    | `/objects/:id/access`           | The caller's allowed actions and access source                                  |
| `GET`    | `/objects/:id/shares`           | List active direct grants and waiting shares                                    |
| `GET`    | `/persons/:id/shares`           | What is shared each way with a person                                           |
| `POST`   | `/shares`                       | Create or replace a direct user grant, whole or narrowed to a view or a section |
| `DELETE` | `/shares/:id`                   | Revoke a direct grant                                                           |
| `POST`   | `/objects/:id/leave`            | Give up every grant the caller holds on the resource                            |
| `POST`   | `/shares/pending`               | Queue a share for a person without an account                                   |
| `DELETE` | `/shares/pending/:id`           | Take a waiting share back                                                       |
| `PATCH`  | `/objects/:id/permission-scope` | Change inheritance with a version                                               |

`GET /objects/:id/access` answers `{ resourceId, actions, source }` for a
live object the caller can view. `source` says where that access comes from:
`{ kind: "own" }` when the caller is a member of the workspace; `{ kind:
"direct", grantedBy: { id, displayName }, role }` when a grant on the object
itself gives it; `{ kind: "inherited", through: { id, displayName },
grantedBy, role }` when the grant sits on the Event whose scope the object
inherits. Membership names itself before a grant and a direct grant before an
inherited one. Both backends derive the source from the same membership,
grant, and scope rows in the same snapshot as the actions; nothing the caller
can view lacks one of the three.

`POST /shares` accepts `resourceId`, an Editor or Viewer `role`, an
optional `scope`, and the grantee as exactly one of `principalEmail`,
`personId`, `friendId`, and `principalId`. A single record is not shared
as Owner (HTTP 400): the Owners of the workspace it lives in own it. A grant
made as Owner before keeps its role and its rights until it is changed to
another role or revoked.
An email names the one account with that address. A Person of the workspace
names its linked account, or else the one account whose email equals any
of the card's email contacts and that lets itself be found by email
(`findByEmail`); the order of the contacts does not matter, and a card
whose contacts reach two accounts, or only accounts that hide from email,
reaches none. A friend names an accepted connection of the caller (an id
from `GET /api/friends`); the other side receives the role. A person the
caller cannot view, a person in Trash, one that reaches no account, an
email that matches no account or several, or a connection that is not the
caller's and accepted is `principal_unavailable` (HTTP 404), and naming two
grantees or none is HTTP 400. A `principalId` names an account that already
holds a grant on the resource, as a share sheet does when it changes a
role; any other account is `principal_unavailable`. Both backends resolve a
card the same way (`chronelle_person_account`, migration 0057, on the rpc
path; the readiness check requires it). The recipient must already have a
LivTales identity. Repeating the request for the same resource, user, and
scope replaces the active role rather than creating a duplicate grant; the
audit event of a share by person carries `personId`, one by friend
`friendId`, and a narrowed one its `scope`. Only callers with Share
permission can read or mutate grants; user and person lookup happens after
that authorization check.

`scope` narrows a share of an Event to one of its views: `{ view }` with
`view` one of `todos`, `calendar`, `itinerary`, `expenses`, `reminders`, and
`notes`, or `{ view, sectionId }` for one section of To-dos or Expenses. A
narrowed share opens the Event itself with view alone (so the page opens,
whatever the role) and gives its role on the records the view shows (tasks
for To-dos, schedule items for Calendar and Itinerary, expenses, reminders,
notes) or on the section's records; the other views' records are absent
from the Event's projections and unavailable one by one, never refused with
an error. One grant stands per resource, account, and scope, so the same
account may hold To-dos at viewer and Expenses at editor beside a whole
share; a whole share sees everything. A scope on a resource that is not an
Event, or a section that is not of that view of that Event, is
`invalid_share` (HTTP 400). Deleting a section ends the grants narrowed to
it. Every share read carries `scope`: `null` for a whole share, else
`{ view, sectionId }` (`GET /objects/:id/shares`, `GET /persons/:id/shares`,
the response of `POST /shares`). `GET /objects/:id/access` on an Event
carries `narrowing`: `null` when the caller sees all of it (a member or a
whole share), else `{ views, sections }` with the views shared whole and the
sections shared on their own, which the event page uses to list the shared
views alone. Both backends decide the same way (`chronelle_grant_admits` in
every `chronelle_can_*` function and the held role; the readiness check
requires it and `chronelle_section_visible`, which narrows
`GET /events/:id/sections`).

`POST /objects/:id/leave` is the grantee's own way out of a share: it
deletes every grant the calling account holds on the resource, whole or
narrowed, in the resource's workspace, and answers
`{ resourceId, grantIds, leftAt }` with one `resource.share_left` audit
event naming the grants. A caller holding no grant there (a member of the
workspace, a stranger, or one who already left) gets 404. The web app
sends it when the notice offering Undo expires, so the event returns to
the list until then. Both backends: PostgreSQL directly, the gateway
through `chronelle_resource_share_leave` (migration 0065).

`GET /objects/:id/shares` returns `{ items, pending }`. `pending` lists the
shares waiting on a request or invitation the caller's account sent, each
`{ id, workspaceId, resourceId, role, status: "pending", kind, itemId,
person, email, grantedBy, createdAt }`: `kind` is `connection` (a request to
an account) or `invitation` (a link, emailed or handed on) and `itemId` that
item; `person` is the card the share was ticked from, or null.

`GET /persons/:id/shares` returns `{ items }` for a Person of the caller's
workspace, to a member of that workspace who can view the person: what is
shared each way between the caller and the person, newest first, each
`{ id, kind, direction, resourceId, objectType, displayName, role,
createdAt }`. `direction` is `outgoing` for a live grant the caller's
workspace holds for the person's account or a share queued for the person
(`kind: "pending"`, waiting on an invitation), and `incoming` for a live
grant the person's account gave the caller, in any workspace. The person's
account is the one `POST /shares` resolves for a person grantee (the linked
one, else the one account an email contact reaches); a person that reaches
none has queued shares only. Expired grants and records in Trash are left out. A person the
caller cannot view, one of a workspace the caller is only a guest of (a
grant on the card, no membership), or none, is HTTP 404. Both backends read
the same rows (`chronelle_person_shares_list`, migration 0054, on the rpc
path).

`POST /shares/pending` accepts `resourceId`, `personId`, and an Editor or
Viewer `role` for a Person with no linked account. When a request or invitation from the caller
already names the person, the share is queued on it; otherwise the person
is invited as `POST /api/friends/invitations` would (a request to the
account that has the card's first email contact, an emailed link to an
address without one, a link for the caller to hand on when the card has no
email) and the share queued on what was sent. A person with an account here
is HTTP 400 (share with them directly). The response is the pending share
(201; `email` null behind a link); queuing the same person and resource
again changes the role. The share is granted, with the usual
`resource.shared` audit event carrying `pendingShareId`, when the request
or the link is accepted; it lapses when the request is declined or
withdrawn. `DELETE /shares/pending/:id` takes a waiting
share back for a caller who could revoke a grant on the resource and
answers `{ id, revokedAt }`. Queuing writes `resource.share_queued` and
taking back `resource.share_queue_revoked`.

The permission-scope patch accepts `permissionScopeId` and
`expectedVersion`. Setting the scope to the object's own ID stops inheritance.
Selecting another scope requires a self-scoped Event in the same workspace and
Share permission on both resources. Stale versions return `version_conflict`.

The session response includes `availableWorkspaces`. It contains the personal
workspace plus workspaces reached through membership or live direct grants,
the current one first and the rest by name. Each carries `personal` (whether
it is the account's own workspace), `ownerDisplayName` (the name of the
account it belongs to: its personal owner, else its creator; null when that
account is gone), and `role` (the role the account holds as a member;
null when the workspace is reached through shares alone). Revoking the last
grant makes that workspace unavailable on the next request.

## Workspaces and members

The web calls a workspace a space. A personal workspace belongs to one
account, its only Owner; a shared workspace has any number of Owners and
always at least one.

| Method   | Path                                  | Behavior                                       |
| -------- | ------------------------------------- | ---------------------------------------------- |
| `POST`   | `/workspaces`                         | Create a shared workspace                      |
| `PATCH`  | `/workspaces/current`                 | Rename the current workspace                   |
| `POST`   | `/workspaces/current/leave`           | Leave the current workspace                    |
| `GET`    | `/workspaces/current/members`         | List the current workspace's members           |
| `POST`   | `/workspaces/current/members`         | Add a friend as a member, or change their role |
| `PATCH`  | `/workspaces/current/members/:userId` | Change a member's role                         |
| `DELETE` | `/workspaces/current/members/:userId` | Remove a member                                |

`POST /workspaces` takes `{ displayName }` (trimmed, 1 to 80 characters)
and returns the new workspace as `availableWorkspaces` lists it, with the
caller as its Owner (HTTP 201). An Owner renames a shared workspace with
`PATCH /workspaces/current` and the same body; a personal workspace keeps
its name (HTTP 400).

Any member reads the list: `{ items }` of `{ userId, displayName, email,
role, personal, friendId, joinedAt }`, the personal owner first, then by
name; `friendId` is the caller's accepted connection to that member when
they are friends. An Owner adds a friend with `{ friendId, role }` (`owner`,
`editor`, or `viewer`); a friend who already is a member takes the new role.
An Owner changes any member's role with `{ role }` on
`PATCH /workspaces/current/members/:userId`. A personal workspace has one
Owner: making anyone else its Owner, or changing its owner's role, is HTTP 400. Changing the last Owner of a shared workspace to another role is
`member_conflict` (HTTP 409). An Owner removes any member but the personal
owner and themselves (HTTP 400); a member's direct grants in the workspace
stay. Any member leaves with `POST /workspaces/current/leave`, which returns
`{ userId, left: true }`; the personal owner cannot leave (HTTP 400), and
the last Owner of a shared workspace makes another member an Owner first
(`member_conflict`, HTTP 409). A caller who is not an Owner, or not a
member, gets `resource_unavailable` (HTTP 404).

Each change locks the workspace first, so changes to one workspace's members
run one at a time. They write `workspace.created`, `workspace.renamed`,
`workspace.member_added`, `workspace.member_role_changed`,
`workspace.member_removed`, and `workspace.member_left`. Both backends apply
the same rules (`chronelle_workspace_create`, `_update`, `_member_add`,
`_member_role`, `_member_remove`, and `chronelle_workspace_leave`, migration
0072, on the rpc path; the readiness check requires them).

## Mutation contract

Each mutation validates input, authenticates the caller, authorizes the
resource, checks an expected version where applicable, writes inside a
transaction, and appends an audit event in that transaction. File transfer
authorization and consumption are also audited mutations. Missing and
unauthorized protected resources both return `resource_unavailable` with HTTP 404. Sharing writes `resource.shared`, revocation writes
`resource.share_revoked`, and scope changes write
`object.permission_scope_updated`.
