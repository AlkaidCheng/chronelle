import type { UserRow, WorkspaceRow } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";
import { hashAccessToken } from "../src/authentication/session-auth-provider.js";
import { WeChatAuthenticationService } from "../src/authentication/wechat-auth-service.js";
import type { WeChatAuthStore } from "../src/authentication/wechat-auth-store.js";
import {
  cloudBaseWeChatIdentityProvider,
  type WeChatIdentityVerifier,
} from "../src/authentication/wechat-identity-verifier.js";
import { WeChatCredentialRejectedError } from "../src/errors.js";

const now = new Date("2030-01-01T00:00:00.000Z");
const proofExpiresAt = new Date("2030-01-01T00:05:00.000Z");
const userId = "00000000-0000-7000-8000-000000000001";
const workspaceId = "00000000-0000-7000-8000-000000000002";

const user = {
  id: userId,
  identityProvider: "password",
  providerSubject: "person@example.test",
  email: "person@example.test",
  displayName: "Person",
  username: "person",
  findByName: true,
  findByEmail: true,
  onboardedAt: now,
  locale: null,
  timeZone: null,
  hourCycle: null,
  weekStart: null,
  rail: {},
  eventTabs: {},
  workspaceRecency: {},
  createdAt: now,
  updatedAt: now,
} satisfies UserRow;

const workspace = {
  id: workspaceId,
  displayName: "Personal workspace",
  createdBy: userId,
  personalOwnerId: userId,
  createdAt: now,
  updatedAt: now,
} satisfies WorkspaceRow;

function verifier(expiresAt = proofExpiresAt) {
  const verify = vi.fn<WeChatIdentityVerifier["verify"]>(async () => ({
    provider: cloudBaseWeChatIdentityProvider,
    subject: "chronelle-test:cloud-user-1",
    expiresAt,
  }));
  return { verify };
}

function store() {
  const exchange = vi.fn<WeChatAuthStore["exchange"]>(async () => ({
    user,
    workspace,
  }));
  const link = vi.fn<WeChatAuthStore["link"]>(async () => undefined);
  return { exchange, link };
}

describe("WeChatAuthenticationService", () => {
  it("exchanges only a proof digest for an opaque Chronelle session", async () => {
    const identityVerifier = verifier();
    const authStore = store();
    const service = new WeChatAuthenticationService(
      identityVerifier,
      authStore,
      { clock: () => now, sessionTtlMs: 60_000 },
    );
    const accessToken = "cloudbase-end-user-token";

    const session = await service.exchange(
      { accessToken, deviceId: "device-1" },
      "00000000-0000-7000-8000-000000000003",
    );

    expect(identityVerifier.verify).toHaveBeenCalledWith(
      accessToken,
      "device-1",
    );
    expect(session).toMatchObject({
      user,
      workspace,
      expiresAt: new Date("2030-01-01T00:01:00.000Z"),
    });
    expect(session.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/u);
    expect(session.accessToken).not.toBe(accessToken);
    const exchanged = authStore.exchange.mock.calls[0]?.[0];
    expect(exchanged).toMatchObject({
      proofHash: hashAccessToken(accessToken),
      provider: cloudBaseWeChatIdentityProvider,
      subject: "chronelle-test:cloud-user-1",
      observedAt: now,
      proofExpiresAt,
    });
    expect(JSON.stringify(exchanged)).not.toContain(accessToken);
    expect(exchanged?.tokenHash).toBe(hashAccessToken(session.accessToken));
  });

  it("links only to the authenticated canonical user", async () => {
    const authStore = store();
    const service = new WeChatAuthenticationService(verifier(), authStore, {
      clock: () => now,
    });

    await service.link(
      userId,
      { accessToken: "cloudbase-link-token" },
      "00000000-0000-7000-8000-000000000004",
    );

    expect(authStore.link).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        proofHash: hashAccessToken("cloudbase-link-token"),
      }),
    );
  });

  it("uses the same rejection for invalid and expired proofs", async () => {
    const rejected: WeChatIdentityVerifier = {
      verify: vi.fn(async () => null),
    };
    const invalid = new WeChatAuthenticationService(rejected, store(), {
      clock: () => now,
    });
    const expired = new WeChatAuthenticationService(
      verifier(new Date(now.getTime() - 1)),
      store(),
      { clock: () => now },
    );

    await expect(
      invalid.exchange({ accessToken: "invalid-cloudbase-token" }, "request-1"),
    ).rejects.toBeInstanceOf(WeChatCredentialRejectedError);
    await expect(
      expired.exchange({ accessToken: "expired-cloudbase-token" }, "request-2"),
    ).rejects.toBeInstanceOf(WeChatCredentialRejectedError);
  });
});
