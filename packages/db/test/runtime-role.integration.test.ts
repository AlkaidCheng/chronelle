import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { promisify } from "node:util";
import postgres from "postgres";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "../src/testing.js";

const execute = promisify(execFile);
const infrastructure = resolve(import.meta.dirname, "../../../infrastructure");

describe("runtime database privileges", () => {
  let database: TestDatabase;
  let admin: postgres.Sql;
  let runtime: postgres.Sql;
  let role: string;
  let password: string;

  async function provision(overrides: NodeJS.ProcessEnv = {}) {
    const url = new URL(database.databaseUrl);
    return execute(
      "psql",
      [
        "-X",
        "--no-password",
        "--file",
        resolve(infrastructure, "database/runtime-role.sql"),
      ],
      {
        env: {
          ...process.env,
          PGHOST: url.hostname,
          PGPORT: url.port,
          PGUSER: decodeURIComponent(url.username),
          PGPASSWORD: decodeURIComponent(url.password),
          PGDATABASE: url.pathname.slice(1),
          CHRONELLE_RUNTIME_ROLE: role,
          RUNTIME_DATABASE_PASSWORD: password,
          ...overrides,
        },
        timeout: 10_000,
      },
    );
  }

  beforeEach(async () => {
    database = await createTestDatabase();
    const adminUrl = new URL(database.databaseUrl);
    adminUrl.pathname = "/postgres";
    admin = postgres(adminUrl.toString(), { max: 1, onnotice: () => {} });
    role = `chronelle_runtime_${randomUUID().replaceAll("-", "")}`;
    password = randomUUID();
    const runtimeUrl = new URL(database.databaseUrl);
    runtimeUrl.username = role;
    runtimeUrl.password = password;
    runtime = postgres(runtimeUrl.toString(), { max: 1, onnotice: () => {} });
    await applyMigrations(
      { DATABASE_URL: database.databaseUrl },
      resolve(infrastructure, "migrations"),
    );
  });

  afterEach(async () => {
    await runtime?.end();
    await database?.close();
    if (admin) {
      try {
        await admin`DROP ROLE IF EXISTS ${admin(role)}`;
      } finally {
        await admin.end();
      }
    }
  });

  it("provisions a repeatable login with explicit table operations", async () => {
    await provision();
    const repeated = await provision();
    expect(repeated.stdout + repeated.stderr).not.toContain(password);
    expect(await runtime`SELECT current_user AS name`).toEqual([
      { name: role },
    ]);
    const [flags] =
      await runtime`SELECT rolsuper, rolcreatedb, rolcreaterole, rolinherit, rolreplication, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
    expect(Object.values(flags ?? {})).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    const privileges = await runtime`
      SELECT tablename AS name,
        has_table_privilege(current_user, format('public.%I', tablename), 'SELECT') AS read,
        has_table_privilege(current_user, format('public.%I', tablename), 'INSERT') AS insert,
        has_table_privilege(current_user, format('public.%I', tablename), 'UPDATE') AS update,
        has_table_privilege(current_user, format('public.%I', tablename), 'DELETE') AS delete
      FROM pg_tables WHERE schemaname = 'public'
    `;
    for (const table of privileges) {
      expect(table.read).toBe(table.name !== "chronelle_schema_migrations");
      expect(table.insert).toBe(table.name !== "chronelle_schema_migrations");
      expect(table.update).toBe(
        [
          "workspaces",
          "workspace_members",
          "objects",
          "object_relations",
          "resource_grants",
          "events",
          "tasks",
          "expenses",
          "reminders",
          "document_transfer_authorizations",
          "command_stacks",
          "user_sessions",
          "user_credentials",
          "email_verifications",
          "labels",
          "task_labels",
          "persons",
        ].includes(table.name),
      );
      expect(table.delete).toBe(
        ["resource_grants", "labels", "task_labels"].includes(table.name),
      );
    }
  });

  it.each([
    "CREATE TABLE public.runtime_probe (id integer)",
    "CREATE TEMP TABLE runtime_probe (id integer)",
    "CREATE SCHEMA runtime_probe",
    "ALTER TABLE objects DISABLE TRIGGER ALL",
    "DROP TABLE command_receipts",
    "TRUNCATE objects",
    "DELETE FROM objects",
    "DELETE FROM object_relations",
    "UPDATE audit_events SET action = 'forged'",
    "UPDATE object_revisions SET object_version = 99",
    "UPDATE event_context_commands SET request_hash = repeat('0', 64)",
    "UPDATE object_create_commands SET request_hash = repeat('0', 64)",
    "UPDATE command_receipts SET request_hash = repeat('0', 64)",
    "UPDATE event_page_revisions SET pages = '[]'",
    "DELETE FROM event_page_revisions",
    "TRUNCATE event_page_revisions",
    "SELECT * FROM chronelle_schema_migrations",
    "SET session_replication_role = replica",
  ])("denies administrative or destructive SQL: %s", async (statement) => {
    await provision();
    await expect(runtime.unsafe(statement)).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("removes public and column grants without granting future tables", async () => {
    await provision();
    const sql = database.connection.sql;
    await sql`GRANT SELECT ON chronelle_schema_migrations TO PUBLIC`;
    await sql`GRANT UPDATE (action) ON audit_events TO ${sql(role)}`;
    await sql`GRANT UPDATE (action) ON audit_events TO PUBLIC`;
    await provision();
    await expect(
      runtime`UPDATE audit_events SET action = 'forged'`,
    ).rejects.toMatchObject({ code: "42501" });
    await expect(
      runtime`SELECT * FROM chronelle_schema_migrations`,
    ).rejects.toMatchObject({ code: "42501" });
    await sql`CREATE TABLE runtime_probe (id integer)`;
    await expect(runtime`SELECT * FROM runtime_probe`).rejects.toMatchObject({
      code: "42501",
    });
    await sql`CREATE FUNCTION runtime_probe_function() RETURNS integer LANGUAGE sql AS 'SELECT 1'`;
    await expect(
      runtime`SELECT runtime_probe_function()`,
    ).rejects.toMatchObject({ code: "42501" });
  });

  it.each([
    "SUPERUSER",
    "CREATEDB",
    "CREATEROLE",
    "REPLICATION",
    "BYPASSRLS",
    "INHERIT",
    "NOLOGIN",
  ])("refuses an existing privileged role: %s", async (attribute) => {
    await provision();
    await admin.unsafe(`ALTER ROLE "${role}" ${attribute}`);
    await expect(provision()).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Runtime role must be an unprivileged login",
      ),
    });
  });

  it("refuses role membership and ownership", async () => {
    await provision();
    await admin`GRANT pg_read_all_data TO ${admin(role)}`;
    await expect(provision()).rejects.toMatchObject({
      stderr: expect.stringContaining("without membership or ownership"),
    });
    await admin`REVOKE pg_read_all_data FROM ${admin(role)}`;
    const sql = database.connection.sql;
    await sql`CREATE TABLE runtime_probe (id integer)`;
    await sql`ALTER TABLE runtime_probe OWNER TO ${sql(role)}`;
    await expect(provision()).rejects.toMatchObject({
      stderr: expect.stringContaining("without membership or ownership"),
    });
  });

  it("rejects invalid settings without exposing the password", async () => {
    const invalidPassword = "private'configuration";
    try {
      await provision({ RUNTIME_DATABASE_PASSWORD: invalidPassword });
      expect.fail("Invalid configuration was accepted");
    } catch (error) {
      expect(error).toMatchObject({
        stderr: expect.stringContaining(
          "Invalid runtime role or password configuration",
        ),
      });
      expect(String(error)).not.toContain(invalidPassword);
    }
    await expect(
      provision({ CHRONELLE_RUNTIME_ROLE: "postgres" }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Invalid runtime role or password configuration",
      ),
    });
    expect(
      await admin`SELECT FROM pg_roles WHERE rolname = ${role}`,
    ).toHaveLength(0);
  });

  it("rejects a cluster parameter grant that could disable integrity checks", async () => {
    await provision();
    await admin`GRANT SET ON PARAMETER session_replication_role TO ${admin(role)}`;
    try {
      await expect(provision()).rejects.toMatchObject({
        stderr: expect.stringContaining("external cluster grants"),
      });
    } finally {
      await admin`REVOKE SET ON PARAMETER session_replication_role FROM ${admin(role)}`;
    }
  });

  it("rolls back role creation and privilege changes when the schema is incomplete", async () => {
    await database.connection.sql`DROP TABLE documents`;
    await expect(provision()).rejects.toMatchObject({
      stderr: expect.stringContaining(
        'relation "public.documents" does not exist',
      ),
    });
    expect(
      await admin`SELECT FROM pg_roles WHERE rolname = ${role}`,
    ).toHaveLength(0);
    const [privileges] = await database.connection.sql`
      SELECT datacl FROM pg_database WHERE datname = current_database()
    `;
    expect(privileges?.datacl).toBeNull();
  });

  it("updates the login password without exposing either secret", async () => {
    await provision();
    const nextPassword = randomUUID();
    const response = await provision({
      RUNTIME_DATABASE_PASSWORD: nextPassword,
    });
    expect(response.stdout + response.stderr).not.toContain(password);
    expect(response.stdout + response.stderr).not.toContain(nextPassword);
    await expect(runtime`SELECT current_user`).rejects.toMatchObject({
      code: "28P01",
    });
    const url = new URL(database.databaseUrl);
    url.username = role;
    url.password = nextPassword;
    const renewed = postgres(url.toString(), { max: 1 });
    try {
      expect(await renewed`SELECT current_user AS name`).toEqual([
        { name: role },
      ]);
    } finally {
      await renewed.end();
    }
  });

  it("rejects reuse of the supplied administrative password", async () => {
    await provision();
    await expect(
      provision({ PGUSER: role, PGPASSWORD: password }),
    ).rejects.toMatchObject({
      stderr: expect.stringContaining(
        "Invalid runtime role or password configuration",
      ),
    });
  });

  it("refuses existing role-specific session settings", async () => {
    await provision();
    await admin`ALTER ROLE ${admin(role)} SET statement_timeout = '5s'`;
    await expect(provision()).rejects.toMatchObject({
      stderr: expect.stringContaining("role settings"),
    });
  });
});
