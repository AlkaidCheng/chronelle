# WeChat Mini Program

Chronelle's WeChat Mini Program is a native Taro 4 application in
`apps/wechat`. It is a presentation layer over the same canonical application,
not a second backend. Protected business data will continue to pass through the
Fastify REST API and its centralized authorization decision.

## Implemented vertical slice

The current Mini Program provides:

- a package-local React 18 and TypeScript 5 toolchain, isolated from the web
  application's React 19 runtime;
- Simplified Chinese and English message catalogs, with Chinese as the safe
  fallback and the web app's Chinese terms: 伙伴 for People, 工作区 for a
  workspace, 设置 for Settings, and 可编辑 and 仅查看 for access;
- light and dark warm ink, cinnabar, and indigo tokens;
- safe-area layout and reduced-motion defaults;
- a production package report with enforced main, subpackage, and total budgets;
- native WeChat sign-in, independent username/email and password sign-in, and
  explicit existing-account linking;
- session restoration, revocation, onboarding, and workspace switching;
- an Events sidebar with an account menu, a searchable workspace picker, and
  confirmed sign-out;
- account language, time zone, clock, and week-start preferences through the
  authenticated account API;
- lifecycle- and network-aware TanStack Query integration;
- paginated canonical Event cards and an authorized Event overview;
- native creation and editing for undated, date-only, timed, and multi-day
  Events;
- bounded per-account drafts, idempotent creation retries, and explicit
  optimistic-concurrency recovery;
- lazy Event-editor and planning feature subpackages, keeping launch and the
  Event collection in the main package;
- user-defined Event pages with manually selected, explicitly ordered planning
  components;
- authorized canonical To-do, Calendar, Timeline, Itinerary, Expense, and
  Reminder projections, without Mini Program copies of business records;
- native canonical Task creation, editing, completion, due-date, status,
  location, description, and existing-section assignment;
- bounded Task drafts, idempotent Event-context creation, version conflicts,
  and projection-wide refresh after each mutation;
- native list, by-day, week, board, and month Task presentations with a view
  choice stored on the existing Event component;
- To-do section creation, rename, description, ordering, and removal through
  the authorized section API;
- canonical Expense creation and editing from an Event's Expenses component,
  with decimal-text amounts, transaction-time preservation, bounded drafts,
  and explicit version-conflict recovery;
- a Files component with authorized Event, Task, and Expense attachment lists,
  native file selection, upload, and temporary file opening;
- native Event revision history with paginated summaries, historical content,
  a comparison to the current Event, and confirmed content restoration;
- conflict-safe layout writes whose removal operations never delete canonical
  resources;
- native Event sharing through the authorized API: direct grants, queued Person
  invitations, role changes, revocation, and leaving a shared Event;
- a native Trash view for authorized recovery of canonical records across the
  workspace, with type filtering, pagination, and a versioned recovery preview;
- pull-to-refresh, retry, offline, empty, and permission-loss states;
- unit coverage for locale selection, runtime configuration, CloudBase proof
  acquisition, session storage, lifecycle bridging, date formatting, transport,
  and package accounting.

Protected data always comes from the Chronelle REST API. Event list and detail
screens retain the canonical object ID and version in their validated response;
the UI does not display the implementation ID or create a Mini Program copy.

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
uses native file selection, local file reads, upload and download tasks, and a
package-local SHA-256 implementation.

The shared transport contract runs against both Fetch and Taro adapters. A
Mini Program integration test also exercises `/api/health` and the protected
`/api/auth/session` route through the production client and validates both
responses with the shared schemas.

The WeChat runtime cannot compile functions from source text, so the Mini
Program validates responses in zod's `jitless` mode. The app entry imports
`src/runtime/validation.ts` before any other module because schemas read this
setting when they are created; the web app keeps zod's compiled validators.
The runtime also has no `AbortController` or `AbortSignal`, which TanStack
Query, the CloudBase SDK, and request cancellation construct, so the entry next
imports `src/runtime/abort-controller.ts`, which installs a minimal
implementation only where the global object lacks one.

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

## W04 native shell and Event reads

The Mini Program offers WeChat sign-in first and reveals the account form only
when selected. Account sign-in uses the same `POST /api/auth/sign-in` endpoint as
the web app, accepts a username or email and password, and stores the resulting
Chronelle session without linking the WeChat identity. Password reset and
account registration remain on the web app.

WeChat sign-in uses CloudBase OpenID only to obtain a short-lived end-user
proof. It exchanges that proof for a Chronelle-owned bearer session and does
not persist the CloudBase token. An unrecognized WeChat identity can be linked
only after the user signs in to an existing Chronelle account; the user may
instead choose independent account sign-in. A failed link attempts to revoke
the temporary password session and clears the active local credential.

On launch, the shell restores the opaque Chronelle token and validates it with
`GET /api/auth/session`. App show/hide events update TanStack Query focus, and
native network changes update its online manager. Resume and reconnect therefore
revalidate protected data. A workspace change cancels pending work, persists the
new workspace selector beside the same token, and clears the cache before the
next request.

The Event collection calls `GET /api/events` with cursor pagination. Opening a
card reads the same Event through `GET /api/events/:id` and its authoritative
access explanation through `GET /api/objects/:id/access`. Date-only, multi-day,
timed, and undated Events preserve their distinct semantics; timed values use
the Event or account time zone and the account's clock preference. Schedules
read compactly: the weekday and date, the year only outside the current year,
and one date with a time span for a timed Event that starts and ends the same
day.

## Events navigation and account menu

The Events page sets `navigationStyle: "custom"` and draws its own top row: a
menu button aligned with WeChat's capsule, whose position comes from
`Taro.getMenuButtonBoundingClientRect()`. The system keeps drawing the capsule at
the right. Other pages keep the native bar and its back button. Its title is the
product name or the page's name in the account's language; before a session
is available it reads in Chinese, the catalogs' fallback.

The menu button opens a left sidebar that stops short of the capsule. It lists
the Events and People collections, then Trash, and ends with the account block:
the account's name, with its username in its own workspace or the workspace and
access in a shared one. The account block opens the account menu, which shows
the current workspace, switches workspace through a picker that searches names,
owners, and access, and opens Friends and Settings. Signing out asks
for confirmation first.

Event cards say only what differs from the workspace. A view-only badge marks an
Event the account cannot edit in a workspace where it can, and one line carries
the location, the number of accounts an Event is shared with, and who shared an
Event with the account. Access reads as a permission: owner, can edit, or view
only. Pages open with their title and content, without introductory hints.

## W05 Event creation and editing

The collection opens a focused native editor for new Events. An authorized
Event overview exposes the same editor to principals whose server-provided
access actions include Edit; a Viewer never receives an editable surface.
The collection offers creation only when the active workspace role is Owner or
Editor; direct navigation fails closed for Viewer and share-only access.
WeChat date and time pickers keep calendar dates distinct from instants, support
an optional end, and avoid free-form date entry. Timed fields are converted in
the Event's IANA time zone, and nonexistent daylight-saving wall times are
rejected before a request is sent.

Creation uses one cryptographically random `commandId` for the lifetime of the
draft. A lost response can therefore be retried without creating a second
canonical Event. Updates carry the source `version`. A conflict keeps the local
draft, refreshes the canonical Event, and presents the current values before
the user explicitly adopts the current Event or retries their draft against its
new version. No background overwrite is attempted.

Drafts are stored separately from the authentication session, partitioned by
user, workspace, and Event. At most twenty drafts are retained for seven days;
malformed or expired entries are ignored. Successful saves remove their draft
and invalidate both the Event collection and canonical overview query.

## W06 Event planning workspace

The Event overview opens planning depth through a lazy feature subpackage. The
main package retains launch, identity, workspace navigation, the Event
collection, and the small Event overview. The Event editor and planning
workspace have separate subpackage budgets and are loaded only when opened.

An Event layout contains user-named pages and ordered component references. An
Owner or Editor may add, rename, remove, and explicitly move pages and
components with touch controls. Viewers receive the same pages and projections
without layout controls. Removing a page or component updates only the layout;
it never deletes a Task, Expense, Reminder, or other canonical object.

Each visible component calls its existing authorized projection endpoint. A
canonical Task or Expense can therefore appear in several components while
retaining one object ID, version, permission scope, and audit history. Duplicate
components share workspace- and Event-scoped query keys rather than duplicating
stored data. Components not yet implemented by the Mini Program remain intact
in the layout and render a compatibility notice instead of being discarded.

Layout writes carry the current layout version and are never applied
optimistically. A failed request retains the intended pages for retry. A stale
version refreshes the canonical layout and requires an explicit choice between
the current layout and applying the pending change to the latest version. The
API remains the authorization and audit boundary for every read and write.

The To-dos component is interactive for Owners and Editors. Creation calls the
idempotent Event-context resource command, which creates one canonical Task,
relates it to the Event, and adopts the Event's permission scope in one server
transaction. Editing and one-tap completion carry the Task's expected version;
a stale editor save retains the local draft and requires an explicit choice
between the current Task and the draft. Viewers receive the same projection
without mutation controls.

Task drafts are bounded and partitioned by user, workspace, Event, and Task.
Successful mutations replace the matching cached canonical Task when present
and invalidate all Event projection keys, so Calendar, Timeline, and other
applicable views refresh without copied records. The Task editor preserves
date-only and timed due semantics, assigns existing To-do sections, and keeps
canonical IDs out of the normal interface. The To-dos component can show the
same Task records as a sectioned list, by due day, a navigable week or month,
or a day-based board. Date-only Tasks keep their calendar date; timed Tasks are
placed in the account time zone. Owners and Editors can manage To-do sections
through the existing API, while Viewers can switch presentations locally
without editing the shared layout. Deleting a section leaves its Tasks in the
Event without a section.

The Expenses component creates canonical Expenses through the idempotent
Event-context resource command. Owners and Editors may edit an Expense when
its own access decision allows it; a Viewer can read the projection but has no
mutation control. The form retains amount as decimal text, preserves an
unchanged transaction instant exactly, and converts an edited wall-clock time
using the account's effective time zone. The server validates the currency,
amount, permission scope, and expected version. A stale edit keeps the local
draft until the user chooses the latest record or deliberately retries against
the latest version. Drafts are bounded and partitioned by account, workspace,
Event, and Expense. Saving refreshes the Event's Expense and Timeline
projections without storing a second copy. Expense section assignment uses
existing Event sections; Expense section administration remains future Mini
Program work.

The Reminders component creates and edits canonical Reminders through the same
authorized Event-context and versioned resource APIs. Its native editor keeps
date, time, and status together, preserves an unchanged instant exactly, and
rejects invalid or nonexistent local times. The editor enforces the Reminder's
server-provided edit access; Viewers receive read-only rows.
Drafts are bounded and partitioned by account, workspace, Event, and Reminder.
A stale edit preserves the draft until the user adopts the latest record or
deliberately retries against it. Saving invalidates the Event projections so
Timeline and Reminder views read the same canonical record. This is record
editing; device alerts and delivery scheduling are not implemented here.

## W07 Files component

The Files component reads attachment targets and attachment lists through the
authorized API. A user can select the Event or one of its Tasks or Expenses,
then attach a file if the Event allows editing. The API checks the selected
parent's own permissions before issuing the upload ticket. Viewers can list and
open attachments they may access; the list reports additional attachments that
are hidden by document permissions without exposing their metadata.

Native selection accepts one temporary file up to 9 MiB. The Mini Program
reads its bytes to calculate SHA-256, requests a short-lived multipart upload
ticket, sends the file through `Taro.uploadFile`, and finalizes the canonical
Document only after the server accepts the bytes. The multipart endpoint has a
bounded body parser and passes the bytes to the existing document service. That
service rechecks access, size, checksum, expiry, and single use before storing
anything. With Tencent COS, the API forwards the verified bytes under a signed
private, encrypted, create-only PUT; the Mini Program never receives COS
credentials or an upload URL. The browser's raw PUT transfer remains available,
and the canonical attachment limit remains 25 MiB outside this native transport.

Opening a file first obtains a fresh authorized download ticket. Native
`Taro.downloadFile` writes to a temporary path using a short-lived API or signed
COS URL. Document formats supported by WeChat open with `Taro.openDocument`,
and common images open with `Taro.previewImage`. Other formats remain attached
but cannot be opened in the Mini Program. Active upload and download tasks are
aborted when cancelled or when the Files component closes. Selected and
downloaded temporary files are removed after use or when the component closes.
Tickets are short-lived and single use where served by the API; the Mini
Program does not store a permanent public file URL or query protected CloudBase
tables directly.

## Event sharing

The Event overview opens a native Sharing page when the API reports Share
permission or the caller holds a direct grant they can leave. Grant lists and
mutations use the authenticated Chronelle REST API. A Viewer with a direct
grant sees a read-only permission state and may leave; Share permission is
required to list or change other people's grants. The API remains the authority
for which roles can be granted, and revocation or leaving requires confirmation.

Sharing with a workspace Person who has an account creates a direct grant.
The native picker searches by name when a Person is not in the initial list.
Sharing with a Person without a linked account queues a share on an existing or
new friend request or invitation; access begins only after acceptance. For a
Person without an email, the page offers the opaque, server-issued invitation
URL returned by the Friends API for copying. That URL opens the existing web
claim page. No Event ID is treated as a token, and the Mini Program does not
construct a shareable Event URL. A direct email grant requires an existing
discoverable account; an unknown recipient must be represented by a Person card
to use the pending invitation flow. Native Mini Program invitation claiming and
WeChat share-card entry are not provided by the current API contract.

## Settings

The Settings page edits language, time zone, clock format, and first day of the
week through the authenticated account API. The Mini Program sends only changed
fields and updates the session view after a successful save, so Event dates and
times use the new preferences without creating a separate local account copy.
Time zone syntax is checked before submission; the API determines whether the
zone exists, independent of the device's available time zone data.

## Event history and restoration

The Event overview opens a lazy history subpackage. It reads twenty authorized
revision summaries at a time through the shared API client. A selected revision
shows its historical Event content and the server's typed comparison with the
current Event. Cards shorten long values; the selected comparison shows them
in full. Viewers can inspect history and the restore preview, but receive
no restore control. If a history read loses access, the page replaces protected
content with the permission-loss state.

Restoration applies only the server's eligible Event content. Identity,
permissions, relationships, lifecycle state, and system metadata retain their
current values. Before confirmation, the page refetches current access and the
restore preview. A changed current version requires the reader to review the
updated comparison and confirm again. The write sends the preview's
`expectedVersion` to the existing authorized restore endpoint. A version
conflict refreshes the Event and preview; it never retries automatically.
Successful restoration invalidates the Event list, overview, history, and
preview queries. The page does not store a local history copy or change Event
editor drafts.

## Native Trash and recovery

The sidebar links to a lazy Trash subpackage. `GET /api/trash` lists
only records for which the current principal has Recover permission in the
active workspace. The Mini Program keeps that list cursor-paginated and
filters by canonical object type; it does not persist copies of deleted
content or display object IDs. Selecting a row opens a focused preview from
`GET /api/objects/:id/recovery-preview`. The preview reflects the server's
current permission and scope checks, including a blocked parent or scope.

Restoration refetches the preview before an explicit confirmation and sends its
current `expectedVersion` to `POST /api/objects/:id/recover`. A changed target
or blocked recovery requires the user to review the updated preview. Restoring
a Task also restores subtasks removed with it; independently removed subtasks
stay in Trash. The API performs
authorization, optimistic concurrency, revision capture, and audit logging in
the same transaction. A stale version causes the Mini Program to refresh the
preview and ask for confirmation again. Lost access hides the former record
details and returns a generic unavailable state. A successful recovery
invalidates cached projections, so the original record reappears wherever it
belongs; an Event can be opened directly. Existing relationships are retained.

This slice does not expose permanent deletion or a client-side undo stack.
Undo and redo use the separate server command-history model and are deferred
until their native interaction and cross-client semantics are defined.

## People and Friends

The sidebar opens People, and the account menu opens Friends. People lists the
visible canonical Person records in the active workspace, with a debounced
server-side name search. The list is bounded to 100 records; a large workspace
can narrow it by search. Owner and Editor roles may create a Person, while an
existing Person is editable only when `GET /api/objects/:id/access` includes
`edit`. The form edits name, nickname, description, and ordered contacts. It
does not change labels, custom properties, or account links. Creation uses a
stable command ID for retries; updates carry the Person's expected version.
On conflict, the editor keeps the local values and requires a deliberate choice
between the latest record and retrying against its new version.

Friends is account-wide, not a workspace collection. It reads incoming
requests, accepted connections, and pending outgoing invitations through the
same authenticated REST client. A user may accept or decline a request,
withdraw an outgoing item, or remove a connection with confirmation. Email
and link invitations use the existing server endpoint. A link is copied only
on explicit action and opens the Chronelle web invitation page; the Mini
Program does not fabricate an invitation from an object ID or claim native
WeChat share-card behavior. The API remains responsible for privacy,
authorization, rate limits, and audit events. Account search, linking a
workspace Person to a friend, and broader Person fields remain for later
native slices.

## Local build

Install workspace dependencies, then build once or start the watcher:

```bash
TARO_APP_API_BASE_URL=https://api.example.com \
TARO_APP_CLOUDBASE_ENV_ID=your-cloudbase-environment-id \
TARO_APP_CLOUDBASE_USE_WX_CLOUD=false \
pnpm build:weapp
```

The API origin must be HTTPS outside loopback development. Set
`TARO_APP_CLOUDBASE_USE_WX_CLOUD=true` only for an environment associated with
the Mini Program through WeChat Cloud Development; an independent Tencent
CloudBase environment uses the default `false` HTTP path.

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

The [WeChat release-readiness checklist](wechat-release.md) covers production
build inputs, domain and environment checks, the current data inventory, device
evidence, monitoring, and rollback. Its preflight runs only when a real AppID
and deployment inputs are available.

A successful production compile and structural DevTools project validate W01's
build feasibility. Automated browser emulation does not validate a Mini Program
runtime. Physical iOS and Android behavior, Chinese IME, assistive technology,
network interruption, domain allowlists, privacy declarations, and submission
remain release evidence for the production-hardening slice.
