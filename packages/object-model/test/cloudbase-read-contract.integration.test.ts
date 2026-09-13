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
  CloudBaseRdbClient,
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

import { CloudBaseCalendarReadRepository } from "../src/cloudbase-calendar-read-repository.js";
import { CloudBaseEventReadRepository } from "../src/cloudbase-event-read-repository.js";
import { PostgresEventReadRepository } from "../src/event-list.js";
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
 * Serves the workspace rows PostgreSQL holds through the RDB transport
 * boundary, so both adapters read one dataset.
 */
async function snapshotClient(
  db: Database,
  workspaceId: string,
): Promise<CloudBaseRdbClient> {
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
    capabilities: { transactions: false, nativeTcp: false },
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
      cloudbaseClient,
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
  });
});
