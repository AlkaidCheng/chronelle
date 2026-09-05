import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { auditEvents } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  apiErrorResponseSchema,
  developmentSignInResponseSchema,
  documentAttachmentResponseSchema,
  documentDownloadAuthorizationResponseSchema,
  documentUploadAuthorizationResponseSchema,
  eventDetailResponseSchema,
  eventResourceProjectionResponseSchema,
  eventResponseSchema,
  expenseResponseSchema,
  objectSearchResponseSchema,
  relationListResponseSchema,
  relationResponseSchema,
  reminderResourceProjectionResponseSchema,
  reminderResponseSchema,
  shareResponseSchema,
  taskResourceProjectionResponseSchema,
  taskResponseSchema,
  timelineResponseSchema,
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
const currentTime = new Date("2026-10-01T12:00:00Z");

let app: FastifyInstance;
let storageRoot: string;
let testDatabase: TestDatabase;
let testResourcesReady = false;

function buildTestApp(): FastifyInstance {
  return buildApp(
    createDevelopmentAppDependencies(testDatabase.connection, {
      clock: () => currentTime,
      documentTransferTtlMs: 60_000,
      localStorageRoot: storageRoot,
    }),
  );
}

beforeEach(async () => {
  testResourcesReady = false;
  storageRoot = await mkdtemp(join(tmpdir(), "chronelle-slice-"));
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
  app = buildTestApp();
  testResourcesReady = true;
});

afterEach(async () => {
  try {
    if (testResourcesReady) {
      await app.close();
      await testDatabase.close();
    }
  } finally {
    testResourcesReady = false;
    await rm(storageRoot, { force: true, recursive: true });
  }
});

async function signIn(email: string, displayName: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { displayName, email },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}

function sessionHeaders(
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
    headers: sessionHeaders(session, workspaceId),
  });
}

async function includeResource(
  owner: Awaited<ReturnType<typeof signIn>>,
  workspaceId: string,
  eventId: string,
  targetObjectId: string,
) {
  const response = await request(owner, workspaceId, {
    method: "POST",
    url: `/api/objects/${eventId}/relations`,
    payload: { relationType: "includes", targetObjectId },
  });
  expect(response.statusCode).toBe(201);
  return relationResponseSchema.parse(response.json());
}

async function attachDocument(
  owner: Awaited<ReturnType<typeof signIn>>,
  workspaceId: string,
  parentObjectId: string,
) {
  const bytes = Buffer.from("private event receipt");
  const authorizationResponse = await request(owner, workspaceId, {
    method: "POST",
    url: "/api/documents/upload-url",
    payload: {
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      mimeType: "application/pdf",
      originalFilename: "deposit-receipt.pdf",
      parentObjectId,
      sizeBytes: bytes.byteLength,
    },
  });
  expect(authorizationResponse.statusCode).toBe(201);
  const authorization = documentUploadAuthorizationResponseSchema.parse(
    authorizationResponse.json(),
  );

  const uploadResponse = await app.inject({
    method: "PUT",
    url: authorization.upload.url,
    headers: authorization.upload.headers,
    payload: bytes,
  });
  expect(uploadResponse.statusCode).toBe(204);

  const finalizationResponse = await request(owner, workspaceId, {
    method: "POST",
    url: "/api/documents",
    payload: { uploadAuthorizationId: authorization.id },
  });
  expect(finalizationResponse.statusCode).toBe(201);
  return {
    attachment: documentAttachmentResponseSchema.parse(
      finalizationResponse.json(),
    ),
    bytes,
  };
}

describe.sequential("event-planning vertical slice", () => {
  it("preserves identity, authorization, lifecycle, storage, and audit invariants", async () => {
    const owner = await signIn("owner@example.com", "Event Owner");
    const viewer = await signIn("viewer@example.com", "Event Viewer");
    const unrelated = await signIn("unrelated@example.com", "Other User");
    const workspaceId = owner.workspace.id;

    const eventCreateResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/events",
      payload: {
        displayName: "Community harvest dinner",
        startsAt: "2026-10-15T16:00:00Z",
        timezone: "America/Los_Angeles",
      },
    });
    expect(eventCreateResponse.statusCode).toBe(201);
    const event = eventResponseSchema.parse(eventCreateResponse.json());

    const scheduledCreateResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/events",
      payload: {
        displayName: "Doors open",
        permissionScopeId: event.id,
        startsAt: "2026-10-15T17:30:00Z",
        timezone: "America/Los_Angeles",
      },
    });
    const scheduledEvent = eventResponseSchema.parse(
      scheduledCreateResponse.json(),
    );

    const taskCreateResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/tasks",
      payload: {
        displayName: "Confirm venue access",
        dueAt: "2026-10-10T18:00:00Z",
        permissionScopeId: event.id,
      },
    });
    const task = taskResponseSchema.parse(taskCreateResponse.json());

    const expenseCreateResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/expenses",
      payload: {
        amount: "500.0000",
        currency: "USD",
        displayName: "Venue deposit",
        occurredAt: "2026-09-15T12:00:00Z",
        permissionScopeId: event.id,
      },
    });
    const expense = expenseResponseSchema.parse(expenseCreateResponse.json());

    const reminderCreateResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/reminders",
      payload: {
        displayName: "Send guest alert",
        permissionScopeId: event.id,
        remindAt: "2026-10-08T16:00:00Z",
      },
    });
    const reminder = reminderResponseSchema.parse(
      reminderCreateResponse.json(),
    );

    const privateTaskCreateResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/tasks",
      payload: { displayName: "Private venue notes" },
    });
    const privateTask = taskResponseSchema.parse(
      privateTaskCreateResponse.json(),
    );

    for (const resource of [scheduledEvent, task, expense, reminder]) {
      await includeResource(owner, workspaceId, event.id, resource.id);
    }
    const privateRelation = await includeResource(
      owner,
      workspaceId,
      event.id,
      privateTask.id,
    );

    const shareCreateResponse = await request(owner, workspaceId, {
      method: "POST",
      url: "/api/shares",
      payload: {
        principalEmail: viewer.user.email,
        resourceId: event.id,
        role: "viewer",
      },
    });
    expect(shareCreateResponse.statusCode).toBe(201);
    shareResponseSchema.parse(shareCreateResponse.json());

    const attachment = await attachDocument(owner, workspaceId, expense.id);
    expect(attachment.attachment.document.permissionScopeId).toBe(event.id);

    const ownerDetailResponse = await request(owner, workspaceId, {
      method: "GET",
      url: `/api/events/${event.id}/detail`,
    });
    const ownerDetail = eventDetailResponseSchema.parse(
      ownerDetailResponse.json(),
    );
    expect(ownerDetail.tasks.map(({ id }) => id).sort()).toEqual(
      [task.id, privateTask.id].sort(),
    );
    expect(ownerDetail.events.map(({ id }) => id)).toEqual([scheduledEvent.id]);
    expect(ownerDetail.expenses.map(({ id }) => id)).toEqual([expense.id]);
    expect(ownerDetail.reminders.map(({ id }) => id)).toEqual([reminder.id]);

    const viewerDetailResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/events/${event.id}/detail`,
    });
    const viewerDetail = eventDetailResponseSchema.parse(
      viewerDetailResponse.json(),
    );
    expect(viewerDetail.tasks.map(({ id }) => id)).toEqual([task.id]);
    expect(viewerDetail.lockedRelationCount).toBe(1);

    const viewerRelationsResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/objects/${event.id}/relations`,
    });
    expect(
      relationListResponseSchema
        .parse(viewerRelationsResponse.json())
        .items.map(({ targetObjectId }) => targetObjectId)
        .sort(),
    ).toEqual([scheduledEvent.id, task.id, expense.id, reminder.id].sort());

    const todosResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/events/${event.id}/todos`,
    });
    expect(
      taskResourceProjectionResponseSchema.parse(todosResponse.json()).items,
    ).toMatchObject([{ id: task.id }]);

    for (const projectionName of ["calendar", "itinerary"] as const) {
      const response = await request(viewer, workspaceId, {
        method: "GET",
        url: `/api/events/${event.id}/${projectionName}`,
      });
      expect(
        eventResourceProjectionResponseSchema.parse(response.json()).items,
      ).toMatchObject([{ id: scheduledEvent.id, displayName: "Doors open" }]);
    }

    const timelineResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/events/${event.id}/timeline`,
    });
    expect(
      timelineResponseSchema
        .parse(timelineResponse.json())
        .items.map(({ canonicalObjectId }) => canonicalObjectId)
        .sort(),
    ).toEqual([scheduledEvent.id, task.id, expense.id, reminder.id].sort());

    const viewerSearchResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: "/api/search?query=venue",
    });
    expect(viewerSearchResponse.statusCode).toBe(200);
    expect(
      objectSearchResponseSchema
        .parse(viewerSearchResponse.json())
        .items.map(({ id }) => id)
        .sort(),
    ).toEqual([task.id, expense.id].sort());

    const ownerSearchResponse = await request(owner, workspaceId, {
      method: "GET",
      url: "/api/search?query=venue&objectType=task",
    });
    expect(
      objectSearchResponseSchema
        .parse(ownerSearchResponse.json())
        .items.map(({ id }) => id)
        .sort(),
    ).toEqual([task.id, privateTask.id].sort());

    const unrelatedSearchResponse = await request(
      unrelated,
      unrelated.workspace.id,
      { method: "GET", url: "/api/search?query=venue" },
    );
    expect(
      objectSearchResponseSchema.parse(unrelatedSearchResponse.json()).items,
    ).toEqual([]);
    const forgedWorkspaceSearchResponse = await request(
      unrelated,
      workspaceId,
      { method: "GET", url: "/api/search?query=venue" },
    );
    expect(forgedWorkspaceSearchResponse.statusCode).toBe(404);

    const updateResponse = await request(owner, workspaceId, {
      method: "PATCH",
      url: `/api/events/${scheduledEvent.id}`,
      payload: {
        displayName: "Guest doors open",
        expectedVersion: scheduledEvent.version,
      },
    });
    const updatedScheduledEvent = eventResponseSchema.parse(
      updateResponse.json(),
    );
    expect(updatedScheduledEvent.version).toBe(scheduledEvent.version + 1);

    for (const projectionName of ["calendar", "itinerary"] as const) {
      const response = await request(owner, workspaceId, {
        method: "GET",
        url: `/api/events/${event.id}/${projectionName}`,
      });
      expect(
        eventResourceProjectionResponseSchema.parse(response.json()).items,
      ).toMatchObject([
        {
          displayName: "Guest doors open",
          id: scheduledEvent.id,
          version: updatedScheduledEvent.version,
        },
      ]);
    }

    const staleUpdateResponse = await request(owner, workspaceId, {
      method: "PATCH",
      url: `/api/events/${scheduledEvent.id}`,
      payload: {
        displayName: "Stale doors",
        expectedVersion: scheduledEvent.version,
      },
    });
    expect(staleUpdateResponse.statusCode).toBe(409);
    expect(
      apiErrorResponseSchema.parse(staleUpdateResponse.json()),
    ).toMatchObject({ error: { code: "version_conflict" } });

    const viewerUpdateResponse = await request(viewer, workspaceId, {
      method: "PATCH",
      url: `/api/tasks/${task.id}`,
      payload: { displayName: "Unauthorized", expectedVersion: task.version },
    });
    expect(viewerUpdateResponse.statusCode).toBe(404);
    const privateTaskResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/tasks/${privateTask.id}`,
    });
    expect(privateTaskResponse.statusCode).toBe(404);

    const reminderDeleteResponse = await request(owner, workspaceId, {
      method: "DELETE",
      url: `/api/objects/${reminder.id}?expectedVersion=${reminder.version}`,
    });
    expect(reminderDeleteResponse.statusCode).toBe(200);
    const remindersAfterDeleteResponse = await request(owner, workspaceId, {
      method: "GET",
      url: `/api/events/${event.id}/reminders`,
    });
    expect(
      reminderResourceProjectionResponseSchema.parse(
        remindersAfterDeleteResponse.json(),
      ).items,
    ).toEqual([]);
    const deletedSearchResponse = await request(owner, workspaceId, {
      method: "GET",
      url: "/api/search?query=guest+alert",
    });
    expect(
      objectSearchResponseSchema.parse(deletedSearchResponse.json()).items,
    ).toEqual([]);

    const unlinkResponse = await request(owner, workspaceId, {
      method: "DELETE",
      url: `/api/relations/${privateRelation.id}?expectedVersion=${privateRelation.version}`,
    });
    expect(unlinkResponse.statusCode).toBe(200);
    const unlinkedTaskResponse = await request(owner, workspaceId, {
      method: "GET",
      url: `/api/tasks/${privateTask.id}`,
    });
    expect(taskResponseSchema.parse(unlinkedTaskResponse.json()).id).toBe(
      privateTask.id,
    );

    const downloadAuthorizationResponse = await request(viewer, workspaceId, {
      method: "GET",
      url: `/api/documents/${attachment.attachment.document.id}/download-url`,
    });
    expect(downloadAuthorizationResponse.statusCode).toBe(200);
    const downloadAuthorization =
      documentDownloadAuthorizationResponseSchema.parse(
        downloadAuthorizationResponse.json(),
      );

    await app.close();
    app = buildTestApp();

    const downloadResponse = await app.inject({
      method: "GET",
      url: downloadAuthorization.download.url,
    });
    expect(downloadResponse.statusCode).toBe(200);
    expect(downloadResponse.rawPayload).toEqual(attachment.bytes);

    const restartedOwner = await signIn("owner@example.com", "Event Owner");
    const restartedViewer = await signIn("viewer@example.com", "Event Viewer");
    expect(restartedOwner.workspace.id).toBe(workspaceId);
    const persistedDetailResponse = await request(
      restartedViewer,
      workspaceId,
      { method: "GET", url: `/api/events/${event.id}/detail` },
    );
    expect(
      eventDetailResponseSchema.parse(persistedDetailResponse.json()).event.id,
    ).toBe(event.id);

    const audits = await testDatabase.connection.db
      .select({
        action: auditEvents.action,
        actorId: auditEvents.actorId,
        requestId: auditEvents.requestId,
        resourceId: auditEvents.resourceId,
      })
      .from(auditEvents)
      .where(eq(auditEvents.workspaceId, workspaceId));
    expect(audits.map(({ action }) => action).sort()).toEqual(
      [
        "document.created",
        "document.download_authorized",
        "document.downloaded",
        "document.upload_authorized",
        "document.uploaded",
        "event.created",
        "event.created",
        "event.updated",
        "expense.created",
        "identity.signed_in",
        "relation.created",
        "relation.created",
        "relation.created",
        "relation.created",
        "relation.created",
        "relation.deleted",
        "reminder.created",
        "reminder.deleted",
        "resource.shared",
        "task.created",
        "task.created",
        "workspace.personal_created",
      ].sort(),
    );
    expect(audits.every(({ actorId }) => actorId !== null)).toBe(true);
    expect(new Set(audits.map(({ requestId }) => requestId)).size).toBe(
      audits.length,
    );
    expect(
      audits.find(({ action }) => action === "event.updated")?.resourceId,
    ).toBe(scheduledEvent.id);
    expect(
      audits.find(({ action }) => action === "reminder.deleted")?.resourceId,
    ).toBe(reminder.id);
  });
});
