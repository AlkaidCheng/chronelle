import { resolve } from "node:path";

import { auditEvents } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  apiErrorResponseSchema,
  developmentSignInResponseSchema,
  eventDetailResponseSchema,
  eventResourceProjectionResponseSchema,
  eventResponseSchema,
  expenseResourceProjectionResponseSchema,
  expenseResponseSchema,
  objectAccessResponseSchema,
  reminderResourceProjectionResponseSchema,
  reminderResponseSchema,
  sessionResponseSchema,
  shareListResponseSchema,
  shareResponseSchema,
  shareRevocationResponseSchema,
  taskResourceProjectionResponseSchema,
  taskResponseSchema,
} from "@chronelle/schemas";
import { eq } from "drizzle-orm";
import type { FastifyInstance, InjectOptions } from "fastify";
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

async function request(
  session: Awaited<ReturnType<typeof signIn>>,
  workspaceId: string,
  options: Omit<InjectOptions, "headers">,
) {
  return app.inject({
    ...options,
    headers: headers(session, workspaceId),
  });
}

describe.sequential("Event sharing API", () => {
  it("shares one canonical Event scope and revokes it on the next request", async () => {
    const owner = await signIn("owner@example.com", "Event Owner");
    const viewer = await signIn("viewer@example.com", "Event Viewer");
    const editor = await signIn("editor@example.com", "Event Editor");
    const workspaceId = owner.workspace.id;

    const eventResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/events",
      payload: {
        displayName: "Shared launch",
        startsAt: "2026-10-15T16:00:00Z",
      },
    });
    expect(eventResponse.statusCode).toBe(201);
    const event = eventResponseSchema.parse(eventResponse.json());

    const scheduledResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/events",
      payload: {
        displayName: "Doors open",
        permissionScopeId: event.id,
        startsAt: "2026-10-15T17:00:00Z",
      },
    });
    const scheduledEvent = eventResponseSchema.parse(scheduledResponse.json());
    const taskResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/tasks",
      payload: {
        displayName: "Confirm speakers",
        permissionScopeId: event.id,
        dueAt: "2026-10-10T18:00:00Z",
      },
    });
    const task = taskResponseSchema.parse(taskResponse.json());
    const expenseResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/expenses",
      payload: {
        displayName: "Venue deposit",
        permissionScopeId: event.id,
        amount: "1000.0000",
        currency: "USD",
        occurredAt: "2026-09-15T12:00:00Z",
      },
    });
    const expense = expenseResponseSchema.parse(expenseResponse.json());
    const reminderResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/reminders",
      payload: {
        displayName: "Send final briefing",
        permissionScopeId: event.id,
        remindAt: "2026-10-14T16:00:00Z",
      },
    });
    const reminder = reminderResponseSchema.parse(reminderResponse.json());

    for (const targetObjectId of [
      scheduledEvent.id,
      task.id,
      expense.id,
      reminder.id,
    ]) {
      const relationResponse = await request(owner, workspaceId, {
        method: "POST",
        url: `/api/objects/${event.id}/relations`,
        payload: { relationType: "includes", targetObjectId },
      });
      expect(relationResponse.statusCode).toBe(201);
    }

    const viewerShareResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/shares",
      payload: {
        resourceId: event.id,
        principalEmail: "VIEWER@EXAMPLE.COM",
        role: "viewer",
      },
    });
    expect(viewerShareResponse.statusCode).toBe(201);
    const viewerShare = shareResponseSchema.parse(viewerShareResponse.json());
    expect(viewerShare).toMatchObject({
      principal: { id: viewer.user.id, email: "viewer@example.com" },
      resourceId: event.id,
      role: "viewer",
    });

    const editorShareResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/shares",
      payload: {
        resourceId: event.id,
        principalEmail: "editor@example.com",
        role: "editor",
      },
    });
    expect(editorShareResponse.statusCode).toBe(201);
    expect(shareResponseSchema.parse(editorShareResponse.json()).role).toBe(
      "editor",
    );

    const sharesResponse = await request(owner, workspaceId, {
      method: "GET",
      url: `/api/objects/${event.id}/shares`,
    });
    expect(
      shareListResponseSchema
        .parse(sharesResponse.json())
        .items.map(({ role }) => role)
        .sort(),
    ).toEqual(["editor", "viewer"]);

    const viewerSessionResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: "/api/auth/session",
    });
    const viewerSession = sessionResponseSchema.parse(
      viewerSessionResponse.json(),
    );
    expect(viewerSession.workspace.id).toBe(workspaceId);
    expect(viewerSession.availableWorkspaces.map(({ id }) => id)).toEqual([
      workspaceId,
      viewer.workspace.id,
    ]);

    const viewerAccessResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/objects/${event.id}/access`,
    });
    expect(
      objectAccessResponseSchema.parse(viewerAccessResponse.json()).actions,
    ).toEqual(["view"]);

    const viewerDetailResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/events/${event.id}/detail`,
    });
    const viewerDetail = eventDetailResponseSchema.parse(
      viewerDetailResponse.json(),
    );
    expect(viewerDetail).toMatchObject({
      events: [{ id: scheduledEvent.id }],
      tasks: [{ id: task.id }],
      expenses: [{ id: expense.id }],
      reminders: [{ id: reminder.id }],
      lockedRelationCount: 0,
    });

    const viewerProjectionRequests = [
      {
        path: "calendar",
        schema: eventResourceProjectionResponseSchema,
        expectedId: scheduledEvent.id,
      },
      {
        path: "todos",
        schema: taskResourceProjectionResponseSchema,
        expectedId: task.id,
      },
      {
        path: "expenses",
        schema: expenseResourceProjectionResponseSchema,
        expectedId: expense.id,
      },
      {
        path: "reminders",
        schema: reminderResourceProjectionResponseSchema,
        expectedId: reminder.id,
      },
    ] as const;
    for (const projection of viewerProjectionRequests) {
      const response = await request(viewer, workspaceId, {
        method: "GET",
        url: `/api/events/${event.id}/${projection.path}`,
      });
      expect(response.statusCode).toBe(200);
      expect(
        projection.schema.parse(response.json()).items.map(({ id }) => id),
      ).toEqual([projection.expectedId]);
    }

    const editorUpdateResponse = await request(editor, workspaceId, {
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      payload: {
        expectedVersion: task.version,
        displayName: "Confirm keynote speakers",
      },
    });
    expect(editorUpdateResponse.statusCode).toBe(200);
    const editedTask = taskResponseSchema.parse(editorUpdateResponse.json());
    expect(editedTask).toMatchObject({
      displayName: "Confirm keynote speakers",
      version: task.version + 1,
    });

    const auditCountBeforeDeniedMutations = (
      await testDatabase.connection.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, workspaceId))
    ).length;
    const deniedResponses = await Promise.all([
      request(viewer, workspaceId, {
        method: "PATCH",
        url: `/api/tasks/${task.id}`,
        payload: {
          expectedVersion: editedTask.version,
          displayName: "Unauthorized edit",
        },
      }),
      request(viewer, workspaceId, {
        method: "DELETE",
        url: `/api/objects/${event.id}?expectedVersion=${event.version}`,
      }),
      request(viewer, workspaceId, {
        method: "POST",
        url: "/api/shares",
        payload: {
          resourceId: event.id,
          principalEmail: "editor@example.com",
          role: "owner",
        },
      }),
      request(editor, workspaceId, {
        method: "POST",
        url: "/api/shares",
        payload: {
          resourceId: event.id,
          principalEmail: "viewer@example.com",
          role: "owner",
        },
      }),
      request(viewer, workspaceId, {
        method: "POST",
        url: "/api/shares",
        payload: {
          resourceId: event.id,
          principalEmail: "unknown@example.com",
          role: "viewer",
        },
      }),
    ]);
    expect(deniedResponses.map(({ statusCode }) => statusCode)).toEqual([
      404, 404, 404, 404, 404,
    ]);
    expect(
      apiErrorResponseSchema.parse(deniedResponses[4]?.json()),
    ).toMatchObject({ error: { code: "resource_unavailable" } });
    const auditCountAfterDeniedMutations = (
      await testDatabase.connection.db
        .select({ id: auditEvents.id })
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, workspaceId))
    ).length;
    expect(auditCountAfterDeniedMutations).toBe(
      auditCountBeforeDeniedMutations,
    );

    const unchangedTaskResponse = await request(owner, workspaceId, {
      method: "GET",
      url: `/api/tasks/${task.id}`,
    });
    expect(
      taskResponseSchema.parse(unchangedTaskResponse.json()),
    ).toMatchObject({
      displayName: "Confirm keynote speakers",
      version: editedTask.version,
    });

    const stopInheritanceResponse = await request(owner, workspaceId, {
      method: "PATCH",
      url: `/api/objects/${task.id}/permission-scope`,
      payload: {
        expectedVersion: editedTask.version,
        permissionScopeId: task.id,
      },
    });
    expect(stopInheritanceResponse.statusCode).toBe(200);
    const privateTask = taskResponseSchema.parse(
      stopInheritanceResponse.json(),
    );
    expect(privateTask).toMatchObject({
      id: task.id,
      permissionScopeId: task.id,
      version: editedTask.version + 1,
    });

    const staleScopeResponse = await request(owner, workspaceId, {
      method: "PATCH",
      url: `/api/objects/${task.id}/permission-scope`,
      payload: {
        expectedVersion: editedTask.version,
        permissionScopeId: event.id,
      },
    });
    expect(staleScopeResponse.statusCode).toBe(409);
    expect(
      apiErrorResponseSchema.parse(staleScopeResponse.json()),
    ).toMatchObject({ error: { code: "version_conflict" } });

    const privateViewerDetailResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/events/${event.id}/detail`,
    });
    const privateViewerDetail = eventDetailResponseSchema.parse(
      privateViewerDetailResponse.json(),
    );
    expect(privateViewerDetail.tasks).toEqual([]);
    expect(privateViewerDetail.lockedRelationCount).toBe(1);

    const privateViewerTodosResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/events/${event.id}/todos`,
    });
    expect(
      taskResourceProjectionResponseSchema.parse(
        privateViewerTodosResponse.json(),
      ).items,
    ).toEqual([]);

    const privateViewerTaskResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/tasks/${task.id}`,
    });
    expect(privateViewerTaskResponse.statusCode).toBe(404);
    expect(
      apiErrorResponseSchema.parse(privateViewerTaskResponse.json()),
    ).toMatchObject({ error: { code: "resource_unavailable" } });

    const ownerDetailResponse = await request(owner, workspaceId, {
      method: "GET",
      url: `/api/events/${event.id}/detail`,
    });
    expect(
      eventDetailResponseSchema
        .parse(ownerDetailResponse.json())
        .tasks.map(({ id }) => id),
    ).toEqual([task.id]);

    const revokeResponse = await request(owner, workspaceId, {
      method: "DELETE",
      url: `/api/shares/${viewerShare.id}`,
    });
    expect(revokeResponse.statusCode).toBe(200);
    expect(shareRevocationResponseSchema.parse(revokeResponse.json()).id).toBe(
      viewerShare.id,
    );

    const revokedViewerResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/events/${event.id}`,
    });
    expect(revokedViewerResponse.statusCode).toBe(404);
    expect(
      apiErrorResponseSchema.parse(revokedViewerResponse.json()),
    ).toMatchObject({ error: { code: "workspace_unavailable" } });

    const sharingAudits = await testDatabase.connection.db
      .select({ action: auditEvents.action, requestId: auditEvents.requestId })
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, workspaceId));
    expect(
      sharingAudits
        .map(({ action }) => action)
        .filter((action) =>
          [
            "resource.shared",
            "resource.share_revoked",
            "object.permission_scope_updated",
          ].includes(action),
        )
        .sort(),
    ).toEqual(
      [
        "resource.shared",
        "resource.shared",
        "resource.share_revoked",
        "object.permission_scope_updated",
      ].sort(),
    );
    expect(new Set(sharingAudits.map(({ requestId }) => requestId)).size).toBe(
      sharingAudits.length,
    );
  });
});
