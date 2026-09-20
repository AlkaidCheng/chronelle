import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readDatabaseFootprint } from "../src/footprint.js";
import { createId } from "../src/ids.js";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "../src/testing.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    migrationDirectory,
  );
});

afterAll(async () => {
  await database?.close();
});

describe.sequential("database storage footprint", () => {
  it("removes redundant index storage while preserving grant lookups and constraints", async () => {
    const sql = database.connection.sql;
    const ownerId = createId();
    const guestId = createId();
    const workspaceId = createId();
    await sql`
      INSERT INTO users (id, identity_provider, provider_subject, display_name)
      VALUES (${ownerId}, 'test', 'index-owner', 'Owner'),
        (${guestId}, 'test', 'index-guest', 'Guest')
    `;
    await sql`
      INSERT INTO workspaces (id, display_name, created_by)
      VALUES (${workspaceId}, 'Grant lookup fixture', ${ownerId})
    `;
    await sql`
      INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id)
      SELECT id, ${workspaceId}, 'event', 'Fixture event', ${ownerId}, id
      FROM (SELECT chronelle_uuidv7() AS id FROM generate_series(1, 5000)) fixture
    `;
    await sql`
      INSERT INTO resource_grants (id, workspace_id, resource_id, principal_id, role, granted_by)
      SELECT chronelle_uuidv7(), workspace_id, id, ${guestId}, 'viewer', ${ownerId}
      FROM objects WHERE workspace_id = ${workspaceId}
    `;
    // Recreate the four-column secondary index to measure the upgrade on
    // an isolated database whose migrations already include its removal.
    await sql`CREATE INDEX resource_grants_resource_principal_idx
      ON resource_grants (workspace_id, resource_id, principal_type, principal_id)`;
    await sql`ANALYZE resource_grants`;
    const constraints = () => sql`
      SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
      WHERE conrelid = 'resource_grants'::regclass ORDER BY conname
    `;
    const fingerprint = () => sql`
      SELECT count(*)::text AS count, md5(string_agg(to_jsonb(g)::text, '' ORDER BY id)) AS digest
      FROM resource_grants g
    `;
    const beforeConstraints = await constraints();
    const beforeRows = await fingerprint();
    const [before] = await sql`
      SELECT pg_relation_size('resource_grants_resource_principal_idx')::text AS removed_bytes,
        pg_indexes_size('resource_grants')::text AS index_bytes,
        pg_table_size('resource_grants')::text AS data_bytes
    `;
    const positions = await sql<{ resource_id: string }[]>`
      SELECT resource_id FROM resource_grants ORDER BY resource_id LIMIT 12
    `;
    const firstId = positions[0]?.resource_id;
    const lastId = positions[10]?.resource_id;
    expect(firstId).toBeDefined();
    expect(lastId).toBeDefined();
    const lookups = [
      {
        query:
          "SELECT role FROM resource_grants WHERE workspace_id = $1 AND resource_id = $2 AND principal_type = 'user' AND principal_id = $3",
        parameters: [workspaceId, firstId as string, guestId],
      },
      {
        query:
          "SELECT resource_id, role FROM resource_grants WHERE workspace_id = $1 AND resource_id >= $2 AND resource_id <= $3 ORDER BY resource_id",
        parameters: [workspaceId, firstId as string, lastId as string],
      },
    ];
    const beforeResults = await Promise.all(
      lookups.map(({ query, parameters }) => sql.unsafe(query, parameters)),
    );
    await sql.unsafe(
      await readFile(
        resolve(migrationDirectory, "0068_remove_redundant_grant_index.sql"),
        "utf8",
      ),
    );
    for (const [index, { query, parameters }] of lookups.entries()) {
      expect(await sql.unsafe(query, parameters)).toEqual(beforeResults[index]);
      const plan = await sql.unsafe(
        `EXPLAIN (FORMAT JSON) ${query}`,
        parameters,
      );
      expect(JSON.stringify(plan)).toContain(
        "resource_grants_principal_unique",
      );
    }
    expect(await constraints()).toEqual(beforeConstraints);
    expect(await fingerprint()).toEqual(beforeRows);
    const [after] = await sql`
      SELECT pg_indexes_size('resource_grants')::text AS index_bytes,
        pg_table_size('resource_grants')::text AS data_bytes
    `;
    expect(after?.data_bytes).toBe(before?.data_bytes);
    expect(BigInt(before?.index_bytes) - BigInt(after?.index_bytes)).toBe(
      BigInt(before?.removed_bytes),
    );
    expect(BigInt(before?.removed_bytes)).toBeGreaterThan(0n);
    console.info(
      JSON.stringify({
        grantRows: 5000,
        reclaimedIndexBytes: before?.removed_bytes,
      }),
    );
    await expect(sql`
      INSERT INTO resource_grants (id, workspace_id, resource_id, principal_id, role, granted_by)
      VALUES (${createId()}, ${workspaceId}, ${firstId as string}, ${guestId}, 'viewer', ${ownerId})
    `).rejects.toMatchObject({
      code: "23505",
      constraint_name: "resource_grants_principal_unique",
    });
  });

  it("reports aggregate relation and optional history bytes without exposing or modifying snapshots", async () => {
    const sql = database.connection.sql;
    const [signedIn] = await sql`
      SELECT chronelle_identity_sign_in('test', 'footprint-history', NULL, 'History fixture', NULL, ${createId()}) AS session
    `;
    const userId = signedIn?.session.user.id as string;
    const workspaceId = signedIn?.session.workspace.id as string;
    const privateBody = "Private snapshot contents ".repeat(400);
    const [created] = await sql`
      SELECT chronelle_note_create(${workspaceId}, ${userId}, ${createId()},
        ${JSON.stringify({ displayName: "Private note", body: privateBody })}::jsonb) AS note
    `;
    const noteId = created?.note.object.id as string;
    await sql`
      SELECT chronelle_object_update(${workspaceId}, ${userId}, ${createId()}, 'note', ${noteId}, 1,
        ${JSON.stringify({ displayName: "Renamed private note" })}::jsonb)
    `;
    const [event] = await sql`
      SELECT chronelle_event_create(${workspaceId}, ${userId}, ${createId()},
        '{"displayName":"Private event"}'::jsonb) AS event
    `;
    await sql`
      SELECT chronelle_event_layout_update(${workspaceId}, ${userId}, ${createId()},
        ${event?.event.object.id as string}, 0, '[]'::jsonb)
    `;
    const snapshots = () => sql`SELECT * FROM object_revisions ORDER BY id`;
    const before = await snapshots();
    const beforeLayouts = await sql`SELECT * FROM event_page_revisions`;
    const catalog = await readDatabaseFootprint(sql);
    expect(catalog.history).toBeNull();
    expect(catalog.tables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "object_revisions",
          totalBytes: expect.stringMatching(/^\d+$/),
        }),
      ]),
    );
    expect(catalog.indexes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          index: "resource_grants_principal_unique",
          unique: true,
        }),
      ]),
    );
    const report = await readDatabaseFootprint(sql, { includeHistory: true });
    const notes = report.history?.find((row) => row.objectType === "note");
    expect(notes).toMatchObject({
      table: "object_revisions",
      revisions: "2",
      objects: "1",
    });
    expect(BigInt(notes?.logicalJsonBytes ?? "0")).toBeGreaterThan(
      BigInt(privateBody.length * 2),
    );
    expect(BigInt(notes?.storedJsonBytes ?? "0")).toBeGreaterThan(0n);
    expect(report.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          table: "event_page_revisions",
          revisions: "1",
          objects: "1",
        }),
      ]),
    );
    expect(JSON.stringify(report)).not.toContain("Private");
    expect(JSON.stringify(report)).not.toContain(noteId);
    expect(await snapshots()).toEqual(before);
    expect(await sql`SELECT * FROM event_page_revisions`).toEqual(
      beforeLayouts,
    );
  });

  it("does not print credentials when the CLI fails", async () => {
    const run = promisify(execFile);
    const result = await run(
      process.execPath,
      [
        "--import",
        "tsx",
        resolve(import.meta.dirname, "../src/footprint-cli.ts"),
      ],
      {
        env: { ...process.env, DATABASE_URL: "secret-not-a-database-url" },
      },
    ).catch((error: { stdout: string; stderr: string; code: number }) => error);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("Database footprint inspection failed.");
    expect(result.stderr).not.toContain("secret-not-a-database-url");
  });
});
