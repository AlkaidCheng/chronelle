# WeChat Mini Program

Chronelle's WeChat Mini Program is a native Taro 4 application in
`apps/wechat`. It is a presentation layer over the same canonical application,
not a second backend. Protected business data will continue to pass through the
Fastify REST API and its centralized authorization decision.

## Implemented foundation

The current foundation provides one offline shell page with:

- a package-local React 18 and TypeScript 5 toolchain, isolated from the web
  application's React 19 runtime;
- Simplified Chinese and English message catalogs, with Chinese as the safe
  fallback;
- light and dark warm ink, cinnabar, and indigo tokens;
- safe-area layout and reduced-motion defaults;
- a production package report with enforced main, subpackage, and total budgets;
- unit coverage for locale selection and package accounting.

The visible shell does not yet fetch business data. W02 provides its shared
transport boundary, and W03 provides verified identity, explicit account
linking, and revocable session storage without adding a second data or
permission path. W04 will compose those capabilities into the native sign-in
and read-only Event screens.

## W02 API transport

`ChronelleApiClient` owns request construction, bearer and workspace headers,
runtime response validation, and safe API error translation. It now delegates
JSON I/O through a small transport port:

- the web adapter uses Fetch;
- the Mini Program adapter uses `Taro.request` and its abortable request task;
- both adapters enforce caller cancellation and a 30-second default deadline;
- public health checks omit credentials, while protected session requests send
  the opaque Chronelle bearer token and active workspace ID;
- unreadable, failed, cancelled, and timed-out responses cross the same typed
  client boundary.

File hashing and binary transfer are separate capabilities. Browser defaults
use Web Crypto and Fetch with a two-minute transfer deadline. The Mini Program
does not pretend to provide those browser APIs; W07 will supply native WeChat
hashing, upload, download, and file-opening adapters.

The shared transport contract runs against both Fetch and Taro adapters. A
Mini Program integration test also exercises `/api/health` and the protected
`/api/auth/session` route through the production client and validates both
responses with the shared schemas.

## W03 identity and session boundary

The API exposes two CloudBase-backed identity operations:

- `POST /api/auth/wechat` verifies an end-user bearer token with CloudBase,
  consumes its digest once, and returns a revocable Chronelle session;
- `POST /api/auth/wechat/link` requires a live Chronelle session and explicitly
  links the verified WeChat identity to that canonical user.

Migration `0071_add_linked_identities.sql` adds `user_identities` and backfills
every existing provider without changing any `users.id`. A provider and subject
can belong to only one user, and one user can have only one identity for a
provider. Chronelle does not merge accounts from display names or email
addresses. Invalid, expired, replayed, unlinked, and conflicting proofs all use
the same unauthenticated response so the endpoint does not disclose accounts.

The server calls CloudBase's `/auth/v1/user/me` endpoint and accepts only an
active profile carrying an allowed WeChat provider id. Raw CloudBase tokens,
OpenIDs, and profile data are neither logged nor persisted; only the
environment-qualified subject and the consumed proof's SHA-256 digest cross the
persistence boundary. The Mini Program's `WeChatSessionStore` accepts only the
opaque Chronelle token, workspace id, and expiry. It rejects expired or malformed
state and clears local credentials even if remote sign-out fails.

The feature is fail-closed and disabled by default. After applying migration
0071, configure the API with:

```dotenv
ENABLE_WECHAT_AUTH=true
CLOUDBASE_ENV_ID=your-cloudbase-environment-id
CLOUDBASE_WECHAT_PROVIDER_IDS=wechat,weixin,wx,wx_openid
CLOUDBASE_AUTH_TIMEOUT_MS=10000
```

Provider ids must match the identifiers returned by the target CloudBase
environment. `CLOUDBASE_APIKEY` remains a server-only database gateway
credential and is not used as the end user's WeChat proof.

## Local build

Install workspace dependencies, then build once or start the watcher:

```bash
pnpm build:weapp
pnpm dev:weapp
```

Open `apps/wechat` in WeChat DevTools. Its tracked `project.config.json` uses
`touristappid` and points at `dist/weapp`. Store a real AppID and local DevTools
settings in `apps/wechat/project.private.config.json`; it is gitignored and must
not be committed.

Run the transport and package tests with:

```bash
pnpm --filter @chronelle/api-client test
pnpm --filter @chronelle/wechat test
```

A deployed Mini Program API origin must use HTTPS and be registered as a WeChat
request domain. Keep API keys and the WeChat AppSecret on the server; the client
persists only its opaque, revocable Chronelle session token.

The production build disables DevTools-side ES5 conversion, style completion,
and upload-time minification because Taro performs those transformations. The
generated `dist/weapp` directory is ignored.

## Package budgets

Run the byte report after a production build:

```bash
pnpm wechat:bundle
```

The build fails above these internal limits:

| Package                 |            Limit |
| ----------------------- | ---------------: |
| Main package            |  1,500,000 bytes |
| Each feature subpackage |  1,500,000 bytes |
| Combined package        | 15,000,000 bytes |

These leave operating room below WeChat's platform ceilings. W01 establishes
the baseline; later feature slices must keep launch, identity, navigation, and
the Event collection in the main package and load planning depth from feature
subpackages.

## Supply-chain policy

The workspace permits the `@tarojs/binding` lifecycle script because it selects
or builds Taro's native compiler binding. The `@tarojs/cli` postinstall script is
disabled: it attempts to contact a separate registry and install an optional
global performance plugin. `core-js`'s informational postinstall banner is also
disabled. Neither disabled script is required to build Chronelle.

## Validation boundary

A successful production compile and structural DevTools project validate W01's
build feasibility. Automated browser emulation does not validate a Mini Program
runtime. Physical iOS and Android behavior, Chinese IME, assistive technology,
network interruption, domain allowlists, privacy declarations, and submission
remain release evidence for the production-hardening slice.
