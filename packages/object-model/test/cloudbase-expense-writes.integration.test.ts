import { AuthorizationDeniedError } from "@livtales/authorization";
import { createId, expenses, objects, resourceGrants } from "@livtales/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseExpenseWriteRepository } from "../src/cloudbase-expense-write-repository.js";
import { InvalidObjectStateError, ObjectConflictError } from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import type {
  CreateExpenseInput,
  ExpenseResource,
  UpdateExpenseInput,
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

// The Expense write functions must produce what the PostgreSQL service
// produces. Both backends run against one database here.

let harness: WriteHarness;
let reference: EventPlanningObjectService;
let cloudbase: EventPlanningObjectService;

beforeAll(async () => {
  harness = await createWriteHarness("Expense writes");
  const db = harness.database.connection.db;
  reference = new EventPlanningObjectService(db);
  cloudbase = new EventPlanningObjectService(db, undefined, undefined, {
    expense: new CloudBaseExpenseWriteRepository(harness),
  });
});

afterAll(async () => {
  await harness?.database.close();
});

const context = (
  userId?: string,
  command?: Parameters<typeof mutationContext>[2],
) => mutationContext(harness, userId, command);

describe.sequential("CloudBase Expense writes", () => {
  it("create and update leave the same resource, audit, and revision rows", async () => {
    const created: ExpenseResource[] = [];
    const updated: ExpenseResource[] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const deposit = await service.createExpense(context(), {
        displayName: "Venue deposit",
        amount: "1250.5",
        currency: "EUR",
        occurredAt: new Date("2030-09-01T10:00:00.000Z"),
        customProperties: { category: "venue", paid: true },
        metadata: { source: "test" },
      });
      // numeric(19,4) fixes the scale the resource reports.
      expect(deposit.amount).toBe("1250.5000");
      const refund = await service.createExpense(context(), {
        displayName: "Deposit refund",
        amount: "-1250.5",
        currency: "EUR",
        occurredAt: new Date("2030-09-15T10:00:00.000Z"),
        permissionScopeId: deposit.id,
      });
      expect(refund.permissionScopeId).toBe(deposit.id);
      created.push(deposit, refund);
      updated.push(
        await service.updateExpense(
          context(harness.ownerId, {
            id: "command-1",
            operationId: "operation-1",
            direction: "execute",
          }),
          deposit.id,
          {
            expectedVersion: 1,
            displayName: "Venue deposit, final",
            amount: "1300",
            currency: "USD",
            occurredAt: new Date("2030-09-02T10:00:00.000Z"),
            customProperties: { category: "venue" },
            metadata: {},
          },
        ),
        await service.updateExpense(context(), refund.id, {
          expectedVersion: 1,
          displayName: "Deposit refund, partial",
        }),
      );
    }

    const [pgDeposit, pgRefund, cbDeposit, cbRefund] = created;
    expect(shape(cbDeposit as ExpenseResource)).toEqual(
      shape(pgDeposit as ExpenseResource),
    );
    expect(shape(cbRefund as ExpenseResource)).toEqual(
      shape(pgRefund as ExpenseResource),
    );
    const [pgFinal, pgPartial, cbFinal, cbPartial] = updated;
    expect(shape(cbFinal as ExpenseResource)).toEqual(
      shape(pgFinal as ExpenseResource),
    );
    expect(shape(cbPartial as ExpenseResource)).toEqual(
      shape(pgPartial as ExpenseResource),
    );
    expect(cbFinal?.version).toBe(2);
    expect(cbFinal?.amount).toBe("1300.0000");
    expect(cbFinal?.currency).toBe("USD");
    expect(cbPartial?.amount).toBe("-1250.5000");

    for (const [pg, cb] of [
      [pgDeposit, cbDeposit],
      [pgRefund, cbRefund],
    ] as const) {
      expect(await ledger(harness, (cb as ExpenseResource).id)).toEqual(
        await ledger(harness, (pg as ExpenseResource).id),
      );
      expect(await ledger(harness, (cb as ExpenseResource).id)).toHaveLength(2);
    }
  });

  it("reject the same inputs with the same errors", async () => {
    const occurredAt = new Date("2030-01-01T00:00:00Z");
    const invalidCreates: CreateExpenseInput[] = [
      { displayName: "x", amount: "12,50", currency: "EUR", occurredAt },
      { displayName: "x", amount: "1.23456", currency: "EUR", occurredAt },
      {
        displayName: "x",
        amount: "1234567890123456",
        currency: "EUR",
        occurredAt,
      },
      { displayName: "x", amount: "10", currency: "eur", occurredAt },
      { displayName: "x", amount: "10", currency: "EURO", occurredAt },
      {
        displayName: "x",
        amount: "10",
        currency: "EUR",
        occurredAt: new Date("not a date"),
      },
    ];
    const invalidUpdates: Omit<UpdateExpenseInput, "expectedVersion">[] = [
      { amount: "abc" },
      { currency: "E" },
      { occurredAt: new Date(Number.NaN) },
    ];

    const outcomes: string[][] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const seen: string[] = [];
      for (const input of invalidCreates) {
        const error = await failure(() =>
          service.createExpense(context(), input),
        );
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      const guarded = await service.createExpense(context(), {
        displayName: "Guarded",
        amount: "42",
        currency: "GBP",
        occurredAt,
      });
      for (const changes of invalidUpdates) {
        const error = await failure(() =>
          service.updateExpense(context(), guarded.id, {
            expectedVersion: 1,
            ...changes,
          }),
        );
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      expect(
        await failure(() =>
          service.updateExpense(context(), guarded.id, {
            expectedVersion: 2,
            displayName: "stale",
          }),
        ),
      ).toBeInstanceOf(ObjectConflictError);
      expect(
        await failure(() =>
          service.updateExpense(context(harness.viewerId), guarded.id, {
            expectedVersion: 1,
            displayName: "forbidden",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.updateExpense(context(), createId(), {
            expectedVersion: 1,
            displayName: "missing",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.createExpense(context(harness.viewerId), {
            displayName: "denied",
            amount: "1",
            currency: "EUR",
            occurredAt,
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
      const byGrantee = await service.updateExpense(
        context(harness.viewerId),
        guarded.id,
        { expectedVersion: 1, displayName: "by grantee" },
      );
      expect(byGrantee.version).toBe(2);
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toHaveLength(
      invalidCreates.length + invalidUpdates.length,
    );
  });

  it("refuse an object of another type or without a revision baseline", async () => {
    const messages: string[] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const task = await service.createTask(context(), {
        displayName: "Not an expense",
      });
      expect(
        await failure(() =>
          service.updateExpense(context(), task.id, {
            expectedVersion: 1,
            displayName: "as an expense",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);

      const legacyId = createId();
      await harness.database.connection.db.insert(objects).values({
        id: legacyId,
        workspaceId: harness.workspaceId,
        permissionScopeId: legacyId,
        objectType: "expense",
        displayName: "Legacy",
        createdBy: harness.ownerId,
      });
      await harness.database.connection.db.insert(expenses).values({
        objectId: legacyId,
        workspaceId: harness.workspaceId,
        amount: "1",
        currency: "EUR",
        occurredAt: new Date("2030-01-01T00:00:00Z"),
      });
      const error = await failure(() =>
        service.updateExpense(context(), legacyId, {
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
