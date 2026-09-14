import {
  CloudBaseRpcError,
  type CloudBaseRdbClient,
  type UserSessionRow,
} from "@chronelle/db";

import { record, userRow, userSessionRow } from "../identity/cloudbase-rows.js";
import {
  defaultSessionTouchIntervalMs,
  type NewSession,
  type ResolvedSession,
  type SessionStore,
  type SessionStoreOptions,
} from "./session-store.js";

/**
 * Session persistence through the gateway: chronelle_session_create,
 * chronelle_session_resolve, chronelle_session_revoke, and
 * chronelle_sessions_revoke_all, with the PostgreSQL store's semantics.
 */
export class CloudBaseSessionStore implements SessionStore {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;
  readonly #touchIntervalMs: number;

  constructor(
    client: Pick<CloudBaseRdbClient, "rpc">,
    options: SessionStoreOptions = {},
  ) {
    this.#client = client;
    this.#touchIntervalMs =
      options.touchIntervalMs ?? defaultSessionTouchIntervalMs;
  }

  async create(input: NewSession): Promise<UserSessionRow> {
    const created = await this.#call("chronelle_session_create", {
      user_id: input.userId,
      token_hash: input.tokenHash,
      identity_provider: input.identityProvider,
      expires_at: input.expiresAt.toISOString(),
    });
    return userSessionRow(record(created, "session"));
  }

  async resolve(
    tokenHash: string,
    observedAt: Date,
  ): Promise<ResolvedSession | null> {
    const resolved = await this.#call("chronelle_session_resolve", {
      token_hash: tokenHash,
      observed_at: observedAt.toISOString(),
      touch_after_seconds: Math.ceil(this.#touchIntervalMs / 1_000),
    });
    if (resolved === null || resolved === undefined) return null;
    const row = record(resolved, "session result");
    return {
      session: userSessionRow(record(row.session, "session")),
      user: userRow(record(row.user, "user")),
    };
  }

  async revoke(
    tokenHash: string,
    revokedAt: Date,
    requestId: string,
  ): Promise<boolean> {
    const result = await this.#call("chronelle_session_revoke", {
      token_hash: tokenHash,
      revoked_at: revokedAt.toISOString(),
      request_id: requestId,
    });
    return record(result, "revocation result").revoked === true;
  }

  async revokeAll(
    userId: string,
    revokedAt: Date,
    requestId: string,
  ): Promise<number> {
    const result = await this.#call("chronelle_sessions_revoke_all", {
      user_id: userId,
      revoked_at: revokedAt.toISOString(),
      request_id: requestId,
    });
    const revoked = record(result, "revocation result").revoked;
    if (typeof revoked !== "number" || !Number.isInteger(revoked))
      throw new Error("CloudBase returned an invalid revocation count.");
    return revoked;
  }

  async #call(
    functionName: string,
    parameters: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.#client.rpc(functionName, parameters);
    } catch (error) {
      if (error instanceof CloudBaseRpcError)
        throw new Error(`Session persistence failed: ${error.message}`);
      throw error;
    }
  }
}
