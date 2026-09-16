import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  createId,
  documents,
  objects,
  resourceGrants,
  users,
  workspaceMembers,
} from "@chronelle/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseObjectLifecycleWriteRepository } from "../src/cloudbase-object-lifecycle-write-repository.js";
import { InvalidObjectStateError, ObjectConflictError } from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import { readObjectState } from "../src/object-state.js";
import { ObjectRecoveryService } from "../src/recovery-service.js";
import { baselineObjectRevisions } from "../src/revision-baseline.js";
import type { EventPlanningResource } from "../src/types.js";
import {
  createWriteHarness,
  failure,
  ledger,
  mutationContext,
  shape,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// chronelle_object_delete and chronelle_object_recover must leave what
// EventPlanningObjectService.softDelete and ObjectRecoveryService.recover
// leave: the object row, the audit event, and the revision snapshot for
// every canonical type, and they must reject the same inputs the same way.

let harness: WriteHarness;
let reference: {
  objects: EventPlanningObjectService;
  recovery: ObjectRecoveryService;
};
let cloudbase: {
  objects: EventPlanningObjectService;
  recovery: ObjectRecoveryService;
};

const clock = () => new Date("2030-07-01T12:00:00.000Z");

beforeAll(async () => {
  harness = await createWriteHarness("Object lifecycle");
  const db = harness.database.connection.db;
  // The second principal is an Editor here: enough to edit, not to delete.
  await db.insert(workspaceMembers).values({
    workspaceId: harness.workspaceId,
    userId: harness.viewerId,
    role: "editor",
  });
  const adapter = new CloudBaseObjectLifecycleWriteRepository(harness);
  reference = {
    objects: new EventPlanningObjectService(db, clock),
    recovery: new ObjectRecoveryService(db),
  };
  cloudbase = {
    objects: new EventPlanningObjectService(db, clock, undefined, {
      objectLifecycle: adapter,
    }),
    recovery: new ObjectRecoveryService(db, undefined, adapter),
  };
});

afterAll(async () => {
  await harness?.database.close();
});

const context = (userId?: string) => mutationContext(harness, userId);

const backends = () =>
  [
    ["postgres", reference],
    ["cloudbase", cloudbase],
  ] as const;

/** One object of every canonical type, each with its version-1 revision. */
async function fixtures(service: EventPlanningObjectService) {
  const db = harness.database.connection.db;
  const event = await service.createEvent(context(), {
    displayName: "Launch",
    startsOn: "2030-10-16",
  });
  const task = await service.createTask(context(), {
    displayName: "Badges",
    permissionScopeId: event.id,
  });
  const expense = await service.createExpense(context(), {
    displayName: "Venue",
    amount: "12.5",
    currency: "EUR",
    occurredAt: new Date("2030-09-01T10:00:00.000Z"),
  });
  const reminder = await service.createReminder(context(), {
    displayName: "Call",
    remindAt: new Date("2030-09-01T08:00:00.000Z"),
  });
  const documentId = createId();
  await db.insert(objects).values({
    id: documentId,
    workspaceId: harness.workspaceId,
    permissionScopeId: event.id,
    objectType: "document",
    displayName: "Contract.pdf",
    createdBy: harness.ownerId,
  });
  await db.insert(documents).values({
    objectId: documentId,
    workspaceId: harness.workspaceId,
    storageProvider: "local",
    storageKey: `workspace/${documentId}`,
    originalFilename: "Contract.pdf",
    mimeType: "application/pdf",
    sizeBytes: 123456789012n,
    checksumSha256: "a".repeat(64),
  });
  await baselineObjectRevisions(db);
  return { event, task, expense, reminder, documentId };
}

/** Storage keys are unique per provider, so the fixture's carries the object id. */
function withoutStorageKey<T extends object>(value: T): T {
  const { storageKey: _storageKey, ...rest } = value as T & {
    storageKey?: unknown;
  };
  return rest as T;
}

describe.sequential("CloudBase object lifecycle writes", () => {
  it("deletes and recovers every canonical type with the same rows", async () => {
    const results = [];
    for (const [, services] of backends()) {
      const { event, task, expense, reminder, documentId } = await fixtures(
        services.objects,
      );
      for (const id of [
        task.id,
        expense.id,
        reminder.id,
        documentId,
        event.id,
      ]) {
        const deletion = await services.objects.softDelete(context(), id, 1);
        expect(deletion).toEqual({ id, version: 2, deletedAt: clock() });
      }
      // Children under the Event's scope recover only after the Event.
      const recovered: EventPlanningResource[] = [];
      for (const id of [
        event.id,
        task.id,
        expense.id,
        reminder.id,
        documentId,
      ]) {
        recovered.push(
          await services.recovery.recover(context(), id, {
            expectedVersion: 2,
          }),
        );
      }
      const ledgers = [];
      for (const id of [event.id, task.id, expense.id, reminder.id, documentId])
        ledgers.push(
          (await ledger(harness, id)).map((entry) => ({
            ...entry,
            snapshot: withoutStorageKey(entry.snapshot),
          })),
        );
      results.push({
        recovered: recovered.map((resource) =>
          withoutStorageKey(shape(resource)),
        ),
        ledgers,
      });
    }
    const [postgres, cloud] = results;
    expect(cloud).toEqual(postgres);
    for (const entries of cloud?.ledgers ?? []) {
      expect(entries.map((entry) => entry.mutationKind)).toEqual([
        expect.stringMatching(/^(created|baseline)$/u),
        "deleted",
        "recovered",
      ]);
    }
    expect(cloud?.recovered.map((resource) => resource.version)).toEqual([
      3, 3, 3, 3, 3,
    ]);
    expect(cloud?.recovered.map((resource) => resource.deletedAt)).toEqual([
      null,
      null,
      null,
      null,
      null,
    ]);
  });

  it("rejects the same lifecycle changes with the same errors", async () => {
    const outcomes = [];
    for (const [, services] of backends()) {
      const { event, task } = await fixtures(services.objects);
      const seen: string[] = [];
      const record = (error: Error) =>
        seen.push(`${error.constructor.name}: ${error.message}`);

      record(
        await failure(() => services.objects.softDelete(context(), task.id, 2)),
      );
      record(
        await failure(() =>
          services.objects.softDelete(context(harness.viewerId), task.id, 1),
        ),
      );
      record(
        await failure(() =>
          services.recovery.recover(context(), task.id, { expectedVersion: 1 }),
        ),
      );
      await services.objects.softDelete(context(), event.id, 1);
      await services.objects.softDelete(context(), task.id, 1);
      record(
        await failure(() => services.objects.softDelete(context(), task.id, 2)),
      );
      record(
        await failure(() =>
          services.recovery.recover(context(), task.id, { expectedVersion: 1 }),
        ),
      );
      record(
        await failure(() =>
          services.recovery.recover(context(harness.viewerId), task.id, {
            expectedVersion: 2,
          }),
        ),
      );
      record(
        await failure(() =>
          services.recovery.recover(context(), createId(), {
            expectedVersion: 1,
          }),
        ),
      );
      const recoveredEvent = await services.recovery.recover(
        context(),
        event.id,
        { expectedVersion: 2 },
      );
      expect(recoveredEvent.version).toBe(3);
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      `${ObjectConflictError.name}: ${new ObjectConflictError().message}`,
      `${AuthorizationDeniedError.name}: The requested resource is unavailable.`,
      `${InvalidObjectStateError.name}: The object is not in Trash.`,
      `${AuthorizationDeniedError.name}: The requested resource is unavailable.`,
      `${ObjectConflictError.name}: ${new ObjectConflictError().message}`,
      `${AuthorizationDeniedError.name}: The requested resource is unavailable.`,
      `${AuthorizationDeniedError.name}: The requested resource is unavailable.`,
    ]);
  });

  it("takes live subtasks to Trash with their parent and brings them back with it", async () => {
    const outcomes: Record<string, unknown>[] = [];
    for (const [, services] of backends()) {
      const db = harness.database.connection.db;
      // Inside an Event the scope stays live, so the parent rule is what
      // blocks a lone subtask recovery.
      const event = await services.objects.createEvent(context(), {
        displayName: "Trip",
      });
      const parent = await services.objects.createTask(context(), {
        displayName: "Plan the trip",
        permissionScopeId: event.id,
      });
      const subtask = (name: string) =>
        services.objects.createTask(context(), {
          displayName: name,
          parentTaskId: parent.id,
          permissionScopeId: event.id,
        });
      const first = await subtask("Book flights");
      const second = await subtask("Pack");
      const earlier = await subtask("Dropped before");
      await baselineObjectRevisions(db);
      // One subtask is trashed on its own first.
      await services.objects.softDelete(context(), earlier.id, 1);

      const deletion = await services.objects.softDelete(
        context(),
        parent.id,
        1,
      );
      const trashed = await Promise.all(
        [first.id, second.id, earlier.id].map((id) =>
          readObjectState(db, harness.workspaceId, id),
        ),
      );
      // Live subtasks went at the parent's instant with a version each;
      // the one trashed earlier is untouched.
      expect(trashed.map((task) => task.version)).toEqual([2, 2, 2]);
      expect(
        trashed.slice(0, 2).map((task) => task.deletedAt?.toISOString()),
      ).toEqual([
        deletion.deletedAt.toISOString(),
        deletion.deletedAt.toISOString(),
      ]);
      // A subtask cannot be recovered under a parent in Trash.
      const blocked = await failure(() =>
        services.recovery.recover(context(), first.id, { expectedVersion: 2 }),
      );
      expect(blocked).toBeInstanceOf(InvalidObjectStateError);
      expect(blocked.message).toBe("Restore the parent task first.");

      const recovered = await services.recovery.recover(context(), parent.id, {
        expectedVersion: 2,
      });
      expect(recovered.version).toBe(3);
      const after = await Promise.all(
        [first.id, second.id].map((id) =>
          services.objects.getTask(context().principal, id),
        ),
      );
      expect(after.map((task) => [task.deletedAt, task.version])).toEqual([
        [null, 3],
        [null, 3],
      ]);
      const stillTrashed = await readObjectState(
        db,
        harness.workspaceId,
        earlier.id,
      );
      expect(stillTrashed.deletedAt).not.toBeNull();
      expect(stillTrashed.version).toBe(2);
      // The cascade's audit rows name the parent; identities differ per run.
      const withoutIds = async (id: string) =>
        (await ledger(harness, id)).map((entry) => ({
          ...entry,
          snapshot: {
            ...entry.snapshot,
            parentTaskId: entry.snapshot.parentTaskId === parent.id,
          },
          metadata: {
            ...entry.metadata,
            cascadeFrom: "cascadeFrom" in entry.metadata,
          },
        }));
      outcomes.push({
        parent: await withoutIds(parent.id),
        first: await withoutIds(first.id),
        earlier: await withoutIds(earlier.id),
      });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    const firstLedger = outcomes[0]?.first as { action: string }[];
    expect(firstLedger.map((entry) => entry.action)).toEqual([
      "task.created",
      "task.deleted",
      "task.recovered",
    ]);
  });

  it("refuses to recover a child while its scope is in Trash and honours owner grants", async () => {
    for (const [, services] of backends()) {
      const { event, task } = await fixtures(services.objects);
      await services.objects.softDelete(context(), task.id, 1);
      await services.objects.softDelete(context(), event.id, 1);
      const blocked = await failure(() =>
        services.recovery.recover(context(), task.id, { expectedVersion: 2 }),
      );
      expect(blocked).toBeInstanceOf(InvalidObjectStateError);
      expect(blocked.message).toBe(
        "Restore the canonical permission scope first. Recovery does not change permissions.",
      );

      const granteeId = createId();
      await harness.database.connection.db.insert(users).values({
        id: granteeId,
        identityProvider: "test",
        providerSubject: granteeId,
        displayName: "Scope owner",
      });
      await harness.database.connection.db.insert(resourceGrants).values({
        id: createId(),
        workspaceId: harness.workspaceId,
        resourceId: event.id,
        principalId: granteeId,
        role: "owner",
        grantedBy: harness.ownerId,
      });
      // An owner grant on the scope reaches the tombstone and the child.
      const byGrantee = await services.recovery.recover(
        context(granteeId),
        event.id,
        { expectedVersion: 2 },
      );
      expect(byGrantee.version).toBe(3);
      const child = await services.recovery.recover(
        context(granteeId),
        task.id,
        {
          expectedVersion: 2,
        },
      );
      expect(child.version).toBe(3);
      const deletion = await services.objects.softDelete(
        context(granteeId),
        task.id,
        3,
      );
      expect(deletion.version).toBe(4);
    }
  });
});
