import { AuthorizationDeniedError } from "@livtales/authorization";
import { createId, objectRevisions, resourceGrants } from "@livtales/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseObjectLifecycleWriteRepository } from "../src/cloudbase-object-lifecycle-write-repository.js";
import { CloudBaseObjectReadRepository } from "../src/cloudbase-object-read-repository.js";
import { CloudBaseRevisionReadRepository } from "../src/cloudbase-revision-read-repository.js";
import { InvalidObjectStateError, ObjectConflictError } from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import { ObjectRecoveryService } from "../src/recovery-service.js";
import { ObjectRestorationService } from "../src/restoration-service.js";
import {
  createWriteHarness,
  failure,
  ledger,
  mutationContext,
  shape,
  type WriteHarness,
} from "./cloudbase-write-harness.js";
import { liveReader } from "./cloudbase-read-double.js";

// chronelle_object_restore must leave what ObjectRestorationService.restore
// leaves: the restored content, the preserved fields, the audit event with
// its source, and the restored revision; and it must refuse the same
// requests with the same errors.

let harness: WriteHarness;
let objects: EventPlanningObjectService;
let recovery: ObjectRecoveryService;
let reference: ObjectRestorationService;
let cloudbase: ObjectRestorationService;
let cloudbaseReads: ObjectRestorationService;

beforeAll(async () => {
  harness = await createWriteHarness("Revision restore");
  const db = harness.database.connection.db;
  objects = new EventPlanningObjectService(db);
  recovery = new ObjectRecoveryService(db);
  reference = new ObjectRestorationService(db);
  const writes = new CloudBaseObjectLifecycleWriteRepository(harness);
  cloudbase = new ObjectRestorationService(db, writes);
  // The policy's reads through the gateway adapters as well as its write.
  const reader = liveReader(db);
  cloudbaseReads = new ObjectRestorationService(db, writes, {
    objects: new CloudBaseObjectReadRepository(reader),
    revisions: new CloudBaseRevisionReadRepository(reader),
  });
});

afterAll(async () => {
  await harness?.database.close();
});

const context = (userId?: string) => mutationContext(harness, userId);

const backends = () =>
  [
    ["postgres", reference],
    ["cloudbase", cloudbase],
    ["cloudbase reads", cloudbaseReads],
  ] as const;

/** An Event at version 3, a Task at version 2, and an Expense at version 2. */
async function fixtures() {
  const event = await objects.createEvent(context(), {
    displayName: "Launch night",
    startsAt: new Date("2030-10-16T18:00:00.000Z"),
    endsAt: new Date("2030-10-16T23:00:00.000Z"),
    timezone: "Asia/Shanghai",
    customProperties: { theme: "gold" },
  });
  await objects.updateEvent(context(), event.id, {
    expectedVersion: 1,
    displayName: "Launch night, moved",
    startsAt: null,
    endsAt: null,
    timezone: null,
    startsOn: "2030-10-17",
    isAllDay: true,
    customProperties: { theme: "silver" },
    metadata: { note: "kept" },
  });
  await objects.updateEvent(context(), event.id, {
    expectedVersion: 2,
    displayName: "Launch night, final",
  });
  const task = await objects.createTask(context(), {
    displayName: "Badges",
    status: "in_progress",
    dueAt: new Date("2030-10-10T09:00:00.000Z"),
  });
  await objects.updateTask(context(), task.id, {
    expectedVersion: 1,
    status: "done",
    completedAt: new Date("2030-10-09T17:00:00.000Z"),
  });
  const expense = await objects.createExpense(context(), {
    displayName: "Venue",
    amount: "100",
    currency: "EUR",
    occurredAt: new Date("2030-09-01T10:00:00.000Z"),
  });
  await objects.updateExpense(context(), expense.id, {
    expectedVersion: 1,
    amount: "120",
    displayName: "Venue, revised",
  });
  return { event, task, expense };
}

/** The ledger with the source revision id resolved to the version it names. */
async function restoreLedger(objectId: string) {
  const entries = await ledger(harness, objectId);
  const versions = new Map(
    (
      await harness.database.connection.db
        .select({
          id: objectRevisions.id,
          version: objectRevisions.objectVersion,
        })
        .from(objectRevisions)
        .where(eq(objectRevisions.objectId, objectId))
    ).map((row) => [row.id, row.version]),
  );
  return entries.map((entry) => {
    const { sourceRevisionId, ...metadata } = entry.metadata;
    return {
      ...entry,
      metadata: {
        ...metadata,
        ...(typeof sourceRevisionId === "string" && {
          sourceRevisionVersion: versions.get(sourceRevisionId) ?? null,
        }),
      },
    };
  });
}

describe.sequential("CloudBase revision restore", () => {
  it("restores content and preserves the rest identically", async () => {
    const results = [];
    for (const [, service] of backends()) {
      const { event, task, expense } = await fixtures();
      const restoredEvent = await service.restore(context(), event.id, 1, {
        expectedVersion: 3,
      });
      const restoredTask = await service.restore(context(), task.id, 1, {
        expectedVersion: 2,
      });
      // Expense amounts are preserved by policy; only the name comes back.
      const restoredExpense = await service.restore(context(), expense.id, 1, {
        expectedVersion: 2,
      });
      results.push({
        event: shape(restoredEvent),
        task: shape(restoredTask),
        expense: shape(restoredExpense),
        eventLedger: await restoreLedger(event.id),
        taskLedger: await restoreLedger(task.id),
        expenseLedger: await restoreLedger(expense.id),
      });
    }
    const [postgres, cloud, cloudReads] = results;
    expect(cloud).toEqual(postgres);
    expect(cloudReads).toEqual(postgres);
    expect(cloud?.event).toMatchObject({
      version: 4,
      displayName: "Launch night",
      startsAt: new Date("2030-10-16T18:00:00.000Z"),
      endsAt: new Date("2030-10-16T23:00:00.000Z"),
      timezone: "Asia/Shanghai",
      startsOn: null,
      isAllDay: false,
      customProperties: { theme: "gold" },
      metadata: { note: "kept" },
    });
    expect(cloud?.task).toMatchObject({
      version: 3,
      status: "in_progress",
      completedAt: null,
    });
    expect(cloud?.expense).toMatchObject({
      version: 3,
      displayName: "Venue",
      amount: "120.0000",
    });
    const lastEvent = cloud?.eventLedger.at(-1);
    expect(lastEvent?.mutationKind).toBe("restored");
    expect(lastEvent?.action).toBe("event.restored");
    expect(lastEvent?.metadata).toEqual({
      previousVersion: 3,
      sourceVersion: 1,
      version: 4,
      sourceRevisionVersion: 1,
    });
  });

  it("refuses the same restorations with the same errors", async () => {
    const outcomes = [];
    for (const [, service] of backends()) {
      const { event, task } = await fixtures();
      const seen: string[] = [];
      const record = (error: Error) =>
        seen.push(`${error.constructor.name}: ${error.message}`);

      record(
        await failure(() =>
          service.restore(context(), event.id, 1, { expectedVersion: 2 }),
        ),
      );
      record(
        await failure(() =>
          service.restore(context(), event.id, 3, { expectedVersion: 3 }),
        ),
      );
      record(
        await failure(() =>
          service.restore(context(), event.id, 9, { expectedVersion: 3 }),
        ),
      );
      record(
        await failure(() =>
          service.restore(context(harness.viewerId), event.id, 1, {
            expectedVersion: 3,
          }),
        ),
      );
      // An object in Trash cannot be edited at all; once recovered, the
      // deleted revision in its history is not a restorable state.
      await objects.softDelete(context(), task.id, 2);
      record(
        await failure(() =>
          service.restore(context(), task.id, 1, { expectedVersion: 3 }),
        ),
      );
      await recovery.recover(context(), task.id, { expectedVersion: 3 });
      record(
        await failure(() =>
          service.restore(context(), task.id, 3, { expectedVersion: 4 }),
        ),
      );
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[2]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      `${ObjectConflictError.name}: ${new ObjectConflictError().message}`,
      `${InvalidObjectStateError.name}: This revision has no restorable content changes.`,
      `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`,
      `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`,
      `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`,
      `${InvalidObjectStateError.name}: A deleted state cannot be restored through content history.`,
    ]);
  });

  it("lets an editor grant restore", async () => {
    for (const [, service] of backends()) {
      const { event } = await fixtures();
      await harness.database.connection.db.insert(resourceGrants).values({
        id: createId(),
        workspaceId: harness.workspaceId,
        resourceId: event.id,
        principalId: harness.viewerId,
        role: "editor",
        grantedBy: harness.ownerId,
      });
      const restored = await service.restore(
        context(harness.viewerId),
        event.id,
        2,
        { expectedVersion: 3 },
      );
      expect(restored.version).toBe(4);
      expect(restored.displayName).toBe("Launch night, moved");
    }
  });
});
