# Web deployment

The Next.js UI has a standalone production build and a non-root Docker image.
It can be deployed for **trusted preview testing**. The complete application is
**not ready for public production access**: development sign-in accepts an
unverified email and can impersonate any development identity. Do not place it
on the public internet or store real personal information in a preview.

## Build and run a trusted preview

From the repository root, configure `.env` using `.env.example`, start
PostgreSQL, and prepare the application:

```bash
pnpm install --frozen-lockfile
docker compose up -d
pnpm db:migrate
pnpm db:baseline-revisions
pnpm build
```

For an existing database, stop API writers before migrating and baselining.
The empty-database baseline is a no-op. Keep a database and storage backup before
upgrades; see [Revisions](revisions.md) for the startup barrier.

Start the API in one terminal. The API reads the repository `.env`; development
sign-in must be explicitly enabled for this preview:

```bash
API_HOST=127.0.0.1 pnpm --filter @chronelle/api start
```

Start the production web entry point in another terminal:

```bash
HOSTNAME=127.0.0.1 PORT=3000 API_INTERNAL_URL=http://127.0.0.1:4000 pnpm --filter @chronelle/web start
```

Open `http://localhost:3000/sign-in`. Keep both processes bound to loopback or
behind a trusted network boundary. Rebuild before restarting the standalone
entry point after source changes. No development server is needed at runtime.

## Containerized web

Build the UI image from the repository root:

```bash
docker build -f apps/web/Dockerfile -t chronelle-web .
```

When the API runs on the Docker host on a trusted interface, this preview
command exposes only the web port on loopback:

```bash
docker run --rm --name chronelle-web \
  --add-host=host.docker.internal:host-gateway \
  --publish 127.0.0.1:3000:3000 \
  --env API_INTERNAL_URL=http://host.docker.internal:4000 \
  chronelle-web
```

An API bound only to host loopback is not necessarily reachable from a
container. On a shared container network, use the API service's internal DNS
name instead. The browser always calls same-origin `/api`; it never receives
the internal API address. `API_INTERNAL_URL` is a runtime server variable, not
a `NEXT_PUBLIC_*` value. It must name a trusted HTTP(S) API origin.

The image includes the standalone server, static bundles, and the app-router
icon/manifest routes. Local worktrees, attachment storage, test output, nested
environment files, and agent directories are excluded from the build context.
The browser release gate starts the same standalone entry point on the host.

## Private container stack

The preview stack starts PostgreSQL, applies migrations and revision baselines,
configures the restricted runtime login, then starts the API and web images.
It publishes only the web port on loopback.
API and database ports remain private on an internal Docker network. Only the
web service also joins an ingress bridge for its loopback publication. The API
image contains compiled workspace packages, production dependencies, and SQL
migrations. Neither image includes application source/tests or development
tooling. Upstream production packages retain their distributed runtime files;
dependency-local agent settings are excluded from the API artifact.

Build both images from the repository root:

```bash
docker build -f apps/api/Dockerfile -t chronelle-api:local .
docker build -f apps/web/Dockerfile -t chronelle-web:local .
```

Set a unique, URL-safe `POSTGRES_PASSWORD` in the private `.env` file, using
letters, digits, underscores, or hyphens. Also set a distinct
`RUNTIME_DATABASE_PASSWORD`, 24-128 characters from that same alphabet, for the
API's `chronelle_runtime` login. Set `ENABLE_DEVELOPMENT_AUTH=true`
only for trusted preview testing. The stack fails closed if auth is not enabled.
Start it from the repository root:

```bash
docker compose --env-file .env -f infrastructure/compose.preview.yaml up -d --wait
```

Open `http://localhost:3000/sign-in`. `WEB_PORT` changes the loopback port.
`API_IMAGE` and `WEB_IMAGE` can name versioned or digest-pinned images.
The API entry point inside its image is `node dist/server.js`; host workspace
start commands are unchanged. Migration and baseline commands run separately
from the API server, using compiled code rather than a TypeScript runner.

Both application containers use UID 1000, a read-only root filesystem, dropped
capabilities, and no-new-privileges. Documents live in a named volume owned by
that user; the web cache and temporary files use tmpfs. Health checks verify
HTTP availability, not continuous database or storage readiness. Do not mount
an untrusted storage tree or expose development sign-in outside the trusted
boundary. The API receives only its runtime database credential, not the owner
password used by migrations and administrative provisioning.

Stop API writers before upgrading an existing stack:

```bash
docker compose --env-file .env -f infrastructure/compose.preview.yaml stop web api
docker compose --env-file .env -f infrastructure/compose.preview.yaml run --rm migrate
docker compose --env-file .env -f infrastructure/compose.preview.yaml run --rm runtime-role
docker compose --env-file .env -f infrastructure/compose.preview.yaml up -d --wait
```

Back up the database and matching document volume before upgrades. Keep the
same password and project name for an existing database. Ordinary `down`
preserves named volumes; do not add `--volumes` to a persistent preview stack.

### Database privilege boundary

`infrastructure/database/runtime-role.sql` is a version-controlled administrative
policy, separate from application schema migrations. It is applied transactionally
after migrations/baselines and before the API starts. The one-shot `runtime-role`
container uses PostgreSQL's client and mounts the policy read-only. Deploy this
SQL file alongside the Compose file, even when using registry-hosted images.

The policy requires a dedicated Chronelle database: it revokes public schema,
table, function, sequence, and database privileges before granting the runtime
login its explicit operations. Do not apply it to a database shared with other
applications. Existing runtime roles with elevated attributes, role memberships,
owned objects, role-specific session settings, or external cluster grants
(including parameter privileges) are refused. An existing safe login is
reconfigured and its password updated; stop API writers before rotating this
secret, then recreate the API container so it receives the new value.
Never pass the owner credential
to API processes or use the runtime credential to run migrations.

Runtime can read and create application records, update mutable state, and
delete revoked resource grants. Audit events, revision snapshots, and command
history are read/insert only. The migration ledger is inaccessible. Runtime
cannot create schema or temporary objects, disable integrity triggers, truncate
tables, or permanently delete canonical objects/relations. Table and column ACL
drift in the public schema is reset. Default privileges apply to objects created
by the provisioning administrator, which must also run migrations; its new
tables/functions receive no automatic runtime grant. Other schemas and object
creators are outside this policy. Add explicit grants whenever a schema migration
needs new operations.

Provisioning outside Compose uses a database administrator's `PGHOST`, `PGPORT`,
`PGDATABASE`, `PGUSER`, and `PGPASSWORD` environment settings, plus the separate
`RUNTIME_DATABASE_PASSWORD`. An optional `CHRONELLE_RUNTIME_ROLE` must be
`chronelle_runtime` or that prefix plus an underscore and lowercase alphanumeric
suffix, up to 63 characters total. Run with startup files disabled:

```bash
psql -X --no-password --file infrastructure/database/runtime-role.sql
```

Inject credentials through private environment/secret configuration; do not
echo them or enable query/parameter tracing during provisioning. The script
does not modify cluster authentication rules, server log policy, or roles outside
the configured runtime login. Managed database administrator capabilities and
secret rotation must be verified on the deployment target.

These privileges limit a compromised API account's administrative reach. They do
not enforce per-user or per-workspace access inside PostgreSQL: every request
still needs application authorization, and RLS remains a separate defense-in-depth
task. Database owners and administrators remain trusted and can bypass this
boundary. Backup/restore, retention, production storage, and identity are separate
release requirements.

## Release validation and publication

After building the local images, run the disposable container gate:

```bash
API_IMAGE=chronelle-api:local WEB_IMAGE=chronelle-web:local pnpm test:containers
```

It creates a unique Compose project with synthetic credentials and an empty
database, inspects runtime contents and ownership, checks private networking and
restricted database privileges, exercises typed planning, context commands,
Undo/Redo, restoration, trash recovery and sharing/revocation,
round-trips an authorized attachment through the web proxy, rejects unauthorized
downloads, verifies persistence after API restart, and completes an accepted web
request after SIGTERM. Next.js finishes cleanup with exit code 143; the idle API
closes its database pool and exits with code 0. Sustained-load request draining
and the deployment's termination deadline still need validation on the final target.
It removes only its disposable containers, network, and volumes on completion
or failure. Docker Engine with Compose and Node.js 24 or newer are required.

The same gate runs a database-and-files recovery drill after stopping the
fixture's API and web writers. It captures a PostgreSQL custom-format dump and
the matching document volume, then restores into a second UUID-owned Compose
project with distinct, empty volumes. A deliberately truncated dump must fail
without leaving partial schema or data; the complete dump is restored in one
transaction. The normal migration and revision-baseline startup runs afterward.

The drill compares every public table before and after restore and startup,
including canonical IDs, typed records, relations, grants, audit events,
revisions, deleted objects, and the migration ledger. Restored files retain
private modes and runtime ownership. Through the web proxy, it verifies the
same identities and history, Viewer reads without writes, denied unrelated
access, live downloads, and recovery of a trashed binary attachment. Restoring
an Event revision and recovering the Document append history without changing
prior audit/revision rows or the source database. Development sessions must be
created again after restart.

This is a synthetic release test, not a backup service or an operator restore
command. Archives remain in process memory, with a 16 MiB output limit and a
three-minute timeout per Docker command. No archive is accepted from an
external path or retained as a release artifact. Only archives created by the
drill are trusted for SQL execution and file extraction. Cleanup removes only
the two disposable projects, never a persistent preview stack. Abruptly killing
the runner or losing the Docker daemon can leave its temporary resources behind.

Production recovery still requires encrypted, access-controlled off-host
backups, monitored scheduling and retention, credential/key recovery, and
deployment-scale restore timing. Database roles and ownership are provisioned
by the target environment, not imported by this drill; PostgreSQL role/ACL
recovery needs its own operational procedure. Stop all writers to obtain a
matching database/file pair unless the storage deployment provides a verified
snapshot protocol. A logical database dump alone does not make file storage
consistent. Live Tencent COS backup/version retention and point-in-time
recovery are not exercised here.

Tag and manual releases call the same CI workflow from the triggering revision.
Manual runs default to `dry_run=true`: they validate, transfer, load, and verify
the images without registry login or pushes. Set `dry_run=false` explicitly to
publish a manual release. Version-tag pushes publish after validation succeeds.
Registry write permission belongs only to the publishing job, which depends on
successful quality, browser, and running-container gates. The container job
retains the tested images as a one-day artifact; publishing loads that artifact
and verifies each image's revision label instead of building again. Missing or
expired artifacts fail the release and require a fresh validation run.

Images receive `sha-<full-commit-sha>` tags and, for a tag-triggered release,
the triggering version tag. Existing short SHA tags are not updated. Prefer
image digests for deployments: tags can be reassigned, and publishing the API
and web images is not an atomic registry operation. A failed push can leave
one validated image published without its counterpart; retry the publishing
job while the validated artifact exists. This workflow does not deploy services
or certify development authentication for public use.

## Runtime protections and limits

- Terminate TLS at the deployment ingress and enable HSTS there after HTTPS
  is confirmed. Keep PostgreSQL, storage, and API listeners private.
- Do not cache authenticated routes or `/api` at the CDN. Both API and proxy send
  `Cache-Control: private, no-store`, preserves download disposition, forwards
  only selected headers, and does not follow upstream redirects.
- The proxy preserves response content type, attachment disposition, and request
  ID. It leaves response framing to the web server, omitting upstream encoding
  and length headers because fetch can decompress the response body.
- The proxy starts one 30-second deadline at route entry, covering incoming
  body reads and upstream work, including streamed responses. A deadline before
  response headers produces 504; an observed client cancellation produces 408;
  unreachable upstreams produce 503. Errors omit internal addresses and exception
  details. After headers are sent, cancellation terminates the response stream.
  A dispatched mutation may already have committed: retain existing command IDs
  and expected versions, refresh state, and do not retry as a fresh operation.
- API and proxy permit 1 MiB ordinary request bodies and 25 MiB only on the file
  upload route. The proxy counts actual bytes, validates declared length, and
  cancels rejected or abandoned bodies before forwarding. Buffers grow with
  received bytes; declared sizes alone do not allocate them. Browser uploads
  reject oversized files before reading/hashing. This remains bounded buffering,
  not direct upload streaming or a global memory/concurrency budget.
- Enforce matching byte, header, connection, concurrency, and slow-client limits
  at ingress. The API sets a 30-second Node request-receipt timeout; its enforcement
  follows Node's connection-check schedule and does not cancel database work.
  Framework/ingress buffering and rate limits require deployment validation.
- API request logs contain generated request IDs, method, route template, status,
  and duration. They omit raw URLs, query strings, credentials, payloads, filenames,
  and arbitrary exception details. HTTP parser failures log only status. Ordinary
  API responses return `x-request-id`, which the proxy preserves for correlation.
  Configure the same privacy policy at ingress and in error-reporting integrations;
  existing logs require their own retention/access review. Startup failures emit
  a stable error code without exception text; inspect configuration through a
  controlled diagnostic workflow rather than enabling raw request logging.
- Response headers prevent framing, MIME sniffing, referrer leakage, embedded
  plugin content, and off-origin form submissions. The script policy below
  applies to HTML documents, including not-found pages.

## Script Content Security Policy

Each document response receives a fresh 128-bit random nonce. Next.js applies
that nonce to its framework, page, and inline hydration scripts. Production
uses `script-src 'nonce-...' 'strict-dynamic'` and `script-src-attr 'none'`:
initial scripts need the nonce, and trusted scripts can load their descendants.
Unapproved parser scripts, inline handlers, and string evaluation are blocked.
Only the development server permits `unsafe-eval` for framework debugging.
Caller-supplied nonce and policy headers are overwritten, including on prefetch
requests. There is no script `unsafe-inline` allowance.

The root layout forces dynamic rendering. HTML is private and non-cacheable;
do not add static export, page caching, or a CDN HTML cache without redesigning
the nonce contract. This adds server-rendering work per document request compared
with a static shell. JavaScript/CSS bundles retain Next.js immutable caching.
The framework owns cache headers; dynamic HTML errors stay non-cacheable and
missing static assets return non-executable plain text. API routes and private
transfers retain their existing body limits and cache policy, outside the page
middleware.

This follows the [Next.js nonce integration](https://nextjs.org/docs/app/guides/content-security-policy)
and is defense in depth, not a substitute for escaping or authorization. It does
not establish connection/style origin policies, TLS, provider trust, or token
revocation. Future external scripts must use a reviewed nonce-aware integration;
do not relax production policy with `unsafe-inline` or `unsafe-eval`. Revalidate
the policy through the actual ingress and run an independent security review
before public launch.

## Public launch gate

Before exposing the application publicly:

1. Implement and test a production identity adapter, email/identity verification,
   session revocation, and a suitable browser session strategy. Disable
   development auth and replace the development sign-in screen.
2. Configure durable private storage, backups, restore drills, and least-privilege
   database/storage credentials. Run the authorization and attachment suites
   against the deployed topology.
3. Configure TLS, ingress limits, origin policies, monitoring, alerting, and
   secrets management. Revalidate the script CSP through ingress and conduct a
   security review.
4. Run `pnpm check`, `pnpm test:e2e`, both container builds, and smoke-test sign-in,
   shared Viewer access, uploads/downloads, recovery, and API outage behavior
   on the actual deployment target.

No cloud account, domain, infrastructure, or deployment is created by this UI
release. Tencent-compatible provider boundaries remain unchanged.
