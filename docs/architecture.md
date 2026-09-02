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
- `packages/authorization` owns the central permission policy and its
  PostgreSQL-backed access lookup.
- `packages/object-model` owns canonical Event, Task, Expense, and Reminder
  lifecycle behavior, relationships, and event-plan projections.
- `packages/schemas` owns contracts shared across process boundaries.
- `packages/db` owns ordered migration execution, Drizzle query mappings,
  UUIDv7 generation, database connections, and persistence integrity tests.
- `infrastructure/migrations` owns immutable PostgreSQL schema changes.

The storage package will appear with the first secure-document behavior that
needs it. Each package must hide a concrete domain decision; shared UI remains
inside `apps/web` until more than one application needs it.

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

Application mutations use `runAuditedMutation`, which appends one audit event
inside the same database transaction. An invalid audit record therefore rolls
back the business change. Object services validate state, authorize access,
and atomically enforce the expected object version before writing typed data.

## Event-planning vertical slice

Fastify routes validate requests and delegate to three domain services:

- `EventPlanningObjectService` manages canonical and typed rows as one unit.
- `ObjectRelationService` manages compatible, metadata-bearing links without
  owning either endpoint.
- `EventPlanningProjectionService` resolves event detail and focused views at
  read time, authorizing every returned object.

The projection service stores no calendar, itinerary, timeline, or to-do
copies. Updating one canonical child changes every later projection response.
Deleting a relation only unlinks its endpoints; deleting an object is a
versioned soft deletion. Unauthorized and missing resources share one public
response to avoid existence leaks.

React components do not contain authorization or domain business logic.

## Web client boundary

The Next.js application renders a responsive workspace and forwards same-origin
`/api` requests to the Fastify process through a narrow route handler. The
upstream origin is server-only configuration, so browser code does not contain
deployment topology or cross-origin policy.

`ChronelleApiClient` attaches the active credential and workspace, validates
every successful response against the shared Zod contract, and turns API errors
into one typed error. An expiring development credential is kept in
`sessionStorage`; no authentication provider rules enter the domain layer.

TanStack Query owns remote state and invalidation. Event detail, calendar,
timeline, itinerary, expenses, reminders, and to-dos retain separate query
results, but every item carries the canonical object ID returned by the API.
Mutations invalidate all projections for the source Event. Forms use the latest
returned version, and HTTP 409 conflicts remain visible until the user refreshes
the current canonical value.

Creating an included planning resource currently uses two independently
audited API mutations: create the scoped canonical object, then create its
`includes` relationship. If the second request fails, the object remains valid
but unlinked. A future application command can make this interaction atomic
when recovery and product behavior are defined.

PostgreSQL is the canonical data store. Object files will be accessed through a
storage interface and stored outside PostgreSQL. Provider adapters will keep
CloudBase identity and Tencent COS concerns out of the domain layer.
