# CloudBase backend runbook

How to move an environment between the PostgreSQL backend and the CloudBase
backend, verify each step, observe the gateway, and roll back. The backend
is a deployment setting; the code, the schema, and the migrations are the
same on both.

## Backends

| Setting                                | PostgreSQL backend (default)                                    | CloudBase backend                                     |
| -------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------- |
| `LIVTALES_BACKEND`                     | `postgres`                                                      | `cloudbase`                                           |
| `DATABASE_URL`                         | Required; every read and write not opted into CloudBase uses it | Not read; the API never opens a PostgreSQL connection |
| `CLOUDBASE_READS_ENABLED`              | Optional opt-in for the read repositories                       | Implied; setting it to `false` is a startup error     |
| `CLOUDBASE_WRITES_ENABLED`             | Optional opt-in for the write repositories (requires reads)     | Implied; setting it to `false` is a startup error     |
| `CLOUDBASE_ENV_ID`, `CLOUDBASE_APIKEY` | Required when either flag is on                                 | Required                                              |
| Startup check                          | Revision baseline through PostgreSQL                            | `chronelle_backend_readiness` through the gateway     |

The web app, the storage provider, and the authentication provider are
configured the same way on both backends.

## Prerequisites for the CloudBase backend

1. The environment's PostgreSQL holds the full schema: migrations `0001`
   through `0048`, applied in order with their `chronelle_schema_migrations`
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

1. Set `LIVTALES_BACKEND=cloudbase`, `CLOUDBASE_ENV_ID`, and a fresh
   `CLOUDBASE_APIKEY`; remove or leave `DATABASE_URL` (it is not read).
2. Start the API. It calls `chronelle_backend_readiness` and logs
   `LivTales backend selected` with `backend: "cloudbase"` once it listens.
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

1. Set `LIVTALES_BACKEND=postgres` and `DATABASE_URL` for the same
   database; set or remove the two CloudBase flags as wanted (both `false`
   or absent serves everything from PostgreSQL).
2. Restart the API. It checks the revision baseline through PostgreSQL and
   listens.

No data changes: both backends write the same rows through the same
functions or the same transactional code, and the functions stay installed
and unused. A rollback can be reversed the same way.

## Host the application on CloudBase Run (yun tuo guan)

The same environment can host both containers as CloudBase Run services,
built by the platform from this repository's Dockerfiles. This is a
trusted-preview deployment until the public launch gate in
[deployment.md](deployment.md) is met: development sign-in remains the only
identity provider, so keep the web service's address private.

### Before creating services

1. Enable CloudBase Run for the environment in the console (Cloud
   Functions / Hosting, then Cloud Run, then enable). Enabling accepts the
   service terms and the pay-as-you-go pricing for the environment; it is an
   account decision, not an application setting.
2. Create a server API key for the deployment (Environment, then API Key):
   the key is a JWT with an expiry; note the date and rotate the key in the
   API service's settings before it, or the API refuses to start.
3. Decide where attachments live. A CloudBase Run container's filesystem is
   discarded on restart, so `DOCUMENT_STORAGE_PROVIDER=local-filesystem`
   loses uploads; use `tencent-cos` with a private bucket and least-privilege
   credentials as described in [storage.md](storage.md), or accept
   ephemeral attachments for a smoke deployment.
4. Confirm the prerequisites above: migrations through 0048 applied, the
   baseline captured, the contract harnesses passing.

### Deployment repository

CloudBase Run reads the source through a GitHub authorization that covers
every repository the authorizing account can reach, and a collaborator on a
user-owned repository always receives write access. Give the platform its own
repository instead of the development one:

1. A dedicated GitHub account used for nothing else (two-factor
   authentication on, no other repositories, not a collaborator on the
   development repository) owns a private repository of the same name. Create
   it empty rather than forking: a fork of a public repository cannot be made
   private.
2. Register a deploy key on that repository with write access. The key is
   scoped to the one repository and revoked from its settings; keep the
   private key outside the working tree.
3. Add the repository as a second remote of the development clone, pushing
   only `main` and offering only the deploy key. When the development remote
   uses HTTPS, the clone's SSH command can be bound to the key directly;
   otherwise use an SSH host alias with the same options:

   ```bash
   git remote add deploy git@github.com:<deployment-account>/livtales.git
   git config remote.deploy.push refs/heads/main:refs/heads/main
   git config core.sshCommand "ssh -i <deploy-key> -o IdentitiesOnly=yes"
   ```

4. Disable Actions on the deployment repository (the checks already ran on
   the development repository) and make its default branch one that does not
   carry `.github/dependabot.yml`: Dependabot version updates have no switch
   while that file is on the default branch, and they would open pull
   requests nobody merges. A one-commit orphan branch holding a README that
   states the repository's purpose serves; `main` stays a fast-forward copy,
   and the services below deploy from it explicitly.
5. Authorize CloudBase Run from the deployment account only, so the grant
   never covers the development account, and select the deployment
   repository's `main` when creating the services below.

A release is a fast-forward push of a green `main`: `git push deploy`. The
deployment repository never diverges, so the push never needs a merge, and
automatic deployment on push can be enabled once the procedure is trusted,
because pushing there is the release decision itself.

#### Renaming the deployment repository

The deployment repository follows the development repository's name. To move
an existing setup to a new name (`livtales` below):

1. Rename the deployment repository in its settings, signed in as the
   deployment account. The deploy key, the default branch, and the disabled
   Actions carry over.
2. Point the development clone's remote at the new name. The push refspec and
   `core.sshCommand` stay as they are:

   ```bash
   git remote set-url deploy git@github.com:<deployment-account>/livtales.git
   ```

3. Rebind each service (`chronelle-api`, then `chronelle-web`): open
   更新服务 (update service), choose the Git deployment method
   (使用公开 GIT 仓库部署), and under Git 仓库 select `GitHub (已授权)` (the
   authorized account), then `<deployment-account>/livtales` and `main`. Never
   choose 公开仓库 (public repository): the deployment repository is private.
   The build settings and variables are prefilled from the live version; leave
   them and the access settings as they were.
4. Deploy, then check each service's variable list, as after any Git-mode
   deploy.

The services keep the names `chronelle-api` and `chronelle-web`, which cannot
change. Until a service is rebound, its saved source still names the old
repository, and its deploys depend on the old name redirecting to the new one.

### Service: chronelle-api

| Setting                        | Value                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source                         | The deployment repository's `main`; Dockerfile `apps/api/Dockerfile`; build context the repository root                                                                                                                                                                                                                                              |
| Port                           | `4000`                                                                                                                                                                                                                                                                                                                                               |
| Health check                   | `GET /api/health`                                                                                                                                                                                                                                                                                                                                    |
| Access                         | Internal only: the web service forwards `/api` to it, including document transfer URLs                                                                                                                                                                                                                                                               |
| Instances                      | At least one warm instance; the readiness call and the SDK client make a cold start noticeable                                                                                                                                                                                                                                                       |
| `LIVTALES_BACKEND`             | `cloudbase`                                                                                                                                                                                                                                                                                                                                          |
| `CLOUDBASE_ENV_ID`             | The environment id                                                                                                                                                                                                                                                                                                                                   |
| `CLOUDBASE_APIKEY`             | The server API key (a secret; set it as a protected variable, never in the image)                                                                                                                                                                                                                                                                    |
| `EMAIL_PROVIDER`               | `smtp` with `SMTP_URL` (for Tencent SES, `smtps://user:password@smtp.qcloudmail.com:465`) and `EMAIL_FROM`; `file` with `EMAIL_FILE_PATH` (for example `/tmp/livtales-emails.jsonl`) appends each message as a JSON line the operator reads from the instance's Webshell with `tail`; the default `log` writes verification codes to the service log |
| `ENABLE_DEVELOPMENT_AUTH`      | `true` only while the development sign-in screen is the way in; unset once the account screens exist                                                                                                                                                                                                                                                 |
| `API_HOST`, `API_PORT`         | `0.0.0.0`, `4000`                                                                                                                                                                                                                                                                                                                                    |
| `DOCUMENT_STORAGE_PROVIDER`    | `tencent-cos` with `COS_BUCKET`, `COS_REGION`, `COS_SECRET_ID`, `COS_SECRET_KEY` (secrets), or `local-filesystem` with `LOCAL_STORAGE_ROOT=/app/.livtales/storage` for a smoke deployment                                                                                                                                                            |
| `CLOUDBASE_REQUEST_TIMEOUT_MS` | Optional; 30000 by default                                                                                                                                                                                                                                                                                                                           |

Operator note: the service was created with `CHRONELLE_BACKEND=cloudbase`;
rename the variable at its next deploy by adding `LIVTALES_BACKEND=cloudbase`
before releasing the new image (which stops at startup while
`CHRONELLE_BACKEND` is set alone) and removing `CHRONELLE_BACKEND` once no
rollback to an older image is expected. A failed Git-mode deploy can drop
newly added variables, so check the list after every deploy.

A service on `local-filesystem` that sets
`LOCAL_STORAGE_ROOT=/app/.chronelle/storage`, the value this runbook gave
before the LivTales rename, must change it to `/app/.livtales/storage` or unset
it: the image no longer creates `/app/.chronelle`, and the `node` user cannot
create it, so every upload fails while the health check still passes.

Do not set `DATABASE_URL`, `CLOUDBASE_READS_ENABLED`, or
`CLOUDBASE_WRITES_ENABLED`: the CloudBase backend ignores the first and
implies the other two. After the first deployment, the service log must show
`LivTales backend selected` with `backend: "cloudbase"` followed by
`Server listening`; a `startup_failed` line names what to fix (see above).
With `smtp`, give `EMAIL_FROM` the display name users see, LivTales (for
example `LivTales <no-reply@your-domain>`): it heads every verification and
invitation email.

### Service: chronelle-web

| Setting                   | Value                                                                                                          |
| ------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Source                    | The deployment repository's `main`; Dockerfile `apps/web/Dockerfile`; build context the repository root        |
| Port                      | `3000`                                                                                                         |
| Health check              | `GET /sign-in`                                                                                                 |
| Access                    | The address users open; restrict it (allowed IPs or an access layer) while development sign-in is enabled      |
| `API_INTERNAL_URL`        | The API service's internal address (scheme, host, and port), with no path                                      |
| `WEB_DEVELOPMENT_SIGN_IN` | Unset: the development sign-in screen must not exist on a deployment; accounts sign in with email and password |
| `NODE_ENV`                | `production` (set by the image)                                                                                |

The web service is the only public entry point: it stamps the script CSP
nonce, forwards `/api` to the API service, and serves the document transfer
URLs the API issues, which are relative to its own origin.

### Verify a deployment

1. Open the web address, sign in with a development identity, create an
   Event, edit it, undo the edit, upload an attachment, download it, delete
   the Event, and find it in Trash. Each step exercises a different function
   family through the gateway.
2. Read the API service log: every gateway request appears as a `cloudbase`
   event; a stale edit produces `outcome: "rejected"` with
   `code: "DATABASE_PT409"`, and no `timeout` or `failed` outcomes should
   appear under normal use.
3. Stop and restart the API service: it must pass readiness and listen again
   without any manual step.

### Roll back

Stop or delete both services. Nothing else changes: the data stays in the
environment's PostgreSQL, the functions stay installed, and the same database
serves a PostgreSQL-backend deployment through `LIVTALES_BACKEND=postgres`
and a `DATABASE_URL` wherever a TCP route exists.

## Apply a new migration

Migrations are immutable files applied in order on both backends. For the
CloudBase backend, apply the file through the console's SQL editor together
with its ledger row (the file's SHA-256 checksum, as `pnpm db:migrate` would
record it), then restart the API so the readiness check sees the new
function. A migration that changes tables is applied with the API stopped,
as on the PostgreSQL backend.
