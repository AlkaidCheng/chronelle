import type { UserPrincipal } from "@livtales/authorization";
import type { Database } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";

import { EventPlanningProjectionService } from "../src/projection-service.js";
import type { CalendarReadRepository } from "../src/projection-service.js";

describe("calendar read repository boundary", () => {
  it("delegates calendar event loading and keeps the projection envelope", async () => {
    const principal: UserPrincipal = {
      type: "user",
      userId: "user-1",
      workspaceId: "workspace-1",
    };
    const listCalendarEvents = vi.fn().mockResolvedValue([]);
    const repository: CalendarReadRepository = { listCalendarEvents };
    const service = new EventPlanningProjectionService(
      {} as Database,
      repository,
    );

    await expect(service.getCalendar(principal, "event-1")).resolves.toEqual({
      sourceEventId: "event-1",
      items: [],
    });
    expect(listCalendarEvents).toHaveBeenCalledOnce();
    expect(listCalendarEvents).toHaveBeenCalledWith(principal, "event-1");
  });
});
