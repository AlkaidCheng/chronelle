# WeChat Mini Program

Chronelle's WeChat Mini Program is a native Taro 4 application in
`apps/wechat`. It is a presentation layer over the same canonical application,
not a second backend. Protected business data will continue to pass through the
Fastify REST API and its centralized authorization decision.

## Implemented foundation

The current slice provides one offline shell page with:

- a package-local React 18 and TypeScript 5 toolchain, isolated from the web
  application's React 19 runtime;
- Simplified Chinese and English message catalogs, with Chinese as the safe
  fallback;
- light and dark warm ink, cinnabar, and indigo tokens;
- safe-area layout and reduced-motion defaults;
- a production package report with enforced main, subpackage, and total budgets;
- unit coverage for locale selection and package accounting.

The visible shell does not yet authenticate or cache business data. W02 adds
the transport boundary used by future authenticated screens without adding a
second data or permission path.

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
responses with the shared schemas. W03 will add verified WeChat identity,
revocable token persistence, and lifecycle ownership before the shell performs
live requests.

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
will eventually persist only its opaque, revocable Chronelle session token.

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
