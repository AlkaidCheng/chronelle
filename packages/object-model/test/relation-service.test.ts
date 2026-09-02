import { describe, expect, it } from "vitest";

import { isCompatibleRelation } from "../src/relation-service.js";

describe("isCompatibleRelation", () => {
  it("accepts the event-planning relationship vocabulary", () => {
    expect(isCompatibleRelation("event", "includes", "event")).toBe(true);
    expect(isCompatibleRelation("event", "includes", "task")).toBe(true);
    expect(isCompatibleRelation("event", "includes", "expense")).toBe(true);
    expect(isCompatibleRelation("event", "includes", "reminder")).toBe(true);
    expect(isCompatibleRelation("event", "includes", "document")).toBe(true);
    expect(isCompatibleRelation("reminder", "reminds_about", "task")).toBe(
      true,
    );
    expect(isCompatibleRelation("document", "attached_to", "expense")).toBe(
      true,
    );
    expect(isCompatibleRelation("task", "related_to", "expense")).toBe(true);
  });

  it("rejects relationships with incompatible endpoint types", () => {
    expect(isCompatibleRelation("task", "includes", "event")).toBe(false);
    expect(isCompatibleRelation("event", "reminds_about", "task")).toBe(false);
    expect(isCompatibleRelation("expense", "attached_to", "document")).toBe(
      false,
    );
  });
});
