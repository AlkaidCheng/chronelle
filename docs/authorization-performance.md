# Authorization performance

## Workload and method

The authorization integration fixture creates one workspace, one shared Event
scope, a Viewer grant, and 1, 100, or 1,000 inheriting objects. Measurements use
real PostgreSQL 17, a read-only repeatable-read transaction, and a fixed grant
evaluation time within each transaction. Each reported latency is the median
of three measured runs after one warm-up. Fixture creation, transaction setup,
and teardown are excluded; evaluating and checking every result is included.
Drizzle's query logger counts executed statements without logging parameters.

The baseline was measured against commit `b09ea83` using sequential `can()`
calls. The batch measurements below describe the joined role lookup accepted
at `6f1a978`, calling `canMany()` once with the same resource set.
These are local integration measurements, not production throughput or an SLA.

| Objects | Baseline policy queries | Batch policy queries | Baseline median | Batch median |
| ------: | ----------------------: | -------------------: | --------------: | -----------: |
|       1 |                       3 |                    1 |         1.42 ms |      1.24 ms |
|     100 |                     300 |                    1 |        64.07 ms |      2.51 ms |
|   1,000 |                   3,000 |                    1 |       621.74 ms |     12.87 ms |

At 1,001 objects, the batch fixture executes two policy statements (14.18 ms
median). Larger inputs are chunked sequentially; no per-resource asynchronous
fan-out is used. Single-resource checks use the same query and role matrix.

With shared role-query definitions used by both batch joins and scalar search
predicates, a subsequent run measured 1.32/3.14/13.83 ms at 1/100/1,000 objects
and 16.14 ms at 1,001 objects. Statement counts remain 1/1/1/2. These small
timing differences are not a claim of a batch latency improvement.

## Read-snapshot cache A/B

Repeated decisions about the same canonical object within one read boundary
reuse its role lookup. The cache belongs to the read-only repeatable-read
transaction and is discarded with that transaction. Write transactions use the
uncached store so a later decision can observe earlier writes in the same
transaction.

The paired fixture calls `can(principal, "view", resource)` followed by
`allowedActions(principal, resource)`, matching the duplicate role lookup in an
object access read. Its uncached control uses `DrizzleAuthorizationStore`
directly. Its treatment uses the cache through the production
`withReadAuthorization` boundary. Both variants run against the same PostgreSQL
17 fixture, their order alternates within every pair, and transaction setup is
outside the timer. Each of three independent runs used 10 warm-up pairs and 50
measured pairs. Query counts are asserted; timings are reported without a
pass/fail threshold.

| Variant             | Policy statements |   Median range |      p95 range |
| ------------------- | ----------------: | -------------: | -------------: |
| Control             |                 2 | 1.835-2.004 ms | 2.595-3.548 ms |
| Read-snapshot cache |                 1 | 0.971-1.035 ms | 1.208-1.632 ms |

The treatment removed one of two policy statements. Across the three runs its
median was 47-49% lower and its p95 was 52-55% lower. These are local paired
measurements of the policy decision, not endpoint latency, production
throughput, or an SLA.

Entries are partitioned by principal, workspace, evaluation instant, and
resource. Unavailable resources are cached as empty results. Concurrent checks
share an in-flight lookup, while a failed lookup is evicted so the next check
retries storage. No entry survives the authorization snapshot, and CloudBase
authorization-bearing functions are unchanged.

Run the reproducible policy fixture against the configured test database:

```sh
pnpm --filter @livtales/authorization test
pnpm --filter @livtales/authorization exec vitest run test/batch-authorization.integration.test.ts --reporter=verbose
```

## Retrieval budgets

Object-model integration tests exercise 1, 100, 1,000, and 1,001 related Events
plus one inaccessible self-scoped Event. They assert query counts and canonical
IDs for collection loading, Event detail, search, and active relations. Counts
below include the one statement configuring the read snapshot, but not driver
transaction control.

- Loading `N` visible objects: `1 + 2 * ceil(N / 1000)` statements. An empty
  input returns immediately without opening a transaction.
- Event detail with `N` visible children and one hidden child, no attachments:
  `5 + ceil((N + 1) / 1000) + ceil(N / 1000)` statements.
- Active relation page: three statements (snapshot setup, starting-object
  authorization, visible links), fetching at most `limit + 1` rows. The default
  response includes 20 links, with a continuation, instead of the entire list.
  The shared View predicate checks opposite endpoints in a bounded lateral
  lookup; no second application-side authorization pass is needed.
- Search: two statements (snapshot setup and one visibility-filtered query),
  returning at most the requested page size plus one visible row. The
  sparse-access fixture places 550 private matches before shared matches.
- Root Event page: three statements (snapshot setup, authorized positions,
  bounded typed-state hydration), or two for an empty page. Fixtures with
  1, 100, 1,000, and 1,001 children made self-scoped retain this budget. At
  1,003 visible roots, a default read hydrates 20 rather than all 1,003 records.
  This compares one bounded page with the former complete response, not the
  cost of enumerating the entire collection.

Role queries return at most one row per requested object, using existing unique
membership and grant constraints. Only authorized IDs proceed to typed-state
loading. Mixed-workspace, duplicate, missing, expired, and deleted references
are tested alongside direct, inherited, membership, and recovery access.

## Limits

Current role lookup uses shared queries for membership, direct, and inherited
roles. Batch evaluation joins them; search and Event pages use their scalar expressions.
This avoids a second workspace-wide object scan in collection predicates;
query-count budgets are unchanged for other retrieval paths.

Batching bounds IDs and parameters per statement, not total response size.
Returned state still uses memory proportional to visible objects, and a large
read holds its snapshot connection across all chunks. Search limits returned
rows after authorization, not the total database work needed to find and rank
matches. The read-snapshot cache retains role arrays only for canonical IDs
checked by that transaction; no result crosses a transaction or request. No
new index or migration is introduced.
Event pages likewise bound hydration and response rows, not candidate filtering
or sorting. Active relation pages bound transfer and response memory, not all
candidate scanning or sorting. Database statistics still affect lookup plans;
the endpoint boundary avoids repeated workspace-wide policy evaluation from a
flattened join. Removed-link scans remain iterative. Focused projection queries
and recovery-list bounds require separate work.

## CloudBase session resolution

CloudBase resolves the authenticated identity and its selected workspace through
`chronelle_identity_session_resolve` (migration `0066`). It reads the user,
personal workspace, optional routed object, membership, and active grants in
one database snapshot. Only the resolved user and workspace cross the gateway.

A normal password-session request now needs two sequential gateway calls before
resource-specific authorization: credential/session resolution and
identity/workspace resolution, down from five for a workspace member. Shared
object routing uses the same two-call budget, without additional grant or
workspace table requests. These are transport counts, not production latency
measurements.

No CloudBase authorization result is cached. Every request rechecks session
revocation, membership, grant expiry, and deletion eligibility. Narrowed grants
admit the workspace without granting unrestricted access to its objects or
views; their existing resource-level checks remain mandatory. Provider
authentication stays separate from workspace authorization.

Apply migration `0066` before deploying the API. CloudBase startup readiness
requires the new function; the migration is additive and older API versions can
continue using table reads. The identity-store integration fixture asserts the
two-call HTTP request budget, immediate revocation, and parity with PostgreSQL
for workspace selection and grant access.
