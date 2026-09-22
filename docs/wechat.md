# WeChat Mini Program

Chronelle's WeChat Mini Program is a native Taro 4 application in
`apps/wechat`. It is a presentation layer over the same canonical application,
not a second backend. Protected business data will continue to pass through the
Fastify REST API and its centralized authorization decision.

## W01 foundation

The current slice provides one offline shell page with:

- a package-local React 18 and TypeScript 5 toolchain, isolated from the web
  application's React 19 runtime;
- Simplified Chinese and English message catalogs, with Chinese as the safe
  fallback;
- light and dark warm ink, cinnabar, and indigo tokens;
- safe-area layout and reduced-motion defaults;
- a production package report with enforced main, subpackage, and total budgets;
- unit coverage for locale selection and package accounting.

It does not yet authenticate, call the API, or cache business data. Those
capabilities belong to later vertical slices and must not bypass the API.

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
