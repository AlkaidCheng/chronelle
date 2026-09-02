# SQL Migrations

Store immutable PostgreSQL migrations here using names such as
`0001_create_core_objects.sql`. The migration runner applies files in lexical
order and records their SHA-256 checksums.

The facade contains no domain tables. The first vertical-slice migration will
introduce users, workspaces, canonical objects, relations, grants, audit events,
and typed travel tables together with their integrity constraints.
