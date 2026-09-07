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
calls. The batched workload calls `canMany()` once with the same resource set.
These are local integration measurements, not production throughput or an SLA.

| Objects | Baseline policy queries | Batch policy queries | Baseline median | Batch median |
| ------: | ----------------------: | -------------------: | --------------: | -----------: |
|       1 |                       3 |                    1 |         1.42 ms |      1.24 ms |
|     100 |                     300 |                    1 |        64.07 ms |      2.51 ms |
|   1,000 |                   3,000 |                    1 |       621.74 ms |     12.87 ms |

At 1,001 objects, the batch fixture executes two policy statements (14.18 ms
median). Larger inputs are chunked sequentially; no per-resource asynchronous
fan-out is used. Single-resource checks use the same query and role matrix.

Run the reproducible policy fixture against the configured test database:

```sh
pnpm --filter @chronelle/authorization test
pnpm --filter @chronelle/authorization exec vitest run test/batch-authorization.integration.test.ts --reporter=verbose
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
- Active relations for that Event: `3 + ceil((N + 1) / 1000)` statements.
- Search: three statements for up to the existing 500 candidates.
- Root Event listing: `2 + ceil(C / 1000) + ceil(V / 1000)` statements, where
  `C` is the candidate count and `V` the visible count. An empty candidate set
  requires only snapshot setup and candidate selection.

Role queries return at most one row per requested object, using existing unique
membership and grant constraints. Only authorized IDs proceed to typed-state
loading. Mixed-workspace, duplicate, missing, expired, and deleted references
are tested alongside direct, inherited, membership, and recovery access.

## Limits

Batching bounds IDs and parameters per statement, not total response size.
Returned state still uses memory proportional to visible objects, and a large
read holds its snapshot connection across all chunks. No authorization cache,
new index, migration, REST contract, or pagination behavior is introduced.
Search still limits candidates before visibility filtering. Removed-link scans
remain iterative. Focused projection queries and visibility-aware pagination
require separate work.
