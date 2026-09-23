import type { ReminderResponse } from "@chronelle/schemas";
import { describe, expect, it } from "vitest";

import {
  canEditReminder,
  replaceReminderProjection,
} from "../src/reminders/data";
import {
  emptyReminderFields,
  fieldsFromReminder,
  reminderCreatePayload,
  reminderUpdatePayload,
  ReminderEditorValidationError,
  sameReminderFields,
} from "../src/reminders/editor";

const id = "019d6e7d-0000-7000-8000-000000000001";
const otherId = "019d6e7d-0000-7000-8000-000000000004";

function reminder(change: Partial<ReminderResponse> = {}): ReminderResponse {
  return {
    archivedAt: null,
    createdAt: "2030-07-01T10:00:00.000Z",
    createdBy: "019d6e7d-0000-7000-8000-000000000003",
    customProperties: {},
    deletedAt: null,
    displayName: "Call the venue",
    id,
    metadata: {},
    objectType: "reminder",
    permissionScopeId: "019d6e7d-0000-7000-8000-000000000005",
    rank: "00000001000",
    remindAt: "2030-07-03T16:30:42.000Z",
    status: "pending",
    updatedAt: "2030-07-01T10:00:00.000Z",
    version: 3,
    workspaceId: "019d6e7d-0000-7000-8000-000000000002",
    ...change,
  };
}

describe("Mini Program Reminder editor", () => {
  it("creates one canonical Reminder in the Event context", () => {
    const fields = {
      ...emptyReminderFields("America/Los_Angeles"),
      date: "2030-07-03",
      displayName: " Call the venue ",
      time: "09:30",
    };
    expect(reminderCreatePayload(fields, id)).toEqual({
      commandId: id,
      resource: {
        displayName: "Call the venue",
        objectType: "reminder",
        remindAt: "2030-07-03T16:30:00.000Z",
        status: "pending",
      },
    });
  });

  it("keeps an unchanged instant lossless on a versioned edit", () => {
    const source = reminder();
    const fields = fieldsFromReminder(source, "America/Los_Angeles");
    expect(fields).toMatchObject({ date: "2030-07-03", time: "09:30" });
    expect(reminderUpdatePayload(fields, source)).toMatchObject({
      expectedVersion: 3,
      remindAt: "2030-07-03T16:30:42.000Z",
      status: "pending",
    });
    expect(sameReminderFields(fields, { ...fields, status: "dismissed" })).toBe(
      false,
    );
  });

  it.each([
    [{ displayName: "" }, "name-required"],
    [{ date: "2030-02-30" }, "date-invalid"],
    [{ time: "25:00" }, "time-invalid"],
    [{ date: "2030-03-10", time: "02:30" }, "invalid-local-time"],
  ] as const)("rejects invalid fields (%s)", (change, issue) => {
    const fields = {
      ...emptyReminderFields("America/Los_Angeles"),
      date: "2030-07-03",
      displayName: "Call the venue",
      time: "09:30",
      ...change,
    };
    expect(() => reminderCreatePayload(fields, id)).toThrowError(
      ReminderEditorValidationError,
    );
    try {
      reminderCreatePayload(fields, id);
    } catch (error) {
      expect((error as ReminderEditorValidationError).issue).toBe(issue);
    }
  });

  it("replaces only the same canonical Reminder in a projection", () => {
    const first = reminder();
    const other = reminder({ id: otherId });
    const projection = {
      kind: "reminders" as const,
      value: { sourceEventId: id, items: [first, other] },
    };
    const saved = reminder({ status: "dismissed", version: 4 });
    const next = replaceReminderProjection(projection, saved);
    expect(next?.kind).toBe("reminders");
    if (next?.kind !== "reminders") return;
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
    expect(canEditReminder(access)).toBe(false);
    expect(canEditReminder({ ...access, actions: ["view", "edit"] })).toBe(
      true,
    );
    expect(canEditReminder(undefined)).toBe(false);
  });
});
