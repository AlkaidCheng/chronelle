import { CloudBaseRpcError } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";
import { CloudBaseWeChatAuthStore } from "../src/authentication/wechat-auth-store.js";
import { WeChatCredentialRejectedError } from "../src/errors.js";

const observedAt = new Date("2030-01-01T00:00:00.000Z");
const proofExpiresAt = new Date("2030-01-01T00:05:00.000Z");
const sessionExpiresAt = new Date("2030-01-15T00:00:00.000Z");
const userId = "00000000-0000-7000-8000-000000000001";
const workspaceId = "00000000-0000-7000-8000-000000000002";
const requestId = "00000000-0000-7000-8000-000000000003";

const user = {
  id: userId,
  identity_provider: "password",
  provider_subject: "person@example.test",
  email: "person@example.test",
  display_name: "Person",
  username: "person",
  find_by_name: true,
  find_by_email: true,
  onboarded_at: observedAt.toISOString(),
  locale: null,
  time_zone: null,
  hour_cycle: null,
  week_start: null,
  rail: {},
  event_tabs: {},
  workspace_recency: {},
  created_at: observedAt.toISOString(),
  updated_at: observedAt.toISOString(),
};

const workspace = {
  id: workspaceId,
  display_name: "Personal workspace",
  created_by: userId,
  personal_owner_id: userId,
  created_at: observedAt.toISOString(),
  updated_at: observedAt.toISOString(),
};

describe("CloudBaseWeChatAuthStore", () => {
  it("maps session exchange to one atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ user, workspace });
    const store = new CloudBaseWeChatAuthStore({ rpc });

    await expect(
      store.exchange({
        provider: "cloudbase-wechat",
        subject: "chronelle-test:cloud-user-1",
        proofHash: "a".repeat(64),
        proofExpiresAt,
        observedAt,
        tokenHash: "b".repeat(64),
        sessionExpiresAt,
        requestId,
      }),
    ).resolves.toMatchObject({
      user: { id: userId },
      workspace: { id: workspaceId },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("chronelle_wechat_exchange", {
      identity_provider: "cloudbase-wechat",
      provider_subject: "chronelle-test:cloud-user-1",
      proof_hash: "a".repeat(64),
      proof_expires_at: proofExpiresAt.toISOString(),
      session_token_hash: "b".repeat(64),
      session_expires_at: sessionExpiresAt.toISOString(),
      observed_at: observedAt.toISOString(),
      request_id: requestId,
    });
  });

  it("maps explicit linking to one atomic RPC", async () => {
    const rpc = vi.fn().mockResolvedValue(true);
    const store = new CloudBaseWeChatAuthStore({ rpc });

    await expect(
      store.link({
        userId,
        provider: "cloudbase-wechat",
        subject: "chronelle-test:cloud-user-1",
        proofHash: "c".repeat(64),
        proofExpiresAt,
        observedAt,
        requestId,
      }),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "chronelle_wechat_identity_link",
      {
        user_id: userId,
        identity_provider: "cloudbase-wechat",
        provider_subject: "chronelle-test:cloud-user-1",
        proof_hash: "c".repeat(64),
        proof_expires_at: proofExpiresAt.toISOString(),
        observed_at: observedAt.toISOString(),
        request_id: requestId,
      },
    );
  });

  it("does not disclose credential failures and preserves provider outages", async () => {
    const rejected = new CloudBaseWeChatAuthStore({
      rpc: vi
        .fn()
        .mockRejectedValue(
          new CloudBaseRpcError(401, "DATABASE_PT401", "unavailable"),
        ),
    });
    const unavailable = new CloudBaseRpcError(
      503,
      "DATABASE_UNAVAILABLE",
      "unavailable",
    );
    const failed = new CloudBaseWeChatAuthStore({
      rpc: vi.fn().mockRejectedValue(unavailable),
    });
    const input = {
      provider: "cloudbase-wechat",
      subject: "chronelle-test:cloud-user-1",
      proofHash: "d".repeat(64),
      proofExpiresAt,
      observedAt,
      tokenHash: "e".repeat(64),
      sessionExpiresAt,
      requestId,
    };

    await expect(rejected.exchange(input)).rejects.toBeInstanceOf(
      WeChatCredentialRejectedError,
    );
    await expect(failed.exchange(input)).rejects.toBe(unavailable);
  });
});
