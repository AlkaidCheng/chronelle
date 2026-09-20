import { resolve } from "node:path";

import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  createId,
  events,
  objectRelations,
  objects,
  resourceGrants,
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
  createCloudBaseRpcDouble,
  type TestDatabase,
} from "@chronelle/db/testing";
import { eq, getTableColumns, type Table } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseCalendarReadRepository } from "../src/cloudbase-calendar-read-repository.js";
import { CloudBaseEventReadRepository } from "../src/cloudbase-event-read-repository.js";
import {
  type EventReadRepository,
  PostgresEventReadRepository,
} from "../src/event-list.js";
import { PostgresCalendarReadRepository } from "../src/projection-service.js";

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
      case "ilike":
        return String(value)
          .toLocaleLowerCase()
          .includes(
            String(filter.value).replaceAll("%", "").toLocaleLowerCase(),
          );
      default:
        return false;
    }
  });
}

const snapshotTables = {
  events,
  object_relations: objectRelations,
  objects,
  resource_grants: resourceGrants,
  users,
  workspace_members: workspaceMembers,
} as const;

/** Encodes one PostgreSQL row the way the gateway serializes it: SQL column names, ISO instants. */
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

/**
 * Serves the rows PostgreSQL holds through the RDB transport boundary, so
 * both adapters read one dataset: one workspace's rows, or every
 * workspace's when none is named, with the accounts either way.
 */
async function snapshotClient(
  db: Database,
  workspaceId?: string,
): Promise<CloudBaseRdbReader> {
  const rows = new Map<string, Record<string, unknown>[]>();
  for (const [name, table] of Object.entries(snapshotTables)) {
    const records =
      workspaceId === undefined || !("workspaceId" in table)
        ? await db.select().from(table)
        : await db
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

describe.sequential("CloudBase read contract", () => {
  it("matches PostgreSQL event lists, calendars, and denials for members and grantees", async () => {
    const db = database.connection.db;
    const ownerId = createId();
    const viewerId = createId();
    const workspaceId = createId();
    const rootId = createId();
    const datedChildId = createId();
    const timedChildId = createId();
    const privateChildId = createId();
    const unrelatedId = createId();
    const deletedId = createId();
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
      displayName: "CloudBase contract",
    });
    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: ownerId,
      role: "owner",
    });
    // Two children inherit the root's scope; the private child and the
    // unrelated Event own theirs; the deleted Event must never appear.
    await db.insert(objects).values(
      [
        { id: rootId, permissionScopeId: rootId, displayName: "Launch night" },
        {
          id: datedChildId,
          permissionScopeId: rootId,
          displayName: "Venue walkthrough",
        },
        {
          id: timedChildId,
          permissionScopeId: rootId,
          displayName: "Doors open",
        },
        {
          id: privateChildId,
          permissionScopeId: privateChildId,
          displayName: "Private budget review",
        },
        {
          id: unrelatedId,
          permissionScopeId: unrelatedId,
          displayName: "Unrelated planning",
        },
        {
          id: deletedId,
          permissionScopeId: deletedId,
          displayName: "Cancelled rehearsal",
          deletedAt: new Date("2030-01-01T00:00:00Z"),
        },
      ].map((row) => ({
        ...row,
        workspaceId,
        objectType: "event" as const,
        createdBy: ownerId,
      })),
    );
    await db.insert(events).values([
      {
        objectId: rootId,
        workspaceId,
        startsAt: new Date("2030-01-16T18:00:00Z"),
        endsAt: new Date("2030-01-16T23:00:00Z"),
        timezone: "UTC",
      },
      {
        objectId: datedChildId,
        workspaceId,
        startsOn: "2030-01-10",
        endsOn: "2030-01-11",
      },
      {
        objectId: timedChildId,
        workspaceId,
        startsAt: new Date("2030-01-16T17:30:00Z"),
        timezone: "UTC",
      },
      {
        objectId: privateChildId,
        workspaceId,
        startsAt: new Date("2030-01-12T09:00:00Z"),
        timezone: "UTC",
      },
      { objectId: unrelatedId, workspaceId, startsOn: "2030-02-01" },
      {
        objectId: deletedId,
        workspaceId,
        startsAt: new Date("2030-01-15T10:00:00Z"),
        timezone: "UTC",
      },
    ]);
    await db.insert(objectRelations).values(
      [datedChildId, timedChildId, privateChildId].map((targetObjectId) => ({
        id: createId(),
        workspaceId,
        sourceObjectId: rootId,
        targetObjectId,
        relationType: "includes" as const,
        createdBy: ownerId,
      })),
    );
    await db.insert(resourceGrants).values({
      id: createId(),
      workspaceId,
      resourceId: rootId,
      principalId: viewerId,
      role: "viewer",
      grantedBy: ownerId,
    });

    const clock = () => new Date("2030-01-01T00:00:00.000Z");
    const cloudbaseClient = await snapshotClient(db, workspaceId);
    const postgresEvents = new PostgresEventReadRepository(db);
    const postgresCalendar = new PostgresCalendarReadRepository(db);
    const cloudbaseEvents = new CloudBaseEventReadRepository(
      {
        ...cloudbaseClient,
        rpc: createCloudBaseRpcDouble(database.connection.sql),
      },
      clock,
    );
    const cloudbaseCalendar = new CloudBaseCalendarReadRepository(
      cloudbaseClient,
      clock,
    );
    const ids = (resources: readonly { readonly id: string }[]) =>
      resources.map(({ id }) => id);

    for (const [principal, expectedList, expectedCalendar] of [
      [
        owner,
        [privateChildId, rootId, unrelatedId],
        [datedChildId, timedChildId, privateChildId],
      ],
      [viewer, [rootId], [datedChildId, timedChildId]],
    ] as const) {
      const postgresPage = await postgresEvents.listEvents(principal, {
        sort: "date",
        limit: 10,
      });
      const cloudbasePage = await cloudbaseEvents.listEvents(principal, {
        sort: "date",
        limit: 10,
      });
      expect(ids(postgresPage.items)).toEqual(expectedList);
      expect(ids(cloudbasePage.items)).toEqual(ids(postgresPage.items));

      const postgresCalendarItems = await postgresCalendar.listCalendarEvents(
        principal,
        rootId,
      );
      const cloudbaseCalendarItems = await cloudbaseCalendar.listCalendarEvents(
        principal,
        rootId,
      );
      expect(ids(postgresCalendarItems)).toEqual(expectedCalendar);
      expect(ids(cloudbaseCalendarItems)).toEqual(ids(postgresCalendarItems));
    }

    await expect(
      postgresCalendar.listCalendarEvents(viewer, unrelatedId),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      cloudbaseCalendar.listCalendarEvents(viewer, unrelatedId),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);

    // Cursor paging: every sort mode crosses a page boundary with limit 2,
    // and each backend's own cursor must reproduce the same page sequence.
    for (const sort of ["date", "name", "updated"] as const) {
      const walk = async (repository: EventReadRepository) => {
        const pages: string[][] = [];
        let cursor: string | undefined;
        do {
          const page = await repository.listEvents(owner, {
            sort,
            limit: 2,
            cursor,
          });
          pages.push(ids(page.items));
          cursor = page.nextCursor ?? undefined;
        } while (cursor !== undefined && pages.length < 5);
        return pages;
      };
      const postgresPages = await walk(postgresEvents);
      const cloudbasePages = await walk(cloudbaseEvents);
      expect(postgresPages.map((page) => page.length)).toEqual([2, 1]);
      expect(cloudbasePages).toEqual(postgresPages);
      expect(new Set(postgresPages.flat())).toEqual(
        new Set([privateChildId, rootId, unrelatedId]),
      );
    }
  });

  it("matches PostgreSQL for the events shared from other workspaces, with their access and counts", async () => {
    const db = database.connection.db;
    const meiId = createId();
    const kaiId = createId();
    const anaId = createId();
    const meiWorkspace = createId();
    const kaiWorkspace = createId();
    const kyotoId = createId();
    const aloneId = createId();
    const weddingId = createId();
    const expiredId = createId();
    await db.insert(users).values(
      [
        [meiId, "Mei Lin"],
        [kaiId, "Kai Tanaka"],
        [anaId, "Ana Souza"],
      ].map(([id, displayName]) => ({
        id: id as string,
        identityProvider: "test",
        providerSubject: id as string,
        displayName: displayName as string,
      })),
    );
    await db.insert(workspaces).values([
      { id: meiWorkspace, createdBy: meiId, displayName: "Mei" },
      { id: kaiWorkspace, createdBy: kaiId, displayName: "Kai" },
    ]);
    await db.insert(workspaceMembers).values([
      { workspaceId: meiWorkspace, userId: meiId, role: "owner" },
      { workspaceId: kaiWorkspace, userId: kaiId, role: "owner" },
    ]);
    await db.insert(objects).values(
      [
        [kyotoId, meiWorkspace, meiId, "Kyoto in November"],
        [aloneId, meiWorkspace, meiId, "Mei alone"],
        [expiredId, meiWorkspace, meiId, "Expired share"],
        [weddingId, kaiWorkspace, kaiId, "Wedding countdown"],
      ].map(([id, workspaceId, createdBy, displayName]) => ({
        id: id as string,
        workspaceId: workspaceId as string,
        createdBy: createdBy as string,
        displayName: displayName as string,
        permissionScopeId: id as string,
        objectType: "event" as const,
      })),
    );
    await db.insert(events).values([
      { objectId: kyotoId, workspaceId: meiWorkspace, startsOn: "2030-11-02" },
      { objectId: aloneId, workspaceId: meiWorkspace, startsOn: "2020-06-01" },
      {
        objectId: expiredId,
        workspaceId: meiWorkspace,
        startsOn: "2030-03-01",
      },
      {
        objectId: weddingId,
        workspaceId: kaiWorkspace,
        startsAt: new Date("2030-10-11T10:00:00Z"),
        timezone: "UTC",
      },
    ]);
    await db.insert(resourceGrants).values([
      {
        id: createId(),
        workspaceId: meiWorkspace,
        resourceId: kyotoId,
        principalId: kaiId,
        role: "viewer",
        grantedBy: meiId,
      },
      {
        id: createId(),
        workspaceId: meiWorkspace,
        resourceId: kyotoId,
        principalId: kaiId,
        role: "editor",
        grantedBy: meiId,
        scope: "todos",
      },
      {
        id: createId(),
        workspaceId: meiWorkspace,
        resourceId: expiredId,
        principalId: kaiId,
        role: "viewer",
        grantedBy: meiId,
        createdAt: new Date("2020-01-01T00:00:00Z"),
        expiresAt: new Date("2020-12-31T00:00:00Z"),
      },
      {
        id: createId(),
        workspaceId: kaiWorkspace,
        resourceId: weddingId,
        principalId: meiId,
        role: "editor",
        grantedBy: kaiId,
      },
      {
        id: createId(),
        workspaceId: kaiWorkspace,
        resourceId: weddingId,
        principalId: anaId,
        role: "viewer",
        grantedBy: kaiId,
      },
    ]);

    // Both backends read at the wall clock, so the periods agree.
    const clock = () => new Date();
    const cloudbaseClient = await snapshotClient(db);
    const postgresEvents = new PostgresEventReadRepository(db);
    const cloudbaseEvents = new CloudBaseEventReadRepository(
      {
        ...cloudbaseClient,
        rpc: createCloudBaseRpcDouble(database.connection.sql),
      },
      clock,
    );
    const kai = {
      type: "user" as const,
      userId: kaiId,
      workspaceId: kaiWorkspace,
    };
    const mei = {
      type: "user" as const,
      userId: meiId,
      workspaceId: meiWorkspace,
    };
    const summary = (
      page: Awaited<ReturnType<EventReadRepository["listEvents"]>>,
    ) => ({
      items: page.items.map((item) => ({
        id: item.id,
        workspaceId: item.workspaceId,
        access: item.access,
      })),
      counts: page.counts,
      more: page.nextCursor !== null,
    });

    for (const [principal, scope, expected] of [
      [
        kai,
        "all",
        {
          items: [
            {
              id: weddingId,
              workspaceId: kaiWorkspace,
              access: { sharedBy: null, role: null, sharedWith: 2 },
            },
            {
              id: kyotoId,
              workspaceId: meiWorkspace,
              access: {
                sharedBy: { userId: meiId, displayName: "Mei Lin" },
                role: "viewer",
                sharedWith: 0,
              },
            },
          ],
          counts: { all: 2, mine: 1, shared: 1, upcoming: 2, past: 0 },
          more: false,
        },
      ],
      [
        kai,
        "mine",
        {
          items: [
            {
              id: weddingId,
              workspaceId: kaiWorkspace,
              access: { sharedBy: null, role: null, sharedWith: 2 },
            },
          ],
          counts: { all: 2, mine: 1, shared: 1, upcoming: 2, past: 0 },
          more: false,
        },
      ],
      [
        mei,
        "shared",
        {
          items: [
            {
              id: weddingId,
              workspaceId: kaiWorkspace,
              access: {
                sharedBy: { userId: kaiId, displayName: "Kai Tanaka" },
                role: "editor",
                sharedWith: 0,
              },
            },
          ],
          counts: { all: 4, mine: 3, shared: 1, upcoming: 3, past: 1 },
          more: false,
        },
      ],
    ] as const) {
      const input = { scope, sort: "date" as const, limit: 10 };
      const postgresPage = await postgresEvents.listEvents(principal, input);
      const cloudbasePage = await cloudbaseEvents.listEvents(principal, input);
      expect(summary(postgresPage)).toEqual(expected);
      expect(summary(cloudbasePage)).toEqual(summary(postgresPage));
    }
    // A later page carries no counts on either backend.
    const first = await postgresEvents.listEvents(mei, { limit: 2 });
    const cursor = first.nextCursor ?? "";
    expect(cursor).not.toBe("");
    const postgresRest = await postgresEvents.listEvents(mei, {
      limit: 2,
      cursor,
    });
    const cloudbaseRest = await cloudbaseEvents.listEvents(mei, {
      limit: 2,
      cursor:
        (await cloudbaseEvents.listEvents(mei, { limit: 2 })).nextCursor ?? "",
    });
    expect(postgresRest.counts).toBeNull();
    expect(cloudbaseRest.counts).toBeNull();
    expect(summary(cloudbaseRest).items).toEqual(summary(postgresRest).items);
  });
});
