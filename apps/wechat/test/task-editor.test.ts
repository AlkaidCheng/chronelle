import type { TaskResponse } from "@livtales/schemas";
import { describe, expect, it } from "vitest";

import {
  emptyTaskFields,
  fieldsFromTask,
  sameTaskFields,
  taskCreatePayload,
  TaskEditorValidationError,
  taskUpdatePayload,
  type TaskEditorFields,
} from "../src/tasks/editor";

const commandId = "019d6e7d-0000-7000-8000-000000000010";

function task(change: Partial<TaskResponse> = {}): TaskResponse {
  return {
    archivedAt: null,
    assigneeId: null,
    completedAt: null,
    createdAt: "2030-07-01T10:00:00.000Z",
    createdBy: "019d6e7d-0000-7000-8000-000000000003",
    customProperties: {},
    deletedAt: null,
    description: null,
    displayName: "Pack tea",
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
    updatedAt: "2030-07-01T10:00:00.000Z",
    version: 3,
    workspaceId: "019d6e7d-0000-7000-8000-000000000002",
    ...change,
  };
}

function fields(change: Partial<TaskEditorFields> = {}): TaskEditorFields {
  return {
    ...emptyTaskFields("America/Los_Angeles", null, new Date(2030, 6, 3)),
    displayName: "Pack tea",
    ...change,
  };
}

function expectIssue(action: () => unknown, issue: string): void {
  try {
    action();
    throw new Error("Expected Task editor validation to fail.");
  } catch (error) {
    expect(error).toBeInstanceOf(TaskEditorValidationError);
    expect((error as TaskEditorValidationError).issue).toBe(issue);
  }
}

describe("Mini Program Task editor", () => {
  it("creates an idempotent canonical Task in the Event context", () => {
    expect(
      taskCreatePayload(
        fields({
          description: "  Bring jasmine.  ",
          location: "  Courtyard  ",
        }),
        commandId,
        new Date("2030-07-01T12:00:00.000Z"),
      ),
    ).toEqual({
      commandId,
      resource: {
        completedAt: null,
        description: "Bring jasmine.",
        displayName: "Pack tea",
        dueAt: null,
        dueOn: null,
        durationMinutes: null,
        location: "Courtyard",
        objectType: "task",
        repeatRule: null,
        repeatUntil: null,
        sectionId: null,
        status: "todo",
      },
    });
  });

  it("preserves date-only semantics and converts timed wall clocks", () => {
    expect(
      taskCreatePayload(
        fields({ dueDate: "2030-07-03", mode: "date" }),
        commandId,
      ).resource,
    ).toMatchObject({ dueAt: null, dueOn: "2030-07-03" });
    expect(
      taskCreatePayload(
        fields({ dueDate: "2030-07-03", dueTime: "09:30", mode: "timed" }),
        commandId,
      ).resource,
    ).toMatchObject({ dueAt: "2030-07-03T16:30:00.000Z", dueOn: null });
  });

  it("rejects a nonexistent daylight-saving wall time", () => {
    expectIssue(
      () =>
        taskCreatePayload(
          fields({ dueDate: "2030-03-10", dueTime: "02:30", mode: "timed" }),
          commandId,
        ),
      "invalid-local-time",
    );
  });

  it.each([
    [{ displayName: "" }, "name-required"],
    [{ dueDate: "", mode: "date" }, "due-date-required"],
    [
      { dueDate: "2030-07-03", dueTime: "", mode: "timed" },
      "due-time-required",
    ],
  ] as const)("validates incomplete editor state", (change, issue) => {
    expectIssue(() => taskCreatePayload(fields(change), commandId), issue);
  });

  it("reads canonical date-only and timed Tasks back into fields", () => {
    expect(fieldsFromTask(task({ dueOn: "2030-07-03" }), "UTC")).toMatchObject({
      dueDate: "2030-07-03",
      mode: "date",
    });
    expect(
      fieldsFromTask(
        task({ dueAt: "2030-07-03T16:30:00.000Z" }),
        "America/Los_Angeles",
      ),
    ).toMatchObject({ dueDate: "2030-07-03", dueTime: "09:30", mode: "timed" });
  });

  it("carries the expected version and completion timestamp on updates", () => {
    expect(
      taskUpdatePayload(
        fields({ status: "done" }),
        task(),
        7,
        new Date("2030-07-03T18:00:00.000Z"),
      ),
    ).toMatchObject({
      completedAt: "2030-07-03T18:00:00.000Z",
      expectedVersion: 7,
      status: "done",
    });
  });

  it("keeps an existing completion instant until the Task is reopened", () => {
    const done = task({
      completedAt: "2030-07-02T18:00:00.000Z",
      status: "done",
    });
    expect(
      taskUpdatePayload(fields({ status: "done" }), done).completedAt,
    ).toBe(done.completedAt);
    expect(
      taskUpdatePayload(fields({ status: "todo" }), done).completedAt,
    ).toBeNull();
  });

  it("clears timed-only and repeat state when a Task becomes undated", () => {
    expect(taskUpdatePayload(fields(), task())).toMatchObject({
      dueAt: null,
      dueOn: null,
      durationMinutes: null,
      repeatRule: null,
      repeatUntil: null,
    });
  });

  it("compares every persisted editor field", () => {
    const baseline = fields();
    expect(sameTaskFields(baseline, { ...baseline })).toBe(true);
    expect(
      sameTaskFields(baseline, { ...baseline, sectionId: commandId }),
    ).toBe(false);
  });
});
