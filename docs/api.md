# Event-planning API

Most `/api` routes accept and return JSON; document transfers carry file bytes.
Protected routes require a development or production-provider bearer token.
Send `x-workspace-id` when operating outside the identity's personal workspace.

Protected database reads evaluate permissions and assemble data in the same
snapshot. A read in progress may finish with the earlier authorized version
after a concurrent revocation, but cannot combine that access with later private
content. Subsequent reads use current policy; separate requests are not a shared
snapshot. Response schemas and mutation/version preconditions are unchanged.
See [Consistent reads](permissions.md#consistent-reads).

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

List responses use `items` and `nextBeforeId`; send the latter as `beforeId`
to continue. Trash additionally accepts exact `scopeId`. A preview does not
reserve a version or grant permission for a later mutation. Both recovery POST
bodies contain only `{ expectedVersion }`.
See [Recovery](recovery.md) for authorization, pagination, and rollout semantics.

## Canonical objects

| Method   | Path                             | Behavior                            |
| -------- | -------------------------------- | ----------------------------------- |
| `GET`    | `/events`                        | List visible root Events            |
| `POST`   | `/events`                        | Create an Event                     |
| `POST`   | `/tasks`                         | Create a Task                       |
| `POST`   | `/expenses`                      | Create an Expense                   |
| `POST`   | `/reminders`                     | Create a Reminder                   |
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

The Event collection query examines self-scoped planning roots in the active
workspace and applies the same `view` authorization decision to every candidate
before returning it. Directly shared Events can appear without workspace
membership; child schedule items, unrelated Events, and soft-deleted Events are
omitted.

## Search

| Method | Path      | Behavior                                   |
| ------ | --------- | ------------------------------------------ |
| `GET`  | `/search` | Search authorized active canonical objects |

`GET /search` requires a `query` of 2-120 characters containing at least one
letter or number. `objectType` may select `event`, `task`, `expense`,
`reminder`, or `document`; `limit` defaults to 20 and is capped at 50. The
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

## Event projections

| Method | Path                    | Result                                     |
| ------ | ----------------------- | ------------------------------------------ |
| `GET`  | `/events/:id/detail`    | Event plus related typed collections       |
| `GET`  | `/events/:id/todos`     | Included Tasks ordered by due time         |
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
