import { CloudBaseRpcError } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";

import { CloudBaseEventLayoutWriteRepository } from "../src/cloudbase-event-layout-write-repository.js";
import { InvalidObjectStateError } from "../src/errors.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
const eventId = "00000000-0000-7000-8000-000000000002";
const userId = "00000000-0000-7000-8000-000000000005";
const context = {
  principal: { type: "user" as const, userId, workspaceId },
  requestId: "request-1",
};
const pages = [
  {
    id: "00000000-0000-7000-8000-0000000000a1",
    name: "Overview",
    components: [
      { id: "00000000-0000-7000-8000-0000000000b1", kind: "calendar" as const },
    ],
  },
];
const layout = {
  eventId,
  version: 2,
  pages,
  updatedAt: "2030-08-01T12:00:00.000Z",
};

describe("CloudBaseEventLayoutWriteRepository", () => {
  it("updates and restores through the two functions and parses the layout", async () => {
    const rpc = vi.fn().mockResolvedValue(layout);
    const repository = new CloudBaseEventLayoutWriteRepository({ rpc });

    const updated = await repository.update(context, eventId, 1, pages);
    const restored = await repository.restore(context, eventId, 2, 1);

    const principal = {
      workspace_id: workspaceId,
      user_id: userId,
      request_id: "request-1",
    };
    expect(rpc).toHaveBeenNthCalledWith(1, "chronelle_event_layout_update", {
      ...principal,
      event_id: eventId,
      expected_version: 1,
      pages,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "chronelle_event_layout_restore", {
      ...principal,
      event_id: eventId,
      expected_version: 2,
      target_version: 1,
    });
    expect(updated).toEqual(layout);
    expect(restored).toEqual(layout);
  });

  it("rejects a malformed layout", async () => {
    const repository = new CloudBaseEventLayoutWriteRepository({
      rpc: vi.fn().mockResolvedValue({ ...layout, pages: [{ id: "x" }] }),
    });
    await expect(
      repository.update(context, eventId, 1, pages),
    ).rejects.toThrow();
  });

  it("maps a PT422 rejection to the service error", async () => {
    const repository = new CloudBaseEventLayoutWriteRepository({
      rpc: vi
        .fn()
        .mockRejectedValue(
          new CloudBaseRpcError(
            422,
            "DATABASE_PT422",
            "Page layouts belong to Events.",
          ),
        ),
    });
    await expect(repository.update(context, eventId, 0, pages)).rejects.toThrow(
      new InvalidObjectStateError("Page layouts belong to Events."),
    );
  });
});
