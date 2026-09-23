# Implemented Architecture

The [browser-only design sandbox](browser-sandbox.md) is a separate offline build
of the existing web screens. Its build-time adapters use fictional browser-local
data and do not participate in the production architecture described below.

Chronelle starts as a TypeScript modular monolith in a pnpm workspace. The web,
WeChat Mini Program, and API applications build independently while domain
contracts and database infrastructure remain explicit shared packages.

The first product slice is event planning. Canonical `Event`, `Task`,
`Expense`, `Reminder`, and `Document` records support event detail,
to-do, calendar, timeline, itinerary, expense, and reminder projections;
`Person` records begin the people family, which tasks and events will
reference by canonical ID.

## Non-negotiable invariant

An object has one canonical identity, can appear in many contexts, has one
canonical permission scope, and every human or AI access passes through the
same authorization decision.

Views will query canonical objects and first-class relationships. They will not
own copies of business fields. Typed tables will hold stable domain data while
the common `objects` table holds identity and lifecycle fields.

## Current module boundaries

- `apps/web` owns HTTP rendering and browser interaction.
- `apps/wechat` owns native Mini Program rendering and platform lifecycle. It
  uses Taro 4 with a package-local React 18 toolchain; it does not import the
  Next.js component tree or read protected CloudBase tables directly.
- `packages/api-client` owns authenticated REST transport, response validation,
  and normalized client errors.
- `apps/api` owns thin HTTP transport, authentication-provider composition,
  request principal resolution (the workspace a request acts in comes from
  the object it names when the caller may enter that workspace, else from
  the header or the personal workspace; the decision itself is unchanged),
  and personal-workspace bootstrap.
- `packages/authorization` owns the central permission policy, audited direct
  grant lifecycle, and PostgreSQL-backed access lookup.
- `packages/object-model` owns canonical Event, Task, Expense, Reminder, and
  Person lifecycle behavior, relationships, document workflows, event-plan
  projections, and authorized object search.
- `packages/schemas` owns contracts shared across process boundaries.
- `packages/storage` owns the provider-neutral private storage port and the
  local filesystem development adapter.
- `packages/db` owns ordered migration execution, Drizzle query mappings,
  UUIDv7 generation, database connections, and persistence integrity tests.
- `infrastructure/migrations` owns immutable PostgreSQL schema changes.

Each package must hide a concrete domain decision. Web and Mini Program UI stay
separate; only platform-neutral contracts and behavior move to shared packages.

## Persistence kernel

PostgreSQL owns schema constraints through immutable SQL migrations. Drizzle
maps the accepted schema for typed queries but does not generate or execute
migrations.

Every typed domain row references one canonical object through its workspace,
object ID, and fixed object type. Composite foreign keys prevent relations,
permission scopes, and grants from joining resources across workspaces.
Relationships never cascade-delete their endpoint objects. Audit events are
append-only at the database boundary.

The application generates UUIDv7 identifiers before persistence. This keeps
IDs sortable without relying on database-version-specific UUID functions.

## Runtime boundaries

`ReversibleCommandService` owns an explicit, bounded Event/Task content command
boundary. It references canonical revisions, applies compound edits through the
typed services, and persists user/workspace Undo/Redo stacks and idempotent
receipts in the same transaction. Existing mutation endpoints remain independent.
See [Reversible content commands](commands.md) for eligibility and rollout.

The Fastify API resolves each bearer credential through an `AuthProvider` to a
canonical Chronelle user ID, then resolves the active workspace. External
providers are normalized in `user_identities`; several explicitly linked
providers may identify the same user without changing that user's ID, personal
workspace, grants, objects, or audit history.
The session provider backs that credential with the `user_sessions` table: a
sign-in issues a random opaque token and stores only its SHA-256 digest with
the expiry, a request resolves the digest to a live session and its user, and
sign-out revokes one session or all of a user's sessions with an audit event.
The session store has a PostgreSQL implementation and a CloudBase one over the
`chronelle_session_*` functions, selected with the identity store. Sign-in
methods only assert an identity: the email and password method keeps the
scrypt hash, the email verification, and the failed-attempt lock in
`user_credentials` and emailed codes in `email_verifications` (a credential
store with the same two implementations; hashing and comparison happen in the
API, never in SQL; codes are issued at most once a minute and five times an
hour per account and purpose, refused ones silently); the development method
is registered when explicitly
enabled and asserts the submitted email. Outbound email is a port with a log
sender for development and an SMTP sender for deployments. CloudBase WeChat
authentication follows the same boundary: the server verifies the end-user
token, consumes its digest once, and issues a normal Chronelle session. Linking
requires an already authenticated user and never infers an account match from
profile data. Further providers can be added without changing sessions,
workspace, or authorization services.

The first sign-in transaction creates one user, one personal workspace, one
owner membership, and one audit event. A unique personal-owner constraint makes
this idempotent under concurrent requests.

`AuthorizationService.can(principal, action, resource)` is the only object
permission decision. It considers workspace membership, a direct grant, and
the resource's one canonical permission scope. It ignores relationships,
expired grants, and deleted resources. Workspace selection uses the same store
to require membership or an active grant.

Application mutations append audit events inside the business transaction.
Canonical object mutations additionally capture immutable typed revisions there,
and return the captured state. `runAuditedMutation` serves operations that do not
change canonical content, such as grant and transfer lifecycles. Failure to record
either required ledger entry rolls back the business change. Object services
validate state, authorize access, and atomically enforce the expected version.
See [Object revisions](revisions.md) for snapshot, history, and baseline contracts.

`withReadAuthorization` owns read transaction configuration and constructs an
evaluator bound to that transaction. Service constructors accept a database
connection; composed object/relation services instead receive an explicit
`{ database: transaction, authorization }` context from the owning boundary.
This keeps nested projection reads on one connection without starting savepoints
or opening independent snapshots. A bare transaction is rejected because a
savepoint cannot establish a new isolation level. Mutation composition supplies
the same context under `withStableAuthorization`, retaining the outer writer's
lock, isolation level, and uncommitted state. Contexts must not escape their
callback or pair a transaction with an unrelated evaluator.

Read responses represent one authorized database snapshot per service operation,
not a revocation barrier at response delivery. See [Permissions](permissions.md)
for expiry, workspace resolution, and in-flight read semantics. The implementation
uses PostgreSQL's [repeatable-read isolation](https://www.postgresql.org/docs/17/transaction-iso.html#XACT-REPEATABLE-READ);
it does not copy permission policy into projections or controllers.

Collection reads use the authorization package's `canMany()` and
`allowedActionsMany()` methods. Single-resource checks delegate to the same
implementation. The database store batches role lookup, while object-model owns
batched typed-state loading through `listVisibleObjects()` and `readObjectStates()`.
No controller, projection, or React component implements role precedence.
Statements handle at most 1,000 IDs at a time and share the owning snapshot;
repeated role lookups for the same canonical ID are memoized inside that
read-only snapshot, and there is no cross-request permission cache. See
[Authorization performance](authorization-performance.md) for query budgets.

`ObjectRestorationService` owns typed comparison, preview, and content
restoration. Its allowlist preserves security state and immutable typed facts.
The authorization package owns a workspace transaction boundary shared by
canonical mutations, context/link creation, document finalization and local
download consumption, restoration, and security mutations. Slow storage I/O
stays outside that boundary; permissions are rechecked before the final write.
One shared web History drawer presents this
capability without owning canonical state or open editor drafts.

Document bytes cross a `StorageProvider` port. The local adapter stores opaque
workspace-scoped keys below a configured private root, validates every resolved
path, creates directories and files with restrictive permissions, and verifies
size and SHA-256 before finalization. Its transfer URLs are API-relative and
opaque. The Tencent COS adapter returns short-lived signed provider URLs and
inspects actual object bytes without changing document-domain behavior. Provider
configuration and operational limits are described in [Storage](storage.md).

Local writes use a private sibling staging directory. The adapter flushes and
closes the file before linking it to the final key, so readers see either no
object or complete bytes. Publication never replaces an existing key; matching
size/checksum retries are idempotent and conflicting content is rejected.
Normal completion or failure removes only that attempt's staging directory.
An interrupted process can leave an unaddressable staging orphan; retention
and orphan reconciliation remain separate operations. The local root must be
trusted and support same-filesystem hard links.

Transfer credentials are random bearer secrets. PostgreSQL stores only their
hashes plus operation, resource, expected file metadata, expiry, consumption,
and finalization state. Upload authorization requires Edit on the parent.
Finalization reauthorizes that parent and atomically creates the canonical
Document, typed metadata, `attached_to` relationship, and audit event.
Download authorization requires View on the Document, and the local transfer
endpoint rechecks that permission before returning bytes. Local tokens expire
and are consumed once. Direct COS URLs remain reusable bearer capabilities
until expiry; provider access logs record actual transfers.

## Event-planning vertical slice

Fastify routes validate requests and delegate to domain services:

- `EventPlanningObjectService` manages canonical and typed rows as one unit.
- `ObjectRelationService` manages compatible, metadata-bearing links without
  owning either endpoint.
- `EventPlanningProjectionService` resolves event detail and focused views at
  read time, authorizing every returned object.
- `CanonicalObjectSearchService` queries the active workspace's PostgreSQL
  full-text index and applies the same View decision to every candidate before
  returning a compact canonical result.
- `ResourceGrantService` creates, lists, and revokes user grants only after the
  central policy permits Share on the canonical resource.
- `ObjectRevisionService` returns authorized history summaries and selected
  typed snapshots under a consistent database read transaction.
- `EventContextService` coordinates canonical creation and inclusion in one
  retry-safe transaction, reusing the object and relationship services.

The projection service stores no calendar, itinerary, timeline, or to-do
copies. Updating one canonical child changes every later projection response.
Deleting a relation only unlinks its endpoints; deleting an object is a
versioned soft deletion. Unauthorized and missing resources share one public
response to avoid existence leaks.

Focused projection endpoints select active `includes` targets of the requested
types before batched authorization and canonical-state retrieval. They do not
traverse `attached_to` links. Calendar and itinerary share scheduled-Event
selection; timeline maps the four dated planning types to one compact descriptor.
All reads remain in one authorization snapshot. The full detail endpoint retains
its document collections and generic locked-reference count.

This narrows candidate retrieval, not the size of each relevant collection.
The canonical-state reader still uses its shared typed-table joins; focused
projections do not have a second object decoder. The web shell reads the
canonical Event and its access actions independently. Full detail is enabled
only for Overview, Files, and Sharing; focused tabs request their own projection
without traversing the full detail response. Large projections remain
unpaginated.

Search stores no second object representation. Results contain the canonical
ID, type, display name, permission scope, version, and update time read from
`objects`. The query supports a name phrase, one optional object-type filter,
and visibility-aware keyset pagination. The authorization evaluator supplies a
SQL predicate using the same role expressions, action policy, and evaluation
instant as individual and batched reads. PostgreSQL filters active authorized
objects before sorting and fetching at most the page limit plus one. Search
has no fixed private-candidate cutoff and returns no totals. See
[the search contract](api.md#search) for cursor behavior and consistency limits.

React components do not contain authorization or domain business logic.

The Event collection also applies the evaluator's SQL View predicate before
LIMIT. Its focused query function stays behind `EventPlanningObjectService`;
no second public service or general query framework is introduced. It selects
at most `limit + 1` authorized positions, then hydrates only the returned page
through the canonical typed-state mapper in the same read-only snapshot.
Nonempty pages use three service statements, including snapshot configuration.
Name/period filters and date/name/updated keyset ordering run in PostgreSQL.
The API, typed client, and Events screen share the [collection contract](api.md#event-collection).

Active relation listing stays behind `ObjectRelationService`, with a focused
page query. It first authorizes the starting object, then uses a bounded lateral
lookup for the opposite canonical endpoint and the central SQL View predicate.
This keeps endpoint equality inside the policy lookup even with poor table
statistics. Visibility precedes the outer page limit, and metadata comes from
the same snapshot. Three service statements return at most 50 links; database
scan and sort work is not constant-time. See [Relationships](api.md#relationships).

The API transport boundary owns safe error envelopes, request metadata logs,
private cache headers, and parser limits. Shared HTTP limits live in schemas;
the same-origin proxy counts incoming bytes and applies one deadline across
body receipt and upstream work. Request buffers grow only as bytes arrive and
responses remain streamed. These transport checks do not replace authorization,
mutation transactions, or ingress concurrency controls. See [API](api.md) and
[Deployment](deployment.md) for error, cancellation, and observability contracts.

## Workspace isolation and RLS

Application queries constrain rows by the authenticated workspace, composite
foreign keys prevent cross-workspace references, and every protected result is
checked by `AuthorizationService`. Adversarial integration tests cover forged
workspace selection, relation traversal, projections, search, and files.

The private container stack separates the runtime login from the migration
owner and applies an explicit PostgreSQL table-privilege policy. See
[Database privilege boundary](deployment.md#database-privilege-boundary).
Host development defaults still use the owner account. PostgreSQL RLS remains
deferred until every protected query binds the request workspace to a
transaction-local setting; session-level settings could leak between pooled
requests. Table privileges do not replace per-resource authorization.
Fine-grained permission logic will remain in the application after RLS is added.

## Web client boundary

The Next.js application renders a responsive workspace and forwards same-origin
`/api` requests to the Fastify process through a narrow route handler. The
upstream origin is server-only configuration, so browser code does not contain
deployment topology or cross-origin policy.

The same handler owns the session cookie described under the client below.
The web request boundary issues per-response script nonces and the root layout
renders HTML dynamically. Document responses cannot be cached; static bundles
retain immutable caching. The production script policy blocks unapproved
parser scripts, inline handlers, and string evaluation while allowing the
nonced framework runtime and its descendants. This boundary does not authenticate
requests or change canonical permissions. See [Deployment](deployment.md#script-content-security-policy)
for the rendering tradeoff and remaining public-launch requirements.

`ChronelleApiClient` attaches the active workspace (and a bearer token when
the caller holds one), validates every successful response against the shared
Zod contract, and turns API errors into one typed error. In the browser the
session is an httpOnly, `SameSite=Lax` cookie owned by the web origin: the
`/api` route handler sets it from a sign-in response, presents it to the API as
the bearer credential (an explicit bearer header takes precedence, so API
scripting through the origin still works), and clears it on sign-out. Page
scripts never see the token; a tab keeps only its active workspace in
`sessionStorage`, with an in-memory fallback, and a new tab discovers the
session by asking `/api/auth/session` with the cookie when a readable
presence marker says one exists. No authentication provider rules enter the
domain layer.
The workspace shell can switch between the user's personal workspace and
workspaces discovered through active resource grants. If the active workspace
is revoked, the shell clears protected query state and returns to the personal
workspace.

Each sign-in, sign-out, or workspace change synchronously aborts the previous
session lifetime and remounts its query cache, API client, and UI subtree. The
generation is an opaque counter, not a credential. A return to the same workspace
creates a fresh lifetime: old requests, drawers, and drafts cannot become active
again. Selecting the already active workspace is a no-op. Browser-storage errors
do not block these in-memory transitions.

Loaded pages and continuation cursors belong to that session lifetime. Returning
to a workspace starts from its first page. Event and Search filters, ordering,
and canonical item deduplication remain unchanged; each page request receives
its own query cancellation signal. Lifecycle actions retain an exact inclusion
lookup, so links beyond the first page remain removable.

The typed client pins credentials for each request and the complete attachment
workflow, checks the lifetime after asynchronous boundaries, and forwards
cancellation to both API and signed-transfer fetches. Signed transfers carry only
their issued headers, never the application's bearer credential. Query functions
pass TanStack Query's [cancellation signal](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation)
through `client.withSignal(signal)`, which combines caller cancellation with the
client's optional session-lifetime `signal`:

```typescript
const client = new ChronelleApiClient({
  getCredential: () => credential,
  signal: sessionController.signal,
});
const events = await client.withSignal(querySignal).listEvents();
```

Cancellation rejects abandoned results even when a transport ignores its signal.
It is not a server-side rollback: a submitted mutation may already have committed,
and an issued signed URL remains valid until expiry. Existing command IDs and
version preconditions remain stable for uncertain retries within one active
session; abandoned mutations are not automatically replayed in another session.
Backend authorization remains authoritative for every request.

## WeChat Mini Program boundary

The Mini Program is a separate Taro presentation layer. Its native shell
composes the provider-neutral API client, verified identity exchange, and
Chronelle session storage into workspace-scoped Event reads.
Every protected read and mutation therefore reaches the same Fastify
routes, transaction-bound authorization, version checks, and audit ledger as the
web client. File hashing and binary transfer are independent platform ports;
Mini Program attachment support does not require browser-global emulation.
CloudBase bootstraps a verified WeChat identity, but it does not become an
alternate data or permission boundary. The client persists only the opaque
Chronelle token; account linking is explicit and server-authorized.

Platform-specific concerns remain in `apps/wechat`: app lifecycle, network
state, storage, file selection and transfer, touch navigation, safe areas, and
Mini Program package structure. Schemas, canonical identifiers, REST behavior,
and invalidation semantics remain shared. See [WeChat Mini Program](wechat.md).

TanStack Query receives focus from Mini Program show/hide events and online
state from native network events. Switching the active workspace cancels
in-flight work, rewrites only the workspace selector beside the same bearer
token, and clears the client cache before protected reads resume. Event list and
overview responses retain the canonical ID and version returned by the API; the
Mini Program does not create a parallel Event or calendar record.

Task writes follow the same boundary. The Mini Program creates a Task through
the Event-context command so the object, `includes` relation, and canonical
permission scope are established atomically. Updates and completion target that
Task by version, remain authorized and audited by the API, and invalidate the
Event's projection-key prefix. Local editor drafts contain only bounded
recoverable input; they are not canonical records or an offline write queue.

The native Event editor sends the same typed create and update payloads as the
web client. Creation drafts retain one cryptographically random command ID so an
uncertain retry is idempotent. Edit drafts retain the canonical source version;
a `version_conflict` response keeps the draft, refreshes the current Event, and
requires an explicit choice before rebasing or discarding it. Draft storage is
partitioned by user, workspace, and canonical Event, expires after seven days,
and retains at most twenty entries. It never stores CloudBase credentials.
Successful mutations invalidate the Event collection and canonical overview.

Event editing and planning depth compile as lazy Mini Program subpackages, so
launch, identity, navigation, and the Event collection retain a bounded main
package. The planning subpackage reads the canonical Event layout and renders
only the pages and component references the user selected. To-dos, Calendar,
Timeline, Itinerary, Expenses, and Reminders call their existing authorized
projection endpoints; the layout never owns copies of their business fields.
Removing or moving a component changes only the versioned layout.

Layout writes are pessimistic and carry the current layout version. Network
failure retains the proposed pages for an explicit retry. A
`version_conflict` refreshes the current layout and requires the user to accept
it or apply the retained change against its latest version. Owner and Editor
controls are derived from the server-provided access actions, while the API
reauthorizes and audits every write. Unsupported component kinds remain in the
layout and render a compatibility notice until their native slice is available.

TanStack Query owns remote state and invalidation. Event detail, calendar,
timeline, itinerary, expenses, reminders, and to-dos retain separate query
results, but every item carries the canonical object ID returned by the API.
Canonical mutations invalidate cached event contexts, object attachments, and
search results across the active session, since one object can appear in many
contexts. Only active queries refetch immediately; inactive views become stale
and reload when opened. Event views wait for the browser URL before enabling
view-specific reads, including during hydration of a bookmarked tab. Overview
mounts its summary calculations and clock only while visible. Full-detail and
projection errors stay in their tab, leaving the header editor and navigation
available. Mutations invalidate the canonical Event and all affected contexts;
disabled views refetch when selected, not on every mutation. An already-started
request may finish into its session-owned cache after a tab switch; session
changes still cancel outstanding work and discard that cache.

An open editor keeps its pinned source object, version, and typed field draft
in one state. Changing object identity, explicitly loading the latest source,
or accepting a successful save initializes fields with that source. Background
updates to the same object preserve the draft. Each form supplies its field
initializer and partial creation reset; currency and timestamp semantics stay
with the typed form.

Event, scheduled Event, Task, Expense, and Reminder forms compose the same
save/cancel and conflict controls. Refresh invalidates server reads before
resetting the mutation error; only explicit discard accepts the latest
source. Each form owns its typed fields, create/reset defaults, and submit
payload. These client controls do not replace backend authorization or version
checks.

Background updates preserve the draft and require explicit discard-and-reload
before saving against a newer version. HTTP 409 conflicts preserve the draft as
well. Inputs are disabled during save, and a successful save advances the
editor's source version.

Date badges in Events, Calendar, and Reminders share day/month formatting and
unscheduled placeholders. Display and datetime-local input conversion use the
browser's locale and timezone; they do not reinterpret an Event in its stored
timezone. Formatters resolve runtime defaults on each call. Month casing stays
with each view. Typed submit handlers retain their resource-specific payloads
and creation resets; shared draft state and controls own the common lifecycle.

Event, Task, Expense and Reminder recovery share one authenticated-tab store with a twenty-draft
limit. Snapshots preserve typed fields, source versions and creation receipts;
they are not canonical records or browser storage. Creation keys include the
parent Event and resource kind; edit keys use the canonical object ID. Resuming
checks current access before showing fields. Known parent access loss clears its
creation drafts, while canonical child edits require their own access decision.
Pending saves remain tracked across unmounts, and late results cannot repopulate
a cleared session. See [Editor recovery](web-experience.md) for lifetime limits.

Task, Expense and Reminder inspectors share a fresh-read access boundary. Typed canonical
reads and access queries must both settle before cached fields become visible.
Temporary refresh failures preserve an approved editor; definitive denial clears
its retained draft. Expense amounts remain decimal text, and name-only edits
preserve the original transaction instant, including seconds and milliseconds.
The planning editors share focus/discard behavior and lossless local-instant
conversion while keeping typed fields and payloads domain-specific. Reminder
metadata edits omit status, preserving dismissed, triggered and cancelled records.
Recording a Reminder does not schedule notification delivery.

The Event Sharing view is capability-driven: only principals with Share see
grant administration, while Viewers receive read-only planning panels. Owners
can stop a child object's inheritance with a versioned permission-scope
mutation. Locked relationships render as a generic count; inaccessible IDs,
types, and fields never enter the client response.

The workspace includes a dedicated Search view. Its typed filter is sent to the
API; the browser never filters an unrestricted object collection. Event tabs
use the ARIA `tablist`, `tab`, and `tabpanel` roles with arrow, Home, and End
keyboard navigation. The shell provides a keyboard-visible skip link, and
narrow-screen layouts keep forms and result actions in a single usable column.

Creating an included planning resource uses one create-in-context command. The
canonical object, typed row, `includes` relationship, revision, both business
audit events, and command receipt commit together. A user/workspace-scoped command
ID serializes duplicate requests and replays the original creation result after
reauthorization. A retry never reverses later edits or restores an unlinked
relationship. Existing standalone create and relation routes remain available.
Trash uses an authorization-owned Owner predicate over canonical tombstones.
Object recovery advances the existing object and revision ledger; independent
link recovery advances only the relation generation and audit. Both use the
workspace security fence. The browser presents version-pinned confirmation
dialogs separately from content restoration. See [Recovery](recovery.md).
History and recovery share a native-dialog lifecycle hook. Opening captures
the trigger; closing returns focus to that trigger or to the workspace content
when the trigger was removed. Both dialogs close when the access token or
workspace changes. Their content, labels, and cancel actions remain local to
each feature; this client lifecycle does not replace backend authorization.
The Event/Task Undo/Redo API is implemented; editor controls and lifecycle/link
inverses remain planned.

PostgreSQL is the canonical data store. Object files are accessed through the
storage interface and stored outside PostgreSQL. Provider adapters keep
CloudBase identity and Tencent COS concerns out of the domain layer.

[Event pages](event-pages.md) store presentation separately in append-only
`event_page_revisions`. The owning Event supplies the permission boundary;
layout versions are independent from canonical object versions. Components
query existing protected projections and never own copies of business records.
History reads are paginated. Restoration appends a snapshot and its audit event
atomically; it does not rewrite earlier revisions. Layout undo/redo keeps bounded
session-local version references and calls the same authorized restore API.
