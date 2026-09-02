# Implemented Architecture

Chronelle starts as a TypeScript modular monolith in a pnpm workspace. The web
and API applications deploy independently while domain contracts and database
infrastructure remain explicit shared packages.

## Non-negotiable invariant

An object has one canonical identity, can appear in many contexts, has one
canonical permission scope, and every human or AI access passes through the
same authorization decision.

Views will query canonical objects and first-class relationships. They will not
own copies of business fields. Typed tables will hold stable domain data while
the common `objects` table holds identity and lifecycle fields.

## Current module boundaries

- `apps/web` owns HTTP rendering and browser interaction.
- `apps/api` owns transport concerns and composes application modules.
- `packages/schemas` owns contracts shared across process boundaries.
- `packages/db` owns ordered migration execution and integrity checks.
- `infrastructure/migrations` owns immutable PostgreSQL schema changes.

The facade intentionally does not create empty packages for future concepts.
Authorization, object-model, storage, and API-client packages will appear with
the first behavior that needs them.

## Runtime boundaries

The Fastify API is the only planned entry point to application mutations. Each
mutation will validate, authenticate, authorize, check concurrency, transact,
write an audit event, and return a typed response. React components will not
contain authorization or domain business logic.

PostgreSQL is the canonical data store. Object files will be accessed through a
storage interface and stored outside PostgreSQL. Provider adapters will keep
CloudBase identity and Tencent COS concerns out of the domain layer.
