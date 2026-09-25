import { AuthorizationDeniedError } from "@livtales/authorization";
import { createId, objects, reminders, resourceGrants } from "@livtales/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseReminderWriteRepository } from "../src/cloudbase-reminder-write-repository.js";
import { InvalidObjectStateError, ObjectConflictError } from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import type { ReminderResource } from "../src/types.js";
import {
  backends,
  createWriteHarness,
  failure,
  ledger,
  mutationContext,
  shape,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// The Reminder write functions must produce what the PostgreSQL service
// produces. Both backends run against one database here.

let harness: WriteHarness;
let reference: EventPlanningObjectService;
let cloudbase: EventPlanningObjectService;

beforeAll(async () => {
  harness = await createWriteHarness("Reminder writes");
  const db = harness.database.connection.db;
  reference = new EventPlanningObjectService(db);
  cloudbase = new EventPlanningObjectService(db, undefined, undefined, {
    reminder: new CloudBaseReminderWriteRepository(harness),
  });
});

afterAll(async () => {
  await harness?.database.close();
});

const context = (
  userId?: string,
  command?: Parameters<typeof mutationContext>[2],
) => mutationContext(harness, userId, command);

describe.sequential("CloudBase Reminder writes", () => {
  it("create and update leave the same resource, audit, and revision rows", async () => {
    const created: ReminderResource[] = [];
    const updated: ReminderResource[] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const bare = await service.createReminder(context(), {
        displayName: "Call the caterer",
        remindAt: new Date("2030-10-01T08:00:00.000Z"),
      });
      expect(bare.status).toBe("pending");
      const dismissed = await service.createReminder(context(), {
        displayName: "Confirm headcount",
        remindAt: new Date("2030-10-05T08:00:00.000Z"),
        status: "dismissed",
        customProperties: { channel: "email", attempts: 2 },
        metadata: { source: "test" },
        permissionScopeId: bare.id,
      });
      expect(dismissed.permissionScopeId).toBe(bare.id);
      created.push(bare, dismissed);
      updated.push(
        await service.updateReminder(
          context(harness.ownerId, {
            id: "command-1",
            operationId: "operation-1",
            direction: "execute",
          }),
          bare.id,
          {
            expectedVersion: 1,
            displayName: "Call the caterer, again",
            remindAt: new Date("2030-10-02T08:00:00.000Z"),
            status: "triggered",
            customProperties: { channel: "sms" },
            metadata: {},
          },
        ),
        await service.updateReminder(context(), dismissed.id, {
          expectedVersion: 1,
          status: "cancelled",
        }),
      );
    }

    const [pgBare, pgDismissed, cbBare, cbDismissed] = created;
    expect(shape(cbBare as ReminderResource)).toEqual(
      shape(pgBare as ReminderResource),
    );
    expect(shape(cbDismissed as ReminderResource)).toEqual(
      shape(pgDismissed as ReminderResource),
    );
    const [pgTriggered, pgCancelled, cbTriggered, cbCancelled] = updated;
    expect(shape(cbTriggered as ReminderResource)).toEqual(
      shape(pgTriggered as ReminderResource),
    );
    expect(shape(cbCancelled as ReminderResource)).toEqual(
      shape(pgCancelled as ReminderResource),
    );
    expect(cbTriggered?.version).toBe(2);
    expect(cbTriggered?.status).toBe("triggered");
    expect(cbTriggered?.remindAt).toEqual(new Date("2030-10-02T08:00:00.000Z"));
    expect(cbCancelled?.status).toBe("cancelled");

    for (const [pg, cb] of [
      [pgBare, cbBare],
      [pgDismissed, cbDismissed],
    ] as const) {
      expect(await ledger(harness, (cb as ReminderResource).id)).toEqual(
        await ledger(harness, (pg as ReminderResource).id),
      );
      expect(await ledger(harness, (cb as ReminderResource).id)).toHaveLength(
        2,
      );
    }
  });

  it("rank a new reminder last and keep a given rank alike", async () => {
    const outcomes: string[][] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const first = await service.createReminder(context(), {
        displayName: "First reminder",
        remindAt: new Date("2030-10-01T08:00:00.000Z"),
      });
      const second = await service.createReminder(context(), {
        displayName: "Second reminder",
        remindAt: new Date("2030-10-01T09:00:00.000Z"),
      });
      expect(second.rank > first.rank).toBe(true);
      const moved = await service.updateReminder(context(), second.id, {
        expectedVersion: 1,
        rank: "00000000500",
      });
      const refused = await failure(() =>
        service.updateReminder(context(), first.id, {
          expectedVersion: 1,
          rank: "first",
        }),
      );
      expect(refused).toBeInstanceOf(InvalidObjectStateError);
      outcomes.push([moved.rank, refused.message]);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      "00000000500",
      "rank is a position in manual order.",
    ]);
  });

  it("reject the same inputs with the same errors", async () => {
    const outcomes: string[][] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const seen: string[] = [];
      const invalidCreate = await failure(() =>
        service.createReminder(context(), {
          displayName: "x",
          remindAt: new Date("not a date"),
        }),
      );
      expect(invalidCreate).toBeInstanceOf(InvalidObjectStateError);
      seen.push(invalidCreate.message);

      const guarded = await service.createReminder(context(), {
        displayName: "Guarded",
        remindAt: new Date("2030-03-01T09:00:00Z"),
      });
      const invalidUpdate = await failure(() =>
        service.updateReminder(context(), guarded.id, {
          expectedVersion: 1,
          remindAt: new Date(Number.NaN),
        }),
      );
      expect(invalidUpdate).toBeInstanceOf(InvalidObjectStateError);
      seen.push(invalidUpdate.message);

      expect(
        await failure(() =>
          service.updateReminder(context(), guarded.id, {
            expectedVersion: 2,
            displayName: "stale",
          }),
        ),
      ).toBeInstanceOf(ObjectConflictError);
      expect(
        await failure(() =>
          service.updateReminder(context(harness.viewerId), guarded.id, {
            expectedVersion: 1,
            displayName: "forbidden",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.updateReminder(context(), createId(), {
            expectedVersion: 1,
            displayName: "missing",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.createReminder(context(harness.viewerId), {
            displayName: "denied",
            remindAt: new Date("2030-03-01T09:00:00Z"),
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(await ledger(harness, guarded.id)).toHaveLength(1);

      await harness.database.connection.db.insert(resourceGrants).values({
        id: createId(),
        workspaceId: harness.workspaceId,
        resourceId: guarded.id,
        principalId: harness.viewerId,
        role: "editor",
        grantedBy: harness.ownerId,
      });
      const byGrantee = await service.updateReminder(
        context(harness.viewerId),
        guarded.id,
        { expectedVersion: 1, displayName: "by grantee" },
      );
      expect(byGrantee.version).toBe(2);
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      "remindAt must be a valid date.",
      "remindAt must be a valid date.",
    ]);
  });

  it("refuse an object of another type or without a revision baseline", async () => {
    const messages: string[] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const expense = await service.createExpense(context(), {
        displayName: "Not a reminder",
        amount: "1",
        currency: "EUR",
        occurredAt: new Date("2030-01-01T00:00:00Z"),
      });
      expect(
        await failure(() =>
          service.updateReminder(context(), expense.id, {
            expectedVersion: 1,
            displayName: "as a reminder",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);

      const legacyId = createId();
      await harness.database.connection.db.insert(objects).values({
        id: legacyId,
        workspaceId: harness.workspaceId,
        permissionScopeId: legacyId,
        objectType: "reminder",
        displayName: "Legacy",
        createdBy: harness.ownerId,
      });
      await harness.database.connection.db.insert(reminders).values({
        objectId: legacyId,
        workspaceId: harness.workspaceId,
        remindAt: new Date("2030-01-01T00:00:00Z"),
      });
      const error = await failure(() =>
        service.updateReminder(context(), legacyId, {
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
