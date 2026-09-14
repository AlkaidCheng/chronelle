# CloudBase backend runbook

How to move an environment between the PostgreSQL backend and the CloudBase
backend, verify each step, observe the gateway, and roll back. The backend
is a deployment setting; the code, the schema, and the migrations are the
same on both.

## Backends

| Setting                                | PostgreSQL backend (default)                                    | CloudBase backend                                     |
| -------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| `CHRONELLE_BACKEND`                    | `postgres`                                                      | `cloudbase`                                           |
| `DATABASE_URL`                         | Required; every read and write not opted into CloudBase uses it | Not read; the API never opens a PostgreSQL connection |
| `CLOUDBASE_READS_ENABLED`              | Optional opt-in for the read repositories                       | Implied; setting it to `false` is a startup error     |
| `CLOUDBASE_WRITES_ENABLED`             | Optional opt-in for the write repositories (requires reads)     | Implied; setting it to `false` is a startup error     |
| `CLOUDBASE_ENV_ID`, `CLOUDBASE_APIKEY` | Required when either flag is on                                 | Required                                              |
| Startup check                          | Revision baseline through PostgreSQL                            | `chronelle_backend_readiness` through the gateway     |

The web app, the storage provider, and the authentication provider are
configured the same way on both backends.

## Prerequisites for the CloudBase backend

1. The environment's PostgreSQL holds the full schema: migrations `0001`
   through `0029`, applied in order with their `chronelle_schema_migrations`
   ledger rows. The CloudBase console's SQL editor applies each file; verify
   the editor holds the ledger row at the end of the file before executing.
2. The revision baseline holds: every object has a revision for its current
   version. A database seeded or migrated without revisions needs the
   baseline captured once with all API writers stopped:
   `CLOUDBASE_CONTRACT_ALLOW_WRITES=true pnpm cloudbase:baseline` through the
   gateway (`chronelle_revision_baseline`, migration 0029), or
   `pnpm db:baseline-revisions` through a PostgreSQL connection. Both record
   the same `object.baselined` audit event and baseline revision, and report
   how many objects still lack one afterwards.
3. A short-lived server API key that is not expired. `pnpm cloudbase:probe`
   reports an expired key without printing it.
4. The contract harnesses pass against the environment:
   - `pnpm cloudbase:read-contract` for the read repositories;
   - `CLOUDBASE_CONTRACT_FAMILY=<event|task|expense|reminder> pnpm cloudbase:rpc-contract`
     for each typed family;
   - `CLOUDBASE_CONTRACT_ALLOW_WRITES=true pnpm cloudbase:linked-contract`
     for every cross-object function, the command state, the storage
     references, the document transfer, the layout history, the sign-in,
     and the readiness function.

   The harnesses mutate the environment (they create and retire probe
   objects), so run them against staging, never against a production
   database that serves users.

## Enable the CloudBase backend

1. Set `CHRONELLE_BACKEND=cloudbase`, `CLOUDBASE_ENV_ID`, and a fresh
   `CLOUDBASE_APIKEY`; remove or leave `DATABASE_URL` (it is not read).
2. Start the API. It calls `chronelle_backend_readiness` and logs
   `Chronelle backend selected` with `backend: "cloudbase"` once it listens.
3. If it exits with `startup_failed`, the `reason` field says why:
   - `chronelle_backend_readiness is not callable`: migration 0028 (or the
     rpc route itself) is missing; apply the migrations and check the key.
   - `lacks required functions: ...`: the named migrations are missing;
     apply them in order.
   - `Object revision baseline is missing`: run `pnpm cloudbase:baseline`
     (or `db:baseline-revisions` through PostgreSQL) with the API stopped.
4. Sign in and load an Event page, an attachment, and the command state
   through the web app; each exercises a different adapter family.

## Observe the gateway

Every gateway request is logged by the API as a `cloudbase` event:

```json
{
  "cloudbase": {
    "kind": "rpc",
    "target": "chronelle_event_update",
    "durationMs": 412,
    "outcome": "rejected",
    "status": 409,
    "code": "DATABASE_PT409"
  },
  "msg": "CloudBase gateway request"
}
```

- `kind` is `select`, `insert`, `update`, `delete`, or `rpc`; `target` is the
  table or the function.
- `outcome` is `ok` (debug level), `rejected` with the gateway's `status` and
  `code` (info level below 500: conflicts, denials, missing records; error
  level at 500 and above), `timeout` (error level; the request exceeded
  `CLOUDBASE_REQUEST_TIMEOUT_MS`), or `failed` (error level; the request did
  not reach the gateway).

Aggregate the lines by `kind` and `target` for latency percentiles, by
`code` for rejection counts (`DATABASE_PT409` conflicts, `DATABASE_PT403`
denials, `DATABASE_PT404` missing records, `PGRST202` missing functions),
and by `outcome` for the error rate. A rise in `timeout` or 5xx rejections
is the gateway or the database, not the application; a rise in
`DATABASE_PT409` is contention between users on the same objects.

## Roll back to the PostgreSQL backend

1. Set `CHRONELLE_BACKEND=postgres` and `DATABASE_URL` for the same
   database; set or remove the two CloudBase flags as wanted (both `false`
   or absent serves everything from PostgreSQL).
2. Restart the API. It checks the revision baseline through PostgreSQL and
   listens.

No data changes: both backends write the same rows through the same
functions or the same transactional code, and the functions stay installed
and unused. A rollback can be reversed the same way.

## Apply a new migration

Migrations are immutable files applied in order on both backends. For the
CloudBase backend, apply the file through the console's SQL editor together
with its ledger row (the file's SHA-256 checksum, as `pnpm db:migrate` would
record it), then restart the API so the readiness check sees the new
function. A migration that changes tables is applied with the API stopped,
as on the PostgreSQL backend.
