import type { ExpenseResponse } from "@chronelle/schemas";
import { describe, expect, it } from "vitest";

import { canEditExpense, replaceExpenseProjection } from "../src/expenses/data";
import {
  emptyExpenseFields,
  expenseCreatePayload,
  expenseUpdatePayload,
  ExpenseEditorValidationError,
  fieldsFromExpense,
  sameExpenseFields,
} from "../src/expenses/editor";

const id = "019d6e7d-0000-7000-8000-000000000001";
const sectionId = "019d6e7d-0000-7000-8000-000000000004";

function expense(change: Partial<ExpenseResponse> = {}): ExpenseResponse {
  return {
    amount: "12.3456",
    archivedAt: null,
    createdAt: "2030-07-01T10:00:00.000Z",
    createdBy: "019d6e7d-0000-7000-8000-000000000003",
    currency: "USD",
    customProperties: {},
    deletedAt: null,
    displayName: "Rail ticket",
    id,
    metadata: {},
    objectType: "expense",
    occurredAt: "2030-07-03T16:30:42.000Z",
    permissionScopeId: "019d6e7d-0000-7000-8000-000000000005",
    sectionId,
    updatedAt: "2030-07-01T10:00:00.000Z",
    version: 3,
    workspaceId: "019d6e7d-0000-7000-8000-000000000002",
    ...change,
  };
}

describe("Mini Program Expense editor", () => {
  it("creates one canonical Expense in the Event context without numeric rounding", () => {
    const fields = {
      ...emptyExpenseFields("America/Los_Angeles", sectionId),
      amount: " 12.3456 ",
      currency: "usd",
      date: "2030-07-03",
      displayName: " Rail ticket ",
      time: "09:30",
    };
    expect(expenseCreatePayload(fields, id)).toEqual({
      commandId: id,
      resource: {
        amount: "12.3456",
        currency: "USD",
        displayName: "Rail ticket",
        objectType: "expense",
        occurredAt: "2030-07-03T16:30:00.000Z",
        sectionId,
      },
    });
  });

  it("keeps an unchanged transaction instant lossless on a versioned edit", () => {
    const source = expense();
    const fields = fieldsFromExpense(source, "America/Los_Angeles");
    expect(fields).toMatchObject({ date: "2030-07-03", time: "09:30" });
    expect(expenseUpdatePayload(fields, source)).toMatchObject({
      amount: "12.3456",
      expectedVersion: 3,
      occurredAt: "2030-07-03T16:30:42.000Z",
    });
    expect(sameExpenseFields(fields, { ...fields, amount: "13" })).toBe(false);
  });

  it.each([
    [{ displayName: "" }, "name-required"],
    [{ amount: "1.12345" }, "amount-invalid"],
    [{ currency: "US" }, "currency-invalid"],
    [{ date: "2030-02-30" }, "date-invalid"],
    [{ time: "25:00" }, "time-invalid"],
    [{ date: "2030-03-10", time: "02:30" }, "invalid-local-time"],
  ] as const)("rejects invalid Expense fields (%s)", (change, issue) => {
    const fields = {
      ...emptyExpenseFields("America/Los_Angeles"),
      amount: "1",
      date: "2030-07-03",
      displayName: "Fare",
      time: "09:30",
      ...change,
    };
    expect(() => expenseCreatePayload(fields, id)).toThrowError(
      ExpenseEditorValidationError,
    );
    try {
      expenseCreatePayload(fields, id);
    } catch (error) {
      expect((error as ExpenseEditorValidationError).issue).toBe(issue);
    }
  });

  it("replaces only the canonical Expense in a projection", () => {
    const first = expense();
    const other = expense({ id: sectionId });
    const projection = {
      kind: "expenses" as const,
      value: { sourceEventId: id, items: [first, other], sections: [] },
    };
    const saved = expense({ amount: "14.00", version: 4 });
    const next = replaceExpenseProjection(projection, saved);
    expect(next?.kind).toBe("expenses");
    if (next?.kind !== "expenses") return;
    expect(next.value.items).toEqual([saved, other]);
    expect(next.value.items[0]?.id).toBe(first.id);
  });

  it("requires server-provided edit access", () => {
    const access = {
      resourceId: id,
      actions: ["view"] as ("view" | "edit")[],
      source: { kind: "own" as const },
      narrowing: null,
    };
    expect(canEditExpense(access)).toBe(false);
    expect(canEditExpense({ ...access, actions: ["view", "edit"] })).toBe(true);
    expect(canEditExpense(undefined)).toBe(false);
  });
});
