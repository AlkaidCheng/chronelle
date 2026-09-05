import { describe, expect, it } from "vitest";

import { eventContextCreateRequestSchema } from "../src/event-context.js";

const commandId = "019d6e7d-0000-7000-8000-000000000010";
describe("create in Event context", () => {
  it("validates typed resources and reserves scope assignment for the service", () => {
    expect(
      eventContextCreateRequestSchema.parse({
        commandId,
        resource: { objectType: "task", displayName: "Confirm venue" },
        relationMetadata: { section: "Logistics" },
      }),
    ).toMatchObject({ commandId, resource: { objectType: "task" } });
    for (const resource of [
      { objectType: "task", displayName: "Task", permissionScopeId: commandId },
      { objectType: "task", displayName: "Task", createdBy: commandId },
      { objectType: "expense", displayName: "Expense", amount: "1.00" },
      { objectType: "document", displayName: "Document" },
      { objectType: "event", displayName: "Event", startsAt: "bad date" },
    ])
      expect(
        eventContextCreateRequestSchema.safeParse({ commandId, resource })
          .success,
      ).toBe(false);
    expect(
      eventContextCreateRequestSchema.safeParse({
        resource: { objectType: "task", displayName: "Task" },
      }).success,
    ).toBe(false);
  });
});
