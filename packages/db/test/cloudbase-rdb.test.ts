import { describe, expect, it, vi } from "vitest";

import {
  assertCloudBaseApiKeyFresh,
  CloudBaseRdbTimeoutError,
  CloudBaseRpcError,
  type CloudBaseRequestEvent,
  cloudBaseGatewayUrl,
  createCloudBaseRdbClient,
} from "../src/cloudbase-rdb.js";

describe("assertCloudBaseApiKeyFresh", () => {
  const now = 2_000_000;

  it("rejects an expired JWT-shaped key", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 1 })).toString(
      "base64url",
    );
    expect(() =>
      assertCloudBaseApiKeyFresh(`header.${payload}.signature`, now),
    ).toThrow("CLOUDBASE_APIKEY is expired");
  });

  it("accepts a future expiry and opaque provider keys", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 3_000 })).toString(
      "base64url",
    );
    expect(() =>
      assertCloudBaseApiKeyFresh(`header.${payload}.signature`, now),
    ).not.toThrow();
    expect(() => assertCloudBaseApiKeyFresh("opaque-key", now)).not.toThrow();
  });
});

describe("CloudBase RDB client", () => {
  it("keeps reads behind a small transport boundary", async () => {
    // A successful gateway response carries `error: null`.
    const response = {
      data: [{ id: "event-1" }],
      error: null,
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
      serverFunctions: false,
    });
  });

  it("updates through filters and returns the affected rows", async () => {
    const response = { data: [{ id: "event-1", version: 2 }], error: null };
    const request = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue(response),
    };
    const update = vi.fn().mockReturnValue(request);
    const client = createCloudBaseRdbClient({
      rdb: () => ({ from: vi.fn().mockReturnValue({ update }) }),
    });

    await expect(
      client.update(
        "objects",
        { display_name: "Renamed", version: 2 },
        {
          filters: [
            { column: "id", operator: "eq", value: "event-1" },
            { column: "version", operator: "eq", value: 1 },
          ],
          columns: "id,version",
        },
      ),
    ).resolves.toEqual([{ id: "event-1", version: 2 }]);
    expect(update).toHaveBeenCalledWith({
      display_name: "Renamed",
      version: 2,
    });
    expect(request.eq).toHaveBeenCalledWith("id", "event-1");
    expect(request.eq).toHaveBeenCalledWith("version", 1);
    expect(request.select).toHaveBeenCalledWith("id,version");
  });

  it("resolves to no rows when a write predicate matches nothing", async () => {
    const request = {
      eq: vi.fn().mockReturnThis(),
      select: vi.fn().mockResolvedValue({ data: [], error: null }),
    };
    const client = createCloudBaseRdbClient({
      rdb: () => ({
        from: vi.fn().mockReturnValue({
          update: vi.fn().mockReturnValue(request),
          delete: vi.fn().mockReturnValue(request),
        }),
      }),
    });
    const stale = {
      filters: [{ column: "version", operator: "eq", value: 1 }] as const,
    };

    await expect(
      client.update("objects", { version: 2 }, stale),
    ).resolves.toEqual([]);
    await expect(client.delete("objects", stale)).resolves.toEqual([]);
  });

  it("refuses an update or delete without filters before any request", async () => {
    const from = vi.fn();
    const client = createCloudBaseRdbClient({ rdb: () => ({ from }) });
    const unfiltered = { filters: [] as unknown as [never] };

    await expect(
      client.update("objects", { version: 2 }, unfiltered),
    ).rejects.toThrow("require at least one filter");
    await expect(client.delete("objects", unfiltered)).rejects.toThrow(
      "require at least one filter",
    );
    expect(from).not.toHaveBeenCalled();
  });

  it("inserts rows and returns their representation", async () => {
    const response = { data: [{ id: "event-1", version: 1 }], error: null };
    const select = vi.fn().mockResolvedValue(response);
    const insert = vi.fn().mockReturnValue({ select });
    const from = vi.fn().mockReturnValue({ insert });
    const client = createCloudBaseRdbClient({ rdb: () => ({ from }) });

    await expect(
      client.insert("objects", [{ id: "event-1" }], { columns: "id,version" }),
    ).resolves.toEqual([{ id: "event-1", version: 1 }]);
    expect(insert).toHaveBeenCalledWith([{ id: "event-1" }]);
    expect(select).toHaveBeenCalledWith("id,version");
    await expect(client.insert("objects", [])).resolves.toEqual([]);
    expect(from).toHaveBeenCalledTimes(1);
  });

  it("calls a database function through the gateway rpc route", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "event-1", version: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createCloudBaseRdbClient(
      { rdb: () => ({ from: vi.fn() }) },
      {
        rpc: {
          gatewayUrl: cloudBaseGatewayUrl("env-1"),
          accessKey: "server-key",
          fetch: fetchMock as unknown as typeof fetch,
        },
      },
    );

    await expect(
      client.rpc("chronelle_probe_update_event", { expected_version: 1 }),
    ).resolves.toEqual({ id: "event-1", version: 2 });
    expect(client.capabilities.serverFunctions).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://env-1.api.tcloudbasegateway.com/v1/rdb/rest/rpc/chronelle_probe_update_event",
    );
    expect(init.method).toBe("POST");
    expect(init.body).toBe(JSON.stringify({ expected_version: 1 }));
    expect(new Headers(init.headers).get("authorization")).toBe(
      "Bearer server-key",
    );
  });

  it("reports every request's duration and outcome to the observer", async () => {
    const events: CloudBaseRequestEvent[] = [];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: "DATABASE_PT409", message: "moved" }),
          {
            status: 409,
          },
        ),
      );
    const rows = { data: [{ id: "a" }], error: null };
    const range = vi.fn().mockReturnValue(Promise.resolve(rows));
    const limit = vi
      .fn()
      .mockReturnValue(Object.assign(Promise.resolve(rows), { range }));
    const from = vi.fn().mockReturnValue({
      select: vi
        .fn()
        .mockReturnValue(Object.assign(Promise.resolve(rows), { limit })),
    });
    const client = createCloudBaseRdbClient(
      { rdb: () => ({ from }) },
      {
        onRequest: (event) => events.push(event),
        rpc: {
          gatewayUrl: "https://gateway",
          accessKey: "k",
          fetch: fetchMock as unknown as typeof fetch,
        },
      },
    );

    await client.rpc("chronelle_probe", {});
    await expect(client.rpc("chronelle_probe", {})).rejects.toBeInstanceOf(
      CloudBaseRpcError,
    );
    await client.select("objects", { limit: 1 });

    expect(events.map(({ durationMs, ...rest }) => rest)).toEqual([
      {
        kind: "rpc",
        target: "chronelle_probe",
        outcome: "ok",
        status: undefined,
        code: undefined,
      },
      {
        kind: "rpc",
        target: "chronelle_probe",
        outcome: "rejected",
        status: 409,
        code: "DATABASE_PT409",
      },
      {
        kind: "select",
        target: "objects",
        outcome: "ok",
        status: undefined,
        code: undefined,
      },
    ]);
    expect(events.every((event) => Number.isInteger(event.durationMs))).toBe(
      true,
    );
  });

  it("surfaces a rejected function call with the gateway status and code", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ code: "PT409", message: "The event changed." }),
          { status: 409 },
        ),
      );
    const client = createCloudBaseRdbClient(
      { rdb: () => ({ from: vi.fn() }) },
      {
        rpc: {
          gatewayUrl: "https://gateway",
          accessKey: "k",
          fetch: fetchMock as unknown as typeof fetch,
        },
      },
    );

    const failure = await client.rpc("probe").catch((error) => error);
    expect(failure).toBeInstanceOf(CloudBaseRpcError);
    expect(failure).toMatchObject({
      status: 409,
      code: "PT409",
      message: "The event changed.",
    });
  });

  it("rejects unsafe function names and clients without a gateway before any request", async () => {
    const fetchMock = vi.fn();
    const withGateway = createCloudBaseRdbClient(
      { rdb: () => ({ from: vi.fn() }) },
      {
        rpc: {
          gatewayUrl: "https://gateway",
          accessKey: "k",
          fetch: fetchMock as unknown as typeof fetch,
        },
      },
    );
    await expect(withGateway.rpc("drop table; --")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();

    const withoutGateway = createCloudBaseRdbClient({
      rdb: () => ({ from: vi.fn() }),
    });
    expect(withoutGateway.capabilities.serverFunctions).toBe(false);
    await expect(withoutGateway.rpc("probe")).rejects.toThrow(
      "requires a gateway transport",
    );
  });

  it("bounds a function call with the configured timeout", async () => {
    const fetchMock = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const client = createCloudBaseRdbClient(
      { rdb: () => ({ from: vi.fn() }) },
      {
        requestTimeoutMs: 5,
        rpc: {
          gatewayUrl: "https://gateway",
          accessKey: "k",
          fetch: fetchMock as unknown as typeof fetch,
        },
      },
    );

    await expect(client.rpc("probe")).rejects.toBeInstanceOf(
      CloudBaseRdbTimeoutError,
    );
  });

  it("rejects a gateway error instead of returning rows", async () => {
    const error = { code: "DATABASE_PGRST205", message: "relation missing" };
    const response = { data: null, error };
    const from = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue(Promise.resolve(response)),
    });
    const client = createCloudBaseRdbClient({
      rdb: () => ({ from }),
    });

    await expect(client.select("events")).rejects.toBe(error);
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
      insert(rows: readonly Record<string, unknown>[]): NeverQuery;
      update(values: Record<string, unknown>): NeverQuery;
      delete(): NeverQuery;
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
