import { describe, expect, it, vi } from "vitest";

import { CloudBaseExpenseWriteRepository } from "../src/cloudbase-expense-write-repository.js";
import { InvalidObjectStateError } from "../src/errors.js";

// Encoding, error mapping, and the command envelope are shared with the Event
// adapter and covered there; this test pins the Expense function names, the
// text amount, and the invalid-instant guard.

const workspaceId = "00000000-0000-7000-8000-000000000001";
const objectId = "00000000-0000-7000-8000-000000000002";
const context = {
  principal: { type: "user" as const, userId: "user-1", workspaceId },
  requestId: "request-1",
};
const rows = {
  object: {
    id: objectId,
    workspace_id: workspaceId,
    object_type: "expense",
    display_name: "Venue deposit",
    created_by: "user-1",
    permission_scope_id: objectId,
    created_at: "2030-01-01T00:00:00+00:00",
    updated_at: "2030-01-02T00:00:00+00:00",
    version: 2,
    archived_at: null,
    deleted_at: null,
    custom_properties: {},
    metadata: {},
  },
  expense: {
    object_id: objectId,
    workspace_id: workspaceId,
    amount: "1250.5000",
    currency: "EUR",
    occurred_at: "2030-09-01T10:00:00+00:00",
  },
};

describe("CloudBaseExpenseWriteRepository", () => {
  it("calls the Expense functions and decodes the expense row", async () => {
    const rpc = vi.fn().mockResolvedValue(rows);
    const repository = new CloudBaseExpenseWriteRepository({ rpc });

    const created = await repository.create(context, {
      displayName: "Venue deposit",
      amount: "1250.5",
      currency: "EUR",
      occurredAt: new Date("2030-09-01T10:00:00.000Z"),
    });
    const updated = await repository.update(context, objectId, {
      expectedVersion: 1,
      currency: "USD",
    });

    expect(rpc).toHaveBeenNthCalledWith(1, "chronelle_expense_create", {
      workspace_id: workspaceId,
      user_id: "user-1",
      request_id: "request-1",
      input: {
        displayName: "Venue deposit",
        amount: "1250.5",
        currency: "EUR",
        occurredAt: "2030-09-01T10:00:00.000Z",
      },
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "chronelle_expense_update", {
      workspace_id: workspaceId,
      user_id: "user-1",
      request_id: "request-1",
      object_id: objectId,
      expected_version: 1,
      changes: { currency: "USD" },
      command: null,
    });
    for (const resource of [created, updated]) {
      expect(resource).toMatchObject({
        id: objectId,
        objectType: "expense",
        version: 2,
        amount: "1250.5000",
        currency: "EUR",
        occurredAt: new Date("2030-09-01T10:00:00.000Z"),
      });
    }
  });

  it("rejects an invalid instant before calling the gateway", async () => {
    const rpc = vi.fn();
    const repository = new CloudBaseExpenseWriteRepository({ rpc });
    await expect(
      repository.update(context, objectId, {
        expectedVersion: 1,
        occurredAt: new Date(Number.NaN),
      }),
    ).rejects.toThrow(
      new InvalidObjectStateError("occurredAt must be a valid date."),
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it("rejects rows whose amount is not text", async () => {
    const repository = new CloudBaseExpenseWriteRepository({
      rpc: vi.fn().mockResolvedValue({
        object: rows.object,
        expense: { ...rows.expense, amount: 1250.5 },
      }),
    });
    await expect(
      repository.update(context, objectId, { expectedVersion: 1 }),
    ).rejects.toThrow("invalid amount");
  });
});
