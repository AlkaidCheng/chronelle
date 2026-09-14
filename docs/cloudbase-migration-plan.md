# CloudBase migration plan

## Goal

Make CloudBase a viable deployment backend for Chronelle without duplicating
canonical business data or weakening the guarantees already provided by the
PostgreSQL implementation.

The migration is staged. Local development and the current production-shaped
API continue to use PostgreSQL through Drizzle. CloudBase's shared PostgreSQL
gateway is introduced behind a small transport boundary for work that does not
require native TCP or database transactions.

## Non-negotiable invariants

- A canonical object keeps one identity regardless of backend or projection.
- Workspace isolation and centralized authorization remain application rules;
  CloudBase credentials never become a substitute for Chronelle authorization.
- Every mutation remains auditable.
- Optimistic concurrency must reject stale writes rather than silently overwrite.
- Recovery, undo/redo, and soft deletion must remain atomic from the caller's
  perspective.
- The PostgreSQL/Drizzle adapter remains supported for local development and a
  future dedicated PostgreSQL deployment.

## Current state

Completed in PR #78:

- CloudBase gateway connectivity probe using a short-lived server-side key.
- `@chronelle/db` CloudBase RDB read transport.
- Dynamic table-name validation and bounded pagination.
- Explicit capability metadata showing that this transport is not a native TCP
  or transaction boundary.
- Existing `connectDatabase(DATABASE_URL)` adapter preserved unchanged.

The API still runs on PostgreSQL. No application feature has been moved to the
CloudBase transport yet.

The event-list read path now has an explicit `EventReadRepository` boundary.
The default `PostgresEventReadRepository` preserves the existing Drizzle query,
authorization filtering, cursor pagination, and response shape. A CloudBase
event repository is intentionally deferred until the gateway can express the
same permission-filtered query contract; the UI and API service do not need to
change when that adapter is added.

The event calendar projection now has a matching `CalendarReadRepository`
boundary. Its PostgreSQL implementation returns the same authorized canonical
events, while the projection service retains scheduling and sorting semantics.

An integration contract fixture compares canonical IDs and calendar ordering
with the actual CloudBase event-list and calendar adapters over an in-memory RDB
fixture client. It deliberately does not claim that the shared gateway has
passed the permission-filtered join gate; that evidence still requires a real
CloudBase run against staging.

The CloudBase RDB transport now exposes validated equality, null, pattern, and
membership filters plus deterministic ordering. These are transport primitives
only; application repositories still own authorization and must not treat an
API key as a substitute for Chronelle permission evaluation.

The first real application adapter is now available for calendar projections:
`CloudBaseCalendarReadRepository` loads the canonical event, active `includes`
relations, workspace membership, and user grants through the RDB transport,
then applies the same workspace, deleted-object, inherited-scope, and grant
expiry rules before returning resources. It is read-only and deliberately not
wired into the default API runtime yet; the adapter still needs a staging
against the real CloudBase schema and gateway response shapes before it can
replace the PostgreSQL repository.

The event-list read path now has the same CloudBase boundary. Its adapter uses
the shared visibility and row-decoding helpers, preserves search, period
filters, deterministic sort modes, and the existing cursor envelope, and
returns an empty page when the principal has no visible grants. It remains an
opt-in adapter until a real-gateway differential run proves date encoding,
pagination, and permission filtering against CloudBase rather than a local
double.

An opt-in `pnpm cloudbase:read-contract` harness now exercises both adapters
against a real CloudBase environment using pre-existing staging identifiers. It
is deliberately read-only: it checks canonical IDs, calendar projection
membership, cursor-page non-overlap, workspace and deletion invariants, and an
optional negative authorization case. A passing harness is staging evidence for
R1, not a license to switch the production backend or migrate mutations.

The connectivity preflight uses the shared request-timeout budget and reports
expired or unauthorized keys without exposing response payloads. This makes a
failed staging prerequisite actionable before the read-contract harness runs.
The probe and read-contract harness share the same local expiry and timeout
validation, so both staging entry points fail consistently before querying
fixtures.

The API now has an explicit `CLOUDBASE_READS_ENABLED` deployment flag. When
enabled, only event-list and calendar repository dependencies switch to the
CloudBase adapters; PostgreSQL remains mandatory for mutations, detail
hydration, audit events, recovery, sharing, and transaction-heavy workflows.
The flag defaults to false so a connectivity probe cannot silently change the
runtime consistency model.

When the flag is enabled, API startup rejects expired JWT-shaped CloudBase keys
before constructing the RDB client. This keeps deployment failures close to
their configuration cause; opaque provider keys remain accepted because their
expiry is not locally inspectable.

The first read-contract run against the real staging gateway showed that the
transport treated the gateway's `error: null` success shape as a failure, so
every successful query threw. The transport now accepts that shape, and the
staging commands load the root `.env` and exit once their report is written.
The same run recorded that the CloudBase event list returned child events that
inherit a root Event's permission scope, which the PostgreSQL list excludes.
The adapter now lists root Events only, the differential test serves the
CloudBase double from the PostgreSQL rows it seeds (inheriting and private
children, a deleted Event, a member and a grant-only viewer), and a configured
harness expectation must match the returned set exactly.

R1 evidence now exists for a synthetic staging fixture: with a workspace owner
and a grant-only viewer, the event pages, calendar membership and order,
workspace isolation, deleted-row exclusion, private-child exclusion, and the
denied-event case all match PostgreSQL through the real gateway. Cursor paging
was exercised on the same fixture with page sizes of one and two, walking every
page with no overlap and the same collection; the differential test also
compares both backends' page sequences for every sort mode. Each gateway query
took roughly 1–2 seconds from the operator's location, which is the first R5
latency input. Enabling `CLOUDBASE_READS_ENABLED` remains a deployment decision
under Phase 6, not a consequence of this run.

The rpc route resolves the audit gap: functions called through the gateway run
as one transaction, and the probe functions reproduce the service's audit and
revision rows. See Phase 3 for the evidence and the R3 decision.

The operation-by-operation consistency inventory is maintained in
[`docs/cloudbase-operation-matrix.md`](cloudbase-operation-matrix.md). It is
the review checklist for deciding whether a future repository may leave the
PostgreSQL path.

## Migration phases

### Phase 1 — Contract and schema inventory

Document every service operation by consistency requirement:

1. read-only projection;
2. single-row write;
3. optimistic-concurrency write;
4. audited multi-table mutation;
5. recovery or command-stack mutation.

Map each operation to its tables, authorization checks, audit events, and
transaction boundary. Add contract tests that can run against both the current
PostgreSQL adapter and a CloudBase test double.

**Exit gate:** no service is migrated until its authorization, version, audit,
and rollback requirements are explicitly listed.

The initial inventory is complete for the current API. The matrix remains a
living gate: new routes must be classified before they receive a CloudBase
adapter.

### Phase 2 — Read path migration

Move low-risk reads behind a repository interface implemented by:

- Drizzle/PostgreSQL for local and TCP deployments;
- CloudBase RDB for HTTPS gateway deployments.

Start with projections that can tolerate independent requests: event lists,
calendar ranges, search suggestions, and read-only detail panels. Keep result
schemas identical so the UI and API-client layers do not know which backend is
in use.

**Exit gate:** differential tests return equivalent canonical IDs, relation
sets, archived/deleted filtering, and permission-filtered results.

### Phase 3 — Safe single-object writes

Add CloudBase repositories for writes that affect one logical object and can
use an explicit compare-and-set predicate on `version`. The repository must
return a conflict when the predicate matches zero rows. Audit records should be
written in the same supported consistency mechanism or the operation remains on
the PostgreSQL path.

**Exit gate:** stale-version tests, authorization tests, and audit assertions
pass against the CloudBase implementation.

**R2 evidence:** the transport now has bounded `insert`, `update`, and
`delete` verbs whose results are the affected rows, so a stale version predicate
reports an empty result. Against the real gateway, `pnpm cloudbase:write-contract`
showed one affected row for a current version, none for a stale one, none for a
predicate naming another workspace, exactly one winner among four concurrent
updates on the same version, and a check-constraint rejection surfaced as a
gateway error with the row unchanged. Version enforcement therefore holds.

Audit atomicity is not available to a client issuing table writes: the SDK's
table path has no transactions, so an audit event and revision snapshot could
only follow an update as separate requests. It is available through the
gateway's rpc route: a PostgreSQL function called as
`POST /v1/rdb/rest/rpc/<function>` with the same server key runs as one
transaction, and a raised exception discards every row it wrote. The rpc probe
in `infrastructure/cloudbase/rpc-probe.sql` implements an audited Event create
and update as functions with the service's authorization, version, audit, and
snapshot rules. Against one PostgreSQL, the differential test shows the
functions leave audit and revision rows identical in shape to the TypeScript
service's. Against the real gateway, `pnpm cloudbase:rpc-contract` showed the
create and update succeeding in one call each, a stale version answered with
HTTP 409, a principal without edit access with 403, a raise after every write
with 500 and no persisted change, and one winner among four concurrent calls on
the same version. Custom `PTxxx` SQLSTATEs map to HTTP statuses on this gateway.

**R3 decision (2026-09-14):** the deployment target stays the shared CloudBase
cluster, which offers no TCP route, and the write path moves to PostgreSQL
functions invoked through rpc. The Drizzle/TypeScript services remain a
first-class, fully tested backend (the one local development, CI, and any
future TCP deployment use unchanged), and every ported family keeps both
implementations behind one repository interface selected by deployment
configuration. The existing integration suites plus a per-family differential
test are the contract both must satisfy; no family ships without one.

**First family (Event create and update):** migration 0012 ships
`chronelle_event_create` and `chronelle_event_update` together with the
serializer, authorization, and state-validation helpers they need.
`EventWriteRepository` is the boundary; `CloudBaseEventWriteRepository` encodes
the service's inputs as JSON and maps the functions' `PT403`/`PT409`/`PT422`
outcomes to the service's error classes, so API responses are unchanged.
`EventPlanningObjectService` delegates to it when
`CLOUDBASE_WRITES_ENABLED=true` (which requires the read client). The
differential test drives both backends through the service against one
PostgreSQL and requires identical resources, audit rows, revision rows, and
errors across timed and date-only Events, scope inheritance, every update
field including clearing, command metadata, nine invalid states, conflict,
missing, forbidden, grant-based edit, and the missing-baseline guard.

**Second family (Task create and update):** migration 0013 factors the
Event functions into a shared core, `chronelle_object_create` and
`chronelle_object_update`, that owns authorization, the `objects` row,
optimistic concurrency, the audit event, and the revision. A family plugs in
through four functions named by object type — `chronelle_<type>_insert`,
`_validate`, `_apply`, and `_serialize` — plus `_rows`, which returns the
canonical and typed rows the adapter decodes. The Event functions keep their
signatures as wrappers over the core, so the Event differential test also
guards the refactor. The TypeScript side mirrors this:
`ObjectWriteRepository<CreateInput, UpdateInput, Resource>` is the boundary for
every family, `CloudBaseObjectWriteRepository` encodes inputs and maps errors
once, and a family adapter such as `CloudBaseTaskWriteRepository` supplies only
its object type and row decoder. `EventPlanningObjectService` takes a map of
family repositories and delegates per family, so each port is a descriptor and
a differential test rather than a new service path. The Task test covers the
default status, the done/completedAt invariant in both directions, every update
field including clearing, command metadata, conflict, missing, forbidden,
type mismatch, grant-based edit, and the missing-baseline guard.

**Third family (Expense create and update):** migration 0014 adds the five
typed functions and `chronelle_assert_expense_state` with the service's
decimal, currency, and instant messages. `amount` is text in both directions:
the function validates the decimal notation before the `numeric(19,4)` cast,
and the serialized snapshot and the returned row carry the column's canonical
text (four decimal places), so the adapter never parses a JSON number and the
resource matches the Drizzle service exactly. The generic adapter now rejects
an invalid `Date` with the service's `<field> must be a valid date.` message
before calling the gateway, which the Expense test covers on the update path.

**Fourth family (Reminder create and update):** migration 0015 completes the
single-object families. `chronelle_assert_reminder_state` requires a valid
`remindAt` and a status from the table's set, so an unknown status is an
invalid state rather than a constraint violation, as for Task. With the four
families behind `CLOUDBASE_WRITES_ENABLED`, the next function is linked
creation, the first cross-object operation.

### Phase 4 — Cross-object mutations and recovery

Do not emulate transactions with optimistic hope. For relations, shares,
expenses, revisions, trash, restore, undo, and redo, choose one of:

- a transaction-capable PostgreSQL TCP deployment;
- a CloudBase-supported server-side transaction primitive;
- an explicit durable workflow with idempotency, compensation, and recovery
  records, reviewed as a separate design.

Until one is proven, these operations stay on the Drizzle/TCP adapter.

**Exit gate:** injected-failure tests prove no partial audit, relation, revision,
or recovery state is externally observable.

### Phase 5 — Identity, authorization, and attachments

Keep CloudBase authentication and API keys behind the existing authentication
and authorization abstractions. Server keys remain server-only. Validate that
workspace isolation, inherited shares, viewer/editor boundaries, and private
document URLs behave identically across deployments.

**Exit gate:** the existing authorization and attachment-security suites pass
without relying on frontend checks.

### Phase 6 — Deployment and operations

- Add an explicit backend mode to deployment configuration.
- Default local development to PostgreSQL.
- Enable CloudBase mode only after its capability checks pass at startup.
- Add metrics for gateway latency, rate limits, rejected conflicts, and partial
  workflow compensation.
- Keep migration and rollback runbooks versioned.

**Exit gate:** staging can be deployed, smoke-tested, rolled back, and audited
without exposing credentials or private attachment URLs.

### Optional Phase 7 — Native TCP deployment

If Chronelle needs full transaction semantics, use a dedicated/private
PostgreSQL route when CloudBase makes one available, or run PostgreSQL as a
separate managed service. The existing schema, SQL migrations, Drizzle models,
and integration tests are deliberately retained for this option.

## Decision gates

| Gate | Question                                         | Required evidence                                 |
| ---- | ------------------------------------------------ | ------------------------------------------------- |
| R1   | Can CloudBase reads match PostgreSQL results?    | Differential projection tests                     |
| R2   | Can single-object writes enforce version checks? | Conflict and audit tests                          |
| R3   | Can multi-table mutations be atomic?             | Transaction or compensation failure tests         |
| R4   | Can private data remain protected?               | Authorization and attachment tests                |
| R5   | Is the operational cost acceptable?              | Staging load, latency, quota, and rollback report |

No phase may silently bypass a failed gate. The fallback is the existing
PostgreSQL adapter.

## Recommended next PR

Port linked creation (`POST /api/events/:id/resources`) as the first
cross-object function: one call creates the typed child on the parent's
scope through the family functions, inserts the `includes` relation with its
version, and writes both audit rows. The differential test compares the full
ledger and an injected failure after the relation insert must leave no
object, relation, audit, or revision row.

### R1 operator checklist

1. Keep a fresh short-lived `CLOUDBASE_APIKEY` in the root `.env`; the staging
   commands read that file and refuse an expired key.
2. Set `CLOUDBASE_CONTRACT_WORKSPACE_ID`, `CLOUDBASE_CONTRACT_USER_ID`, and
   `CLOUDBASE_CONTRACT_EVENT_ID` to existing staging fixtures, plus the exact
   `CLOUDBASE_CONTRACT_EXPECTED_*` sets the PostgreSQL repositories return for
   that principal. Run once as a workspace member and once as a grant-only
   principal with `CLOUDBASE_CONTRACT_DENIED_EVENT_ID` set, and once with
   `CLOUDBASE_CONTRACT_PAGE_LIMIT` small enough to cross a page boundary.
3. Run `pnpm cloudbase:probe`, then `pnpm cloudbase:read-contract`.
4. Attach the JSON output and latency observations to the R1 review before
   enabling `CLOUDBASE_READS_ENABLED`.

The harness reports `queryCount` and `timingMs` for the event pages and calendar
projection so the same run can seed the later R5 latency and quota review.
