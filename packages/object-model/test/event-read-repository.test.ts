import type {
  AuthorizationDatabase,
  UserPrincipal,
} from "@chronelle/authorization";
import { describe, expect, it, vi } from "vitest";

import { EventPlanningObjectService } from "../src/object-service.js";
import type { EventPage, EventReadRepository } from "../src/event-list.js";

describe("event read repository boundary", () => {
  it("delegates event listing without changing the service contract", async () => {
    const principal: UserPrincipal = {
      type: "user",
      userId: "user-1",
      workspaceId: "workspace-1",
    };
    const input = { filter: "upcoming" as const, limit: 10 };
    const page = {
      items: [],
      nextCursor: null,
      asOf: "2030-01-01T00:00:00.000Z",
    } satisfies EventPage;
    const listEvents = vi.fn().mockResolvedValue(page);
    const repository: EventReadRepository = { listEvents };
    const service = new EventPlanningObjectService(
      {} as AuthorizationDatabase,
      () => new Date("2030-01-01T00:00:00.000Z"),
      repository,
    );

    await expect(service.listEvents(principal, input)).resolves.toBe(page);
    expect(listEvents).toHaveBeenCalledOnce();
    expect(listEvents).toHaveBeenCalledWith(principal, input);
  });
});
