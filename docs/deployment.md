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
icon/manifest routes. Local worktrees, attachment storage, test output, and
agent directories are excluded from the build context. CI builds the image;
the browser release gate starts the same standalone entry point on the host.

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
  plugin content, and off-origin form submissions. The CSP is deliberately
  limited; it is not a complete script-execution policy. A nonce-based script
  policy needs validation with Next.js before public launch.

## Public launch gate

Before exposing the application publicly:

1. Implement and test a production identity adapter, email/identity verification,
   session revocation, and a suitable browser session strategy. Disable
   development auth and replace the development sign-in screen.
2. Configure durable private storage, backups, restore drills, and least-privilege
   database/storage credentials. Run the authorization and attachment suites
   against the deployed topology.
3. Configure TLS, ingress limits, origin policies, monitoring, alerting, and
   secrets management. Validate the script CSP and conduct a security review.
4. Run `pnpm check`, `pnpm test:e2e`, both container builds, and smoke-test sign-in,
   shared Viewer access, uploads/downloads, recovery, and API outage behavior
   on the actual deployment target.

No cloud account, domain, infrastructure, or deployment is created by this UI
release. Tencent-compatible provider boundaries remain unchanged.
