import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, PATCH } from "../app/api/[...path]/route";

afterEach(() => vi.unstubAllGlobals());

describe("same-origin API proxy", () => {
  it("forwards the authenticated request without caching protected data", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json(
          { version: 2 },
          { headers: { "cache-control": "public, max-age=3600" } },
        ),
      );
    vi.stubGlobal("fetch", fetch);
    const request = new NextRequest("http://localhost:3000/api/events/plan", {
      method: "PATCH",
      headers: {
        authorization: "Bearer test-session",
        "x-workspace-id": "workspace",
        "content-type": "application/json",
        cookie: "unrelated=value",
      },
      body: JSON.stringify({ expectedVersion: 1 }),
    });
    const response = await PATCH(request, {
      params: Promise.resolve({ path: ["events", "plan"] }),
    });
    const options = fetch.mock.calls[0]?.[1];
    const headers = new Headers(options?.headers);
    expect(headers.get("authorization")).toBe("Bearer test-session");
    expect(headers.get("x-workspace-id")).toBe("workspace");
    expect(headers.has("cookie")).toBe(false);
    expect(options).toMatchObject({
      method: "PATCH",
      redirect: "manual",
      cache: "no-store",
    });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ version: 2 });
  });
  it("returns a safe structured error when the upstream is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Private upstream details")),
    );
    const response = await GET(
      new NextRequest("http://localhost:3000/api/events"),
      { params: Promise.resolve({ path: ["events"] }) },
    );
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      error: {
        code: "service_unavailable",
        message:
          "Chronelle could not reach the server. Check your connection and try again.",
      },
    });
  });
  it("preserves attachment bytes and disposition while disabling public caching", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("private file", {
          headers: {
            "content-type": "application/octet-stream",
            "content-disposition": "attachment; filename=plan.txt",
          },
        }),
      ),
    );
    const response = await GET(
      new NextRequest("http://localhost:3000/api/documents/transfer"),
      { params: Promise.resolve({ path: ["documents", "transfer"] }) },
    );
    expect(response.headers.get("content-disposition")).toBe(
      "attachment; filename=plan.txt",
    );
    expect(await response.text()).toBe("private file");
  });
});
