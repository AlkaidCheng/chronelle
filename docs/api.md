# Event-planning API

Most `/api` routes accept and return JSON; document transfers carry file bytes.
Protected routes require a bearer token issued by a sign-in. Send
`x-workspace-id` when operating outside the identity's personal workspace.

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
and the workspaces the user may enter.

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

`POST /api/auth/sign-up` with `{ displayName, email, password }` (password
10 to 256 characters) records an unverified account and emails a six-digit
code; the response is 202 `{ accepted: true }`, or 409 `email_taken`.
`POST /api/auth/verify-email` with `{ email, code }` verifies the address
and signs the account in with the sign-in response above; a wrong, expired,
or exhausted code (five wrong guesses) is 400 `verification_invalid`, and
`POST /api/auth/verify-email/resend` with `{ email }` issues a fresh code
(202 whether or not the address has an unverified account). Codes are
issued at most once a minute and five times an hour per account and
purpose; a request inside those limits is accepted but sends nothing, so
the answer never reveals whether the address has an account.

`POST /api/auth/sign-in` with `{ email, password }` returns the sign-in
response, 401 `invalid_credentials` for an unknown address or wrong
password, 403 `email_unverified` for an account whose address is not yet
verified (a fresh code is emailed), or 429 `credential_locked` after ten
wrong passwords, for fifteen minutes.

`POST /api/auth/password-reset` with `{ email }` emails a reset code when
the address has an account and answers 202 either way.
`POST /api/auth/password-reset/confirm` with `{ email, code, password }`
replaces the password, verifies the address if it was not, ends every
session of the user, and signs the caller in. Emails are compared after
trimming and lower-casing.

## HTTP limits and errors

Ordinary request bodies are limited to 1 MiB. Only
`PUT /api/document-transfers/upload/:token` permits up to 25 MiB. The API checks
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

`GET /api/commands` reads the current user's workspace stack. `POST /api/commands`
applies a bounded batch of Event/Task content edits; `POST /api/commands/undo` and
`POST /api/commands/redo` transition its pinned head. Every mutation requires an
operation ID and expected stack version. See [Commands](commands.md) for typed
examples, object preconditions, idempotency, and explicit eligibility limits.

## Event collection

`GET /api/events` returns `{ items, nextCursor, asOf }`. It lists active,
self-scoped Events in the selected workspace with current View permission.
Scoped itinerary Events remain in their parent's projections. Permission and
content are read in one snapshot; private candidates cannot consume the limit.

| Parameter | Values and default                                          |
| --------- | ----------------------------------------------------------- |
| `limit`   | 1-50, default 20                                            |
| `query`   | Trimmed name substring, up to 240 characters, default empty |
| `filter`  | `all` (default), `upcoming`, `past`, or `unscheduled`       |
| `sort`    | `date` (default), `name`, or `updated`                      |
| `cursor`  | Previous `nextCursor`; omit to start a new collection read  |

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
The limit is 1-100. No total counts, security metadata, or private storage keys
are returned. See [Object revisions](revisions.md) for authorization semantics.

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
| `GET`    | `/{type}/:id`                    | Read the requested typed object     |
| `PATCH`  | `/{type}/:id`                    | Update with `expectedVersion`       |
| `GET`    | `/objects/:id`                   | Read any supported canonical object |
| `DELETE` | `/objects/:id?expectedVersion=N` | Soft-delete an object               |

Create input may include `permissionScopeId`. When omitted, the object owns its
permission scope. A child can inherit from exactly one object in the same
workspace. The caller must be allowed to edit that scope.

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
detaches a subtask. Trashing a parent leaves its subtasks live; they show on
their own until the parent is restored. Deploy migration 0035 before this API.

## People

A Person is a canonical object like the others: someone the workspace keeps
track of, with the common `displayName` and `customProperties` for whatever
else matters (a phone, a birthday), an optional `email` (trimmed, null when
absent), and an optional `userId` linking the Person to a workspace member's
account. `userId` must name a member of the workspace, of any role, and each
account belongs to at most one Person of the workspace; a violation returns
HTTP 400 with `userId must name a member of this workspace.` or
`userId is already linked to another person.`. `null` clears either field on
an update; absent leaves it unchanged. People are created, read (`GET
/persons/:id`), updated, trashed, recovered, searched (`objectType=person`),
and versioned like every object; a revision restore brings back the email
but never the linked account.

`GET /persons` lists every live Person the caller may view in the active
workspace, ordered by name without regard to case, then ID; `query` matches
the name and `limit` (1-200, default 100) bounds the page. The response is
`{ items }`; there is no cursor yet, so a query narrows a large workspace.
Deploy migration 0037 before this API and reapply the runtime role grants,
which cover the new table.

A Task may be assigned to one Person through `assigneeId` on create and
update (`null` clears it; absent leaves it unchanged); the id must name a live
Person of the workspace, or the request returns HTTP 400 with
`assigneeId must name a live person in this workspace.`. Responses carry
`assigneeId`, null when unassigned; the Person's name comes from the People
collection. `GET /tasks?assignee=<personId>` lists only the tasks assigned
to that Person. A Person moved to Trash keeps their tasks; the assignee is not
part of a revision's restorable content. Deploy migration 0038 before this
API.

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
last, then name and ID), `name`, or `updated`; `query` matches the name;
`limit` is 1-50 (default 20). Pages carry `nextCursor` and `asOf` like the
Event collection, and a cursor is bound to its caller and query: reusing one
with another `filter`, `sort`, `query`, `label`, `assignee`, or user returns
HTTP 400. Each page
also carries `contexts`, a map from Task ID to `{ eventId, displayName }` for
the Event that includes the Task, present only when the caller may view that
Event (the earliest inclusion when several Events include one Task); a Task
held through a direct grant inside an Event the caller cannot see has no
entry. `progress` maps each listed parent Task ID to `{ done, total }` over
its live, viewable subtasks, and `parents` maps each listed subtask ID to
`{ taskId, displayName }` of its parent when the caller may view it. The
typed client exposes `listTasks(input)`.

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

## Event projections

The typed client can read just the canonical Event for a header or editor:

```typescript
const event = await client.getEvent(eventId);
```

This uses the existing `GET /api/events/:id` route and validates its response.
It does not load related collections; `getEventDetail(eventId)` provides those
when a view needs them.

| Method | Path                    | Result                                     |
| ------ | ----------------------- | ------------------------------------------ |
| `GET`  | `/events/:id/detail`    | Event plus related typed collections       |
| `GET`  | `/events/:id/todos`     | Included Tasks ordered by due date or time |
| `GET`  | `/events/:id/calendar`  | Included scheduled Events                  |
| `GET`  | `/events/:id/timeline`  | Dated included resources in time order     |
| `GET`  | `/events/:id/itinerary` | Included scheduled Events                  |
| `GET`  | `/events/:id/expenses`  | Included Expenses in reverse time order    |
| `GET`  | `/events/:id/reminders` | Included Reminders ordered by trigger time |

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

| Method | Path                                  | Behavior                              |
| ------ | ------------------------------------- | ------------------------------------- |
| `POST` | `/documents/upload-url`               | Authorize one parent-bound upload     |
| `PUT`  | `/document-transfers/upload/:token`   | Transfer the authorized private bytes |
| `POST` | `/documents`                          | Finalize one canonical Document       |
| `GET`  | `/objects/:id/documents`              | List visible attached Documents       |
| `GET`  | `/documents/:id/download-url`         | Authorize one private download        |
| `GET`  | `/document-transfers/download/:token` | Download authorized private bytes     |

Upload authorization accepts `parentObjectId`, `originalFilename`, `mimeType`,
`sizeBytes`, and a lowercase SHA-256 checksum. The parent must be an Event,
Task, or Expense that the caller can edit. Files are limited to 25 MiB. The
returned PUT authorization is short-lived and consumed once; the transfer must
match the declared size and checksum. `POST /documents` then accepts its
`uploadAuthorizationId` and creates the canonical Document plus `attached_to`
relationship in one audited transaction.

The attachment list returns the relation ID, public Document metadata, and a
generic `lockedAttachmentCount`. Delete that relation through the normal
relationship endpoint to unlink the file without deleting its Document.

Download authorization requires View on the Document and returns a short-lived
one-time GET authorization. The local adapter rechecks permission when the
transfer is consumed and responds with `Cache-Control: private, no-store`.
Neither Document responses nor transfer responses expose a storage key or
permanent public URL.

## Access and sharing

| Method   | Path                            | Behavior                              |
| -------- | ------------------------------- | ------------------------------------- |
| `GET`    | `/objects/:id/access`           | List the caller's allowed actions     |
| `GET`    | `/objects/:id/shares`           | List active direct grants             |
| `POST`   | `/shares`                       | Create or replace a direct user grant |
| `DELETE` | `/shares/:id`                   | Revoke a direct grant                 |
| `PATCH`  | `/objects/:id/permission-scope` | Change inheritance with a version     |

`POST /shares` accepts `resourceId`, `principalEmail`, and an Owner, Editor, or
Viewer `role`. The recipient must already have a Chronelle identity. Repeating
the request for the same resource and user replaces the active role rather
than creating a duplicate grant. Only callers with Share permission can read
or mutate grants; user lookup happens after that authorization check.

The permission-scope patch accepts `permissionScopeId` and
`expectedVersion`. Setting the scope to the object's own ID stops inheritance.
Selecting another scope requires a self-scoped Event in the same workspace and
Share permission on both resources. Stale versions return `version_conflict`.

The session response includes `availableWorkspaces`. It contains the personal
workspace plus workspaces reached through live direct grants. Revoking the last
grant makes that workspace unavailable on the next request.

## Mutation contract

Each mutation validates input, authenticates the caller, authorizes the
resource, checks an expected version where applicable, writes inside a
transaction, and appends an audit event in that transaction. File transfer
authorization and consumption are also audited mutations. Missing and
unauthorized protected resources both return `resource_unavailable` with HTTP 404. Sharing writes `resource.shared`, revocation writes
`resource.share_revoked`, and scope changes write
`object.permission_scope_updated`.
