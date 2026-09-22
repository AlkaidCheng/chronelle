import { describe, expect, it, vi } from "vitest";

import {
  loadPlanningProjection,
  planningLayoutQueryKey,
  planningProjectionQueryKey,
} from "../src/features/planning/data";

const eventId = "019d6e7d-0000-7000-8000-000000000001";
const workspaceId = "019d6e7d-0000-7000-8000-000000000002";

function client() {
  return {
    getEventTodos: vi.fn(async (id: string) => ({
      sourceEventId: id,
      items: [],
      sections: [],
    })),
    getEventCalendar: vi.fn(async (id: string) => ({
      sourceEventId: id,
      items: [],
    })),
    getEventTimeline: vi.fn(async (id: string) => ({
      sourceEventId: id,
      items: [],
    })),
    getEventItinerary: vi.fn(async (id: string) => ({
      sourceEventId: id,
      items: [],
    })),
    getEventExpenses: vi.fn(async (id: string) => ({
      sourceEventId: id,
      items: [],
      sections: [],
    })),
    getEventReminders: vi.fn(async (id: string) => ({
      sourceEventId: id,
      items: [],
    })),
  };
}

describe("Mini Program planning queries", () => {
  it.each([
    ["todos", "getEventTodos"],
    ["calendar", "getEventCalendar"],
    ["timeline", "getEventTimeline"],
    ["itinerary", "getEventItinerary"],
    ["expenses", "getEventExpenses"],
    ["reminders", "getEventReminders"],
  ] as const)("loads the canonical %s projection", async (kind, method) => {
    const api = client();
    const result = await loadPlanningProjection(api, eventId, kind);
    expect(result.kind).toBe(kind);
    expect(result.value.sourceEventId).toBe(eventId);
    expect(api[method]).toHaveBeenCalledWith(eventId);
    expect(
      Object.entries(api)
        .filter(([, value]) => value.mock.calls.length > 0)
        .map(([name]) => name),
    ).toEqual([method]);
  });

  it("partitions layout and projection caches by workspace and Event", () => {
    expect(planningLayoutQueryKey(workspaceId, eventId)).toEqual([
      "wechat-event-layout",
      workspaceId,
      eventId,
    ]);
    expect(planningProjectionQueryKey(workspaceId, eventId, "todos")).toEqual([
      "wechat-event-projection",
      workspaceId,
      eventId,
      "todos",
    ]);
    expect(planningProjectionQueryKey(workspaceId, eventId)).toEqual([
      "wechat-event-projection",
      workspaceId,
      eventId,
    ]);
  });
});
