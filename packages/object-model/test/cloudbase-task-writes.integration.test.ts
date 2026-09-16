import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  createId,
  labels,
  objects,
  resourceGrants,
  tasks,
  workspaceMembers,
} from "@chronelle/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseTaskWriteRepository } from "../src/cloudbase-task-write-repository.js";
import {
  CommandConflictError,
  InvalidObjectStateError,
  ObjectConflictError,
} from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import type {
  CreateTaskInput,
  TaskResource,
  UpdateTaskInput,
} from "../src/types.js";
import {
  backends,
  createWriteHarness,
  failure,
  ledger,
  mutationContext,
  shape,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// The Task write functions must produce what the PostgreSQL service
// produces. Both backends run against one database here.

let harness: WriteHarness;
let reference: EventPlanningObjectService;
let cloudbase: EventPlanningObjectService;

beforeAll(async () => {
  harness = await createWriteHarness("Task writes");
  const db = harness.database.connection.db;
  reference = new EventPlanningObjectService(db);
  cloudbase = new EventPlanningObjectService(db, undefined, undefined, {
    task: new CloudBaseTaskWriteRepository(harness),
  });
});

afterAll(async () => {
  await harness?.database.close();
});

const context = (
  userId?: string,
  command?: Parameters<typeof mutationContext>[2],
) => mutationContext(harness, userId, command);

describe.sequential("CloudBase Task writes", () => {
  it("create and update leave the same resource, audit, and revision rows", async () => {
    const created: TaskResource[] = [];
    const updated: TaskResource[] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const bare = await service.createTask(context(), {
        displayName: "Book the caterer",
      });
      expect(bare.status).toBe("todo");
      expect(bare.dueOn).toBeNull();
      expect(bare.dueAt).toBeNull();
      expect(bare.completedAt).toBeNull();
      const done = await service.createTask(context(), {
        displayName: "Confirm the venue",
        status: "done",
        dueAt: new Date("2030-10-01T09:00:00.000Z"),
        completedAt: new Date("2030-09-28T15:30:00.000Z"),
        customProperties: { owner: "ops", weight: 3 },
        metadata: { source: "test" },
        permissionScopeId: bare.id,
      });
      expect(done.permissionScopeId).toBe(bare.id);
      created.push(bare, done);
      updated.push(
        await service.updateTask(
          context(harness.ownerId, {
            id: "command-1",
            operationId: "operation-1",
            direction: "execute",
          }),
          bare.id,
          {
            expectedVersion: 1,
            displayName: "Book the caterer, urgently",
            status: "done",
            dueAt: new Date("2030-10-02T09:00:00.000Z"),
            completedAt: new Date("2030-09-29T10:00:00.000Z"),
            customProperties: { owner: "events" },
            metadata: {},
          },
        ),
        await service.updateTask(context(), done.id, {
          expectedVersion: 1,
          status: "cancelled",
          dueOn: "2030-10-03",
          dueAt: null,
          completedAt: null,
        }),
      );
    }

    const [pgBare, pgDone, cbBare, cbDone] = created;
    expect(shape(cbBare as TaskResource)).toEqual(
      shape(pgBare as TaskResource),
    );
    expect(shape(cbDone as TaskResource)).toEqual(
      shape(pgDone as TaskResource),
    );
    const [pgReopened, pgCancelled, cbReopened, cbCancelled] = updated;
    expect(shape(cbReopened as TaskResource)).toEqual(
      shape(pgReopened as TaskResource),
    );
    expect(shape(cbCancelled as TaskResource)).toEqual(
      shape(pgCancelled as TaskResource),
    );
    expect(cbReopened?.version).toBe(2);
    expect(cbReopened?.status).toBe("done");
    expect(cbReopened?.completedAt).toEqual(
      new Date("2030-09-29T10:00:00.000Z"),
    );
    expect(cbCancelled?.status).toBe("cancelled");
    expect(cbCancelled?.dueOn).toBe("2030-10-03");
    expect(cbCancelled?.dueAt).toBeNull();

    for (const [pg, cb] of [
      [pgBare, cbBare],
      [pgDone, cbDone],
    ] as const) {
      expect(await ledger(harness, (cb as TaskResource).id)).toEqual(
        await ledger(harness, (pg as TaskResource).id),
      );
      expect(await ledger(harness, (cb as TaskResource).id)).toHaveLength(2);
    }
  });

  it("reject the same inputs with the same errors", async () => {
    const invalidCreates: CreateTaskInput[] = [
      { displayName: "x", status: "done" },
      { displayName: "x", completedAt: new Date("2030-01-01T00:00:00Z") },
      {
        displayName: "x",
        status: "in_progress",
        completedAt: new Date("2030-01-01T00:00:00Z"),
      },
      {
        displayName: "x",
        dueOn: "2030-03-01",
        dueAt: new Date("2030-03-01T09:00:00Z"),
      },
    ];
    // Applied to a task whose status is todo, whose completedAt is null, and
    // whose due is the instant 2030-03-01T09:00Z.
    const invalidUpdates: Omit<UpdateTaskInput, "expectedVersion">[] = [
      { status: "done" },
      { completedAt: new Date("2030-01-01T00:00:00Z") },
      { status: "cancelled", completedAt: new Date("2030-01-01T00:00:00Z") },
      { dueOn: "2030-03-02" },
    ];

    const outcomes: string[][] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const seen: string[] = [];
      for (const input of invalidCreates) {
        const error = await failure(() => service.createTask(context(), input));
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      const open = await service.createTask(context(), {
        displayName: "Guarded",
        dueAt: new Date("2030-03-01T09:00:00Z"),
      });
      for (const changes of invalidUpdates) {
        const error = await failure(() =>
          service.updateTask(context(), open.id, {
            expectedVersion: 1,
            ...changes,
          }),
        );
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      // Leaving done without clearing completedAt is the mirror-image violation.
      const finished = await service.createTask(context(), {
        displayName: "Finished",
        status: "done",
        completedAt: new Date("2030-02-01T00:00:00Z"),
      });
      const reopen = await failure(() =>
        service.updateTask(context(), finished.id, {
          expectedVersion: 1,
          status: "todo",
        }),
      );
      expect(reopen).toBeInstanceOf(InvalidObjectStateError);
      seen.push(reopen.message);

      expect(
        await failure(() =>
          service.updateTask(context(), open.id, {
            expectedVersion: 2,
            displayName: "stale",
          }),
        ),
      ).toBeInstanceOf(ObjectConflictError);
      expect(
        await failure(() =>
          service.updateTask(context(harness.viewerId), open.id, {
            expectedVersion: 1,
            displayName: "forbidden",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.updateTask(context(), createId(), {
            expectedVersion: 1,
            displayName: "missing",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.createTask(context(harness.viewerId), {
            displayName: "denied",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(await ledger(harness, open.id)).toHaveLength(1);

      await harness.database.connection.db.insert(resourceGrants).values({
        id: createId(),
        workspaceId: harness.workspaceId,
        resourceId: open.id,
        principalId: harness.viewerId,
        role: "editor",
        grantedBy: harness.ownerId,
      });
      const byGrantee = await service.updateTask(
        context(harness.viewerId),
        open.id,
        { expectedVersion: 1, displayName: "by grantee" },
      );
      expect(byGrantee.version).toBe(2);
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toHaveLength(
      invalidCreates.length + invalidUpdates.length + 1,
    );
  });

  it("keep subtasks one level deep in one scope, with the same refusals", async () => {
    const outcomes: string[][] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const parent = await service.createTask(context(), {
        displayName: "Plan the retreat",
      });
      const child = await service.createTask(context(), {
        displayName: "Book the venue",
        parentTaskId: parent.id,
        permissionScopeId: parent.id,
      });
      expect(child.parentTaskId).toBe(parent.id);
      expect(child.permissionScopeId).toBe(parent.id);
      const detached = await service.updateTask(context(), child.id, {
        expectedVersion: 1,
        parentTaskId: null,
        assigneeId: null,
        location: null,
      });
      expect(detached.parentTaskId).toBeNull();
      const reattached = await service.updateTask(context(), child.id, {
        expectedVersion: 2,
        parentTaskId: parent.id,
      });
      expect(reattached.parentTaskId).toBe(parent.id);

      const seen: string[] = [];
      const other = await service.createTask(context(), {
        displayName: "Elsewhere",
      });
      for (const attempt of [
        // a grandchild
        () =>
          service.createTask(context(), {
            displayName: "x",
            parentTaskId: child.id,
            permissionScopeId: parent.id,
          }),
        // a parent becoming a subtask
        () =>
          service.updateTask(context(), parent.id, {
            expectedVersion: 1,
            parentTaskId: other.id,
          }),
        // another scope
        () =>
          service.createTask(context(), {
            displayName: "x",
            parentTaskId: parent.id,
          }),
        // a missing parent
        () =>
          service.createTask(context(), {
            displayName: "x",
            parentTaskId: createId(),
          }),
        // itself
        () =>
          service.updateTask(context(), other.id, {
            expectedVersion: 1,
            parentTaskId: other.id,
          }),
      ]) {
        const error = await failure(attempt);
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      "A subtask cannot have subtasks of its own.",
      "A task with subtasks cannot become a subtask.",
      "A subtask shares its parent's permission scope.",
      "parentTaskId must name a live task in this workspace.",
      "A task cannot be its own parent.",
    ]);
  });

  it("set a task's labels as a whole and refuse unknown ones alike", async () => {
    const db = harness.database.connection.db;
    const planningId = createId();
    const venueId = createId();
    await db.insert(labels).values([
      {
        id: planningId,
        workspaceId: harness.workspaceId,
        name: "Planning",
        createdBy: harness.ownerId,
      },
      {
        id: venueId,
        workspaceId: harness.workspaceId,
        name: "venue",
        createdBy: harness.ownerId,
      },
    ]);
    const outcomes: string[][] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const created = await service.createTask(context(), {
        displayName: "Labelled",
        labelIds: [venueId, planningId, venueId],
      });
      expect(created.labelIds).toEqual([planningId, venueId]);
      const trimmed = await service.updateTask(context(), created.id, {
        expectedVersion: 1,
        labelIds: [venueId],
      });
      expect(trimmed.labelIds).toEqual([venueId]);
      expect(
        (await service.getTask(context().principal, created.id)).labelIds,
      ).toEqual([venueId]);
      const cleared = await service.updateTask(context(), created.id, {
        expectedVersion: 2,
        labelIds: [],
      });
      expect(cleared.labelIds).toEqual([]);
      const seen: string[] = [];
      for (const attempt of [
        () =>
          service.createTask(context(), {
            displayName: "x",
            labelIds: [createId()],
          }),
        () =>
          service.updateTask(context(), created.id, {
            expectedVersion: 3,
            labelIds: [venueId, createId()],
          }),
      ]) {
        const error = await failure(attempt);
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      "labelIds must name labels of this workspace.",
      "labelIds must name labels of this workspace.",
    ]);
  });

  it("assign a task to a live person and refuse anyone else alike", async () => {
    const trashed = await reference.createPerson(context(), {
      displayName: "Former",
    });
    await reference.softDelete(context(), trashed.id, 1);
    const outcomes: string[][] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const mira = await service.createPerson(context(), {
        displayName: "Mira",
      });
      const sam = await service.createPerson(context(), {
        displayName: "Sam",
      });
      const created = await service.createTask(context(), {
        displayName: "Assigned",
        assigneeId: mira.id,
      });
      expect(created.assigneeId).toBe(mira.id);
      const reassigned = await service.updateTask(context(), created.id, {
        expectedVersion: 1,
        assigneeId: sam.id,
      });
      expect(reassigned.assigneeId).toBe(sam.id);
      expect(
        (await service.getTask(context().principal, created.id)).assigneeId,
      ).toBe(sam.id);
      const cleared = await service.updateTask(context(), created.id, {
        expectedVersion: 2,
        assigneeId: null,
        location: null,
      });
      expect(cleared.assigneeId).toBeNull();
      const seen: string[] = [];
      for (const attempt of [
        () =>
          service.createTask(context(), {
            displayName: "x",
            assigneeId: trashed.id,
          }),
        () =>
          service.updateTask(context(), created.id, {
            expectedVersion: 3,
            assigneeId: created.id,
          }),
        () =>
          service.updateTask(context(), created.id, {
            expectedVersion: 3,
            assigneeId: createId(),
          }),
      ]) {
        const error = await failure(attempt);
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      "assigneeId must name a live person in this workspace.",
      "assigneeId must name a live person in this workspace.",
      "assigneeId must name a live person in this workspace.",
    ]);
  });

  it("keep a task's location as text and refuse a padded or long one alike", async () => {
    const outcomes: string[][] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const created = await service.createTask(context(), {
        displayName: "Placed",
        location: "Sunset Hall, room 2",
      });
      expect(created.location).toBe("Sunset Hall, room 2");
      const moved = await service.updateTask(context(), created.id, {
        expectedVersion: 1,
        location: "The garden",
      });
      expect(moved.location).toBe("The garden");
      expect(
        (await service.getTask(context().principal, created.id)).location,
      ).toBe("The garden");
      const cleared = await service.updateTask(context(), created.id, {
        expectedVersion: 2,
        location: null,
      });
      expect(cleared.location).toBeNull();
      const seen: string[] = [];
      for (const attempt of [
        () =>
          service.createTask(context(), {
            displayName: "x",
            location: " padded ",
          }),
        () =>
          service.updateTask(context(), created.id, {
            expectedVersion: 3,
            location: "x".repeat(241),
          }),
      ]) {
        const error = await failure(attempt);
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      "location is 1 to 240 characters without surrounding spaces.",
      "location is 1 to 240 characters without surrounding spaces.",
    ]);
  });

  it("keep a task's duration with its due time and refuse one without alike", async () => {
    const outcomes: string[][] = [];
    const dueAt = new Date("2030-03-05T09:30:00.000Z");
    for (const [, service] of backends(reference, cloudbase)) {
      const created = await service.createTask(context(), {
        displayName: "Timed",
        dueAt,
        durationMinutes: 30,
      });
      expect(created.durationMinutes).toBe(30);
      const longer = await service.updateTask(context(), created.id, {
        expectedVersion: 1,
        durationMinutes: 90,
      });
      expect(longer.durationMinutes).toBe(90);
      expect(
        (await service.getTask(context().principal, created.id))
          .durationMinutes,
      ).toBe(90);
      // Moving the time keeps the duration; clearing both clears both.
      const moved = await service.updateTask(context(), created.id, {
        expectedVersion: 2,
        dueAt: new Date("2030-03-06T09:30:00.000Z"),
      });
      expect(moved.durationMinutes).toBe(90);
      const cleared = await service.updateTask(context(), created.id, {
        expectedVersion: 3,
        dueAt: null,
        durationMinutes: null,
      });
      expect(cleared.dueAt).toBeNull();
      expect(cleared.durationMinutes).toBeNull();
      const seen: string[] = [];
      for (const attempt of [
        () =>
          service.createTask(context(), {
            displayName: "Untimed",
            durationMinutes: 30,
          }),
        () =>
          service.createTask(context(), {
            displayName: "Dated",
            dueOn: "2030-03-05",
            durationMinutes: 30,
          }),
        () =>
          service.createTask(context(), {
            displayName: "Short",
            dueAt,
            durationMinutes: 0,
          }),
        () =>
          service.createTask(context(), {
            displayName: "Long",
            dueAt,
            durationMinutes: 1441,
          }),
        () =>
          service.updateTask(context(), created.id, {
            expectedVersion: 4,
            durationMinutes: 15,
          }),
      ]) {
        const error = await failure(attempt);
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      // Restoring the time, then dropping it while a duration stands, is refused.
      const timed = await service.updateTask(context(), created.id, {
        expectedVersion: 4,
        dueAt,
        durationMinutes: 45,
      });
      expect(timed.durationMinutes).toBe(45);
      const dropped = await failure(() =>
        service.updateTask(context(), created.id, {
          expectedVersion: 5,
          dueAt: null,
        }),
      );
      expect(dropped).toBeInstanceOf(InvalidObjectStateError);
      seen.push(dropped.message);
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      "durationMinutes requires dueAt.",
      "durationMinutes requires dueAt.",
      "durationMinutes is 1 to 1440 minutes.",
      "durationMinutes is 1 to 1440 minutes.",
      "durationMinutes requires dueAt.",
      "durationMinutes requires dueAt.",
    ]);
  });

  it("create once per command and refuse a different input under the same id alike", async () => {
    const outcomes: unknown[] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const commandId = createId();
      const first = await service.createTask(context(), {
        displayName: "Once",
        location: "The hall",
        commandId,
      });
      const again = await service.createTask(context(), {
        displayName: "Once",
        location: "The hall",
        commandId,
      });
      expect(again.id).toBe(first.id);
      expect(again.version).toBe(1);
      // The same id from another user is that user's own command.
      await harness.database.connection.db.insert(workspaceMembers).values({
        workspaceId: harness.workspaceId,
        userId: harness.viewerId,
        role: "editor",
      });
      const theirs = await service.createTask(context(harness.viewerId), {
        displayName: "Once",
        location: "The hall",
        commandId,
      });
      expect(theirs.id).not.toBe(first.id);
      await harness.database.connection.db
        .delete(workspaceMembers)
        .where(eq(workspaceMembers.userId, harness.viewerId));
      const conflict = await failure(() =>
        service.createTask(context(), {
          displayName: "Once, changed",
          commandId,
        }),
      );
      expect(conflict).toBeInstanceOf(CommandConflictError);
      expect(await ledger(harness, first.id)).toHaveLength(1);
      outcomes.push(shape(again as TaskResource));
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
  });

  it("refuse an object of another type or without a revision baseline", async () => {
    const messages: string[] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const event = await service.createEvent(context(), {
        displayName: "Not a task",
      });
      expect(
        await failure(() =>
          service.updateTask(context(), event.id, {
            expectedVersion: 1,
            displayName: "as a task",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);

      const legacyId = createId();
      await harness.database.connection.db.insert(objects).values({
        id: legacyId,
        workspaceId: harness.workspaceId,
        permissionScopeId: legacyId,
        objectType: "task",
        displayName: "Legacy",
        createdBy: harness.ownerId,
      });
      await harness.database.connection.db.insert(tasks).values({
        objectId: legacyId,
        workspaceId: harness.workspaceId,
        status: "todo",
      });
      const error = await failure(() =>
        service.updateTask(context(), legacyId, {
          expectedVersion: 1,
          displayName: "Legacy v2",
        }),
      );
      messages.push(error.message);
    }
    expect(messages[1]).toBe(messages[0]);
    expect(messages[0]).toContain("Object revision baseline is missing");
  });
});
