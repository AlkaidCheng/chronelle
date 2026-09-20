import type { UserRow, UserSessionRow } from "@chronelle/db";
import { describe, expect, it, vi } from "vitest";

import {
  hashAccessToken,
  SessionAuthProvider,
} from "../src/authentication/session-auth-provider.js";
import type {
  NewSession,
  SessionStore,
} from "../src/authentication/session-store.js";

const now = new Date("2030-01-01T00:00:00.000Z");

const user: UserRow = {
  id: "00000000-0000-7000-8000-000000000001",
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
};

function sessionRow(input: NewSession): UserSessionRow {
  return {
    id: "00000000-0000-7000-8000-000000000002",
    userId: input.userId,
    tokenHash: input.tokenHash,
    identityProvider: input.identityProvider,
    createdAt: now,
    expiresAt: input.expiresAt,
    lastSeenAt: now,
    revokedAt: null,
  };
}

function storeDouble(): SessionStore & {
  readonly created: NewSession[];
} {
  const created: NewSession[] = [];
  return {
    created,
    create: vi.fn(async (input: NewSession) => {
      created.push(input);
      return sessionRow(input);
    }),
    resolve: vi.fn(async (tokenHash: string) => {
      const match = created.find((entry) => entry.tokenHash === tokenHash);
      return match === undefined ? null : { session: sessionRow(match), user };
    }),
    revoke: vi.fn(async () => true),
    revokeAll: vi.fn(async () => 2),
  };
}

describe("SessionAuthProvider", () => {
  it("issues an opaque token and stores only its digest with the expiry", async () => {
    const store = storeDouble();
    const provider = new SessionAuthProvider(store, {
      sessionTtlMs: 60_000,
      clock: () => now,
    });

    const issued = await provider.issue(user, "password");

    expect(issued.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(issued.expiresAt.toISOString()).toBe("2030-01-01T00:01:00.000Z");
    expect(store.created).toEqual([
      {
        userId: user.id,
        tokenHash: hashAccessToken(issued.accessToken),
        identityProvider: "password",
        expiresAt: issued.expiresAt,
      },
    ]);
    expect(JSON.stringify(store.created)).not.toContain(issued.accessToken);
  });

  it("issues a different token each time", async () => {
    const store = storeDouble();
    const provider = new SessionAuthProvider(store, { clock: () => now });

    const first = await provider.issue(user, "password");
    const second = await provider.issue(user, "password");

    expect(first.accessToken).not.toBe(second.accessToken);
  });

  it("authenticates a token to the identity of the session's user", async () => {
    const store = storeDouble();
    const provider = new SessionAuthProvider(store, { clock: () => now });
    const issued = await provider.issue(user, "password");

    await expect(provider.authenticate(issued.accessToken)).resolves.toEqual({
      provider: "password",
      subject: "person@example.test",
      email: "person@example.test",
      displayName: "Person",
    });
    expect(store.resolve).toHaveBeenCalledWith(
      hashAccessToken(issued.accessToken),
      now,
    );
  });

  it("rejects a token without a live session", async () => {
    const store = storeDouble();
    const provider = new SessionAuthProvider(store, { clock: () => now });

    await expect(provider.authenticate("unknown")).resolves.toBeNull();
  });

  it("revokes by digest and forwards the revoke-all count", async () => {
    const store = storeDouble();
    const provider = new SessionAuthProvider(store, { clock: () => now });
    const requestId = "00000000-0000-7000-8000-000000000009";

    await expect(provider.revoke("token", requestId)).resolves.toBe(true);
    expect(store.revoke).toHaveBeenCalledWith(
      hashAccessToken("token"),
      now,
      requestId,
    );
    await expect(provider.revokeAll(user.id, requestId)).resolves.toBe(2);
    expect(store.revokeAll).toHaveBeenCalledWith(user.id, now, requestId);
  });

  it("refuses a non-positive session TTL", () => {
    expect(
      () => new SessionAuthProvider(storeDouble(), { sessionTtlMs: 0 }),
    ).toThrow(RangeError);
  });
});
