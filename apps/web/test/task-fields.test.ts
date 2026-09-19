import { afterEach, describe, expect, it, vi } from "vitest";
import { readTaskFields, taskFieldsPayload } from "../lib/task-fields";

const empty = {
  displayName: "Pack",
  dueDate: "",
  dueTime: "",
  duration: "",
  repeat: "",
  repeatUntil: "",
  assignee: "",
  location: "",
  description: "",
  labels: "",
};

describe("Task field conversion", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("starts without an invented due date", () => {
    expect(readTaskFields()).toEqual({
      displayName: "",
      dueDate: "",
      dueTime: "",
      duration: "",
      repeat: "",
      repeatUntil: "",
      assignee: "",
      location: "",
      description: "",
      labels: "",
    });
    expect(taskFieldsPayload(empty)).toEqual({
      displayName: "Pack",
      dueOn: null,
      dueAt: null,
      durationMinutes: null,
      repeatRule: null,
      repeatUntil: null,
      assigneeId: null,
      location: null,
      description: null,
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
        durationMinutes: null,
        repeatRule: null,
        repeatUntil: null,
        assigneeId: "u1",
        location: "The garden",
        description: "Two bags and the cooler.",
        labelIds: ["b", "a", "b"],
      }),
    ).toEqual({
      displayName: "Pack",
      dueDate: "2030-07-03",
      dueTime: "",
      duration: "",
      repeat: "",
      repeatUntil: "",
      assignee: "u1",
      location: "The garden",
      description: "Two bags and the cooler.",
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
      durationMinutes: null,
      repeatRule: null,
      repeatUntil: null,
      assigneeId: null,
      location: null,
      description: null,
      labelIds: [],
    });
    expect(
      taskFieldsPayload({ ...empty, dueDate: "2030-07-03", dueTime: "12:30" }),
    ).toEqual({
      displayName: "Pack",
      dueOn: null,
      dueAt: "2030-07-03T19:30:00.000Z",
      durationMinutes: null,
      repeatRule: null,
      repeatUntil: null,
      assigneeId: null,
      location: null,
      description: null,
      labelIds: [],
    });
  });

  it("preserves the exact instant when only the name changes", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    const source = {
      displayName: "Pack",
      dueOn: null,
      dueAt: "2030-07-03T18:30:45.678Z",
      durationMinutes: null,
      repeatRule: null,
      repeatUntil: null,
      assigneeId: null,
      location: null,
      description: null,
      labelIds: [],
    };
    const fields = readTaskFields(source);
    expect(fields).toEqual({
      displayName: "Pack",
      dueDate: "2030-07-03",
      dueTime: "11:30",
      duration: "",
      repeat: "",
      repeatUntil: "",
      assignee: "",
      location: "",
      description: "",
      labels: "",
    });
    expect(
      taskFieldsPayload({ ...fields, displayName: "Pack bags" }, source),
    ).toEqual({
      displayName: "Pack bags",
      dueOn: null,
      dueAt: source.dueAt,
      durationMinutes: null,
      repeatRule: null,
      repeatUntil: null,
      assigneeId: null,
      location: null,
      description: null,
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
      durationMinutes: null,
      repeatRule: null,
      repeatUntil: null,
      assigneeId: null,
      location: null,
      description: null,
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
    expect(() =>
      taskFieldsPayload({ ...empty, location: `${"x".repeat(240)} ` }),
    ).not.toThrow();
    expect(() =>
      taskFieldsPayload({ ...empty, location: "x".repeat(241) }),
    ).toThrow("Keep the location to 240 characters.");
  });

  it("keeps a duration only with a due time and within a day", () => {
    vi.stubEnv("TZ", "America/Los_Angeles");
    expect(
      readTaskFields({
        displayName: "Pack",
        dueOn: null,
        dueAt: "2030-07-03T19:30:00.000Z",
        durationMinutes: 90,
        repeatRule: null,
        repeatUntil: null,
        assigneeId: null,
        location: null,
        description: null,
        labelIds: [],
      }).duration,
    ).toBe("90");
    expect(
      taskFieldsPayload({
        ...empty,
        dueDate: "2030-07-03",
        dueTime: "12:30",
        duration: "90",
      }).durationMinutes,
    ).toBe(90);
    expect(() =>
      taskFieldsPayload({ ...empty, dueDate: "2030-07-03", duration: "30" }),
    ).toThrow("Choose a due time for the duration.");
    expect(() => taskFieldsPayload({ ...empty, duration: "30" })).toThrow(
      "Choose a due time for the duration.",
    );
    for (const duration of ["0", "1441", "1.5", "soon"])
      expect(() =>
        taskFieldsPayload({
          ...empty,
          dueDate: "2030-07-03",
          dueTime: "12:30",
          duration,
        }),
      ).toThrow("Choose a duration of up to a day.");
  });

  it("keeps a repeat rule only with a due date and its end on or after it", () => {
    const fields = readTaskFields({
      displayName: "Water",
      dueOn: "2030-07-03",
      dueAt: null,
      durationMinutes: null,
      repeatRule: "weekly",
      repeatUntil: "2030-08-01",
      assigneeId: null,
      location: null,
      description: null,
      labelIds: [],
    });
    expect(fields.repeat).toBe("weekly");
    expect(fields.repeatUntil).toBe("2030-08-01");
    expect(taskFieldsPayload(fields)).toMatchObject({
      dueOn: "2030-07-03",
      repeatRule: "weekly",
      repeatUntil: "2030-08-01",
    });
    expect(
      taskFieldsPayload({ ...empty, dueDate: "2030-07-03", repeat: "daily" }),
    ).toMatchObject({ repeatRule: "daily", repeatUntil: null });
    // An end without a rule is dropped; a rule without a date, or an end
    // before the date, is refused.
    expect(
      taskFieldsPayload({
        ...empty,
        dueDate: "2030-07-03",
        repeatUntil: "2030-08-01",
      }),
    ).toMatchObject({ repeatRule: null, repeatUntil: null });
    expect(() => taskFieldsPayload({ ...empty, repeat: "weekly" })).toThrow(
      "Choose a due date to repeat from.",
    );
    expect(() =>
      taskFieldsPayload({
        ...empty,
        dueDate: "2030-07-03",
        repeat: "weekly",
        repeatUntil: "2030-07-02",
      }),
    ).toThrow("Choose a repeat end on or after the due date.");
    expect(() =>
      taskFieldsPayload({ ...empty, dueDate: "2030-07-03", repeat: "hourly" }),
    ).toThrow("Choose a repeat the picker offers.");
  });
});
