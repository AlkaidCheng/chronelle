# Database storage

## Inspecting the footprint

With `DATABASE_URL` set to a PostgreSQL connection, report table and index sizes:

```sh
pnpm db:footprint
```

The command runs in a read-only transaction and prints aggregate metadata as
JSON. It does not print connection details, object IDs, or record contents.
Byte sizes and counts are decimal strings to preserve bigint precision.
`estimatedRows` comes from PostgreSQL's catalog estimates, not an exact count;
fresh or unanalyzed tables can report zero.

To measure revision counts and JSON sizes by object type, include the optional
history scan:

```sh
pnpm db:footprint --history
```

History includes canonical object snapshots and event-page revisions. Each
statement has a 30-second timeout; large histories can exceed it. Run history
scans off peak with an administrative read connection. The command does not
take exclusive locks or run `ANALYZE`, `VACUUM`, purge, or repair operations.
It requires native PostgreSQL access, not a CloudBase API key. The index
migration itself also applies to PostgreSQL reached through CloudBase's
management migration tools.

Interpret the measurements separately:

- `dataBytes` includes the table, auxiliary storage, and TOAST storage;
  `indexBytes` covers the table's indexes, and `totalBytes` is their sum.
- Per-index `bytes` identifies which secondary indexes dominate storage.
- History `storedJsonBytes` sums `pg_column_size` for the JSON column, including
  its compressed representation where applicable. It excludes row, page, and
  index overhead; it is not the physical table size.
- `logicalJsonBytes` measures the JSON text representation in the database's
  encoding. It can be
  much larger than stored bytes and is not a prediction of disk savings from
  deduplication. `revisions` and `objects` give the scale of retained history.

## Grant index consolidation

Migration `0068_remove_redundant_grant_index.sql` removes only
`resource_grants_resource_principal_idx`. Its four B-tree key columns are the
leading columns of the surviving five-column
`resource_grants_principal_unique` constraint index. The unique constraint,
foreign keys, grant records, scoped sharing, and authorization rules remain
unchanged.

The PostgreSQL 17 integration fixture populates 5,000 grants, analyzes the
table, and compares equality and resource-range query results before and after
the drop. Both queries use the surviving unique index afterwards. The fixture
also verifies identical grant contents and constraint definitions, unchanged
table bytes, and rejection of duplicate grants. One fixture run reclaimed
401,408 bytes (392 KiB) of index storage. Actual savings depend on grant count,
scope distribution, and index fill; this is not a production latency claim.

The transactional index drop briefly locks the grants table. Schedule migration
during a quiet deployment window, and investigate long-running transactions
before applying it. The previous API remains compatible. If workload-specific
plans justify restoring the secondary index, recreate its original four-column
definition in a new migration rather than editing migration history.

No retained files, revisions, audit events, or undo records are removed.
Snapshot deduplication and expired-upload cleanup need separate designs and
measurements; storage retention remains `retain-all`.
