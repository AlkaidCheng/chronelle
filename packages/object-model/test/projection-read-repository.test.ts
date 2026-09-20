import type { UserPrincipal } from "@chronelle/authorization";
import type { Database } from "@chronelle/db";
import { describe, expect, it, vi } from "vitest";

import { EventPlanningProjectionService } from "../src/projection-service.js";
import type { ProjectionReadRepository } from "../src/projection-service.js";
import type {
  DocumentResource,
  EventPlanningResource,
  EventResource,
  TaskResource,
} from "../src/types.js";

const principal: UserPrincipal = {
  type: "user",
  userId: "user-1",
  workspaceId: "workspace-1",
};

function canonical(id: string) {
  return {
    id,
    workspaceId: principal.workspaceId,
    displayName: id,
    createdBy: principal.userId,
    permissionScopeId: "root",
    createdAt: new Date("2030-01-01T00:00:00Z"),
    updatedAt: new Date("2030-01-01T00:00:00Z"),
    version: 1,
    archivedAt: null,
    deletedAt: null,
    customProperties: {},
    metadata: {},
  };
}

function event(
  id: string,
  schedule: Partial<EventResource> = {},
): EventResource {
  return {
    ...canonical(id),
    objectType: "event",
    startsAt: null,
    endsAt: null,
    startsOn: null,
    endsOn: null,
    timezone: null,
    isAllDay: false,
    location: null,
    description: null,
    ...schedule,
  };
}

function task(id: string, dueAt: Date | null): TaskResource {
  return {
    ...canonical(id),
    objectType: "task",
    status: "todo",
    dueOn: null,
    dueAt,
    completedAt: null,
    parentTaskId: null,
    assigneeId: null,
    location: null,
    description: null,
    durationMinutes: null,
    repeatRule: null,
    repeatUntil: null,
    rank: "00000001000",
    sectionId: null,
    labelIds: [],
  };
}

function document(id: string): DocumentResource {
  return {
    ...canonical(id),
    objectType: "document",
    storageProvider: "local",
    storageKey: `documents/${id}`,
    originalFilename: `${id}.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 1n,
    checksumSha256: "a".repeat(64),
    encryptionMode: "provider",
  };
}

function service(
  included: readonly EventPlanningResource[],
  attached: readonly DocumentResource[] = [],
) {
  const repository: ProjectionReadRepository = {
    readAttachmentTargets: vi.fn().mockResolvedValue({
      event: { id: "root", displayName: "root" },
      included: [],
    }),
    listIncludedResources: vi.fn().mockResolvedValue(included),
    readEventDetail: vi.fn().mockResolvedValue({
      event: event("root"),
      includedResources: included,
      attachedDocuments: attached,
      lockedRelationCount: 2,
    }),
  };
  return {
    repository,
    service: new EventPlanningProjectionService(
      {} as Database,
      undefined,
      repository,
      undefined,
      { listSections: vi.fn().mockResolvedValue([]) },
    ),
  };
}

describe("projection read repository boundary", () => {
  it("partitions the detail rows by type and lists each Document once", async () => {
    const runSheet = document("run-sheet");
    const { repository, service: projections } = service(
      [event("child"), task("book", null), runSheet],
      [runSheet, document("contract")],
    );

    const detail = await projections.getDetail(principal, "root");

    expect(repository.readEventDetail).toHaveBeenCalledWith(principal, "root");
    expect(detail.event.id).toBe("root");
    expect(detail.events.map(({ id }) => id)).toEqual(["child"]);
    expect(detail.tasks.map(({ id }) => id)).toEqual(["book"]);
    expect(detail.expenses).toEqual([]);
    expect(detail.reminders).toEqual([]);
    expect(detail.documents.map(({ id }) => id)).toEqual([
      "run-sheet",
      "contract",
    ]);
    expect(detail.lockedRelationCount).toBe(2);
  });

  it("asks for one family and keeps the projection ordering", async () => {
    const { repository, service: projections } = service([
      task("undated", null),
      task("later", new Date("2030-01-09T00:00:00Z")),
      task("sooner", new Date("2030-01-08T00:00:00Z")),
    ]);

    const todos = await projections.getTodos(principal, "root");

    expect(repository.listIncludedResources).toHaveBeenCalledWith(
      principal,
      "root",
      ["task"],
    );
    expect(todos).toMatchObject({ sourceEventId: "root", sections: [] });
    expect(todos.items.map(({ id }) => id)).toEqual([
      "sooner",
      "later",
      "undated",
    ]);
  });

  it("builds the timeline from every dated family with date-only precision kept", async () => {
    const { repository, service: projections } = service([
      event("dated", { startsOn: "2030-01-10" }),
      event("timed", { startsAt: new Date("2030-01-09T18:00:00Z") }),
      event("unscheduled"),
      task("due", new Date("2030-01-11T09:00:00Z")),
    ]);

    const timeline = await projections.getTimeline(principal, "root");

    expect(repository.listIncludedResources).toHaveBeenCalledWith(
      principal,
      "root",
      ["event", "task", "expense", "reminder"],
    );
    expect(timeline.items).toEqual([
      expect.objectContaining({
        canonicalObjectId: "timed",
        occursAt: new Date("2030-01-09T18:00:00Z"),
      }),
      expect.objectContaining({
        canonicalObjectId: "dated",
        occursAt: null,
        occursOn: "2030-01-10",
      }),
      expect.objectContaining({ canonicalObjectId: "due" }),
    ]);
  });
});
