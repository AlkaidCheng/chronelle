import {
  auditEvents,
  type CloudBaseRdbClient,
  CloudBaseRpcError,
  createId,
  type Database,
  identityExchanges,
  type UserRow,
  userIdentities,
  userSessions,
  users,
  type WorkspaceRow,
  workspaces,
} from "@livtales/db";
import { and, eq, sql } from "drizzle-orm";

import { WeChatCredentialRejectedError } from "../errors.js";
import { record, userRow, workspaceRow } from "../identity/cloudbase-rows.js";

export interface WeChatProof {
  readonly provider: string;
  readonly subject: string;
  readonly proofHash: string;
  readonly proofExpiresAt: Date;
  readonly observedAt: Date;
}

export interface WeChatSessionExchange extends WeChatProof {
  readonly tokenHash: string;
  readonly sessionExpiresAt: Date;
  readonly requestId: string;
}

export interface WeChatIdentityLink extends WeChatProof {
  readonly userId: string;
  readonly requestId: string;
}

export interface WeChatExchangeResult {
  readonly user: UserRow;
  readonly workspace: WorkspaceRow;
}

export interface WeChatAuthStore {
  exchange(input: WeChatSessionExchange): Promise<WeChatExchangeResult>;
  link(input: WeChatIdentityLink): Promise<void>;
}

function validProof(input: WeChatProof): boolean {
  return (
    /^[0-9a-f]{64}$/u.test(input.proofHash) &&
    input.proofExpiresAt.getTime() > input.observedAt.getTime()
  );
}

/** PostgreSQL implementation: proof consumption, session issue, and audit are atomic. */
export class PostgresWeChatAuthStore implements WeChatAuthStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async exchange(input: WeChatSessionExchange): Promise<WeChatExchangeResult> {
    if (
      !validProof(input) ||
      input.sessionExpiresAt.getTime() <= input.observedAt.getTime()
    ) {
      throw new WeChatCredentialRejectedError();
    }
    return this.#database.transaction(async (transaction) => {
      const [account] = await transaction
        .select({ user: users })
        .from(userIdentities)
        .innerJoin(users, eq(users.id, userIdentities.userId))
        .where(
          and(
            eq(userIdentities.provider, input.provider),
            eq(userIdentities.subject, input.subject),
          ),
        )
        .limit(1);
      if (account === undefined) throw new WeChatCredentialRejectedError();

      const [consumed] = await transaction
        .insert(identityExchanges)
        .values({
          id: createId(),
          userId: account.user.id,
          provider: input.provider,
          proofHash: input.proofHash,
          purpose: "sign_in",
          consumedAt: input.observedAt,
          expiresAt: input.proofExpiresAt,
        })
        .onConflictDoNothing({
          target: [identityExchanges.provider, identityExchanges.proofHash],
        })
        .returning({ id: identityExchanges.id });
      if (consumed === undefined) throw new WeChatCredentialRejectedError();

      const [workspace] = await transaction
        .select()
        .from(workspaces)
        .where(eq(workspaces.personalOwnerId, account.user.id))
        .limit(1);
      if (workspace === undefined) throw new WeChatCredentialRejectedError();
      const sessionId = createId();
      await transaction.insert(userSessions).values({
        id: sessionId,
        userId: account.user.id,
        tokenHash: input.tokenHash,
        identityProvider: input.provider,
        expiresAt: input.sessionExpiresAt,
      });
      await transaction
        .update(userIdentities)
        .set({
          lastUsedAt: sql`GREATEST(${input.observedAt.toISOString()}::timestamptz, ${userIdentities.createdAt})`,
        })
        .where(
          and(
            eq(userIdentities.userId, account.user.id),
            eq(userIdentities.provider, input.provider),
            eq(userIdentities.subject, input.subject),
          ),
        );
      await transaction.insert(auditEvents).values({
        id: createId(),
        workspaceId: workspace.id,
        actorType: "user",
        actorId: account.user.id,
        action: "identity.wechat_signed_in",
        resourceId: null,
        requestId: input.requestId,
        metadata: { identityProvider: input.provider, sessionId },
      });
      return { user: account.user, workspace };
    });
  }

  async link(input: WeChatIdentityLink): Promise<void> {
    if (!validProof(input)) throw new WeChatCredentialRejectedError();
    await this.#database.transaction(async (transaction) => {
      const [workspace] = await transaction
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.personalOwnerId, input.userId))
        .limit(1);
      if (workspace === undefined) throw new WeChatCredentialRejectedError();

      const [consumed] = await transaction
        .insert(identityExchanges)
        .values({
          id: createId(),
          userId: input.userId,
          provider: input.provider,
          proofHash: input.proofHash,
          purpose: "link",
          consumedAt: input.observedAt,
          expiresAt: input.proofExpiresAt,
        })
        .onConflictDoNothing({
          target: [identityExchanges.provider, identityExchanges.proofHash],
        })
        .returning({ id: identityExchanges.id });
      if (consumed === undefined) throw new WeChatCredentialRejectedError();

      await transaction
        .insert(userIdentities)
        .values({
          id: createId(),
          userId: input.userId,
          provider: input.provider,
          subject: input.subject,
          lastUsedAt: input.observedAt,
        })
        .onConflictDoNothing();
      const [identityOwner] = await transaction
        .select({ userId: userIdentities.userId })
        .from(userIdentities)
        .where(
          and(
            eq(userIdentities.provider, input.provider),
            eq(userIdentities.subject, input.subject),
          ),
        )
        .limit(1);
      const [providerIdentity] = await transaction
        .select({ subject: userIdentities.subject })
        .from(userIdentities)
        .where(
          and(
            eq(userIdentities.userId, input.userId),
            eq(userIdentities.provider, input.provider),
          ),
        )
        .limit(1);
      if (
        identityOwner?.userId !== input.userId ||
        providerIdentity?.subject !== input.subject
      ) {
        throw new WeChatCredentialRejectedError();
      }
      await transaction
        .update(userIdentities)
        .set({
          lastUsedAt: sql`GREATEST(${input.observedAt.toISOString()}::timestamptz, ${userIdentities.createdAt})`,
        })
        .where(
          and(
            eq(userIdentities.provider, input.provider),
            eq(userIdentities.subject, input.subject),
          ),
        );
      await transaction.insert(auditEvents).values({
        id: createId(),
        workspaceId: workspace.id,
        actorType: "user",
        actorId: input.userId,
        action: "identity.linked",
        resourceId: null,
        requestId: input.requestId,
        metadata: { identityProvider: input.provider },
      });
    });
  }
}

function cloudBaseFailure(error: unknown): Error {
  if (error instanceof CloudBaseRpcError && error.status < 500) {
    return new WeChatCredentialRejectedError();
  }
  return error instanceof Error ? error : new Error(String(error));
}

/** CloudBase gateway implementation backed by the migration's atomic RPCs. */
export class CloudBaseWeChatAuthStore implements WeChatAuthStore {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async exchange(input: WeChatSessionExchange): Promise<WeChatExchangeResult> {
    let value: unknown;
    try {
      value = await this.#client.rpc("chronelle_wechat_exchange", {
        identity_provider: input.provider,
        provider_subject: input.subject,
        proof_hash: input.proofHash,
        proof_expires_at: input.proofExpiresAt.toISOString(),
        session_token_hash: input.tokenHash,
        session_expires_at: input.sessionExpiresAt.toISOString(),
        observed_at: input.observedAt.toISOString(),
        request_id: input.requestId,
      });
    } catch (error) {
      throw cloudBaseFailure(error);
    }
    const result = record(value, "WeChat exchange");
    return {
      user: userRow(record(result.user, "user")),
      workspace: workspaceRow(record(result.workspace, "workspace")),
    };
  }

  async link(input: WeChatIdentityLink): Promise<void> {
    try {
      const linked = await this.#client.rpc("chronelle_wechat_identity_link", {
        user_id: input.userId,
        identity_provider: input.provider,
        provider_subject: input.subject,
        proof_hash: input.proofHash,
        proof_expires_at: input.proofExpiresAt.toISOString(),
        observed_at: input.observedAt.toISOString(),
        request_id: input.requestId,
      });
      if (linked !== true)
        throw new Error("CloudBase did not link the identity.");
    } catch (error) {
      throw cloudBaseFailure(error);
    }
  }
}
