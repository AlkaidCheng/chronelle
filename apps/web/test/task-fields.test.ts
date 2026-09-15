import { afterEach, describe, expect, it, vi } from "vitest";
import { readTaskFields, taskFieldsPayload } from "../lib/task-fields";

const empty = {
  displayName: "Pack",
  dueDate: "",
  dueTime: "",
  assignee: "",
  location: "",
  labels: "",
};

describe("Task field conversion", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("starts without an invented due date", () => {
    expect(readTaskFields()).toEqual({
      displayName: "",
      dueDate: "",
      dueTime: "",
      assignee: "",
      location: "",
      labels: "",
    });
    expect(taskFieldsPayload(empty)).toEqual({
      displayName: "Pack",
      dueOn: null,
      dueAt: null,
      assigneeId: null,
      location: null,
      labelIds: [],
    });
  });

  it("keeps a date-only due as a date and a dated time as an instant", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(
      readTaskFields({
        displayName: "Pack",
        dueOn: "2030-07-03",
        dueAt: null,
        assigneeId: "u1",
        location: "The garden",
        labelIds: ["b", "a", "b"],
      }),
    ).toEqual({
      displayName: "Pack",
      dueDate: "2030-07-03",
      dueTime: "",
      assignee: "u1",
      location: "The garden",
      labels: "a,b",
    });
    expect(taskFieldsPayload({ ...empty, labels: "a,b" }).labelIds).toEqual([
      "a",
      "b",
    ]);
    expect(taskFieldsPayload({ ...empty, assignee: "u1" }).assigneeId).toBe(
      "u1",
    );
    expect(taskFieldsPayload({ ...empty, location: "  Hall  " }).location).toBe(
      "Hall",
    );
    expect(taskFieldsPayload({ ...empty, dueDate: "2030-07-03" })).toEqual({
      displayName: "Pack",
      dueOn: "2030-07-03",
      dueAt: null,
      assigneeId: null,
      location: null,
      labelIds: [],
    });
    expect(
      taskFieldsPayload({ ...empty, dueDate: "2030-07-03", dueTime: "12:30" }),
    ).toEqual({
      displayName: "Pack",
      dueOn: null,
      dueAt: "2030-07-03T19:30:00.000Z",
      assigneeId: null,
      location: null,
      labelIds: [],
    });
  });

  it("preserves the exact instant when only the name changes", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const source = {
      displayName: "Pack",
      dueOn: null,
      dueAt: "2030-07-03T18:30:45.678Z",
      assigneeId: null,
      location: null,
      labelIds: [],
    };
    const fields = readTaskFields(source);
    expect(fields).toEqual({
      displayName: "Pack",
      dueDate: "2030-07-03",
      dueTime: "11:30",
      assignee: "",
      location: "",
      labels: "",
    });
    expect(
      taskFieldsPayload({ ...fields, displayName: "Pack bags" }, source),
    ).toEqual({
      displayName: "Pack bags",
      dueOn: null,
      dueAt: source.dueAt,
      assigneeId: null,
      location: null,
      labelIds: [],
    });
  });

  it("accepts an explicitly changed time and clears the due", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const source = { dueAt: "2030-07-03T18:30:45.678Z" };
    expect(
      taskFieldsPayload(
        { ...empty, dueDate: "2030-07-03", dueTime: "12:30" },
        source,
      ).dueAt,
    ).toBe("2030-07-03T19:30:00.000Z");
    expect(taskFieldsPayload(empty, source)).toEqual({
      displayName: "Pack",
      dueOn: null,
      dueAt: null,
      assigneeId: null,
      location: null,
      labelIds: [],
    });
  });

  it("rejects a time without a date, malformed dates, and unavailable daylight-saving times", () => {
    vi.stubEnv("TZ", "America/New_York");
    expect(() => taskFieldsPayload({ ...empty, dueTime: "09:00" })).toThrow(
      "Choose a due date",
    );
    expect(() => taskFieldsPayload({ ...empty, dueDate: "invalid" })).toThrow(
      "valid due date",
    );
    expect(() =>
      taskFieldsPayload({ ...empty, dueDate: "2030-03-10", dueTime: "02:30" }),
    ).toThrow("local time is unavailable");
  });
});
