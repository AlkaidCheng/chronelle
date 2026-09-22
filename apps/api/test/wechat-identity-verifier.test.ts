import { describe, expect, it, vi } from "vitest";
import {
  CloudBaseWeChatIdentityVerifier,
  cloudBaseWeChatIdentityProvider,
  defaultCloudBaseTokenTtlMs,
} from "../src/authentication/wechat-identity-verifier.js";
import { IdentityProviderUnavailableError } from "../src/errors.js";

const now = new Date("2030-01-01T00:00:00.000Z");

function token(expiresAt: Date): string {
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(expiresAt.getTime() / 1_000) }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

function profile(overrides: Record<string, unknown> = {}) {
  return {
    sub: "cloud-user-1",
    providers: [{ id: "wx_openid" }],
    status: "ACTIVE",
    ...overrides,
  };
}

function verifier(fetch: typeof globalThis.fetch) {
  return new CloudBaseWeChatIdentityVerifier({
    envId: "chronelle-test-123",
    fetch,
    clock: () => now,
  });
}

describe("CloudBaseWeChatIdentityVerifier", () => {
  it("accepts an active WeChat profile and scopes its subject to the environment", async () => {
    const expiresAt = new Date(now.getTime() + 60_000);
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(profile()),
    );

    await expect(
      verifier(fetch).verify(token(expiresAt), "device-1"),
    ).resolves.toEqual({
      provider: cloudBaseWeChatIdentityProvider,
      subject: "chronelle-test-123:cloud-user-1",
      expiresAt,
    });
    const [url, request] = fetch.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://chronelle-test-123.api.tcloudbasegateway.com/auth/v1/user/me?client_id=chronelle-test-123",
    );
    expect(new Headers(request?.headers).get("authorization")).toBe(
      `Bearer ${token(expiresAt)}`,
    );
    expect(new Headers(request?.headers).get("x-device-id")).toBe("device-1");
  });

  it("uses a bounded fallback lifetime for an opaque accepted token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(profile()),
    );

    await expect(
      verifier(fetch).verify("opaque-cloudbase-token"),
    ).resolves.toEqual(
      expect.objectContaining({
        expiresAt: new Date(now.getTime() + defaultCloudBaseTokenTtlMs),
      }),
    );
  });

  it.each([
    ["disabled account", profile({ status: "DISABLED" })],
    ["missing account status", profile({ status: undefined })],
    ["non-WeChat provider", profile({ providers: [{ id: "email" }] })],
    ["empty subject", profile({ sub: "" })],
    ["missing fields", {}],
  ])("rejects a %s profile without exposing it", async (_label, body) => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(body),
    );

    await expect(
      verifier(fetch).verify("opaque-cloudbase-token"),
    ).resolves.toBeNull();
  });

  it.each([400, 401, 403])(
    "treats CloudBase status %s as a rejected credential",
    async (status) => {
      const fetch = vi.fn<typeof globalThis.fetch>(
        async () => new Response(null, { status }),
      );

      await expect(
        verifier(fetch).verify("opaque-cloudbase-token"),
      ).resolves.toBeNull();
    },
  );

  it("rejects expired and oversized accepted profiles", async () => {
    const expired = token(new Date(now.getTime() - 1_000));
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(Response.json(profile()))
      .mockResolvedValueOnce(
        new Response(JSON.stringify(profile({ padding: "x".repeat(70_000) }))),
      );
    const subject = verifier(fetch);

    await expect(subject.verify(expired)).resolves.toBeNull();
    await expect(subject.verify("opaque-cloudbase-token")).resolves.toBeNull();
  });

  it("rejects an oversized response before reading its body", async () => {
    let bodyRead = false;
    const response = {
      status: 200,
      ok: true,
      headers: new Headers({ "content-length": "70000" }),
      get body() {
        bodyRead = true;
        throw new Error("Body must not be read.");
      },
    } as unknown as Response;
    const fetch = vi.fn<typeof globalThis.fetch>(async () => response);

    await expect(
      verifier(fetch).verify("opaque-cloudbase-token"),
    ).resolves.toBeNull();
    expect(bodyRead).toBe(false);
  });

  it.each([
    () => Promise.resolve(new Response(null, { status: 500 })),
    () => Promise.reject(new Error("network unavailable")),
  ])("maps provider failures to a safe availability error", async (reply) => {
    const fetch = vi.fn<typeof globalThis.fetch>(reply);

    await expect(
      verifier(fetch).verify("opaque-cloudbase-token"),
    ).rejects.toBeInstanceOf(IdentityProviderUnavailableError);
  });

  it("rejects invalid verifier configuration", () => {
    expect(
      () => new CloudBaseWeChatIdentityVerifier({ envId: "invalid host" }),
    ).toThrow(TypeError);
    expect(
      () =>
        new CloudBaseWeChatIdentityVerifier({
          envId: "chronelle-test-123",
          providerIds: [" "],
        }),
    ).toThrow(TypeError);
  });
});
