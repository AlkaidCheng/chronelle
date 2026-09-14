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

Audit does not: the gateway path has no transactions and exposes no server-side
functions, so an audit event and revision snapshot can only follow an update as
separate requests, leaving an unaudited change observable if the process fails
in between. By this phase's own rule, single-object writes stay on PostgreSQL.
The only route that would satisfy the gate is a database-side mechanism applied
as a migration, for example triggers on the typed tables that append the audit
event and revision from context carried in the updated row; that is a separate
design with its own review, not an adapter change.

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

R1 and the version half of R2 have real-gateway evidence. No write repository
should be added until the audit half is resolved. The next step is a design
record, not code: decide whether a database-side audit and revision mechanism
(triggers applied by migration, with actor and request context carried in the
written row) is acceptable for the CloudBase deployment, or whether all
mutations remain on a PostgreSQL TCP route (Phase 7). Either answer is a
deployment decision that the operation matrix must record before Phase 3
continues.

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
