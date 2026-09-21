import {
  createId,
  events,
  objects,
  persons,
  resourceGrants,
  sections,
  tasks,
  type CloudBaseRdbQuery,
} from "@chronelle/db";
import {
  createCloudBaseLiveReader,
  createCloudBaseSnapshotReader,
} from "@chronelle/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { CloudBaseEventReadRepository } from "../src/cloudbase-event-read-repository.js";
import { CloudBasePersonReadRepository } from "../src/cloudbase-person-read-repository.js";
import { CloudBaseTaskReadRepository } from "../src/cloudbase-task-read-repository.js";
import { decodeCursor, encodeCursor } from "../src/cursor.js";
import {
  readCloudBaseVisibility,
  readCloudBaseVisibleObjects,
} from "../src/cloudbase-read-support.js";
import {
  createWriteHarness,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

const harnesses: WriteHarness[] = [];
afterAll(async () => {
  await Promise.all(harnesses.map((harness) => harness.database.close()));
});

async function fixture() {
  const harness = await createWriteHarness("List pagination");
  harnesses.push(harness);
  return {
    ...harness,
    principal: {
      type: "user" as const,
      userId: harness.ownerId,
      workspaceId: harness.workspaceId,
    },
  };
}

describe.sequential("CloudBase bounded list hydration", () => {
  it.each(["event", "task", "person"] as const)(
    "omits a %s moved into a private scope before hydration",
    async (objectType) => {
      const harness = await fixture();
      const db = harness.database.connection.db;
      const sharedScope = createId();
      const privateScope = createId();
      const objectId = objectType === "event" ? sharedScope : createId();
      await db.insert(objects).values([
        ...[sharedScope, privateScope].map((id) => ({
          id,
          workspaceId: harness.workspaceId,
          objectType: "event" as const,
          displayName: "Event scope",
          permissionScopeId: id,
          createdBy: harness.ownerId,
        })),
        ...(objectType === "event"
          ? []
          : [
              {
                id: objectId,
                workspaceId: harness.workspaceId,
                objectType,
                displayName: "Shared record",
                permissionScopeId: sharedScope,
                createdBy: harness.ownerId,
              },
            ]),
      ]);
      await db.insert(events).values(
        [sharedScope, privateScope].map((objectId) => ({
          objectId,
          workspaceId: harness.workspaceId,
        })),
      );
      if (objectType !== "event")
        await db
          .insert(objectType === "task" ? tasks : persons)
          .values({ objectId, workspaceId: harness.workspaceId });
      await db.insert(resourceGrants).values({
        id: createId(),
        workspaceId: harness.workspaceId,
        resourceId: sharedScope,
        principalId: harness.viewerId,
        role: "viewer",
        grantedBy: harness.ownerId,
      });
      const client = {
        ...createCloudBaseLiveReader(db),
        async rpc<T>(name: string, args?: Record<string, unknown>) {
          const result = await harness.rpc<T>(name, args);
          await db
            .update(objects)
            .set({
              permissionScopeId: privateScope,
              displayName: "Private revision",
            })
            .where(eq(objects.id, objectId));
          return result;
        },
      };
      const viewer = { ...harness.principal, userId: harness.viewerId };
      const page =
        objectType === "event"
          ? await new CloudBaseEventReadRepository(client).listEvents(viewer)
          : objectType === "task"
            ? await new CloudBaseTaskReadRepository(client).listTasks(viewer)
            : await new CloudBasePersonReadRepository(client).listPersons(
                viewer,
              );
      expect(page.items).toEqual([]);
      expect(JSON.stringify(page)).not.toContain("Private revision");
    },
  );

  it("hydrates a Task page with two RPCs and no table reads", async () => {
    const harness = await fixture();
    const db = harness.database.connection.db;
    const taskId = createId();
    await db.insert(objects).values({
      id: taskId,
      workspaceId: harness.workspaceId,
      objectType: "task",
      displayName: "Two-request task",
      permissionScopeId: taskId,
      createdBy: harness.ownerId,
    });
    await db
      .insert(tasks)
      .values({ objectId: taskId, workspaceId: harness.workspaceId });
    const reader = createCloudBaseLiveReader(db);
    const selects: string[] = [];
    const rpcs: string[] = [];
    const client = {
      ...reader,
      async select<T>(table: string, query: CloudBaseRdbQuery = {}) {
        selects.push(table);
        return reader.select<T>(table, query);
      },
      async rpc<T>(name: string, args?: Record<string, unknown>) {
        rpcs.push(name);
        return harness.rpc<T>(name, args);
      },
    };

    const page = await new CloudBaseTaskReadRepository(client).listTasks(
      harness.principal,
    );

    expect(page.items.map(({ id }) => id)).toEqual([taskId]);
    expect(rpcs).toEqual([
      "chronelle_task_list_candidates",
      "chronelle_task_list_hydrate",
    ]);
    expect(selects).toEqual([]);
  });

  it("bounds updated/manual candidates and hydrates only one page of canonical payloads", async () => {
    const harness = await fixture();
    const db = harness.database.connection.db;
    const count = 320;
    const rows = (["event", "task", "person"] as const).flatMap((objectType) =>
      Array.from({ length: count }, (_, index) => {
        const id = createId();
        return {
          id,
          workspaceId: harness.workspaceId,
          objectType,
          displayName: `${objectType} ${index.toString().padStart(4, "0")}`,
          permissionScopeId: id,
          createdBy: harness.ownerId,
          customProperties: { details: "x".repeat(4096) },
        };
      }),
    );
    await db.insert(objects).values(rows);
    for (const [kind, table] of [
      ["event", events],
      ["task", tasks],
      ["person", persons],
    ] as const)
      await db.insert(table).values(
        rows
          .filter((row) => row.objectType === kind)
          .map((row) => ({
            objectId: row.id,
            workspaceId: harness.workspaceId,
          })),
      );

    const reader = await createCloudBaseSnapshotReader(db);
    const reads: { table: string; query: CloudBaseRdbQuery; count: number }[] =
      [];
    const candidates: { name: string; count: number; bytes: number }[] = [];
    const client = {
      ...reader,
      async select<T>(table: string, query: CloudBaseRdbQuery = {}) {
        const found = await reader.select<T>(table, query);
        reads.push({ table, query, count: found.length });
        return found;
      },
      async rpc<T>(name: string, args?: Record<string, unknown>) {
        const result = await harness.rpc<T>(name, args);
        if (name.endsWith("_list_candidates")) {
          const page = Array.isArray(result)
            ? result
            : (result as { rows: unknown[] }).rows;
          candidates.push({
            name,
            count: page.length,
            bytes: JSON.stringify(result).length,
          });
        }
        return result;
      },
    };
    const eventReads = new CloudBaseEventReadRepository(client);
    const taskReads = new CloudBaseTaskReadRepository(client);
    const personReads = new CloudBasePersonReadRepository(client);
    const first = await eventReads.listEvents(harness.principal, {
      sort: "updated",
      limit: 20,
    });
    expect(first.items).toHaveLength(20);
    expect(first.counts).toMatchObject({ all: count, mine: count, shared: 0 });
    const second = await eventReads.listEvents(harness.principal, {
      sort: "updated",
      limit: 20,
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toHaveLength(20);
    expect(second.counts).toBeNull();
    expect(
      new Set([...first.items, ...second.items].map((row) => row.id)).size,
    ).toBe(40);
    for (const sort of ["updated", "manual"] as const) {
      const page = await taskReads.listTasks(harness.principal, {
        sort,
        limit: 20,
      });
      expect(page.items).toHaveLength(20);
      expect(page.nextCursor).not.toBeNull();
      const next = await taskReads.listTasks(harness.principal, {
        sort,
        limit: 20,
        cursor: page.nextCursor ?? undefined,
      });
      expect(
        new Set([...page.items, ...next.items].map((row) => row.id)).size,
      ).toBe(40);
    }
    expect(candidates.map((row) => row.count)).toEqual([
      21, 21, 21, 21, 21, 21,
    ]);
    expect(candidates.every((row) => row.bytes < 10_000)).toBe(true);

    // Name/date order keeps the runtime collation, but no unrelated
    // canonical payload, contacts, or labels are hydrated for that order.
    expect(
      (await eventReads.listEvents(harness.principal, { limit: 20 })).items,
    ).toHaveLength(20);
    expect(
      (await taskReads.listTasks(harness.principal, { limit: 20 })).items,
    ).toHaveLength(20);
    expect(
      (await personReads.listPersons(harness.principal, { limit: 20 })).items,
    ).toHaveLength(20);
    expect(candidates.slice(-3).map((row) => row.count)).toEqual([
      count,
      count,
      count,
    ]);
    for (const read of reads.filter((row) =>
      ["objects", "events", "tasks", "persons"].includes(row.table),
    )) {
      expect(read.count).toBeLessThanOrEqual(20);
      expect(
        read.query.filters?.some((filter) => filter.operator === "in"),
      ).toBe(true);
    }
    expect(candidates.at(-1)?.bytes).toBeLessThan(30_000);
  });

  it("preserves runtime name matching, sorting, and cursor comparisons", async () => {
    const harness = await fixture();
    const db = harness.database.connection.db;
    const names = [
      "Zebra",
      "\u00e9clair",
      "_start",
      "Alpha",
      "a-b",
      "\u5f20",
      "\u674e",
    ];
    const rows = (["event", "person"] as const).flatMap((objectType) =>
      names.map((name) => {
        const id = createId();
        return {
          id,
          workspaceId: harness.workspaceId,
          objectType,
          permissionScopeId: id,
          displayName: `Compare ${name}`,
          createdBy: harness.ownerId,
        };
      }),
    );
    await db.insert(objects).values(rows);
    await db.insert(events).values(
      rows
        .filter((row) => row.objectType === "event")
        .map((row) => ({
          objectId: row.id,
          workspaceId: harness.workspaceId,
        })),
    );
    await db.insert(persons).values(
      rows
        .filter((row) => row.objectType === "person")
        .map((row) => ({
          objectId: row.id,
          workspaceId: harness.workspaceId,
        })),
    );
    const client = {
      ...(await createCloudBaseSnapshotReader(db)),
      rpc: harness.rpc,
    };
    const eventReads = new CloudBaseEventReadRepository(client);
    const ordered = names
      .map((name) => `Compare ${name}`)
      .sort((first, second) =>
        first.toLocaleLowerCase().localeCompare(second.toLocaleLowerCase()),
      );
    const first = await eventReads.listEvents(harness.principal, {
      query: "COMPARE",
      sort: "name",
      limit: 2,
    });
    expect(first.items.map((row) => row.displayName)).toEqual(
      ordered.slice(0, 2),
    );
    expect(first.counts?.all).toBe(names.length);
    const last = first.items.at(-1)?.displayName.toLocaleLowerCase() ?? "";
    const next = await eventReads.listEvents(harness.principal, {
      query: "COMPARE",
      sort: "name",
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    expect(next.items.map((row) => row.displayName)).toEqual(
      ordered.filter((name) => name.toLocaleLowerCase() > last).slice(0, 2),
    );
    expect(next.counts).toBeNull();
    const people = await new CloudBasePersonReadRepository(client).listPersons(
      harness.principal,
      { query: "COMPARE", limit: 3 },
    );
    expect(people.items.map((row) => row.displayName)).toEqual(
      ordered.slice(0, 3),
    );
  });

  it("preserves collection visibility through expiry, revocation, and scope deletion", async () => {
    const harness = await fixture();
    const db = harness.database.connection.db;
    const scopeId = createId();
    const taskId = createId();
    const personId = createId();
    await db.insert(objects).values(
      [
        {
          id: scopeId,
          objectType: "event" as const,
          displayName: "Shared event",
        },
        { id: taskId, objectType: "task" as const, displayName: "Shared task" },
        {
          id: personId,
          objectType: "person" as const,
          displayName: "Private person",
        },
      ].map((row) => ({
        ...row,
        workspaceId: harness.workspaceId,
        permissionScopeId: scopeId,
        createdBy: harness.ownerId,
      })),
    );
    await db
      .insert(events)
      .values({ objectId: scopeId, workspaceId: harness.workspaceId });
    await db
      .insert(tasks)
      .values({ objectId: taskId, workspaceId: harness.workspaceId });
    await db
      .insert(persons)
      .values({ objectId: personId, workspaceId: harness.workspaceId });
    const grantId = createId();
    await db.insert(resourceGrants).values({
      id: grantId,
      workspaceId: harness.workspaceId,
      resourceId: scopeId,
      principalId: harness.viewerId,
      role: "viewer",
      scope: "todos",
      grantedBy: harness.ownerId,
      createdAt: new Date(0),
    });
    const client = { ...createCloudBaseLiveReader(db), rpc: harness.rpc };
    const viewer = { ...harness.principal, userId: harness.viewerId };
    const taskReads = new CloudBaseTaskReadRepository(client);
    const eventReads = new CloudBaseEventReadRepository(client);
    const personReads = new CloudBasePersonReadRepository(client);
    expect(
      (await taskReads.listTasks(viewer)).items.map((row) => row.id),
    ).toEqual([taskId]);
    expect(
      (await eventReads.listEvents(viewer)).items.map((row) => row.id),
    ).toEqual([scopeId]);
    expect((await personReads.listPersons(viewer)).items).toEqual([]);
    const sectionId = createId();
    await db.insert(sections).values({
      id: sectionId,
      workspaceId: harness.workspaceId,
      eventId: scopeId,
      view: "todos",
      name: "Visible section",
      rank: "00000001000",
      createdBy: harness.ownerId,
    });
    await db
      .update(resourceGrants)
      .set({ sectionId })
      .where(eq(resourceGrants.id, grantId));
    expect((await taskReads.listTasks(viewer)).items).toEqual([]);
    await db.update(tasks).set({ sectionId }).where(eq(tasks.objectId, taskId));
    expect(
      (await taskReads.listTasks(viewer)).items.map((row) => row.id),
    ).toEqual([taskId]);
    await db
      .update(resourceGrants)
      .set({ sectionId: null })
      .where(eq(resourceGrants.id, grantId));
    expect(
      (await taskReads.listTasks({ ...viewer, workspaceId: createId() })).items,
    ).toEqual([]);
    await db
      .update(resourceGrants)
      .set({ expiresAt: new Date(1000) })
      .where(eq(resourceGrants.id, grantId));
    expect((await taskReads.listTasks(viewer)).items).toEqual([]);
    expect((await eventReads.listEvents(viewer)).items).toEqual([]);
    await db
      .update(resourceGrants)
      .set({ expiresAt: null })
      .where(eq(resourceGrants.id, grantId));
    await db
      .update(objects)
      .set({ deletedAt: new Date() })
      .where(eq(objects.id, scopeId));
    const visibility = await readCloudBaseVisibility(
      client,
      viewer,
      () => new Date(),
    );
    const existing = await readCloudBaseVisibleObjects(
      client,
      viewer,
      visibility,
      "task",
    );
    expect(
      (await taskReads.listTasks(viewer)).items.map((row) => row.id),
    ).toEqual(existing.map((row) => row.id));
    expect(existing.map((row) => row.id)).toEqual([taskId]);
    await db
      .update(objects)
      .set({ deletedAt: null })
      .where(eq(objects.id, scopeId));
    await db.delete(resourceGrants).where(eq(resourceGrants.id, grantId));
    expect((await taskReads.listTasks(viewer)).items).toEqual([]);
  });

  it("keeps updated-order ties at the gateway's millisecond precision", async () => {
    const harness = await fixture();
    const db = harness.database.connection.db;
    const ids: [string, string] = [createId(), createId()];
    ids.sort();
    await db.insert(objects).values(
      ids.map((id) => ({
        id,
        workspaceId: harness.workspaceId,
        objectType: "task" as const,
        displayName: "Same instant",
        permissionScopeId: id,
        createdBy: harness.ownerId,
      })),
    );
    await db
      .insert(tasks)
      .values(
        ids.map((objectId) => ({ objectId, workspaceId: harness.workspaceId })),
      );
    await harness.database.connection
      .sql`UPDATE objects SET updated_at = CASE WHEN id = ${ids[0]}::uuid THEN '2030-01-01T00:00:00.123001Z'::timestamptz ELSE '2030-01-01T00:00:00.123999Z'::timestamptz END WHERE workspace_id = ${harness.workspaceId}`;
    const client = {
      ...(await createCloudBaseSnapshotReader(db)),
      rpc: harness.rpc,
    };
    const repository = new CloudBaseTaskReadRepository(client);
    const first = await repository.listTasks(harness.principal, {
      sort: "updated",
      limit: 1,
    });
    const second = await repository.listTasks(harness.principal, {
      sort: "updated",
      limit: 1,
      cursor: first.nextCursor ?? undefined,
    });
    expect([first.items[0]?.id, second.items[0]?.id]).toEqual(ids);
    expect(second.nextCursor).toBeNull();
    const preciseCursor = encodeCursor({
      ...(decodeCursor(first.nextCursor ?? "") as Record<string, unknown>),
      updatedAt: "2030-01-01T00:00:00.123999Z",
    });
    const precise = await repository.listTasks(harness.principal, {
      sort: "updated",
      limit: 1,
      cursor: preciseCursor,
    });
    expect(precise.items.map((row) => row.id)).toEqual([ids[1]]);
  });
});
