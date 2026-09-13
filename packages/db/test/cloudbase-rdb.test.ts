import { describe, expect, it, vi } from "vitest";

import { createCloudBaseRdbClient } from "../src/cloudbase-rdb.js";

describe("CloudBase RDB client", () => {
  it("keeps reads behind a small transport boundary", async () => {
    const response = {
      data: [{ id: "event-1" }],
    };
    const request = Promise.resolve(response);
    const range = vi.fn().mockReturnValue(request);
    const limit = vi.fn().mockReturnValue(
      Object.assign(Promise.resolve(response), { range }),
    );
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(
        Object.assign(Promise.resolve(response), { limit }),
      ),
    });
    const client = createCloudBaseRdbClient({
      rdb: () => ({ from }),
    });

    await expect(client.select("events", { limit: 10 })).resolves.toEqual([
      { id: "event-1" },
    ]);
    expect(from).toHaveBeenCalledWith("events");
    expect(client.capabilities).toEqual({
      transactions: false,
      nativeTcp: false,
    });
  });

  it("rejects unsafe table identifiers before making a request", async () => {
    const from = vi.fn();
    const client = createCloudBaseRdbClient({
      rdb: () => ({ from }),
    });

    await expect(client.select("events; DROP TABLE users")).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects an unbounded offset instead of silently changing the query", async () => {
    const client = createCloudBaseRdbClient({
      rdb: () => ({ from: vi.fn() }),
    });

    await expect(client.select("events", { offset: 10 })).rejects.toThrow(
      "offsets require a limit",
    );
  });
});
