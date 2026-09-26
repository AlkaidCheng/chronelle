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

/** The functions the deletion adds; the last two are called on the rpc route. */
const deletionFunctions = [
  "chronelle_guard_deleted_workspace()",
  "chronelle_workspace_records(uuid)",
  "chronelle_workspace_deletion(uuid,uuid)",
  "chronelle_workspace_delete(uuid,uuid,uuid,timestamp with time zone)",
];

/** A shared workspace with its Owner, an Event, and a task in Trash. */
async function spaceWithTrash() {
  const sql = database.connection.sql;
  const userId = createId();
  const workspaceId = createId();
  const eventId = createId();
  const taskId = createId();
  await sql`
    INSERT INTO users (id, identity_provider, provider_subject, display_name)
    VALUES (${userId}, 'test', ${userId}, 'Owner')
  `;
  await sql`
    INSERT INTO workspaces (id, display_name, created_by)
    VALUES (${workspaceId}, 'Space', ${userId})
  `;
  await sql`
    INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id, deleted_at)
    VALUES (${eventId}, ${workspaceId}, 'event', 'Party', ${userId}, ${eventId}, NULL),
      (${taskId}, ${workspaceId}, 'task', 'Invite', ${userId}, ${eventId}, now())
  `;
  return { userId, workspaceId, eventId, taskId };
}

describe.sequential("a space's deletion in the schema", () => {
  it("records who deleted a space and when, and never a Personal one", async () => {
    const sql = database.connection.sql;
    const columns = await sql<{ column_name: string; data_type: string }[]>`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'workspaces' AND column_name IN ('deleted_at', 'deleted_by')
      ORDER BY column_name
    `;
    expect(columns).toEqual([
      { column_name: "deleted_at", data_type: "timestamp with time zone" },
      { column_name: "deleted_by", data_type: "uuid" },
    ]);
    const space = await spaceWithTrash();
    // Both or neither, and never before the space was created.
    await expect(
      sql`UPDATE workspaces SET deleted_at = now() WHERE id = ${space.workspaceId}`,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      sql`
        UPDATE workspaces SET deleted_at = created_at - interval '1 day', deleted_by = created_by
        WHERE id = ${space.workspaceId}
      `,
    ).rejects.toMatchObject({ code: "23514" });
    await expect(
      sql`UPDATE workspaces SET deleted_by = ${createId()}, deleted_at = now() WHERE id = ${space.workspaceId}`,
    ).rejects.toMatchObject({ code: "23503" });
    const personalId = createId();
    await expect(
      sql`
        INSERT INTO workspaces (id, display_name, created_by, personal_owner_id, deleted_at, deleted_by)
        VALUES (${personalId}, 'Personal', ${space.userId}, ${space.userId}, now(), ${space.userId})
      `,
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("refuses a record created in a deleted space or restored from its Trash", async () => {
    const sql = database.connection.sql;
    const space = await spaceWithTrash();
    await sql`UPDATE objects SET deleted_at = now() WHERE id = ${space.eventId}`;
    await sql`
      UPDATE workspaces SET deleted_at = now(), deleted_by = ${space.userId}
      WHERE id = ${space.workspaceId}
    `;
    const lateId = createId();
    await expect(
      sql`
        INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id)
        VALUES (${lateId}, ${space.workspaceId}, 'event', 'Late', ${space.userId}, ${lateId})
      `,
    ).rejects.toMatchObject({ code: "PT403" });
    await expect(
      sql`UPDATE objects SET deleted_at = NULL WHERE id = ${space.taskId}`,
    ).rejects.toMatchObject({ code: "PT403" });
    // Its records keep changing otherwise: another step to Trash is taken.
    await sql`UPDATE objects SET display_name = 'Invites' WHERE id = ${space.taskId}`;

    // A space that was not deleted takes both.
    const live = await spaceWithTrash();
    await sql`UPDATE objects SET deleted_at = NULL WHERE id = ${live.taskId}`;
  });

  it("guards inserts and restores before each row", async () => {
    const triggers = await database.connection.sql<
      { tgname: string; definition: string }[]
    >`
      SELECT tgname, pg_get_triggerdef(oid) AS definition FROM pg_trigger
      WHERE tgrelid = 'objects'::regclass AND tgname LIKE '%deleted_workspace_guard'
      ORDER BY tgname
    `;
    expect(triggers).toEqual([
      {
        tgname: "objects_deleted_workspace_guard",
        definition: expect.stringContaining(
          "BEFORE INSERT ON public.objects FOR EACH ROW EXECUTE FUNCTION chronelle_guard_deleted_workspace()",
        ),
      },
      {
        tgname: "objects_restore_deleted_workspace_guard",
        definition: expect.stringContaining(
          "BEFORE UPDATE OF deleted_at ON public.objects FOR EACH ROW WHEN (((old.deleted_at IS NOT NULL) AND (new.deleted_at IS NULL))) EXECUTE FUNCTION chronelle_guard_deleted_workspace()",
        ),
      },
    ]);
  });

  it("counts a record whose scope is in Trash as in Trash", async () => {
    const space = await spaceWithTrash();
    const count = () =>
      database.connection.sql<
        { live_records: number; trash_records: number }[]
      >`
        SELECT * FROM chronelle_workspace_records(${space.workspaceId})
      `;
    expect(await count()).toEqual([{ live_records: 1, trash_records: 1 }]);
    await database.connection
      .sql`UPDATE objects SET deleted_at = now() WHERE id = ${space.eventId}`;
    expect(await count()).toEqual([{ live_records: 0, trash_records: 2 }]);
    await database.connection
      .sql`UPDATE objects SET deleted_at = NULL WHERE id = ${space.taskId}`;
    expect(await count()).toEqual([{ live_records: 0, trash_records: 2 }]);
  });

  it("grants the deletion functions to no one by default", async () => {
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
        WHERE p.proname IN ('chronelle_guard_deleted_workspace', 'chronelle_workspace_records',
                            'chronelle_workspace_deletion', 'chronelle_workspace_delete')
        ORDER BY 1
      `;
      expect(rows.map((row) => row.signature).sort()).toEqual(
        [...deletionFunctions].sort(),
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
        "chronelle_workspace_deletion",
        "chronelle_workspace_delete",
      ]),
    );
  });
});
