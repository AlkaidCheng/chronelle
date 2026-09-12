import { afterEach, describe, expect, it, vi } from "vitest";
import { readTaskFields, taskFieldsPayload } from "../lib/task-fields";

describe("Task field conversion", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("starts without an invented due date", () => {
    expect(readTaskFields()).toEqual({ displayName: "", dueAt: "" });
    expect(taskFieldsPayload({ displayName: "Pack", dueAt: "" })).toEqual({
      displayName: "Pack",
      dueAt: null,
    });
  });

  it("preserves the exact instant when only the name changes", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const source = { displayName: "Pack", dueAt: "2030-07-03T18:30:45.678Z" };
    const fields = readTaskFields(source);
    expect(fields.dueAt).toBe("2030-07-03T11:30");
    expect(
      taskFieldsPayload({ ...fields, displayName: "Pack bags" }, source),
    ).toEqual({ displayName: "Pack bags", dueAt: source.dueAt });
  });

  it("accepts an explicitly changed time and clears the due time", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const source = { dueAt: "2030-07-03T18:30:45.678Z" };
    expect(
      taskFieldsPayload(
        { displayName: "Pack", dueAt: "2030-07-03T12:30" },
        source,
      ).dueAt,
    ).toBe("2030-07-03T19:30:00.000Z");
    expect(
      taskFieldsPayload({ displayName: "Pack", dueAt: "" }, source).dueAt,
    ).toBeNull();
  });

  it("rejects malformed and unavailable daylight-saving times", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(() =>
      taskFieldsPayload({ displayName: "Pack", dueAt: "invalid" }),
    ).toThrow("valid due date");
    expect(() =>
      taskFieldsPayload({ displayName: "Pack", dueAt: "2030-03-10T02:30" }),
    ).toThrow("local time is unavailable");
  });
});
