import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

/** The functions the move adds; the last three are called on the rpc route. */
const moveFunctions = [
  "chronelle_object_move_scope(uuid,uuid)",
  "chronelle_object_move_grants(uuid,uuid,uuid[])",
  "chronelle_object_move_source_check(uuid,uuid,uuid)",
  "chronelle_object_move_target_check(uuid,uuid,uuid)",
  "chronelle_object_move_plan(uuid,uuid,uuid,uuid)",
  "chronelle_object_move_revise(uuid,uuid,uuid,uuid,text,text,jsonb,timestamp with time zone)",
  "chronelle_object_move_targets(uuid,uuid,uuid)",
  "chronelle_object_move_preview(uuid,uuid,uuid,uuid)",
  "chronelle_object_move(uuid,uuid,uuid,uuid,uuid,integer,timestamp with time zone,uuid)",
];

/** A workspace with an Event, a task in its scope, and a relation between them. */
async function relatedPair() {
  const sql = database.connection.sql;
  const userId = createId();
  const workspaceId = createId();
  const eventId = createId();
  const taskId = createId();
  const relationId = createId();
  await sql`
    INSERT INTO users (id, identity_provider, provider_subject, display_name)
    VALUES (${userId}, 'test', ${userId}, 'Owner')
  `;
  await sql`
    INSERT INTO workspaces (id, display_name, created_by)
    VALUES (${workspaceId}, 'Space', ${userId})
  `;
  await sql`
    INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id)
    VALUES (${eventId}, ${workspaceId}, 'event', 'Party', ${userId}, ${eventId}),
      (${taskId}, ${workspaceId}, 'task', 'Invite', ${userId}, ${eventId})
  `;
  await sql`
    INSERT INTO object_relations (id, workspace_id, source_object_id, relation_type, target_object_id, created_by)
    VALUES (${relationId}, ${workspaceId}, ${eventId}, 'includes', ${taskId}, ${userId})
  `;
  return { userId, workspaceId, eventId, taskId, relationId };
}

describe.sequential("the object move's schema", () => {
  it("keeps a context creation's relation id without a key to the relation", async () => {
    const keys = await database.connection.sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'f' AND conrelid = 'event_context_commands'::regclass
        AND confrelid = 'object_relations'::regclass
    `;
    expect(keys).toEqual([]);
    const referencing = await database.connection.sql<{ conname: string }[]>`
      SELECT conname FROM pg_constraint
      WHERE contype = 'f' AND confrelid = 'object_relations'::regclass
    `;
    expect(referencing).toEqual([]);
  });

  it("deletes a relation only when a move says so for its transaction", async () => {
    const sql = database.connection.sql;
    const pair = await relatedPair();
    await expect(
      sql`DELETE FROM object_relations WHERE id = ${pair.relationId}`,
    ).rejects.toMatchObject({ code: "55000" });
    // Another value, or one set for an earlier transaction, is refused too.
    await expect(
      sql.begin(async (transaction) => {
        await transaction`SELECT set_config('chronelle.relation_drop', 'cleanup', true)`;
        await transaction`DELETE FROM object_relations WHERE id = ${pair.relationId}`;
      }),
    ).rejects.toMatchObject({ code: "55000" });
    await sql.begin(async (transaction) => {
      await transaction`SELECT set_config('chronelle.relation_drop', 'move', true)`;
    });
    await expect(
      sql`DELETE FROM object_relations WHERE id = ${pair.relationId}`,
    ).rejects.toMatchObject({ code: "55000" });

    // A relation a context creation recorded can still be dropped.
    await sql`
      INSERT INTO event_context_commands (workspace_id, user_id, command_id, request_id, request_hash,
        context_object_id, object_id, relation_id)
      VALUES (${pair.workspaceId}, ${pair.userId}, ${createId()}, ${createId()}, ${"c".repeat(64)},
        ${pair.eventId}, ${pair.taskId}, ${pair.relationId})
    `;
    await sql.begin(async (transaction) => {
      await transaction`SELECT set_config('chronelle.relation_drop', 'move', true)`;
      await transaction`DELETE FROM object_relations WHERE id = ${pair.relationId}`;
    });
    expect(
      await sql`SELECT id FROM object_relations WHERE id = ${pair.relationId}`,
    ).toEqual([]);
    expect(
      await sql`
        SELECT relation_id FROM event_context_commands WHERE context_object_id = ${pair.eventId}
      `,
    ).toEqual([{ relation_id: pair.relationId }]);
  });

  it("guards deletes before each row and leaves updates to the version trigger", async () => {
    const triggers = await database.connection.sql<
      { tgname: string; definition: string }[]
    >`
      SELECT tgname, pg_get_triggerdef(oid) AS definition FROM pg_trigger
      WHERE tgrelid = 'object_relations'::regclass AND NOT tgisinternal
      ORDER BY tgname
    `;
    expect(triggers).toEqual([
      {
        tgname: "object_relations_drop_guard",
        definition: expect.stringContaining(
          "BEFORE DELETE ON public.object_relations FOR EACH ROW EXECUTE FUNCTION chronelle_guard_relation_drop()",
        ),
      },
      {
        tgname: "object_relations_versioned",
        definition: expect.stringContaining("BEFORE UPDATE"),
      },
    ]);
  });

  it("grants the move functions to no one by default", async () => {
    const sql = database.connection.sql;
    const role = `chronelle_probe_${randomUUID().replaceAll("-", "")}`;
    await sql`CREATE ROLE ${sql(role)} NOLOGIN`;
    try {
      const rows = await sql<
        { signature: string; executable: boolean; public_acl: boolean }[]
      >`
        SELECT p.oid::regprocedure::text AS signature,
          has_function_privilege(${role}, p.oid, 'EXECUTE') AS executable,
          EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0) AS public_acl
        FROM pg_proc p
        WHERE p.proname LIKE 'chronelle\\_object\\_move%' OR p.proname = 'chronelle_guard_relation_drop'
        ORDER BY 1
      `;
      expect(rows.map((row) => row.signature).sort()).toEqual(
        [...moveFunctions, "chronelle_guard_relation_drop()"].sort(),
      );
      for (const row of rows) {
        expect(row, row.signature).toMatchObject({
          executable: false,
          public_acl: false,
        });
      }
    } finally {
      await sql`DROP ROLE ${sql(role)}`;
    }
  });

  it("lists the rpc functions for the readiness check", async () => {
    const [readiness] = await database.connection.sql<
      { result: { functions: string[] } }[]
    >`SELECT chronelle_backend_readiness() AS result`;
    expect(readiness?.result.functions).toEqual(
      expect.arrayContaining([
        "chronelle_object_move",
        "chronelle_object_move_preview",
        "chronelle_object_move_targets",
      ]),
    );
  });
});
