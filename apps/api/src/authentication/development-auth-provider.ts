import { createHash, randomBytes } from "node:crypto";

import type { DevelopmentSignInRequest } from "@chronelle/schemas";

import type { AuthIdentity, AuthProvider } from "./auth-provider.js";

const defaultSessionTtlMs = 12 * 60 * 60 * 1_000;

interface DevelopmentSession {
  readonly expiresAt: Date;
  readonly identity: AuthIdentity;
}

export interface IssuedDevelopmentCredential extends DevelopmentSession {
  readonly accessToken: string;
}

export class DevelopmentAuthProvider implements AuthProvider {
  readonly #clock: () => Date;
  readonly #sessionTtlMs: number;
  readonly #sessions = new Map<string, DevelopmentSession>();

  constructor(
    sessionTtlMs = defaultSessionTtlMs,
    clock: () => Date = () => new Date(),
  ) {
    if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs <= 0) {
      throw new RangeError(
        "Development session TTL must be a positive integer.",
      );
    }
    this.#sessionTtlMs = sessionTtlMs;
    this.#clock = clock;
  }

  issueCredential(
    input: DevelopmentSignInRequest,
  ): IssuedDevelopmentCredential {
    const issuedAt = this.#clock();
    const expiresAt = new Date(issuedAt.getTime() + this.#sessionTtlMs);
    const accessToken = randomBytes(32).toString("base64url");
    const identity: AuthIdentity = {
      displayName: input.displayName,
      email: input.email,
      provider: "development",
      subject: input.email,
    };

    this.#pruneExpiredSessions(issuedAt);
    this.#sessions.set(this.#digest(accessToken), { expiresAt, identity });

    return { accessToken, expiresAt, identity };
  }

  async authenticate(accessToken: string): Promise<AuthIdentity | null> {
    const evaluatedAt = this.#clock();
    const tokenDigest = this.#digest(accessToken);
    const session = this.#sessions.get(tokenDigest);

    if (session === undefined || session.expiresAt <= evaluatedAt) {
      this.#sessions.delete(tokenDigest);
      return null;
    }

    return session.identity;
  }

  revoke(accessToken: string): void {
    this.#sessions.delete(this.#digest(accessToken));
  }

  #digest(accessToken: string): string {
    return createHash("sha256").update(accessToken).digest("hex");
  }

  #pruneExpiredSessions(evaluatedAt: Date): void {
    for (const [tokenDigest, session] of this.#sessions) {
      if (session.expiresAt <= evaluatedAt) {
        this.#sessions.delete(tokenDigest);
      }
    }
  }
}
