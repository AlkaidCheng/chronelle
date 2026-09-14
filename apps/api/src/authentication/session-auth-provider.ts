import { createHash, randomBytes } from "node:crypto";

import type { UserRow } from "@chronelle/db";

import type { AuthIdentity, AuthProvider } from "./auth-provider.js";
import type { SessionStore } from "./session-store.js";

/** Fourteen days. */
export const defaultSessionTtlMs = 14 * 24 * 60 * 60 * 1_000;

/** The credential a sign-in hands to the client. */
export interface IssuedSession {
  readonly accessToken: string;
  readonly expiresAt: Date;
}

export interface SessionAuthProviderOptions {
  readonly sessionTtlMs?: number | undefined;
  readonly clock?: (() => Date) | undefined;
}

/** The SHA-256 hex digest under which a token is stored and looked up. */
export function hashAccessToken(accessToken: string): string {
  return createHash("sha256").update(accessToken).digest("hex");
}

/**
 * Bearer credentials backed by the session store: issue creates a session
 * for a signed-in user and returns the random opaque token, authenticate
 * resolves a token to the identity of the user whose live session carries
 * its digest, and revoke and revokeAll end sessions. The token itself is
 * never stored.
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
    const accessToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.#clock().getTime() + this.#sessionTtlMs);
    await this.#store.create({
      userId: user.id,
      tokenHash: hashAccessToken(accessToken),
      identityProvider,
      expiresAt,
    });
    return { accessToken, expiresAt };
  }

  async authenticate(accessToken: string): Promise<AuthIdentity | null> {
    const resolved = await this.#store.resolve(
      hashAccessToken(accessToken),
      this.#clock(),
    );
    if (resolved === null) return null;
    return {
      provider: resolved.user.identityProvider,
      subject: resolved.user.providerSubject,
      email: resolved.user.email,
      displayName: resolved.user.displayName,
    };
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
