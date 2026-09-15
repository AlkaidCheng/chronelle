import type {
  AuthorizationDatabase,
  UserPrincipal,
} from "@chronelle/authorization";
import { describe, expect, it, vi } from "vitest";

import { EventPlanningObjectService } from "../src/object-service.js";
import type { TaskPage, TaskReadRepository } from "../src/task-list.js";

describe("task read repository boundary", () => {
  it("delegates task listing without changing the service contract", async () => {
    const principal: UserPrincipal = {
      type: "user",
      userId: "user-1",
      workspaceId: "workspace-1",
    };
    const input = { filter: "done" as const, sort: "name" as const, limit: 5 };
    const page = {
      items: [],
      contexts: {},
      progress: {},
      parents: {},
      nextCursor: null,
      asOf: "2030-01-01T00:00:00.000Z",
    } satisfies TaskPage;
    const listTasks = vi.fn().mockResolvedValue(page);
    const repository: TaskReadRepository = { listTasks };
    const service = new EventPlanningObjectService(
      {} as AuthorizationDatabase,
      () => new Date("2030-01-01T00:00:00.000Z"),
      { tasks: repository },
    );

    await expect(service.listTasks(principal, input)).resolves.toBe(page);
    expect(listTasks).toHaveBeenCalledOnce();
    expect(listTasks).toHaveBeenCalledWith(principal, input);
  });
});
