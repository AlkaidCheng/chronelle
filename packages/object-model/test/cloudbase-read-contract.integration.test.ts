import { resolve } from "node:path";

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
import type { CloudBaseRdbClient, CloudBaseRdbQuery } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseCalendarReadRepository } from "../src/cloudbase-calendar-read-repository.js";
import { CloudBaseEventReadRepository } from "../src/cloudbase-event-read-repository.js";
import { PostgresEventReadRepository } from "../src/event-list.js";
import { PostgresCalendarReadRepository } from "../src/projection-service.js";
import type { EventResource } from "../src/types.js";

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

interface CloudBaseFixtureEvent {
  readonly includedIn: string | null;
  readonly resource: EventResource;
}

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

function fixtureClient(
  fixtures: readonly CloudBaseFixtureEvent[],
  principalId: string,
  visibleResourceIds: readonly string[],
): CloudBaseRdbClient {
  const objectRows = fixtures.map(({ resource }) => ({
    id: resource.id,
    workspace_id: resource.workspaceId,
    object_type: resource.objectType,
    display_name: resource.displayName,
    created_by: resource.createdBy,
    permission_scope_id: resource.permissionScopeId,
    created_at: resource.createdAt.toISOString(),
    updated_at: resource.updatedAt.toISOString(),
    version: resource.version,
    archived_at: resource.archivedAt?.toISOString() ?? null,
    deleted_at: resource.deletedAt?.toISOString() ?? null,
    custom_properties: resource.customProperties,
    metadata: resource.metadata,
  }));
  const eventRows = fixtures.map(({ resource }) => ({
    object_id: resource.id,
    workspace_id: resource.workspaceId,
    starts_at: resource.startsAt?.toISOString() ?? null,
    ends_at: resource.endsAt?.toISOString() ?? null,
    starts_on: resource.startsOn,
    ends_on: resource.endsOn,
    timezone: resource.timezone,
    is_all_day: resource.isAllDay,
  }));
  const relationRows = fixtures
    .filter(({ includedIn }) => includedIn !== null)
    .map(({ includedIn, resource }) => ({
      workspace_id: resource.workspaceId,
      source_object_id: includedIn,
      target_object_id: resource.id,
      relation_type: "includes",
      deleted_at: null,
    }));
  return {
    capabilities: { transactions: false, nativeTcp: false },
    async select<T>(table: string, query: CloudBaseRdbQuery = {}) {
      if (table === "objects")
        return objectRows.filter((row) =>
          matches(row, query),
        ) as unknown as readonly T[];
      if (table === "events")
        return eventRows.filter((row) =>
          matches(row, query),
        ) as unknown as readonly T[];
      if (table === "object_relations")
        return relationRows.filter((row) =>
          matches(row, query),
        ) as unknown as readonly T[];
      if (table === "workspace_members") return [] as readonly T[];
      if (table === "resource_grants")
        return visibleResourceIds
          .map((resourceId) => ({
            workspace_id: fixtures[0]?.resource.workspaceId,
            principal_type: "user",
            principal_id: principalId,
            resource_id: resourceId,
            role: "viewer",
            expires_at: null,
          }))
          .filter((row) => matches(row, query)) as unknown as readonly T[];
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function fixtureResource(
  id: string,
  workspaceId: string,
  displayName: string,
  startsAt: Date | null,
): EventResource {
  const now = new Date("2030-01-01T00:00:00.000Z");
  return {
    id,
    workspaceId,
    permissionScopeId: id,
    objectType: "event",
    displayName,
    createdBy: "fixture-owner",
    createdAt: now,
    updatedAt: now,
    version: 1,
    archivedAt: null,
    deletedAt: null,
    customProperties: {},
    metadata: {},
    startsAt,
    endsAt: null,
    startsOn: null,
    endsOn: null,
    timezone: "UTC",
    isAllDay: false,
  };
}

describe.sequential("CloudBase read contract", () => {
  it("matches PostgreSQL canonical IDs and calendar ordering", async () => {
    const db = database.connection.db;
    const ownerId = createId();
    const userId = createId();
    const workspaceId = createId();
    const rootId = createId();
    const firstId = createId();
    const secondId = createId();
    const hiddenId = createId();
    const principal = { type: "user" as const, userId, workspaceId };
    const firstStartsAt = new Date("2030-01-01T09:00:00Z");
    const secondStartsAt = new Date("2030-01-02T09:00:00Z");

    await db.insert(users).values(
      [ownerId, userId].map((id) => ({
        id,
        identityProvider: "test",
        providerSubject: id,
        displayName: "Contract reader",
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
    await db.insert(objects).values(
      [rootId, firstId, secondId, hiddenId].map((id) => ({
        id,
        workspaceId,
        permissionScopeId: id,
        objectType: "event" as const,
        displayName: id === hiddenId ? "Hidden" : "Visible",
        createdBy: ownerId,
      })),
    );
    await db.insert(events).values([
      { objectId: rootId, workspaceId },
      {
        objectId: firstId,
        workspaceId,
        startsAt: firstStartsAt,
        timezone: "UTC",
      },
      {
        objectId: secondId,
        workspaceId,
        startsAt: secondStartsAt,
        timezone: "UTC",
      },
      {
        objectId: hiddenId,
        workspaceId,
        startsAt: new Date("2030-01-03T09:00:00Z"),
        timezone: "UTC",
      },
    ]);
    await db.insert(resourceGrants).values(
      [rootId, firstId, secondId].map((resourceId) => ({
        id: createId(),
        workspaceId,
        resourceId,
        principalId: userId,
        role: "viewer" as const,
        grantedBy: ownerId,
      })),
    );
    await db.insert(objectRelations).values(
      [firstId, secondId, hiddenId].map((targetObjectId) => ({
        id: createId(),
        workspaceId,
        sourceObjectId: rootId,
        targetObjectId,
        relationType: "includes" as const,
        createdBy: ownerId,
      })),
    );

    const postgresEvents = new PostgresEventReadRepository(db);
    const postgresCalendar = new PostgresCalendarReadRepository(db);
    const cloudbaseFixtures = [
      {
        includedIn: null,
        resource: fixtureResource(rootId, workspaceId, "Visible", null),
      },
      {
        includedIn: rootId,
        resource: fixtureResource(
          firstId,
          workspaceId,
          "Visible",
          firstStartsAt,
        ),
      },
      {
        includedIn: rootId,
        resource: fixtureResource(
          secondId,
          workspaceId,
          "Visible",
          secondStartsAt,
        ),
      },
      {
        includedIn: rootId,
        resource: fixtureResource(
          hiddenId,
          workspaceId,
          "Hidden",
          new Date("2030-01-03T09:00:00Z"),
        ),
      },
    ];
    const cloudbaseClient = fixtureClient(cloudbaseFixtures, userId, [
      rootId,
      firstId,
      secondId,
    ]);
    const cloudbaseEvents = new CloudBaseEventReadRepository(
      cloudbaseClient,
      () => new Date("2030-01-01T00:00:00.000Z"),
    );
    const cloudbaseCalendar = new CloudBaseCalendarReadRepository(
      cloudbaseClient,
      () => new Date("2030-01-01T00:00:00.000Z"),
    );

    const postgresPage = await postgresEvents.listEvents(principal, {
      sort: "date",
      limit: 10,
    });
    const cloudbasePage = await cloudbaseEvents.listEvents(principal, {
      sort: "date",
      limit: 10,
    });
    expect(cloudbasePage.items.map(({ id }) => id)).toEqual(
      postgresPage.items.map(({ id }) => id),
    );

    const postgresCalendarItems = await postgresCalendar.listCalendarEvents(
      principal,
      rootId,
    );
    const cloudbaseCalendarItems = await cloudbaseCalendar.listCalendarEvents(
      principal,
      rootId,
    );
    expect(cloudbaseCalendarItems.map(({ id }) => id)).toEqual(
      postgresCalendarItems.map(({ id }) => id),
    );
  });
});
