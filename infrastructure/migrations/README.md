# SQL Migrations

Store immutable PostgreSQL migrations here using names such as
`0001_create_core_objects.sql`. The migration runner applies files in lexical
order and records their SHA-256 checksums.

The first migration establishes users, workspaces, canonical objects,
relations, grants, append-only audit events, and the minimal typed tables for
the event-planning slice. SQL migrations are the schema authority; the Drizzle
definitions in `packages/db` map the accepted schema for typed queries.

Never edit a migration after it has been applied to a shared database. Add the
next ordered migration instead.
