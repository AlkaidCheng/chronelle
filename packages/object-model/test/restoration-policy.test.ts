import { describe, expect, it } from "vitest";
import { revisionSnapshotSchema } from "@chronelle/schemas";
import {
  compareRevisionContent,
  selectRestorableContent,
} from "../src/restoration-policy.js";

const envelope = {
  id: "019d6e7d-0000-7000-8000-000000000010",
  workspaceId: "019d6e7d-0000-7000-8000-000000000001",
  createdBy: "019d6e7d-0000-7000-8000-000000000002",
  displayName: "Plan",
  version: 1,
  createdAt: "2026-09-01T12:00:00Z",
  updatedAt: "2026-09-01T12:00:00Z",
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
};
describe("restoration content policy", () => {
  it("ignores key ordering and distinguishes missing custom properties from null", () => {
    const before = revisionSnapshotSchema.parse({
      ...envelope,
      objectType: "task",
      dueAt: null,
      completedAt: null,
      status: "todo",
      customProperties: { nested: { a: 1, b: 2 }, removed: null },
    });
    const after = {
      ...before,
      customProperties: { nested: { b: 2, a: 1 }, added: null },
    };
    expect(compareRevisionContent(before, after)).toMatchObject([
      {
        field: "customProperties.added",
        beforePresent: false,
        afterPresent: true,
        after: null,
      },
      {
        field: "customProperties.removed",
        beforePresent: true,
        afterPresent: false,
        before: null,
      },
    ]);
  });
  it("selects explicit content while financial, file, and delivery facts remain historical-only", () => {
    const expense = revisionSnapshotSchema.parse({
      ...envelope,
      objectType: "expense",
      amount: "10.0000",
      currency: "USD",
      occurredAt: "2026-09-01T12:00:00Z",
    });
    if (expense.objectType !== "expense")
      throw new Error("Expected an Expense fixture.");
    expect(selectRestorableContent(expense)).toEqual({
      displayName: "Plan",
      customProperties: {},
    });
    expect(
      compareRevisionContent(expense, { ...expense, amount: "20.0000" }),
    ).toMatchObject([{ field: "amount", restorable: false }]);
    const document = revisionSnapshotSchema.parse({
      ...envelope,
      objectType: "document",
      originalFilename: "file.pdf",
      mimeType: "application/pdf",
      sizeBytes: "50",
      checksumSha256: "a".repeat(64),
      storageKey: "private/file.pdf",
    });
    expect(selectRestorableContent(document)).toEqual({
      displayName: "Plan",
      customProperties: {},
    });
    const reminder = revisionSnapshotSchema.parse({
      ...envelope,
      objectType: "reminder",
      remindAt: "2026-09-01T12:00:00Z",
      status: "triggered",
    });
    if (reminder.objectType !== "reminder")
      throw new Error("Expected a Reminder fixture.");
    expect(selectRestorableContent(reminder)).toEqual({
      displayName: "Plan",
      customProperties: {},
      remindAt: reminder.remindAt,
    });
  });
});
