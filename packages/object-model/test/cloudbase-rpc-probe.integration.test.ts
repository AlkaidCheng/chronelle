import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  auditEvents,
  createId,
  objectRevisions,
  objects,
  resourceGrants,
  users,
  workspaceMembers,
  workspaces,
} from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EventPlanningObjectService } from "../src/object-service.js";

// The probe functions must write what the TypeScript service writes. Both
// paths run against one PostgreSQL here; the CloudBase gateway only adds the
// transport, which the read-contract and rpc harnesses cover on staging.

let database: TestDatabase;
let workspaceId: string;
let ownerId: string;
let viewerId: string;

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  await database.connection.sql.unsafe(
    await readFile(
      resolve(
        import.meta.dirname,
        "../../../infrastructure/cloudbase/rpc-probe.sql",
      ),
      "utf8",
    ),
  );
  const db = database.connection.db;
  ownerId = createId();
  viewerId = createId();
  workspaceId = createId();
  await db.insert(users).values(
    [ownerId, viewerId].map((id) => ({
      id,
      identityProvider: "test",
      providerSubject: id,
      displayName: "Probe principal",
    })),
  );
  await db.insert(workspaces).values({
    id: workspaceId,
    createdBy: ownerId,
    displayName: "RPC probe",
  });
  await db.insert(workspaceMembers).values({
    workspaceId,
    userId: ownerId,
    role: "owner",
  });
});

afterAll(async () => {
  await database?.close();
});

interface Snapshot {
  readonly snapshot: Record<string, unknown>;
  readonly mutationKind: string;
  readonly action: string;
  readonly metadata: Record<string, unknown>;
}

async function revisionsOf(objectId: string): Promise<Snapshot[]> {
  const db = database.connection.db;
  const rows = await db
    .select({
      snapshot: objectRevisions.snapshot,
      mutationKind: objectRevisions.mutationKind,
      action: auditEvents.action,
      metadata: auditEvents.metadata,
    })
    .from(objectRevisions)
    .innerJoin(auditEvents, eq(auditEvents.id, objectRevisions.auditEventId))
    .where(
      and(
        eq(objectRevisions.workspaceId, workspaceId),
        eq(objectRevisions.objectId, objectId),
      ),
    )
    .orderBy(objectRevisions.objectVersion);
  return rows as Snapshot[];
}

/** Identity-bearing fields differ per object; everything else must match. */
function shape(entry: Snapshot) {
  const { id, createdAt, updatedAt, permissionScopeId, ...rest } =
    entry.snapshot;
  const { permissionScopeId: scope, ...metadata } = entry.metadata;
  return {
    snapshot: rest,
    snapshotOwnsScope: permissionScopeId === id,
    timestamps: [createdAt, updatedAt].map((value) =>
      typeof value === "string" ? /\.\d{3}Z$/u.test(value) : value,
    ),
    mutationKind: entry.mutationKind,
    action: entry.action,
    metadata,
    metadataScopeMatches: scope === undefined || scope === id,
  };
}

async function callProbe<T>(
  functionName: string,
  args: Record<string, unknown>,
): Promise<T> {
  const sql = database.connection.sql;
  const [row] = await sql.unsafe<{ result: T }[]>(
    `SELECT ${functionName}(${Object.keys(args)
      .map((key, index) => `${key} => $${index + 1}`)
      .join(", ")}) AS result`,
    Object.values(args) as never[],
  );
  return row?.result as T;
}

describe.sequential("CloudBase rpc probe functions", () => {
  it("record the same audit and revision rows as the TypeScript service", async () => {
    const service = new EventPlanningObjectService(database.connection.db);
    const principal = { type: "user" as const, userId: ownerId, workspaceId };
    const viaService = await service.createEvent(
      { principal, requestId: createId() },
      { displayName: "Compared event", timezone: "UTC" },
    );
    await service.updateEvent(
      { principal, requestId: createId() },
      viaService.id,
      { displayName: "Compared event v2", expectedVersion: 1 },
    );

    const created = await callProbe<{ id: string }>(
      "chronelle_probe_create_event",
      {
        workspace_id: workspaceId,
        user_id: ownerId,
        request_id: createId(),
        display_name: "Compared event",
        timezone: "UTC",
      },
    );
    const updated = await callProbe<{ version: number }>(
      "chronelle_probe_update_event",
      {
        workspace_id: workspaceId,
        user_id: ownerId,
        request_id: createId(),
        object_id: created.id,
        expected_version: 1,
        display_name: "Compared event v2",
      },
    );
    expect(updated.version).toBe(2);

    const reference = (await revisionsOf(viaService.id)).map(shape);
    const probe = (await revisionsOf(created.id)).map(shape);
    expect(reference).toHaveLength(2);
    expect(probe).toEqual(reference);
  });

  it("reject a stale version, a forbidden principal, and a missing baseline without writing", async () => {
    const created = await callProbe<{ id: string }>(
      "chronelle_probe_create_event",
      {
        workspace_id: workspaceId,
        user_id: ownerId,
        request_id: createId(),
        display_name: "Guarded event",
      },
    );
    const update = (overrides: Record<string, unknown>) =>
      callProbe("chronelle_probe_update_event", {
        workspace_id: workspaceId,
        user_id: ownerId,
        request_id: createId(),
        object_id: created.id,
        expected_version: 1,
        display_name: "Guarded event v2",
        ...overrides,
      });

    await expect(update({ expected_version: 2 })).rejects.toMatchObject({
      code: "PT409",
    });
    await expect(update({ user_id: viewerId })).rejects.toMatchObject({
      code: "PT403",
    });
    await expect(update({ object_id: createId() })).rejects.toMatchObject({
      code: "PT404",
    });
    expect(await revisionsOf(created.id)).toHaveLength(1);

    await database.connection.db.insert(resourceGrants).values({
      id: createId(),
      workspaceId,
      resourceId: created.id,
      principalId: viewerId,
      role: "editor",
      grantedBy: ownerId,
    });
    await expect(update({ user_id: viewerId })).resolves.toMatchObject({
      version: 2,
    });
  });

  it("discard every write when the function raises after them", async () => {
    const created = await callProbe<{ id: string }>(
      "chronelle_probe_create_event",
      {
        workspace_id: workspaceId,
        user_id: ownerId,
        request_id: createId(),
        display_name: "Atomic event",
      },
    );
    await expect(
      callProbe("chronelle_probe_update_event", {
        workspace_id: workspaceId,
        user_id: ownerId,
        request_id: createId(),
        object_id: created.id,
        expected_version: 1,
        display_name: "Should not persist",
        fail_after: true,
      }),
    ).rejects.toMatchObject({ code: "PT500" });

    const [row] = await database.connection.db
      .select({ version: objects.version, displayName: objects.displayName })
      .from(objects)
      .where(eq(objects.id, created.id));
    expect(row).toEqual({ version: 1, displayName: "Atomic event" });
    expect(await revisionsOf(created.id)).toHaveLength(1);
  });
});
