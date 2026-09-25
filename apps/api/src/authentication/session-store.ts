import {
  auditEvents,
  createId,
  type Database,
  type DatabaseTransaction,
  type UserRow,
  type UserSessionRow,
  userSessions,
  users,
  workspaces,
} from "@livtales/db";
import { and, eq, gt, isNull, sql } from "drizzle-orm";

/** The fields a new session is recorded with. */
export interface NewSession {
  readonly userId: string;
  readonly tokenHash: string;
  readonly identityProvider: string;
  readonly expiresAt: Date;
}

/** A live session and the user it belongs to. */
export interface ResolvedSession {
  readonly session: UserSessionRow;
  readonly user: UserRow;
}

/**
 * Session persistence: create records a session for an existing user;
 * resolve returns the live session carrying a token digest (not expired at
 * the observed time, not revoked) with its user, advancing last_seen_at
 * once it is older than the touch interval; revoke ends the live session
 * carrying a digest and revokeAll ends every live session of a user, each
 * recording session.revoked in the user's personal workspace when anything
 * was revoked.
 */
export interface SessionStore {
  create(input: NewSession): Promise<UserSessionRow>;
  resolve(tokenHash: string, observedAt: Date): Promise<ResolvedSession | null>;
  revoke(
    tokenHash: string,
    revokedAt: Date,
    requestId: string,
  ): Promise<boolean>;
  revokeAll(
    userId: string,
    revokedAt: Date,
    requestId: string,
  ): Promise<number>;
}

/** last_seen_at is rewritten at most this often for a busy session. */
export const defaultSessionTouchIntervalMs = 5 * 60 * 1_000;

export interface SessionStoreOptions {
  readonly touchIntervalMs?: number | undefined;
}

export class PostgresSessionStore implements SessionStore {
  readonly #database: Database;
  readonly #touchIntervalMs: number;

  constructor(database: Database, options: SessionStoreOptions = {}) {
    this.#database = database;
    this.#touchIntervalMs =
      options.touchIntervalMs ?? defaultSessionTouchIntervalMs;
  }

  async create(input: NewSession): Promise<UserSessionRow> {
    return this.#database.transaction(async (transaction) => {
      const [owner] = await transaction
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, input.userId))
        .limit(1);
      if (owner === undefined) {
        throw new Error("The user does not exist.");
      }
      const [created] = await transaction
        .insert(userSessions)
        .values({
          id: createId(),
          userId: input.userId,
          tokenHash: input.tokenHash,
          identityProvider: input.identityProvider,
          expiresAt: input.expiresAt,
        })
        .returning();
      if (created === undefined) {
        throw new Error("Session persistence did not return a session.");
      }
      return created;
    });
  }

  async resolve(
    tokenHash: string,
    observedAt: Date,
  ): Promise<ResolvedSession | null> {
    return this.#database.transaction(async (transaction) => {
      const [found] = await transaction
        .select()
        .from(userSessions)
        .where(
          and(
            eq(userSessions.tokenHash, tokenHash),
            isNull(userSessions.revokedAt),
            gt(userSessions.expiresAt, observedAt),
          ),
        )
        .limit(1);
      if (found === undefined) return null;

      let session = found;
      if (
        found.lastSeenAt.getTime() + this.#touchIntervalMs <=
        observedAt.getTime()
      ) {
        const [touched] = await transaction
          .update(userSessions)
          .set({ lastSeenAt: observedAt })
          .where(eq(userSessions.id, found.id))
          .returning();
        session = touched ?? found;
      }
      const [owner] = await transaction
        .select()
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);
      if (owner === undefined) {
        throw new Error("Session persistence did not return a user.");
      }
      return { session, user: owner };
    });
  }

  async revoke(
    tokenHash: string,
    revokedAt: Date,
    requestId: string,
  ): Promise<boolean> {
    return this.#database.transaction(async (transaction) => {
      const [revoked] = await transaction
        .update(userSessions)
        .set({ revokedAt: clampedToCreation(revokedAt) })
        .where(
          and(
            eq(userSessions.tokenHash, tokenHash),
            isNull(userSessions.revokedAt),
            gt(userSessions.expiresAt, revokedAt),
          ),
        )
        .returning();
      if (revoked === undefined) return false;
      await recordRevocation(transaction, revoked.userId, requestId, {
        sessionId: revoked.id,
        scope: "current",
      });
      return true;
    });
  }

  async revokeAll(
    userId: string,
    revokedAt: Date,
    requestId: string,
  ): Promise<number> {
    return this.#database.transaction(async (transaction) => {
      const revoked = await transaction
        .update(userSessions)
        .set({ revokedAt: clampedToCreation(revokedAt) })
        .where(
          and(
            eq(userSessions.userId, userId),
            isNull(userSessions.revokedAt),
            gt(userSessions.expiresAt, revokedAt),
          ),
        )
        .returning({ id: userSessions.id });
      if (revoked.length > 0) {
        await recordRevocation(transaction, userId, requestId, {
          scope: "all",
          count: revoked.length,
        });
      }
      return revoked.length;
    });
  }
}

/**
 * A revocation instant earlier than the session's creation (an API clock
 * slightly behind the database's) is recorded as the creation instant.
 */
function clampedToCreation(revokedAt: Date) {
  return sql`GREATEST(${revokedAt.toISOString()}::timestamptz, ${userSessions.createdAt})`;
}

/** session.revoked in the user's personal workspace; nothing when the user has none. */
async function recordRevocation(
  transaction: DatabaseTransaction,
  userId: string,
  requestId: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const [personal] = await transaction
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.personalOwnerId, userId))
    .limit(1);
  if (personal === undefined) return;
  await transaction.insert(auditEvents).values({
    id: createId(),
    workspaceId: personal.id,
    actorType: "user",
    actorId: userId,
    action: "session.revoked",
    resourceId: null,
    requestId,
    metadata,
  });
}
