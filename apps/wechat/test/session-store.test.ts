import { describe, expect, it, vi } from "vitest";

import {
  type TaroStorage,
  WeChatSessionStore,
  weChatSessionStorageKey,
} from "../src/auth/session-store";

const now = new Date("2030-01-01T00:00:00.000Z");
const workspaceId = "00000000-0000-7000-8000-000000000001";

function storageDouble(initial?: unknown): TaroStorage & {
  readonly values: Map<string, unknown>;
} {
  const values = new Map<string, unknown>();
  if (initial !== undefined) values.set(weChatSessionStorageKey, initial);
  return {
    values,
    getStorage: vi.fn(async ({ key }) => {
      if (!values.has(key)) throw new Error("missing");
      return { data: values.get(key) };
    }),
    setStorage: vi.fn(async ({ key, data }) => {
      values.set(key, data);
    }),
    removeStorage: vi.fn(async ({ key }) => {
      values.delete(key);
    }),
  };
}

describe("WeChatSessionStore", () => {
  it("persists and restores only the opaque Chronelle session", async () => {
    const storage = storageDouble();
    const sessions = new WeChatSessionStore(storage, () => now);

    await sessions.save({
      accessToken: "opaque-chronelle-session",
      expiresAt: "2030-01-02T00:00:00.000Z",
      workspace: { id: workspaceId },
    });

    expect(storage.values.get(weChatSessionStorageKey)).toEqual({
      accessToken: "opaque-chronelle-session",
      expiresAt: "2030-01-02T00:00:00.000Z",
      workspaceId,
    });
    expect(await new WeChatSessionStore(storage, () => now).restore()).toEqual({
      accessToken: "opaque-chronelle-session",
      workspaceId,
    });
  });

  it.each([
    [
      "expired",
      {
        accessToken: "opaque-chronelle-session",
        expiresAt: now.toISOString(),
        workspaceId,
      },
    ],
    ["malformed", { accessToken: "opaque-chronelle-session" }],
  ])("clears %s persisted state", async (_label, initial) => {
    const storage = storageDouble(initial);
    const sessions = new WeChatSessionStore(storage, () => now);

    await expect(sessions.restore()).resolves.toBeNull();
    expect(storage.values.has(weChatSessionStorageKey)).toBe(false);
    expect(sessions.getCredential()).toBeNull();
  });

  it("clears local state even when remote revocation fails", async () => {
    const storage = storageDouble();
    const sessions = new WeChatSessionStore(storage, () => now);
    await sessions.save({
      accessToken: "opaque-chronelle-session",
      expiresAt: "2030-01-02T00:00:00.000Z",
      workspace: { id: workspaceId },
    });
    const revoker = {
      signOut: vi.fn(async () => {
        throw new Error("network unavailable");
      }),
      signOutEverywhere: vi.fn(async () => ({ revoked: 1 })),
    };

    await expect(sessions.signOut(revoker)).rejects.toThrow(
      "network unavailable",
    );
    expect(sessions.getCredential()).toBeNull();
    expect(storage.values.has(weChatSessionStorageKey)).toBe(false);
    expect(revoker.signOutEverywhere).not.toHaveBeenCalled();
  });

  it("revokes every session when requested", async () => {
    const sessions = new WeChatSessionStore(storageDouble(), () => now);
    const revoker = {
      signOut: vi.fn(async () => ({ revoked: 1 })),
      signOutEverywhere: vi.fn(async () => ({ revoked: 2 })),
    };

    await sessions.signOut(revoker, true);

    expect(revoker.signOutEverywhere).toHaveBeenCalledOnce();
    expect(revoker.signOut).not.toHaveBeenCalled();
  });

  it("surfaces a persistent-storage cleanup failure after clearing memory", async () => {
    const storage = storageDouble();
    storage.removeStorage = vi.fn(async () => {
      throw new Error("storage unavailable");
    });
    const sessions = new WeChatSessionStore(storage, () => now);
    await sessions.save({
      accessToken: "opaque-chronelle-session",
      expiresAt: "2030-01-02T00:00:00.000Z",
      workspace: { id: workspaceId },
    });

    await expect(sessions.clear()).rejects.toThrow("storage unavailable");
    expect(sessions.getCredential()).toBeNull();
  });
});
