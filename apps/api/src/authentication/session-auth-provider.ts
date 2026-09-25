import { createHash, randomBytes } from "node:crypto";

import type { UserRow } from "@livtales/db";

import type { AuthenticatedUser, AuthProvider } from "./auth-provider.js";
import type { SessionStore } from "./session-store.js";

/** Fourteen days. */
export const defaultSessionTtlMs = 14 * 24 * 60 * 60 * 1_000;

/** The credential a sign-in hands to the client. */
export interface IssuedSession {
  readonly accessToken: string;
  readonly expiresAt: Date;
}

/** The public credential and its stored representation before persistence. */
export interface SessionMaterial extends IssuedSession {
  readonly tokenHash: string;
}

export interface SessionAuthProviderOptions {
  readonly sessionTtlMs?: number | undefined;
  readonly clock?: (() => Date) | undefined;
}

/** The SHA-256 hex digest under which a token is stored and looked up. */
export function hashAccessToken(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

export function createSessionMaterial(
  sessionTtlMs: number,
  now: Date,
): SessionMaterial {
  if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs <= 0) {
    throw new RangeError("Session TTL must be a positive integer.");
  }
  const accessToken = randomBytes(32).toString("base64url");
  return {
    accessToken,
    tokenHash: hashAccessToken(accessToken),
    expiresAt: new Date(now.getTime() + sessionTtlMs),
  };
}

/**
 * Bearer credentials backed by the session store: issue creates a session
 * for a signed-in user and returns the random opaque token, authenticate
 * resolves a token to the canonical user whose live session carries its
 * digest, and revoke and revokeAll end sessions. The token itself is never
 * stored.
 */
export class SessionAuthProvider implements AuthProvider {
  readonly #store: SessionStore;
  readonly #sessionTtlMs: number;
  readonly #clock: () => Date;

  constructor(store: SessionStore, options: SessionAuthProviderOptions = {}) {
    const sessionTtlMs = options.sessionTtlMs ?? defaultSessionTtlMs;
    if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs <= 0) {
      throw new RangeError("Session TTL must be a positive integer.");
    }
    this.#store = store;
    this.#sessionTtlMs = sessionTtlMs;
    this.#clock = options.clock ?? (() => new Date());
  }

  async issue(user: UserRow, identityProvider: string): Promise<IssuedSession> {
    const material = createSessionMaterial(this.#sessionTtlMs, this.#clock());
    await this.#store.create({
      userId: user.id,
      tokenHash: material.tokenHash,
      identityProvider,
      expiresAt: material.expiresAt,
    });
    return {
      accessToken: material.accessToken,
      expiresAt: material.expiresAt,
    };
  }

  async authenticate(accessToken: string): Promise<AuthenticatedUser | null> {
    const resolved = await this.#store.resolve(
      hashAccessToken(accessToken),
      this.#clock(),
    );
    if (resolved === null) return null;
    return { userId: resolved.user.id };
  }

  revoke(accessToken: string, requestId: string): Promise<boolean> {
    return this.#store.revoke(
      hashAccessToken(accessToken),
      this.#clock(),
      requestId,
    );
  }

  revokeAll(userId: string, requestId: string): Promise<number> {
    return this.#store.revokeAll(userId, this.#clock(), requestId);
  }
}
