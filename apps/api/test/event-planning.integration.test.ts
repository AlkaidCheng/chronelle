import { resolve } from "node:path";

import { auditEvents, createId, resourceGrants } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  apiErrorResponseSchema,
  developmentSignInResponseSchema,
  eventDetailResponseSchema,
  eventListResponseSchema,
  eventResourceProjectionResponseSchema,
  eventResponseSchema,
  expenseResourceProjectionResponseSchema,
  expenseResponseSchema,
  objectDeletionResponseSchema,
  relationListResponseSchema,
  relationResponseSchema,
  reminderResourceProjectionResponseSchema,
  reminderResponseSchema,
  taskResourceProjectionResponseSchema,
  taskResponseSchema,
  timelineResponseSchema,
} from "@chronelle/schemas";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

let testDatabase: TestDatabase;
let app: FastifyInstance;
let testResourcesReady = false;

beforeEach(async () => {
  testResourcesReady = false;
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
  app = buildApp(createDevelopmentAppDependencies(testDatabase.connection));
  testResourcesReady = true;
});

afterEach(async () => {
  if (testResourcesReady) {
    await app.close();
    await testDatabase.close();
  }
  testResourcesReady = false;
});

async function signIn(email: string, displayName: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email, displayName },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}

function headers(
  session: Awaited<ReturnType<typeof signIn>>,
  workspaceId = session.workspace.id,
) {
  return {
    authorization: `Bearer ${session.accessToken}`,
    "x-workspace-id": workspaceId,
  };
}

describe.sequential("event-planning API", () => {
  it("preserves date precision through projection, edits, history and restoration", async () => {
    const owner = await signIn("dates@example.test", "Planner");
    const auth = headers(owner);
    const created = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: auth,
      payload: {
        displayName: "Summer vacation",
        startsOn: "2030-07-03",
        endsOn: "2030-07-12",
        timezone: "America/Los_Angeles",
      },
    });
    expect(created.statusCode).toBe(201);
    const event = eventResponseSchema.parse(created.json());
    expect(event).toMatchObject({
      startsOn: "2030-07-03",
      endsOn: "2030-07-12",
      startsAt: null,
      endsAt: null,
    });
    const child = await app.inject({
      method: "POST",
      url: `/api/events/${event.id}/resources`,
      headers: auth,
      payload: {
        commandId: createId(),
        resource: {
          objectType: "event",
          displayName: "Mountain stay",
          startsOn: "2030-07-04",
          endsOn: "2030-07-06",
        },
      },
    });
    expect(child.statusCode).toBe(201);
    for (const view of ["calendar", "itinerary"]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/events/${event.id}/${view}`,
        headers: auth,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().items[0]).toMatchObject({
        id: child.json().resource.id,
        startsOn: "2030-07-04",
        startsAt: null,
      });
    }
    const timeline = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/timeline`,
      headers: auth,
    });
    expect(timeline.json().items[0]).toMatchObject({
      occursAt: null,
      occursOn: "2030-07-04",
    });
    const patch = { expectedVersion: 1, endsOn: "2030-07-14" };
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/events/${event.id}`,
          headers: auth,
          payload: patch,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/api/events/${event.id}`,
          headers: auth,
          payload: patch,
        })
      ).statusCode,
    ).toBe(409);
    const restored = await app.inject({
      method: "POST",
      url: `/api/objects/${event.id}/revisions/1/restore`,
      headers: auth,
      payload: { expectedVersion: 2 },
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      startsOn: "2030-07-03",
      endsOn: "2030-07-12",
      version: 3,
    });
    const audit = await testDatabase.connection
      .sql`SELECT action FROM audit_events WHERE resource_id=${event.id}`;
    expect(audit.map((row) => row.action)).toEqual(
      expect.arrayContaining([
        "event.created",
        "event.updated",
        "event.restored",
      ]),
    );
    const outsider = await signIn(
      "outsider-dates@example.test",
      "Other planner",
    );
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}`,
          headers: headers(outsider),
        })
      ).statusCode,
    ).toBe(404);
    for (const payload of [
      { startsOn: "2030-02-30" },
      { startsOn: "2030-07-03", endsOn: "2030-07-01" },
      { startsOn: "2030-07-03", startsAt: "2030-07-03T00:00:00Z" },
    ])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/events",
            headers: auth,
            payload: { displayName: "Invalid", ...payload },
          })
        ).statusCode,
      ).toBe(400);
  });
  it("projects canonical event resources and preserves lifecycle invariants", async () => {
    const owner = await signIn("planner@example.com", "Event Planner");
    const ownerHeaders = headers(owner);

    const eventResponse = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: ownerHeaders,
      payload: {
        displayName: "Product launch",
        startsAt: "2026-10-15T16:00:00Z",
        endsAt: "2026-10-16T03:00:00Z",
        timezone: "America/Los_Angeles",
      },
    });
    expect(eventResponse.statusCode).toBe(201);
    const event = eventResponseSchema.parse(eventResponse.json());

    const itineraryResponse = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: ownerHeaders,
      payload: {
        displayName: "Guest arrival",
        permissionScopeId: event.id,
        startsAt: "2026-10-15T17:30:00Z",
        timezone: "America/Los_Angeles",
      },
    });
    expect(itineraryResponse.statusCode).toBe(201);
    const itineraryItem = eventResponseSchema.parse(itineraryResponse.json());

    const taskCreateResponse = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: ownerHeaders,
      payload: {
        displayName: "Confirm caterer",
        permissionScopeId: event.id,
        dueAt: "2026-10-10T18:00:00Z",
      },
    });
    expect(taskCreateResponse.statusCode).toBe(201);
    const task = taskResponseSchema.parse(taskCreateResponse.json());

    const expenseCreateResponse = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: ownerHeaders,
      payload: {
        displayName: "Venue deposit",
        permissionScopeId: event.id,
        amount: "1250.5000",
        currency: "usd",
        occurredAt: "2026-09-15T12:00:00Z",
      },
    });
    expect(expenseCreateResponse.statusCode).toBe(201);
    const expense = expenseResponseSchema.parse(expenseCreateResponse.json());

    const reminderCreateResponse = await app.inject({
      method: "POST",
      url: "/api/reminders",
      headers: ownerHeaders,
      payload: {
        displayName: "Final headcount",
        permissionScopeId: event.id,
        remindAt: "2026-10-08T16:00:00Z",
      },
    });
    expect(reminderCreateResponse.statusCode).toBe(201);
    const reminder = reminderResponseSchema.parse(
      reminderCreateResponse.json(),
    );

    const includedResources = [itineraryItem, task, expense, reminder];
    const relations = [];
    for (const resource of includedResources) {
      const response = await app.inject({
        method: "POST",
        url: `/api/objects/${event.id}/relations`,
        headers: ownerHeaders,
        payload: {
          relationType: "includes",
          targetObjectId: resource.id,
          metadata: { section: resource.objectType },
        },
      });
      expect(response.statusCode).toBe(201);
      relations.push(relationResponseSchema.parse(response.json()));
    }

    const eventListResponse = await app.inject({
      method: "GET",
      url: "/api/events",
      headers: ownerHeaders,
    });
    expect(
      eventListResponseSchema
        .parse(eventListResponse.json())
        .items.map(({ id }) => id),
    ).toEqual([event.id]);

    const detailResponse = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/detail`,
      headers: ownerHeaders,
    });
    const detail = eventDetailResponseSchema.parse(detailResponse.json());
    expect(detail.event.id).toBe(event.id);
    expect(detail.events.map(({ id }) => id)).toEqual([itineraryItem.id]);
    expect(detail.tasks.map(({ id }) => id)).toEqual([task.id]);
    expect(detail.expenses.map(({ id }) => id)).toEqual([expense.id]);
    expect(detail.reminders.map(({ id }) => id)).toEqual([reminder.id]);

    const todosResponse = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/todos`,
      headers: ownerHeaders,
    });
    expect(
      taskResourceProjectionResponseSchema.parse(todosResponse.json()).items,
    ).toMatchObject([{ id: task.id }]);

    for (const projectionName of ["calendar", "itinerary"] as const) {
      const response = await app.inject({
        method: "GET",
        url: `/api/events/${event.id}/${projectionName}`,
        headers: ownerHeaders,
      });
      expect(
        eventResourceProjectionResponseSchema.parse(response.json()).items,
      ).toMatchObject([{ id: itineraryItem.id }]);
    }

    const expenseProjectionResponse = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/expenses`,
      headers: ownerHeaders,
    });
    expect(
      expenseResourceProjectionResponseSchema.parse(
        expenseProjectionResponse.json(),
      ).items,
    ).toMatchObject([{ id: expense.id, amount: "1250.5000" }]);

    const reminderProjectionResponse = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/reminders`,
      headers: ownerHeaders,
    });
    expect(
      reminderResourceProjectionResponseSchema.parse(
        reminderProjectionResponse.json(),
      ).items,
    ).toMatchObject([{ id: reminder.id }]);

    const timelineResponse = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/timeline`,
      headers: ownerHeaders,
    });
    const timeline = timelineResponseSchema.parse(timelineResponse.json());
    expect(
      timeline.items.map(({ canonicalObjectId }) => canonicalObjectId).sort(),
    ).toEqual([itineraryItem.id, task.id, expense.id, reminder.id].sort());

    const itineraryUpdateResponse = await app.inject({
      method: "PATCH",
      url: `/api/events/${itineraryItem.id}`,
      headers: ownerHeaders,
      payload: {
        expectedVersion: itineraryItem.version,
        displayName: "VIP guest arrival",
      },
    });
    expect(itineraryUpdateResponse.statusCode).toBe(200);
    const updatedItineraryItem = eventResponseSchema.parse(
      itineraryUpdateResponse.json(),
    );
    expect(updatedItineraryItem).toMatchObject({
      id: itineraryItem.id,
      displayName: "VIP guest arrival",
      version: 2,
    });

    const updatedCalendarResponse = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/calendar`,
      headers: ownerHeaders,
    });
    expect(
      eventResourceProjectionResponseSchema.parse(
        updatedCalendarResponse.json(),
      ).items,
    ).toMatchObject([
      {
        id: itineraryItem.id,
        displayName: "VIP guest arrival",
        version: 2,
      },
    ]);

    for (const projection of ["itinerary", "timeline"] as const) {
      const response = await app.inject({
        method: "GET",
        url: `/api/events/${event.id}/${projection}`,
        headers: ownerHeaders,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            [projection === "timeline" ? "canonicalObjectId" : "id"]:
              itineraryItem.id,
            displayName: "VIP guest arrival",
            version: 2,
          }),
        ]),
      );
    }

    const staleUpdateResponse = await app.inject({
      method: "PATCH",
      url: `/api/events/${itineraryItem.id}`,
      headers: ownerHeaders,
      payload: { expectedVersion: 1, displayName: "Stale edit" },
    });
    expect(staleUpdateResponse.statusCode).toBe(409);
    expect(
      apiErrorResponseSchema.parse(staleUpdateResponse.json()),
    ).toMatchObject({ error: { code: "version_conflict" } });

    const relationDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/relations/${relations[1]?.id}?expectedVersion=${relations[1]?.version}`,
      headers: ownerHeaders,
    });
    expect(relationDeleteResponse.statusCode).toBe(200);
    const unlinkedTodosResponse = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/todos`,
      headers: ownerHeaders,
    });
    expect(
      taskResourceProjectionResponseSchema.parse(unlinkedTodosResponse.json())
        .items,
    ).toEqual([]);

    const unlinkedTaskResponse = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
      headers: ownerHeaders,
    });
    expect(unlinkedTaskResponse.statusCode).toBe(200);
    expect(taskResponseSchema.parse(unlinkedTaskResponse.json()).id).toBe(
      task.id,
    );

    const taskDeleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/objects/${task.id}?expectedVersion=${task.version}`,
      headers: ownerHeaders,
    });
    expect(taskDeleteResponse.statusCode).toBe(200);
    expect(
      objectDeletionResponseSchema.parse(taskDeleteResponse.json()),
    ).toMatchObject({ id: task.id, version: 2 });

    const deletedTaskResponse = await app.inject({
      method: "GET",
      url: `/api/tasks/${task.id}`,
      headers: ownerHeaders,
    });
    expect(deletedTaskResponse.statusCode).toBe(404);

    const planningAudits = (
      await testDatabase.connection.db
        .select({
          action: auditEvents.action,
          requestId: auditEvents.requestId,
        })
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, owner.workspace.id))
    ).filter(
      ({ action }) =>
        !action.startsWith("identity.") && !action.startsWith("workspace."),
    );
    expect(planningAudits.map(({ action }) => action).sort()).toEqual(
      [
        "event.created",
        "event.created",
        "task.created",
        "expense.created",
        "reminder.created",
        "relation.created",
        "relation.created",
        "relation.created",
        "relation.created",
        "event.updated",
        "relation.deleted",
        "task.deleted",
      ].sort(),
    );
    expect(new Set(planningAudits.map(({ requestId }) => requestId)).size).toBe(
      planningAudits.length,
    );
  });

  it("keeps a task due on a date apart from one due at an instant", async () => {
    const owner = await signIn("dates@example.com", "Date Planner");
    const ownerHeaders = headers(owner);
    const eventResponse = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: ownerHeaders,
      payload: { displayName: "Autumn fair" },
    });
    const event = eventResponseSchema.parse(eventResponse.json());
    const create = async (payload: Record<string, unknown>) =>
      app.inject({
        method: "POST",
        url: "/api/tasks",
        headers: ownerHeaders,
        payload: { permissionScopeId: event.id, ...payload },
      });

    const bothResponse = await create({
      displayName: "Impossible",
      dueOn: "2026-10-10",
      dueAt: "2026-10-10T18:00:00Z",
    });
    expect(bothResponse.statusCode).toBe(400);
    expect(bothResponse.json()).toMatchObject({
      error: { message: "dueOn and dueAt cannot both be set." },
    });

    const timedResponse = await create({
      displayName: "Timed",
      dueAt: "2026-10-10T18:00:00Z",
    });
    const timed = taskResponseSchema.parse(timedResponse.json());
    expect(timed).toMatchObject({
      dueOn: null,
      dueAt: "2026-10-10T18:00:00.000Z",
    });
    const datedResponse = await create({
      displayName: "Dated",
      dueOn: "2026-10-10",
    });
    const dated = taskResponseSchema.parse(datedResponse.json());
    expect(dated).toMatchObject({ dueOn: "2026-10-10", dueAt: null });
    for (const target of [timed, dated]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/objects/${event.id}/relations`,
        headers: ownerHeaders,
        payload: { relationType: "includes", targetObjectId: target.id },
      });
      expect(response.statusCode).toBe(201);
    }

    const todosResponse = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/todos`,
      headers: ownerHeaders,
    });
    expect(
      taskResourceProjectionResponseSchema
        .parse(todosResponse.json())
        .items.map(({ id }) => id),
    ).toEqual([dated.id, timed.id]);
    const timelineResponse = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/timeline`,
      headers: ownerHeaders,
    });
    expect(
      timelineResponseSchema.parse(timelineResponse.json()).items,
    ).toMatchObject([
      { canonicalObjectId: dated.id, occursOn: "2026-10-10", occursAt: null },
      { canonicalObjectId: timed.id, occursAt: "2026-10-10T18:00:00.000Z" },
    ]);

    // Moving between the forms clears the other in the same update.
    const conflictResponse = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${dated.id}`,
      headers: ownerHeaders,
      payload: { expectedVersion: 1, dueAt: "2026-10-11T09:00:00Z" },
    });
    expect(conflictResponse.statusCode).toBe(400);
    const movedResponse = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${dated.id}`,
      headers: ownerHeaders,
      payload: {
        expectedVersion: 1,
        dueOn: null,
        dueAt: "2026-10-11T09:00:00Z",
      },
    });
    expect(movedResponse.statusCode).toBe(200);
    expect(taskResponseSchema.parse(movedResponse.json())).toMatchObject({
      version: 2,
      dueOn: null,
      dueAt: "2026-10-11T09:00:00.000Z",
    });
  });

  it("enforces inheritance without treating references as grants", async () => {
    const owner = await signIn("owner@example.com", "Owner");
    const viewer = await signIn("viewer@example.com", "Viewer");
    const unrelated = await signIn("unrelated@example.com", "Unrelated");
    const ownerHeaders = headers(owner);

    const eventResponse = await app.inject({
      method: "POST",
      url: "/api/events",
      headers: ownerHeaders,
      payload: { displayName: "Shared conference" },
    });
    const event = eventResponseSchema.parse(eventResponse.json());
    const taskResponse = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: ownerHeaders,
      payload: {
        displayName: "Print badges",
        permissionScopeId: event.id,
      },
    });
    const task = taskResponseSchema.parse(taskResponse.json());
    const expenseResponse = await app.inject({
      method: "POST",
      url: "/api/expenses",
      headers: ownerHeaders,
      payload: {
        displayName: "Private adjustment",
        amount: "25.0000",
        currency: "USD",
        occurredAt: "2026-09-01T12:00:00Z",
      },
    });
    const independentExpense = expenseResponseSchema.parse(
      expenseResponse.json(),
    );

    for (const targetObjectId of [task.id, independentExpense.id]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/objects/${event.id}/relations`,
        headers: ownerHeaders,
        payload: { relationType: "includes", targetObjectId },
      });
      expect(response.statusCode).toBe(201);
    }

    await testDatabase.connection.db.insert(resourceGrants).values({
      id: createId(),
      workspaceId: owner.workspace.id,
      resourceId: event.id,
      principalId: viewer.user.id,
      role: "viewer",
      grantedBy: owner.user.id,
    });

    const viewerHeaders = headers(viewer, owner.workspace.id);
    const ownerListResponse = await app.inject({
      method: "GET",
      url: "/api/events",
      headers: ownerHeaders,
    });
    expect(
      eventListResponseSchema
        .parse(ownerListResponse.json())
        .items.map(({ id }) => id),
    ).toContain(event.id);

    const viewerListResponse = await app.inject({
      method: "GET",
      url: "/api/events",
      headers: viewerHeaders,
    });
    expect(
      eventListResponseSchema
        .parse(viewerListResponse.json())
        .items.map(({ id }) => id),
    ).toEqual([event.id]);

    const unrelatedListResponse = await app.inject({
      method: "GET",
      url: "/api/events",
      headers: headers(unrelated),
    });
    expect(
      eventListResponseSchema.parse(unrelatedListResponse.json()).items,
    ).toEqual([]);

    for (const objectId of [event.id, task.id]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/objects/${objectId}`,
        headers: viewerHeaders,
      });
      expect(response.statusCode).toBe(200);
    }

    const viewerDetailResponse = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}/detail`,
      headers: viewerHeaders,
    });
    const viewerDetail = eventDetailResponseSchema.parse(
      viewerDetailResponse.json(),
    );
    expect(viewerDetail.tasks.map(({ id }) => id)).toEqual([task.id]);
    expect(viewerDetail.expenses).toEqual([]);
    expect(viewerDetail.lockedRelationCount).toBe(1);

    for (const projection of [
      "todos",
      "calendar",
      "itinerary",
      "timeline",
      "expenses",
      "reminders",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/events/${event.id}/${projection}`,
        headers: viewerHeaders,
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).not.toContain(independentExpense.id);
      expect(response.body).not.toContain("Private adjustment");
      expect(response.json().items).toHaveLength(
        projection === "todos" ? 1 : 0,
      );
      for (const inaccessibleHeaders of [
        headers(unrelated),
        headers(unrelated, owner.workspace.id),
        headers(viewer),
      ]) {
        const denied = await app.inject({
          method: "GET",
          url: `/api/events/${event.id}/${projection}`,
          headers: inaccessibleHeaders,
        });
        expect(denied.statusCode).toBe(404);
      }
    }

    const viewerRelationsResponse = await app.inject({
      method: "GET",
      url: `/api/objects/${event.id}/relations`,
      headers: viewerHeaders,
    });
    expect(
      relationListResponseSchema
        .parse(viewerRelationsResponse.json())
        .items.map(({ targetObjectId }) => targetObjectId),
    ).toEqual([task.id]);

    const referencedExpenseResponse = await app.inject({
      method: "GET",
      url: `/api/expenses/${independentExpense.id}`,
      headers: viewerHeaders,
    });
    expect(referencedExpenseResponse.statusCode).toBe(404);

    const viewerEditResponse = await app.inject({
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      headers: viewerHeaders,
      payload: { expectedVersion: task.version, displayName: "Unauthorized" },
    });
    expect(viewerEditResponse.statusCode).toBe(404);

    const viewerCreateResponse = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: viewerHeaders,
      payload: {
        displayName: "Unauthorized child",
        permissionScopeId: event.id,
      },
    });
    expect(viewerCreateResponse.statusCode).toBe(404);

    const unrelatedResponse = await app.inject({
      method: "GET",
      url: `/api/events/${event.id}`,
      headers: headers(unrelated),
    });
    expect(unrelatedResponse.statusCode).toBe(404);

    const crossWorkspaceResponse = await app.inject({
      method: "POST",
      url: "/api/tasks",
      headers: headers(unrelated),
      payload: {
        displayName: "Cross-workspace child",
        permissionScopeId: event.id,
      },
    });
    expect(crossWorkspaceResponse.statusCode).toBe(404);
    await testDatabase.connection.db
      .update(resourceGrants)
      .set({ expiresAt: new Date() })
      .where(eq(resourceGrants.resourceId, event.id));
    for (const projection of [
      "todos",
      "calendar",
      "itinerary",
      "timeline",
      "expenses",
      "reminders",
    ]) {
      const response = await app.inject({
        method: "GET",
        url: `/api/events/${event.id}/${projection}`,
        headers: viewerHeaders,
      });
      expect(response.statusCode).toBe(404);
    }
  });
});
