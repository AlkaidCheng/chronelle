# Event-planning API

## Object history

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

The API accepts JSON and returns JSON under `/api`. Protected routes require a
development or production-provider bearer token. Send `x-workspace-id` when
operating outside the identity's personal workspace.

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
response contains compact canonical object fields and no pre-authorization
total.

PostgreSQL full-text search selects active candidates only in the request
workspace. Each candidate then passes through
`can(principal, view, resource)` before it can enter the response. The current
V1A candidate window is 500 matches; pagination and richer structured filters
are deferred.

## Relationships

| Method   | Path                     | Behavior                             |
| -------- | ------------------------ | ------------------------------------ |
| `POST`   | `/objects/:id/relations` | Relate the source object to a target |
| `GET`    | `/objects/:id/relations` | List visible active relationships    |
| `DELETE` | `/relations/:id`         | Soft-delete only the relationship    |

The create body contains `relationType`, `targetObjectId`, and optional
`metadata`. The initial vocabulary is `includes`, `reminds_about`,
`attached_to`, and `related_to`. Endpoint-type compatibility is enforced in
the domain service. Relationships provide context but never permission.

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
