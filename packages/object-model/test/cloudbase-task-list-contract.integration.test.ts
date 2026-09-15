import { resolve } from "node:path";
import {
  createId,
  objects,
  resourceGrants,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from "@chronelle/db";
import type {
  CloudBaseRdbReader,
  CloudBaseRdbQuery,
  Database,
} from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { eq, getTableColumns, type Table } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseTaskReadRepository } from "../src/cloudbase-task-read-repository.js";
import { InvalidObjectStateError } from "../src/errors.js";
import {
  PostgresTaskReadRepository,
  type TaskReadRepository,
} from "../src/task-list.js";

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
});

afterAll(async () => {
  await database?.close();
});

function matches(
  row: Record<string, unknown>,
  query: CloudBaseRdbQuery,
): boolean {
  return (query.filters ?? []).every((filter) => {
    const value = row[filter.column];
    switch (filter.operator) {
      case "eq":
        return value === filter.value;
      case "in":
        return (filter.value as readonly unknown[]).includes(value);
      case "is":
        return value === filter.value;
      default:
        return false;
    }
  });
}

const snapshotTables = {
  objects,
  tasks,
  resource_grants: resourceGrants,
  workspace_members: workspaceMembers,
} as const;

function gatewayRow(
  table: Table,
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(getTableColumns(table)).map(([property, column]) => {
      const value = record[property];
      return [column.name, value instanceof Date ? value.toISOString() : value];
    }),
  );
}

/** Serves the workspace rows PostgreSQL holds through the RDB transport boundary. */
async function snapshotClient(
  db: Database,
  workspaceId: string,
): Promise<CloudBaseRdbReader> {
  const rows = new Map<string, Record<string, unknown>[]>();
  for (const [name, table] of Object.entries(snapshotTables)) {
    const records = await db
      .select()
      .from(table)
      .where(eq(table.workspaceId, workspaceId));
    rows.set(
      name,
      records.map((record) =>
        gatewayRow(table, record as Record<string, unknown>),
      ),
    );
  }
  return {
    capabilities: {
      transactions: false,
      nativeTcp: false,
      serverFunctions: false,
    },
    async select<T>(table: string, query: CloudBaseRdbQuery = {}) {
      const tableRows = rows.get(table);
      if (tableRows === undefined) throw new Error(`unexpected table ${table}`);
      const matching = tableRows.filter((row) => matches(row, query));
      return (query.limit === undefined
        ? matching
        : matching.slice(0, query.limit)) as unknown as readonly T[];
    },
  };
}

describe.sequential("CloudBase task list contract", () => {
  it("lists the same tasks in the same order for members and grantees, page by page", async () => {
    const db = database.connection.db;
    const ownerId = createId();
    const viewerId = createId();
    const workspaceId = createId();
    const eventId = createId();
    const owner = { type: "user" as const, userId: ownerId, workspaceId };
    const viewer = { type: "user" as const, userId: viewerId, workspaceId };
    await db.insert(users).values(
      [ownerId, viewerId].map((id) => ({
        id,
        identityProvider: "test",
        providerSubject: id,
        displayName: "Contract principal",
      })),
    );
    await db.insert(workspaces).values({
      id: workspaceId,
      createdBy: ownerId,
      displayName: "Task list contract",
    });
    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: ownerId,
      role: "owner",
    });
    // The Event scope is shared with the viewer; two tasks inherit it, three
    // own their scope (one of them done, one deleted).
    const inEventTimed = createId();
    const inEventDated = createId();
    const standaloneUndated = createId();
    const standaloneDone = createId();
    const deletedId = createId();
    await db.insert(objects).values([
      {
        id: eventId,
        workspaceId,
        objectType: "event" as const,
        permissionScopeId: eventId,
        displayName: "Launch night",
        createdBy: ownerId,
      },
      ...[
        {
          id: inEventTimed,
          permissionScopeId: eventId,
          displayName: "Confirm the caterer",
        },
        {
          id: inEventDated,
          permissionScopeId: eventId,
          displayName: "Book the room",
        },
        {
          id: standaloneUndated,
          permissionScopeId: standaloneUndated,
          displayName: "Read the contract",
        },
        {
          id: standaloneDone,
          permissionScopeId: standaloneDone,
          displayName: "Archive last year",
        },
        {
          id: deletedId,
          permissionScopeId: deletedId,
          displayName: "Dropped",
          deletedAt: new Date("2030-01-01T00:00:00Z"),
        },
      ].map((row) => ({
        ...row,
        workspaceId,
        objectType: "task" as const,
        createdBy: ownerId,
      })),
    ]);
    await db.insert(tasks).values([
      {
        objectId: inEventTimed,
        workspaceId,
        status: "todo",
        dueAt: new Date("2030-03-05T09:30:00Z"),
      },
      {
        objectId: inEventDated,
        workspaceId,
        status: "in_progress",
        dueOn: "2030-03-05",
      },
      { objectId: standaloneUndated, workspaceId, status: "todo" },
      {
        objectId: standaloneDone,
        workspaceId,
        status: "done",
        dueOn: "2030-02-01",
        completedAt: new Date("2030-02-01T12:00:00Z"),
      },
      { objectId: deletedId, workspaceId, status: "todo" },
    ]);
    await db.insert(resourceGrants).values({
      id: createId(),
      workspaceId,
      resourceId: eventId,
      principalId: viewerId,
      role: "viewer",
      grantedBy: ownerId,
    });
    const clock = () => new Date("2030-01-01T00:00:00.000Z");
    const cloudbaseClient = await snapshotClient(db, workspaceId);
    const postgres = new PostgresTaskReadRepository(db);
    const cloudbase = new CloudBaseTaskReadRepository(cloudbaseClient, clock);
    const ids = (page: {
      readonly items: readonly { readonly id: string }[];
    }) => page.items.map(({ id }) => id);

    // Due order: the date-only task leads its day, the timed one follows,
    // undated tasks come last; the done task is out of the open filter.
    for (const [principal, expectedOpen, expectedAll] of [
      [
        owner,
        [inEventDated, inEventTimed, standaloneUndated],
        [standaloneDone, inEventDated, inEventTimed, standaloneUndated],
      ],
      [viewer, [inEventDated, inEventTimed], [inEventDated, inEventTimed]],
    ] as const) {
      const open = await postgres.listTasks(principal, { limit: 10 });
      expect(ids(open)).toEqual(expectedOpen);
      expect(ids(await cloudbase.listTasks(principal, { limit: 10 }))).toEqual(
        ids(open),
      );
      const all = await postgres.listTasks(principal, {
        filter: "all",
        limit: 10,
      });
      expect(ids(all)).toEqual(expectedAll);
      expect(
        ids(await cloudbase.listTasks(principal, { filter: "all", limit: 10 })),
      ).toEqual(ids(all));
    }
    expect(
      ids(await postgres.listTasks(owner, { filter: "done", limit: 10 })),
    ).toEqual([standaloneDone]);
    expect(
      ids(await postgres.listTasks(owner, { query: "the", limit: 10 })),
    ).toEqual([inEventDated, inEventTimed, standaloneUndated]);
    expect(
      ids(await cloudbase.listTasks(owner, { query: "THE", limit: 10 })),
    ).toEqual([inEventDated, inEventTimed, standaloneUndated]);

    // Cursor paging: every sort mode crosses a page boundary with limit 2,
    // and each backend's own cursor must reproduce the same page sequence.
    for (const sort of ["due", "name", "updated"] as const) {
      const walk = async (repository: TaskReadRepository) => {
        const pages: string[][] = [];
        let cursor: string | undefined;
        do {
          const page = await repository.listTasks(owner, {
            filter: "all",
            sort,
            limit: 2,
            cursor,
          });
          pages.push(ids(page));
          cursor = page.nextCursor ?? undefined;
        } while (cursor !== undefined && pages.length < 5);
        return pages;
      };
      const postgresPages = await walk(postgres);
      const cloudbasePages = await walk(cloudbase);
      expect(postgresPages.map((page) => page.length)).toEqual([2, 2]);
      expect(cloudbasePages).toEqual(postgresPages);
      expect(new Set(postgresPages.flat())).toEqual(
        new Set([
          inEventDated,
          inEventTimed,
          standaloneUndated,
          standaloneDone,
        ]),
      );
    }

    // A cursor from another query, or another caller, is refused alike.
    const first = await postgres.listTasks(owner, { limit: 1 });
    for (const repository of [postgres, cloudbase]) {
      await expect(
        repository.listTasks(owner, {
          cursor: first.nextCursor ?? "",
          sort: "name",
        }),
      ).rejects.toBeInstanceOf(InvalidObjectStateError);
      await expect(
        repository.listTasks(viewer, { cursor: first.nextCursor ?? "" }),
      ).rejects.toBeInstanceOf(InvalidObjectStateError);
    }
  });
});
