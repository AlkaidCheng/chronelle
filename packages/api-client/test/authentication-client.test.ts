import { describe, expect, it, vi } from "vitest";

import { ChronelleApiClient } from "../src/index.js";

const userId = "00000000-0000-7000-8000-000000000001";
const workspaceId = "00000000-0000-7000-8000-000000000002";
const signInResponse = {
  accessToken: "opaque-chronelle-session",
  tokenType: "Bearer",
  expiresAt: "2030-01-15T00:00:00.000Z",
  user: {
    id: userId,
    displayName: "Person",
    email: "person@example.test",
    username: "person",
  },
  workspace: { id: workspaceId, displayName: "Personal workspace" },
} as const;

describe("WeChat authentication client", () => {
  it("exchanges a CloudBase credential without forwarding a Chronelle session", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json(signInResponse),
    );
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "existing-chronelle-session",
        workspaceId,
      }),
    });

    await expect(
      client.signInWithWeChat({
        accessToken: "cloudbase-end-user-token",
        deviceId: "device-1",
      }),
    ).resolves.toMatchObject(signInResponse);
    const [url, request] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/auth/wechat");
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({
      accessToken: "cloudbase-end-user-token",
      deviceId: "device-1",
    });
    expect(new Headers(request?.headers).get("authorization")).toBeNull();
    expect(new Headers(request?.headers).get("x-workspace-id")).toBeNull();
  });

  it("links a WeChat identity through the current Chronelle session", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () =>
      Response.json({ linked: true }),
    );
    const client = new ChronelleApiClient({
      fetch,
      getCredential: () => ({
        accessToken: "existing-chronelle-session",
        workspaceId,
      }),
    });

    await expect(
      client.linkWeChatIdentity({ accessToken: "cloudbase-link-token" }),
    ).resolves.toEqual({ linked: true });
    const [url, request] = fetch.mock.calls[0] ?? [];
    expect(url).toBe("/api/auth/wechat/link");
    expect(request?.method).toBe("POST");
    expect(new Headers(request?.headers).get("authorization")).toBe(
      "Bearer existing-chronelle-session",
    );
    expect(new Headers(request?.headers).get("x-workspace-id")).toBe(
      workspaceId,
    );
  });
});
