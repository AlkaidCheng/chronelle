# CloudBase operation matrix

This matrix is the migration inventory for the current API. It records the
consistency and security contract that must remain true when an operation is
served by a different backend. It is intentionally conservative: an operation
marked PostgreSQL-only must not be moved to the CloudBase RDB gateway merely
because its SQL can be expressed as a read or write request.

## Contract vocabulary

- **Read** means no canonical state changes and no audit event is required.
- **CAS** means an update must include the current object `version` and reject
  a stale version.
- **Audit** means the mutation and its audit event are committed as one logical
  operation.
- **Cross-object** means the operation changes more than one canonical object,
  relation, grant, revision, or recovery record.
- **CloudBase candidate** means a repository boundary exists or can be added
  without changing the API response contract. It is not approval to switch the
  operation in production.

## Read operations

| API surface                                                                | Service boundary                 | Contract                                                                                | Current route                                                       | CloudBase status                                                        |
| -------------------------------------------------------------------------- | -------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Event list                                                                 | `EventReadRepository`            | Workspace-scoped, permission-filtered, deleted rows excluded, deterministic cursor      | `GET /api/events`                                                   | Candidate; adapter and opt-in runtime flag exist                        |
| Calendar projection                                                        | `CalendarReadRepository`         | Canonical event IDs, active `includes` relations, inherited grants, date ordering       | `GET /api/events/:id/calendar`                                      | Candidate; adapter and opt-in runtime flag exist                        |
| Event detail                                                               | `EventPlanningProjectionService` | Root authorization plus child relations, attached documents, and projection consistency | `GET /api/events/:id/detail`                                        | PostgreSQL; relation/document read contract is not yet equivalent       |
| To-do, timeline, itinerary, expense, reminder projections                  | `EventPlanningProjectionService` | Shared canonical objects and relation visibility                                        | `GET /api/events/:id/{todos,timeline,itinerary,expenses,reminders}` | PostgreSQL; keep until each projection has a tested repository boundary |
| Object search                                                              | `SearchReadRepository`           | Full-text ranking, cursor envelope, workspace and permission predicate                  | `GET /api/search`                                                   | Candidate; adapter calls `chronelle_object_search` (migration 0021)     |
| Object, relation, sharing, revision, recovery, and storage inventory reads | Corresponding services           | Authorization and workspace isolation                                                   | Various `GET` routes                                                | PostgreSQL until a per-service contract is documented and tested        |

Read adapters must return canonical IDs and the same externally visible
resource shape. A gateway API key does not authorize a user; the adapter must
still evaluate the Chronelle principal, workspace, grant expiry, inheritance,
and deletion rules.

## Mutations

| Operation family                     | Examples                                               | Required guarantees                                                                                    | Backend decision                                                                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Event create                         | `POST /api/events`, linked Event creation              | Authorization, typed validation, audit event, revision, generated identity                             | `EventWriteRepository`; CloudBase adapter calls `chronelle_event_create` (migrations 0012/0013) behind `CLOUDBASE_WRITES_ENABLED`                                                                                     |
| Event update                         | `PATCH /api/events/:id`                                | Authorization, CAS on `version`, merged-state validation, audit, revision                              | `EventWriteRepository`; CloudBase adapter calls `chronelle_event_update` (migrations 0012/0013) behind `CLOUDBASE_WRITES_ENABLED`                                                                                     |
| Task create                          | `POST /api/tasks`                                      | Authorization, typed validation, audit event, revision, generated identity                             | `TaskWriteRepository`; CloudBase adapter calls `chronelle_task_create` (migration 0013) behind `CLOUDBASE_WRITES_ENABLED`                                                                                             |
| Task update                          | `PATCH /api/tasks/:id`                                 | Authorization, CAS on `version`, merged-state validation, audit, revision                              | `TaskWriteRepository`; CloudBase adapter calls `chronelle_task_update` (migration 0013) behind `CLOUDBASE_WRITES_ENABLED`                                                                                             |
| Expense create                       | `POST /api/expenses`                                   | Authorization, typed validation, audit event, revision, generated identity                             | `ExpenseWriteRepository`; CloudBase adapter calls `chronelle_expense_create` (migration 0014) behind `CLOUDBASE_WRITES_ENABLED`                                                                                       |
| Expense update                       | `PATCH /api/expenses/:id`                              | Authorization, CAS on `version`, merged-state validation, audit, revision                              | `ExpenseWriteRepository`; CloudBase adapter calls `chronelle_expense_update` (migration 0014) behind `CLOUDBASE_WRITES_ENABLED`                                                                                       |
| Reminder create                      | `POST /api/reminders`                                  | Authorization, typed validation, audit event, revision, generated identity                             | `ReminderWriteRepository`; CloudBase adapter calls `chronelle_reminder_create` (migration 0015) behind `CLOUDBASE_WRITES_ENABLED`                                                                                     |
| Reminder update                      | `PATCH /api/reminders/:id`                             | Authorization, CAS on `version`, merged-state validation, audit, revision                              | `ReminderWriteRepository`; CloudBase adapter calls `chronelle_reminder_update` (migration 0015) behind `CLOUDBASE_WRITES_ENABLED`                                                                                     |
| Linked creation                      | `POST /api/events/:id/resources`                       | Authorization, self-scoped context, typed create, `includes` relation, both audits, idempotent command | `EventContextWriteRepository`; CloudBase adapter calls `chronelle_event_context_create` (migration 0016) behind `CLOUDBASE_WRITES_ENABLED`                                                                            |
| Soft deletion and restoration        | Object delete, trash recovery, revision restore        | CAS, audit, object/revision consistency, recoverability                                                | `ObjectLifecycleWriteRepository`; CloudBase adapter calls `chronelle_object_delete` and `chronelle_object_recover` (migration 0018) and `chronelle_object_restore` (migration 0019) behind `CLOUDBASE_WRITES_ENABLED` |
| Relationship changes                 | Include, attach, paid-for, and removed-link relations  | Both endpoints remain independent objects; relation audit and authorization                            | `RelationWriteRepository`; CloudBase adapter calls `chronelle_relation_create` (0016) and `chronelle_relation_lifecycle` (0017) behind `CLOUDBASE_WRITES_ENABLED`                                                     |
| Sharing and permission-scope changes | Grant, revoke, stop inheritance                        | Canonical scope, inherited access, audit, workspace isolation                                          | PostgreSQL; cross-object                                                                                                                                                                                              |
| Event-page layout changes            | Add/remove/reorder panels and restore history          | Layout versioning, audit, restoration, optimistic concurrency                                          | PostgreSQL; cross-object                                                                                                                                                                                              |
| Attachments                          | Upload authorization, finalize, download authorization | Private storage, parent authorization, short-lived transfer, audit                                     | PostgreSQL plus storage provider                                                                                                                                                                                      |
| Undo/redo and commands               | Execute, undo, redo                                    | Durable command state, inverse operation, atomic audit and recovery                                    | PostgreSQL; transaction-required                                                                                                                                                                                      |

The CloudBase RDB transport advertises no transaction or native TCP
capability for table writes. Mutations move only as PostgreSQL functions
called through the gateway's rpc route, where one call is one transaction, and
only after a differential test proves the function leaves the same resource,
audit, and revision rows as the Drizzle/PostgreSQL service. The Drizzle path
remains a first-class backend that any TCP deployment uses unchanged.

## Gate evidence

Before changing a row in this matrix, add evidence at the same scope as the
operation:

1. Contract tests compare canonical IDs, relation sets, deletion filtering,
   and permission outcomes with the PostgreSQL implementation.
2. Stale-version tests prove a conflict rather than a silent overwrite.
3. Audit assertions prove the event is present for every mutation.
4. Injected-failure tests prove that cross-object operations do not expose
   partial state.
5. Deployment checks prove that credentials remain server-only and private
   document URLs remain authorized and short-lived.

The current evidence satisfies only the event-list and calendar read rows in a
local double plus the opt-in real-gateway harness. The harness still requires
staging workspace, user, and event identifiers before it can provide real
CloudBase evidence.
