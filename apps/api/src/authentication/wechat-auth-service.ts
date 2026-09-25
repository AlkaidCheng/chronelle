import type { UserRow, WorkspaceRow } from "@livtales/db";

import { WeChatCredentialRejectedError } from "../errors.js";
import {
  createSessionMaterial,
  defaultSessionTtlMs,
  hashAccessToken,
} from "./session-auth-provider.js";
import type { WeChatAuthStore } from "./wechat-auth-store.js";
import type { WeChatIdentityVerifier } from "./wechat-identity-verifier.js";

export interface WeChatCredentialInput {
  readonly accessToken: string;
  readonly deviceId?: string | undefined;
}

export interface WeChatSession {
  readonly accessToken: string;
  readonly expiresAt: Date;
  readonly user: UserRow;
  readonly workspace: WorkspaceRow;
}

export interface WeChatAuthenticationOptions {
  readonly clock?: (() => Date) | undefined;
  readonly sessionTtlMs?: number | undefined;
}

/** Verifies CloudBase identity and exchanges it for LivTales-owned state. */
export class WeChatAuthenticationService {
  readonly #clock: () => Date;
  readonly #sessionTtlMs: number;
  readonly #store: WeChatAuthStore;
  readonly #verifier: WeChatIdentityVerifier;

  constructor(
    verifier: WeChatIdentityVerifier,
    store: WeChatAuthStore,
    options: WeChatAuthenticationOptions = {},
  ) {
    const sessionTtlMs = options.sessionTtlMs ?? defaultSessionTtlMs;
    if (!Number.isSafeInteger(sessionTtlMs) || sessionTtlMs <= 0) {
      throw new RangeError("Session TTL must be a positive integer.");
    }
    this.#clock = options.clock ?? (() => new Date());
    this.#sessionTtlMs = sessionTtlMs;
    this.#store = store;
    this.#verifier = verifier;
  }

  async exchange(
    input: WeChatCredentialInput,
    requestId: string,
  ): Promise<WeChatSession> {
    const identity = await this.#verified(input);
    const observedAt = this.#clock();
    if (identity.expiresAt.getTime() <= observedAt.getTime()) {
      throw new WeChatCredentialRejectedError();
    }
    const material = createSessionMaterial(this.#sessionTtlMs, observedAt);
    const result = await this.#store.exchange({
      ...identity,
      proofHash: hashAccessToken(input.accessToken),
      proofExpiresAt: identity.expiresAt,
      observedAt,
      tokenHash: material.tokenHash,
      sessionExpiresAt: material.expiresAt,
      requestId,
    });
    return {
      accessToken: material.accessToken,
      expiresAt: material.expiresAt,
      ...result,
    };
  }

  async link(
    userId: string,
    input: WeChatCredentialInput,
    requestId: string,
  ): Promise<void> {
    const identity = await this.#verified(input);
    const observedAt = this.#clock();
    if (identity.expiresAt.getTime() <= observedAt.getTime()) {
      throw new WeChatCredentialRejectedError();
    }
    await this.#store.link({
      ...identity,
      userId,
      proofHash: hashAccessToken(input.accessToken),
      proofExpiresAt: identity.expiresAt,
      observedAt,
      requestId,
    });
  }

  async #verified(input: WeChatCredentialInput) {
    const identity = await this.#verifier.verify(
      input.accessToken,
      input.deviceId,
    );
    if (identity === null) throw new WeChatCredentialRejectedError();
    return identity;
  }
}
