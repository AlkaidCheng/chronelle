import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, PATCH, POST, PUT } from "../app/api/[...path]/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("same-origin API proxy", () => {
  it.each(["..", ".", "../events", "events\\plan"])(
    "rejects a decoded path segment %s before dispatch",
    async (segment) => {
      const fetch = vi.fn<typeof globalThis.fetch>();
      vi.stubGlobal("fetch", fetch);
      const response = await GET(
        new NextRequest("http://localhost:3000/api/events"),
        { params: Promise.resolve({ path: [segment] }) },
      );
      expect(response.status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("rejects an aborted request before contacting the upstream", async () => {
    const client = new AbortController();
    client.abort();
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const response = await GET(
      new NextRequest("http://localhost:3000/api/events", {
        signal: client.signal,
      }),
      { params: Promise.resolve({ path: ["events"] }) },
    );
    expect(response.status).toBe(408);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("cancels oversized chunked transfers before dispatch", async () => {
    const cancel = vi.fn();
    const chunk = new Uint8Array(1024 * 1024);
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(chunk);
      },
      cancel,
    });
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const response = await PUT(
      new NextRequest(
        "http://localhost:3000/api/document-transfers/upload/token",
        { method: "PUT", body },
      ),
      {
        params: Promise.resolve({
          path: ["document-transfers", "upload", "token"],
        }),
      },
    );
    expect(response.status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("keeps the ordinary limit on non-upload routes even for binary content", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const response = await PUT(
      new NextRequest("http://localhost:3000/api/documents", {
        method: "PUT",
        body: new Uint8Array(1024 * 1024 + 1),
        headers: { "content-type": "application/octet-stream" },
      }),
      { params: Promise.resolve({ path: ["documents"] }) },
    );
    expect(response.status).toBe(413);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("normalizes incoming stream failures without revealing exception details", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("private stream details"));
      },
    });
    const response = await PATCH(
      new NextRequest("http://localhost:3000/api/events/plan", {
        method: "PATCH",
        body,
      }),
      { params: Promise.resolve({ path: ["events", "plan"] }) },
    );
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("private stream details");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([undefined, "1", String(1024 * 1024 + 1)])(
    "rejects oversized bodies with declared length %s before dispatch",
    async (declaredLength) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json({ ok: true }));
      vi.stubGlobal("fetch", fetch);
      const headers = new Headers({ "content-type": "application/json" });
      if (declaredLength !== undefined)
        headers.set("content-length", declaredLength);
      const response = await PATCH(
        new NextRequest("http://localhost:3000/api/events/plan", {
          method: "PATCH",
          headers,
          body: new Uint8Array(1024 * 1024 + 1),
        }),
        { params: Promise.resolve({ path: ["events", "plan"] }) },
      );
      expect(response.status).toBe(413);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it.each(["2", "-1", "invalid", "1, 1"])(
    "rejects mismatched or invalid content length %s",
    async (length) => {
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockResolvedValue(Response.json({ ok: true }));
      vi.stubGlobal("fetch", fetch);
      const response = await PATCH(
        new NextRequest("http://localhost:3000/api/events/plan", {
          method: "PATCH",
          headers: { "content-length": length },
          body: "x",
        }),
        { params: Promise.resolve({ path: ["events", "plan"] }) },
      );
      expect(response.status).toBe(400);
      expect(fetch).not.toHaveBeenCalled();
    },
  );

  it("cancels stalled incoming bodies when the request deadline expires", async () => {
    const deadline = new AbortController();
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(deadline.signal);
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const request = new NextRequest("http://localhost:3000/api/events/plan", {
      method: "PATCH",
      body,
    });
    const pending = PATCH(request, {
      params: Promise.resolve({ path: ["events", "plan"] }),
    });
    await vi.waitFor(() => expect(body.locked).toBe(true));
    deadline.abort(new DOMException("Deadline", "TimeoutError"));
    const response = await pending;
    expect(response.status).toBe(504);
    expect(timeout).toHaveBeenCalledWith(30_000);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it("cancels stalled incoming bodies on client disconnect without waiting for stream cleanup", async () => {
    const client = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const fetch = vi.fn<typeof globalThis.fetch>();
    vi.stubGlobal("fetch", fetch);
    const pending = PATCH(
      new NextRequest("http://localhost:3000/api/events/plan", {
        method: "PATCH",
        body,
        signal: client.signal,
      }),
      { params: Promise.resolve({ path: ["events", "plan"] }) },
    );
    await vi.waitFor(() => expect(body.locked).toBe(true));
    client.abort();
    expect((await pending).status).toBe(408);
    expect(cancel).toHaveBeenCalledOnce();
    expect(fetch).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
  });

  it("preserves chunked binary uploads above the ordinary body limit", async () => {
    const chunks = [
      new Uint8Array(700_000).fill(7),
      new Uint8Array(700_000).fill(9),
    ];
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetch);
    const response = await PUT(
      new NextRequest(
        "http://localhost:3000/api/document-transfers/upload/token",
        {
          method: "PUT",
          body,
          headers: { "content-type": "application/octet-stream" },
        },
      ),
      {
        params: Promise.resolve({
          path: ["document-transfers", "upload", "token"],
        }),
      },
    );
    expect(response.status).toBe(204);
    const forwarded = await new Response(
      fetch.mock.calls[0]?.[1]?.body,
    ).arrayBuffer();
    expect(forwarded.byteLength).toBe(1_400_000);
    expect(Buffer.from(forwarded).equals(Buffer.concat(chunks))).toBe(true);
  });

  it("propagates cancellation during upstream work", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(
      (_url, options) =>
        new Promise((_resolve, reject) => {
          options?.signal?.addEventListener(
            "abort",
            () => reject(options.signal?.reason),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetch);
    const pending = GET(new NextRequest("http://localhost:3000/api/events"), {
      params: Promise.resolve({ path: ["events"] }),
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    deadline.abort();
    expect((await pending).status).toBe(504);
    expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
  it("forwards the authenticated request without caching protected data", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json(
        { version: 2 },
        {
          headers: {
            "cache-control": "public, max-age=3600",
            "x-request-id": "server-generated-id",
          },
        },
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
    expect(response.headers.get("x-request-id")).toBe("server-generated-id");
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
          "LivTales could not reach the server. Check your connection and try again.",
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
            "content-length": "8",
            "content-encoding": "gzip",
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
    expect(response.headers.has("content-length")).toBe(false);
    expect(response.headers.has("content-encoding")).toBe(false);
  });
});

describe("session cookie translation", () => {
  const context = (path: string[]) => ({
    params: Promise.resolve({ path }),
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("presents the session cookie to the API as the bearer credential", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    const response = await GET(
      new NextRequest("http://localhost:3000/api/events", {
        headers: { cookie: "theme=dark; chronelle_session=token-123; other=1" },
      }),
      context(["events"]),
    );
    expect(response.status).toBe(200);
    const headers = fetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer token-123");
  });

  it("lets an explicit bearer header take precedence over the cookie", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ ok: true }));
    vi.stubGlobal("fetch", fetch);
    await GET(
      new NextRequest("http://localhost:3000/api/events", {
        headers: {
          authorization: "Bearer explicit",
          cookie: "chronelle_session=token-123",
        },
      }),
      context(["events"]),
    );
    const headers = fetch.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("authorization")).toBe("Bearer explicit");
  });

  it("sets the httpOnly cookie from a sign-in response and forwards the body", async () => {
    const body = {
      accessToken: "issued-token",
      tokenType: "Bearer",
      expiresAt: "2030-01-15T00:00:00.000Z",
      user: { id: "u", displayName: "Person", email: null },
      workspace: { id: "w", displayName: "Workspace" },
    };
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json(body));
    vi.stubGlobal("fetch", fetch);
    const response = await POST(
      new NextRequest("https://web.example.test/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: "p@example.test",
          password: "x".repeat(10),
        }),
      }),
      context(["auth", "sign-in"]),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(body);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    const [session, presence] = cookies;
    expect(session).toContain("chronelle_session=issued-token");
    expect(session).toContain("HttpOnly");
    expect(session).toContain("SameSite=Lax");
    expect(session).toContain("Secure");
    expect(session).toContain("Expires=Tue, 15 Jan 2030 00:00:00 GMT");
    // The readable marker carries no secret and lets a tab skip the lookup.
    expect(presence).toContain("chronelle_session_present=1");
    expect(presence).not.toContain("HttpOnly");
    expect(presence).toContain("Expires=Tue, 15 Jan 2030 00:00:00 GMT");
  });

  it("does not set a cookie when the sign-in fails or the route is not a sign-in", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(
        Response.json(
          { error: { code: "invalid_credentials" } },
          { status: 401 },
        ),
      )
      .mockResolvedValueOnce(Response.json({ accessToken: "leaked" }));
    vi.stubGlobal("fetch", fetch);
    const failed = await POST(
      new NextRequest("http://localhost:3000/api/auth/sign-in", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      context(["auth", "sign-in"]),
    );
    expect(failed.status).toBe(401);
    expect(failed.headers.get("set-cookie")).toBeNull();
    const other = await POST(
      new NextRequest("http://localhost:3000/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      context(["events"]),
    );
    expect(other.headers.get("set-cookie")).toBeNull();
  });

  it("clears the cookie on sign-out even when the API rejects the credential", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json({ error: { code: "unauthenticated" } }, { status: 401 }),
      );
    vi.stubGlobal("fetch", fetch);
    const response = await DELETE(
      new NextRequest("http://localhost:3000/api/auth/session", {
        method: "DELETE",
        headers: { cookie: "chronelle_session=stale" },
      }),
      context(["auth", "session"]),
    );
    expect(response.status).toBe(401);
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain("chronelle_session=;");
    expect(cookies[0]).toContain("Max-Age=0");
    expect(cookies[0]).toContain("HttpOnly");
    expect(cookies[1]).toContain("chronelle_session_present=;");
    expect(cookies[1]).toContain("Max-Age=0");
  });
});
