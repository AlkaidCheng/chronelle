# Implemented Architecture

Chronelle starts as a TypeScript modular monolith in a pnpm workspace. The web
and API applications deploy independently while domain contracts and database
infrastructure remain explicit shared packages.

The first product slice is event planning. Canonical `Event`, `Task`,
`Expense`, `Reminder`, and `Document` records support event detail,
to-do, calendar, timeline, itinerary, expense, and reminder projections.

## Non-negotiable invariant

An object has one canonical identity, can appear in many contexts, has one
canonical permission scope, and every human or AI access passes through the
same authorization decision.

Views will query canonical objects and first-class relationships. They will not
own copies of business fields. Typed tables will hold stable domain data while
the common `objects` table holds identity and lifecycle fields.

## Current module boundaries

- `apps/web` owns HTTP rendering and browser interaction.
- `packages/api-client` owns authenticated REST transport, response validation,
  and normalized client errors.
- `apps/api` owns thin HTTP transport, authentication-provider composition,
  request principal resolution, and personal-workspace bootstrap.
- `packages/authorization` owns the central permission policy, audited direct
  grant lifecycle, and PostgreSQL-backed access lookup.
- `packages/object-model` owns canonical Event, Task, Expense, and Reminder
  lifecycle behavior, relationships, document workflows, event-plan
  projections, and authorized object search.
- `packages/schemas` owns contracts shared across process boundaries.
- `packages/storage` owns the provider-neutral private storage port and the
  local filesystem development adapter.
- `packages/db` owns ordered migration execution, Drizzle query mappings,
  UUIDv7 generation, database connections, and persistence integrity tests.
- `infrastructure/migrations` owns immutable PostgreSQL schema changes.

Each package must hide a concrete domain decision; shared UI remains inside
`apps/web` until more than one application needs it.

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

The Fastify API resolves each bearer credential through an `AuthProvider`, then
maps the resulting external identity to a Chronelle user and active workspace.
The development adapter issues random opaque tokens, stores only token digests,
and is registered only when explicitly enabled. A production adapter can
replace it without changing workspace or authorization services.

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

`ObjectRestorationService` owns typed comparison, preview, and content
restoration. Its allowlist preserves security state and immutable typed facts.
The authorization package owns a workspace transaction boundary shared by
restore and security mutations. One shared web History drawer presents this
capability without owning canonical state or open editor drafts.

Document bytes cross a `StorageProvider` port. The local adapter stores opaque
workspace-scoped keys below a configured private root, validates every resolved
path, creates directories and files with restrictive permissions, and verifies
size and SHA-256 before finalization. Its transfer URLs are API-relative and
opaque; a Tencent COS adapter can instead return signed provider URLs without
changing document-domain behavior.

Transfer credentials are random bearer secrets. PostgreSQL stores only their
hashes plus operation, resource, expected file metadata, expiry, consumption,
and finalization state. Upload authorization requires Edit on the parent.
Finalization reauthorizes that parent and atomically creates the canonical
Document, typed metadata, `attached_to` relationship, and audit event.
Download authorization requires View on the Document, and the local transfer
endpoint rechecks that permission before returning bytes. Tokens expire and
are consumed once.

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

Search stores no second object representation. Results contain the canonical
ID, type, display name, permission scope, version, and update time read from
`objects`. The V1A query supports a name phrase, one optional object-type
filter, and a bounded result count. It intentionally omits totals because a
count before authorization could reveal protected matches.

React components do not contain authorization or domain business logic.

## Workspace isolation and RLS

Application queries constrain rows by the authenticated workspace, composite
foreign keys prevent cross-workspace references, and every protected result is
checked by `AuthorizationService`. Adversarial integration tests cover forged
workspace selection, relation traversal, projections, search, and files.

PostgreSQL RLS is deferred until the API uses a separate least-privilege runtime
role and binds each request workspace to a transaction-local database setting.
The current pooled connection uses the migration owner and does not wrap every
read in a request transaction. Enabling policies in that model would either be
bypassable by the owner or risk workspace state leaking between pooled
statements. Fine-grained permission logic will remain in the application after
RLS is added.

## Web client boundary

The Next.js application renders a responsive workspace and forwards same-origin
`/api` requests to the Fastify process through a narrow route handler. The
upstream origin is server-only configuration, so browser code does not contain
deployment topology or cross-origin policy.

`ChronelleApiClient` attaches the active credential and workspace, validates
every successful response against the shared Zod contract, and turns API errors
into one typed error. An expiring development credential is kept in
`sessionStorage`; no authentication provider rules enter the domain layer.
The workspace shell can switch between the user's personal workspace and
workspaces discovered through active resource grants. If the active workspace
is revoked, the shell clears protected query state and returns to the personal
workspace.

TanStack Query owns remote state and invalidation. Event detail, calendar,
timeline, itinerary, expenses, reminders, and to-dos retain separate query
results, but every item carries the canonical object ID returned by the API.
Canonical mutations invalidate cached event contexts, object attachments, and
search results across the active session, since one object can appear in many
contexts. Only active queries refetch immediately; inactive views become stale
and reload when opened. The Event overview fetches detail, access, and timeline;
other projections load on demand, with errors confined to the affected tab.

An open editor pins its source object and version. Background updates preserve
the draft and require explicit discard-and-reload before saving against a newer
version. HTTP 409 conflicts preserve the draft as well. Inputs are disabled during
save, and a successful save advances the editor's source version.

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
Restoration, trash, and undo/redo remain planned capabilities.

PostgreSQL is the canonical data store. Object files are accessed through the
storage interface and stored outside PostgreSQL. Provider adapters keep
CloudBase identity and Tencent COS concerns out of the domain layer.
