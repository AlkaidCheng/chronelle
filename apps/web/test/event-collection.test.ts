import type {
  EventDetailResponse,
  EventResponse,
  TaskResponse,
} from "@chronelle/schemas";
import { describe, expect, it } from "vitest";
import { eventPeriod } from "../lib/event-collection";
import { nextPlanningItem } from "../lib/upcoming-plan";

const now = Date.parse("2026-09-06T12:00:00.000Z");
const event: EventResponse = {
  id: "019d6e7d-0000-7000-8000-000000000001",
  workspaceId: "019d6e7d-0000-7000-8000-000000000002",
  createdBy: "019d6e7d-0000-7000-8000-000000000003",
  permissionScopeId: "019d6e7d-0000-7000-8000-000000000001",
  objectType: "event",
  displayName: "Garden gathering",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
  version: 1,
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
  startsAt: "2026-09-07T12:00:00.000Z",
  endsAt: null,
  timezone: "UTC",
  startsOn: null,
  endsOn: null,
  isAllDay: false,
};
const task: TaskResponse = {
  ...event,
  id: "019d6e7d-0000-7000-8000-000000000004",
  objectType: "task",
  dueAt: "2026-09-06T13:00:00.000Z",
  completedAt: null,
  status: "todo",
};

describe("event collection", () => {
  it("includes ongoing events and the exact time boundary", () => {
    expect(
      eventPeriod(
        {
          startsAt: "2026-09-05T12:00:00.000Z",
          endsAt: "2026-09-07T12:00:00.000Z",
        },
        now,
      ),
    ).toBe("upcoming");
    expect(
      eventPeriod({ startsAt: new Date(now).toISOString(), endsAt: null }, now),
    ).toBe("upcoming");
    expect(
      eventPeriod({ startsAt: "2026-09-05T12:00:00.000Z", endsAt: null }, now),
    ).toBe("past");
  });
});

describe("next planning item", () => {
  it("excludes historical transactions, past dates, and completed or cancelled plans", () => {
    const detail: EventDetailResponse = {
      event,
      events: [
        event,
        { ...event, id: "past", startsAt: "2026-09-01T00:00:00.000Z" },
      ],
      tasks: [
        task,
        {
          ...task,
          id: "done",
          status: "done",
          dueAt: new Date(now).toISOString(),
        },
        { ...task, id: "cancelled", status: "cancelled" },
        { ...task, id: "undated", dueAt: null },
      ],
      expenses: [
        {
          ...event,
          objectType: "expense",
          amount: "100.00",
          currency: "USD",
          occurredAt: new Date(now).toISOString(),
        },
      ],
      reminders: [
        {
          ...event,
          objectType: "reminder",
          remindAt: new Date(now).toISOString(),
          status: "dismissed",
        },
      ],
      documents: [],
      lockedRelationCount: 0,
    };
    expect(nextPlanningItem(detail, now)?.id).toBe(task.id);
    expect(
      nextPlanningItem({ ...detail, tasks: [], events: [] }, now),
    ).toBeUndefined();
    expect(
      nextPlanningItem(
        {
          ...detail,
          reminders: [
            {
              ...event,
              objectType: "reminder",
              remindAt: new Date(now).toISOString(),
              status: "pending",
            },
          ],
        },
        now,
      )?.occursAt,
    ).toBe(new Date(now).toISOString());
  });
});
