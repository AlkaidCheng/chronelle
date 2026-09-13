import { describe, expect, it, vi } from "vitest";

import {
  CloudBaseRdbTimeoutError,
  createCloudBaseRdbClient,
} from "../src/cloudbase-rdb.js";

describe("CloudBase RDB client", () => {
  it("keeps reads behind a small transport boundary", async () => {
    const response = {
      data: [{ id: "event-1" }],
    };
    const request = Promise.resolve(response);
    const range = vi.fn().mockReturnValue(request);
    const limit = vi
      .fn()
      .mockReturnValue(Object.assign(Promise.resolve(response), { range }));
    const from = vi.fn().mockReturnValue({
      select: vi
        .fn()
        .mockReturnValue(Object.assign(Promise.resolve(response), { limit })),
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

  it("translates bounded filters and ordering into the SDK query builder", async () => {
    const response = { data: [{ id: "event-1" }] };
    const request = {
      eq: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      is: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue(response),
    };
    const select = vi.fn().mockReturnValue(request);
    const client = createCloudBaseRdbClient({
      rdb: () => ({ from: vi.fn().mockReturnValue({ select }) }),
    });

    await expect(
      client.select("events", {
        columns: "id, display_name",
        filters: [
          { column: "workspace_id", operator: "eq", value: "workspace-1" },
          { column: "deleted_at", operator: "is", value: null },
          { column: "display_name", operator: "ilike", value: "%trip%" },
          { column: "object_type", operator: "in", value: ["event"] },
        ],
        order: [{ column: "starts_at", ascending: true, nullsFirst: false }],
        limit: 10,
        offset: 0,
      }),
    ).resolves.toEqual([{ id: "event-1" }]);
    expect(select).toHaveBeenCalledWith("id, display_name");
    expect(request.eq).toHaveBeenCalledWith("workspace_id", "workspace-1");
    expect(request.is).toHaveBeenCalledWith("deleted_at", null);
    expect(request.ilike).toHaveBeenCalledWith("display_name", "%trip%");
    expect(request.in).toHaveBeenCalledWith("object_type", ["event"]);
    expect(request.order).toHaveBeenCalledWith("starts_at", {
      ascending: true,
      nullsFirst: false,
      referencedTable: undefined,
    });
    expect(request.range).toHaveBeenCalledWith(0, 9);
  });

  it("rejects unsafe filter and order identifiers before making a request", async () => {
    const from = vi.fn();
    const client = createCloudBaseRdbClient({
      rdb: () => ({ from }),
    });

    await expect(
      client.select("events", {
        filters: [
          {
            column: "workspace_id; DROP TABLE users",
            operator: "eq",
            value: "x",
          },
        ],
      }),
    ).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();

    await expect(
      client.select("events", {
        order: [{ column: "starts_at; DROP TABLE users" }],
      }),
    ).rejects.toThrow();
    expect(from).not.toHaveBeenCalled();
  });

  it("bounds a gateway request with the configured timeout", async () => {
    type NeverQuery = Promise<never> & {
      select(columns?: string): NeverQuery;
      eq(column: string, value: unknown): NeverQuery;
      ilike(column: string, value: string): NeverQuery;
      in(column: string, value: readonly unknown[]): NeverQuery;
      is(column: string, value: unknown): NeverQuery;
      limit(value: number): NeverQuery;
      order(
        column: string,
        options?: {
          readonly ascending?: boolean;
          readonly nullsFirst?: boolean;
          readonly referencedTable?: string;
        },
      ): NeverQuery;
      range(from: number, to: number): NeverQuery;
    };
    const never = new Promise<never>(() => undefined) as NeverQuery;
    const source = { select: () => never } as unknown as NeverQuery;
    const client = createCloudBaseRdbClient(
      {
        rdb: () => ({
          from: () => source,
        }),
      },
      { requestTimeoutMs: 5 },
    );

    await expect(client.select("events")).rejects.toBeInstanceOf(
      CloudBaseRdbTimeoutError,
    );
  });

  it("rejects an unsafe timeout before creating a client", () => {
    expect(() =>
      createCloudBaseRdbClient(
        { rdb: () => ({ from: vi.fn() }) },
        { requestTimeoutMs: 0 },
      ),
    ).toThrow();
  });
});
