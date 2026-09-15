import type {
  AuthorizationDatabase,
  UserPrincipal,
} from "@chronelle/authorization";
import type { Database } from "@chronelle/db";
import { describe, expect, it, vi } from "vitest";

import { EventPlanningObjectService } from "../src/object-service.js";
import type { ObjectReadRepository } from "../src/object-reads.js";
import { ObjectRecoveryService } from "../src/recovery-service.js";
import type { RecoveryReadRepository } from "../src/recovery-reads.js";
import { ObjectRelationService } from "../src/relation-service.js";
import type { RelationReadRepository } from "../src/relation-list.js";
import { ObjectRevisionService } from "../src/revision-service.js";
import type { RevisionReadRepository } from "../src/revision-reads.js";
import type { EventPlanningResource } from "../src/types.js";

const principal: UserPrincipal = {
  type: "user",
  userId: "user-1",
  workspaceId: "workspace-1",
};

const task: EventPlanningResource = {
  id: "task-1",
  workspaceId: principal.workspaceId,
  objectType: "task",
  displayName: "Task",
  createdBy: principal.userId,
  permissionScopeId: "event-1",
  createdAt: new Date("2030-01-01T00:00:00.000Z"),
  updatedAt: new Date("2030-01-01T00:00:00.000Z"),
  version: 1,
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
  status: "todo",
  dueOn: null,
  dueAt: null,
  completedAt: null,
  parentTaskId: null,
};

describe("object read repository boundary", () => {
  it("delegates single-object reads, typed getters, allowed actions, and visible lists", async () => {
    const repository: ObjectReadRepository = {
      getObject: vi.fn().mockResolvedValue(task),
      getAllowedActions: vi.fn().mockResolvedValue(["view"]),
      listVisibleObjects: vi.fn().mockResolvedValue([task]),
    };
    const service = new EventPlanningObjectService(
      {} as AuthorizationDatabase,
      () => new Date("2030-01-01T00:00:00.000Z"),
      { objects: repository },
    );

    await expect(service.getObject(principal, "task-1")).resolves.toBe(task);
    await expect(service.getTask(principal, "task-1")).resolves.toBe(task);
    // The type check stays in the service, in front of every repository.
    await expect(service.getEvent(principal, "task-1")).rejects.toThrow(
      "The requested resource is unavailable.",
    );
    await expect(
      service.getAllowedActions(principal, "task-1"),
    ).resolves.toEqual(["view"]);
    await expect(
      service.listVisibleObjects(principal, ["task-1"]),
    ).resolves.toEqual([task]);
    expect(repository.getObject).toHaveBeenCalledTimes(3);
    expect(repository.getObject).toHaveBeenCalledWith(principal, "task-1");
    expect(repository.getAllowedActions).toHaveBeenCalledExactlyOnceWith(
      principal,
      "task-1",
    );
    expect(repository.listVisibleObjects).toHaveBeenCalledExactlyOnceWith(
      principal,
      ["task-1"],
    );
  });
});

describe("relation read repository boundary", () => {
  it("delegates relation and removed-relation pages", async () => {
    const page = { items: [], nextCursor: null };
    const repository: RelationReadRepository = {
      listRelations: vi.fn().mockResolvedValue(page),
      listRemovedRelations: vi.fn().mockResolvedValue(page),
    };
    const service = new ObjectRelationService(
      {} as AuthorizationDatabase,
      undefined,
      undefined,
      repository,
    );
    const input = { limit: 5, direction: "outgoing" as const };
    await expect(
      service.listForObject(principal, "event-1", input),
    ).resolves.toBe(page);
    expect(repository.listRelations).toHaveBeenCalledExactlyOnceWith(
      principal,
      "event-1",
      input,
    );
    await expect(
      service.listRemoved(principal, "event-1", { limit: 5 }),
    ).resolves.toBe(page);
    expect(repository.listRemovedRelations).toHaveBeenCalledExactlyOnceWith(
      principal,
      "event-1",
      { limit: 5 },
    );
  });
});

describe("revision read repository boundary", () => {
  it("delegates revision pages and single revisions", async () => {
    const page = { items: [], nextBeforeVersion: null };
    const repository: RevisionReadRepository = {
      listRevisions: vi.fn().mockResolvedValue(page),
      getRevision: vi.fn().mockResolvedValue({ objectVersion: 2 }),
    };
    const service = new ObjectRevisionService({} as Database, repository);
    await expect(
      service.list(principal, "event-1", { limit: 10 }),
    ).resolves.toBe(page);
    expect(repository.listRevisions).toHaveBeenCalledExactlyOnceWith(
      principal,
      "event-1",
      { limit: 10 },
    );
    await expect(service.get(principal, "event-1", 2)).resolves.toEqual({
      objectVersion: 2,
    });
    expect(repository.getRevision).toHaveBeenCalledExactlyOnceWith(
      principal,
      "event-1",
      2,
    );
  });
});

describe("recovery read repository boundary", () => {
  it("delegates Trash pages and recovery previews", async () => {
    const page = { items: [], nextCursor: null };
    const preview = {
      object: {
        id: "task-1",
        objectType: "task" as const,
        displayName: "Task",
        version: 2,
        deletedAt: "2030-01-02T00:00:00.000Z",
      },
      canRecover: true,
      blockedReason: null,
    };
    const repository: RecoveryReadRepository = {
      listTrash: vi.fn().mockResolvedValue(page),
      previewRecovery: vi.fn().mockResolvedValue(preview),
    };
    const service = new ObjectRecoveryService({} as Database, repository);
    await expect(service.list(principal, { limit: 3 })).resolves.toBe(page);
    expect(repository.listTrash).toHaveBeenCalledExactlyOnceWith(principal, {
      limit: 3,
    });
    await expect(service.preview(principal, "task-1")).resolves.toBe(preview);
    expect(repository.previewRecovery).toHaveBeenCalledExactlyOnceWith(
      principal,
      "task-1",
    );
  });
});
