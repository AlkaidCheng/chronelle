import { resolve } from "node:path";

import type { UserPrincipal } from "@chronelle/authorization";
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
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import type { EventListQueryInput } from "@chronelle/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PostgresCalendarReadRepository,
  type CalendarReadRepository,
} from "../src/projection-service.js";
import {
  PostgresEventReadRepository,
  type EventReadRepository,
} from "../src/event-list.js";
import type { EventPage } from "../src/event-list.js";
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
  readonly visibleTo: string;
  readonly workspaceId: string;
}

class CloudBaseReadDouble
  implements EventReadRepository, CalendarReadRepository
{
  readonly #events: readonly CloudBaseFixtureEvent[];

  constructor(events: readonly CloudBaseFixtureEvent[]) {
    this.#events = events;
  }

  listEvents(
    principal: UserPrincipal,
    _input: EventListQueryInput = {},
  ): Promise<EventPage> {
    const items = this.#events
      .filter(
        (fixture) =>
          fixture.workspaceId === principal.workspaceId &&
          fixture.visibleTo === principal.userId,
      )
      .map(({ resource }) => resource)
      .sort(
        (first, second) =>
          (first.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
            (second.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
          first.id.localeCompare(second.id),
      );
    return Promise.resolve({
      items,
      nextCursor: null,
      asOf: "2030-01-01T00:00:00.000Z",
    });
  }

  listCalendarEvents(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<readonly EventResource[]> {
    return Promise.resolve(
      this.#events
        .filter(
          (fixture) =>
            fixture.includedIn === eventId &&
            fixture.workspaceId === principal.workspaceId &&
            fixture.visibleTo === principal.userId,
        )
        .map(({ resource }) => resource)
        .sort(
          (first, second) =>
            (first.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) -
              (second.startsAt?.getTime() ?? Number.MAX_SAFE_INTEGER) ||
            first.id.localeCompare(second.id),
        ),
    );
  }
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
    const cloudbase = new CloudBaseReadDouble([
      {
        includedIn: null,
        resource: fixtureResource(rootId, workspaceId, "Visible", null),
        visibleTo: userId,
        workspaceId,
      },
      {
        includedIn: rootId,
        resource: fixtureResource(
          firstId,
          workspaceId,
          "Visible",
          firstStartsAt,
        ),
        visibleTo: userId,
        workspaceId,
      },
      {
        includedIn: rootId,
        resource: fixtureResource(
          secondId,
          workspaceId,
          "Visible",
          secondStartsAt,
        ),
        visibleTo: userId,
        workspaceId,
      },
      {
        includedIn: rootId,
        resource: fixtureResource(
          hiddenId,
          workspaceId,
          "Hidden",
          new Date("2030-01-03T09:00:00Z"),
        ),
        visibleTo: "another-user",
        workspaceId,
      },
    ]);

    const postgresPage = await postgresEvents.listEvents(principal, {
      sort: "date",
      limit: 10,
    });
    const cloudbasePage = await cloudbase.listEvents(principal, {
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
    const cloudbaseCalendarItems = await cloudbase.listCalendarEvents(
      principal,
      rootId,
    );
    expect(cloudbaseCalendarItems.map(({ id }) => id)).toEqual(
      postgresCalendarItems.map(({ id }) => id),
    );
  });
});
