import { CloudBaseRpcError } from "@chronelle/db";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceUnavailableError } from "../src/errors.js";
import { CloudBaseIdentityStore } from "../src/identity/cloudbase-identity-store.js";

const observedAt = new Date("2030-08-01T12:00:00.000Z");
const identity = {
  provider: "test",
  subject: "person",
  email: null,
  displayName: "Person",
};

describe("CloudBase identity session boundary", () => {
  it("resolves through one RPC without table reads", async () => {
    const rpc = vi.fn().mockResolvedValue(null);
    const select = vi.fn();
    const store = new CloudBaseIdentityStore({ rpc, select }, () => observedAt);

    await expect(store.resolveSession(identity, undefined)).resolves.toBeNull();
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "chronelle_identity_session_resolve",
      {
        identity_provider: "test",
        provider_subject: "person",
        requested_workspace_id: null,
        object_id: null,
        observed_at: observedAt.toISOString(),
      },
    );
    expect(select).not.toHaveBeenCalled();
  });

  it("preserves unavailable-workspace errors and forwards routing identifiers", async () => {
    const rpc = vi
      .fn()
      .mockRejectedValue(
        new CloudBaseRpcError(404, "DATABASE_PT404", "missing"),
      );
    const store = new CloudBaseIdentityStore({ rpc, select: vi.fn() });
    const workspaceId = "00000000-0000-7000-8000-000000000001";
    const objectId = "00000000-0000-7000-8000-000000000002";

    await expect(
      store.resolveSession(identity, workspaceId, objectId),
    ).rejects.toBeInstanceOf(WorkspaceUnavailableError);
    expect(rpc).toHaveBeenCalledWith(
      "chronelle_identity_session_resolve",
      expect.objectContaining({
        requested_workspace_id: workspaceId,
        object_id: objectId,
      }),
    );
  });

  it.each([
    [503, "unavailable"],
    [404, "PGRST202"],
  ] as const)(
    "does not turn transport failure %s/%s into an authorization result",
    async (status, code) => {
      const failure = new CloudBaseRpcError(status, code, "unavailable");
      const rpc = vi.fn().mockRejectedValue(failure);
      const store = new CloudBaseIdentityStore({ rpc, select: vi.fn() });

      await expect(store.resolveSession(identity, undefined)).rejects.toBe(
        failure,
      );
    },
  );

  it("rejects a malformed result instead of treating it as an absent user", async () => {
    const rpc = vi.fn().mockResolvedValue(undefined);
    const store = new CloudBaseIdentityStore({ rpc, select: vi.fn() });

    await expect(store.resolveSession(identity, undefined)).rejects.toThrow(
      "CloudBase returned an invalid identity session.",
    );
  });
});
