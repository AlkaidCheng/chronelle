# Event-planning API

The API accepts JSON and returns JSON under `/api`. Protected routes require a
development or production-provider bearer token. Send `x-workspace-id` when
operating outside the identity's personal workspace.

## Canonical objects

| Method   | Path                             | Behavior                            |
| -------- | -------------------------------- | ----------------------------------- |
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

## Mutation contract

Each mutation validates input, authenticates the caller, authorizes the
resource, checks an expected version where applicable, writes inside a
transaction, and appends one audit event in that transaction. Missing and
unauthorized protected resources both return `resource_unavailable` with HTTP 404.
