import type { SectionResponse, TaskResponse } from "@chronelle/schemas";
import { describe, expect, it } from "vitest";

import {
  groupTasksByDay,
  groupTasksBySection,
  monthDays,
  sectionAfterStep,
  shiftPeriod,
  taskDay,
  taskViewOf,
  weekDays,
} from "../src/tasks/presentations";

const baseTask: TaskResponse = {
  archivedAt: null,
  assigneeId: null,
  completedAt: null,
  createdAt: "2030-01-01T00:00:00.000Z",
  createdBy: "019d6e7d-0000-7000-8000-000000000003",
  customProperties: {},
  deletedAt: null,
  description: null,
  displayName: "Plan gathering",
  dueAt: null,
  dueOn: null,
  durationMinutes: null,
  id: "019d6e7d-0000-7000-8000-000000000001",
  labelIds: [],
  location: null,
  metadata: {},
  objectType: "task",
  parentTaskId: null,
  permissionScopeId: "019d6e7d-0000-7000-8000-000000000004",
  rank: "00000001000",
  repeatRule: null,
  repeatUntil: null,
  sectionId: null,
  status: "todo",
  updatedAt: "2030-01-01T00:00:00.000Z",
  version: 1,
  workspaceId: "019d6e7d-0000-7000-8000-000000000002",
};

function task(id: string, change: Partial<TaskResponse> = {}): TaskResponse {
  return { ...baseTask, id, ...change };
}

function section(id: string): SectionResponse {
  return {
    createdAt: "2030-01-01T00:00:00.000Z",
    description: null,
    eventId: "019d6e7d-0000-7000-8000-000000000010",
    id,
    name: id,
    rank: id,
    updatedAt: "2030-01-01T00:00:00.000Z",
    view: "todos",
    workspaceId: baseTask.workspaceId,
  };
}

describe("native Task presentations", () => {
  it("uses the canonical component view and falls back to list for unsupported values", () => {
    expect(taskViewOf({ id: "component", kind: "todos", view: "month" })).toBe(
      "month",
    );
    expect(taskViewOf({ id: "component", kind: "todos", view: "agenda" })).toBe(
      "list",
    );
  });

  it("places timed Tasks on the account day and preserves date-only Tasks", () => {
    const timed = task("timed", { dueAt: "2030-03-10T07:30:00.000Z" });
    expect(taskDay(timed, "America/Los_Angeles")).toBe("2030-03-09");
    expect(taskDay(timed, "Asia/Shanghai")).toBe("2030-03-10");
    expect(
      taskDay(task("date", { dueOn: "2030-03-10" }), "America/Los_Angeles"),
    ).toBe("2030-03-10");
  });

  it("keeps one canonical Task in one day group and one section group", () => {
    const firstSection = section("first");
    const secondSection = section("second");
    const items = [
      task("late", { dueOn: "2030-03-08", sectionId: firstSection.id }),
      task("done", {
        dueOn: "2030-03-08",
        sectionId: secondSection.id,
        status: "done",
      }),
      task("future", { dueOn: "2030-03-12", sectionId: "deleted" }),
      task("undated"),
    ];
    const byDay = groupTasksByDay(items, "UTC", "2030-03-10");
    expect(byDay.overdue.map((item) => item.id)).toEqual(["late"]);
    expect(
      byDay.dates.map(({ day, items: group }) => [
        day,
        group.map((item) => item.id),
      ]),
    ).toEqual([
      ["2030-03-08", ["done"]],
      ["2030-03-12", ["future"]],
    ]);
    expect(byDay.undated.map((item) => item.id)).toEqual(["undated"]);
    const bySection = groupTasksBySection(items, [firstSection, secondSection]);
    expect(bySection.loose.map((item) => item.id)).toEqual([
      "future",
      "undated",
    ]);
    expect(
      bySection.groups.map(({ items: group }) => group.map((item) => item.id)),
    ).toEqual([["late"], ["done"]]);
  });

  it("orders dated rows by due time without changing the source projection", () => {
    const items = [
      task("evening", { dueAt: "2030-03-12T19:00:00.000Z" }),
      task("morning", { dueAt: "2030-03-12T09:00:00.000Z" }),
      task("all-day", { dueOn: "2030-03-12" }),
    ];
    const result = groupTasksByDay(items, "UTC", "2030-03-10");
    expect(result.dates[0]?.items.map((item) => item.id)).toEqual([
      "all-day",
      "morning",
      "evening",
    ]);
    expect(items.map((item) => item.id)).toEqual([
      "evening",
      "morning",
      "all-day",
    ]);
  });

  it("moves sections by an after-section anchor without changing Tasks", () => {
    const sections = [section("first"), section("middle"), section("last")];
    expect(sectionAfterStep(sections, "middle", -1)).toBeNull();
    expect(sectionAfterStep(sections, "middle", 1)).toBe("last");
    expect(sectionAfterStep(sections, "first", -1)).toBeUndefined();
  });

  it("navigates Monday and Sunday weeks and complete month grids across years", () => {
    expect(weekDays("2030-01-01", 1)).toEqual([
      "2029-12-31",
      "2030-01-01",
      "2030-01-02",
      "2030-01-03",
      "2030-01-04",
      "2030-01-05",
      "2030-01-06",
    ]);
    expect(weekDays("2030-01-01", 7)[0]).toBe("2029-12-30");
    expect(monthDays("2030-01-15", 1)[0]).toBe("2029-12-31");
    expect(monthDays("2030-01-15", 1).at(-1)).toBe("2030-02-03");
    expect(shiftPeriod("2030-01-31", "month", 1)).toBe("2030-02-01");
    expect(shiftPeriod("2030-01-01", "week", -1)).toBe("2029-12-25");
  });
});
