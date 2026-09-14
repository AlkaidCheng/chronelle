import { resolve } from "node:path";

import { auditEvents, createId, users, workspaces } from "@chronelle/db";
import {
  applyMigrations,
  createCloudBaseRpcDouble,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseSessionStore } from "../src/authentication/cloudbase-session-store.js";
import { hashAccessToken } from "../src/authentication/session-auth-provider.js";
import {
  PostgresSessionStore,
  type SessionStore,
} from "../src/authentication/session-store.js";

// The chronelle_session_* functions must leave and return what the
// PostgreSQL session store leaves and returns: the session row, the
// live-session rules of resolve (expiry, revocation, the throttled
// last_seen_at), and the revocation counts with their audit events.

let database: TestDatabase;
let reference: SessionStore;
let cloudbase: SessionStore;

const touchIntervalMs = 5 * 60 * 1_000;
const issuedAt = new Date("2030-08-01T12:00:00.000Z");
const expiresAt = new Date("2030-08-15T12:00:00.000Z");

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  reference = new PostgresSessionStore(database.connection.db, {
    touchIntervalMs,
  });
  cloudbase = new CloudBaseSessionStore(
    { rpc: createCloudBaseRpcDouble(database.connection.sql) },
    { touchIntervalMs },
  );
});

afterAll(async () => {
  await database?.close();
});

const backends = () =>
  [
    ["postgres", reference],
    ["cloudbase", cloudbase],
  ] as const;

/** A user with a personal workspace, as a sign-in leaves them. */
async function person(label: string) {
  const db = database.connection.db;
  const [user] = await db
    .insert(users)
    .values({
      id: createId(),
      identityProvider: "test",
      providerSubject: `subject-${label}-${createId()}`,
      email: null,
      displayName: `Person ${label}`,
    })
    .returning();
  if (user === undefined) throw new Error("user insert returned nothing");
  const [workspace] = await db
    .insert(workspaces)
    .values({
      id: createId(),
      displayName: `${user.displayName}'s workspace`,
      createdBy: user.id,
      personalOwnerId: user.id,
    })
    .returning();
  if (workspace === undefined)
    throw new Error("workspace insert returned nothing");
  return { user, workspace };
}

const later = (from: Date, ms: number) => new Date(from.getTime() + ms);

describe.sequential("session store", () => {
  it("creates the same session row for a token digest", async () => {
    const results = [];
    for (const [label, store] of backends()) {
      const { user } = await person(label);
      const tokenHash = hashAccessToken(`token-${label}`);
      const created = await store.create({
        userId: user.id,
        tokenHash,
        identityProvider: "development",
        expiresAt,
      });
      results.push({
        ownsUser: created.userId === user.id,
        tokenHash: created.tokenHash === tokenHash,
        identityProvider: created.identityProvider,
        expiresAt: created.expiresAt.toISOString(),
        revokedAt: created.revokedAt,
        lastSeenIsCreation:
          created.lastSeenAt.getTime() === created.createdAt.getTime(),
      });
    }
    const [postgres, cloud] = results;
    expect(cloud).toEqual(postgres);
    expect(postgres).toEqual({
      ownsUser: true,
      tokenHash: true,
      identityProvider: "development",
      expiresAt: expiresAt.toISOString(),
      revokedAt: null,
      lastSeenIsCreation: true,
    });
  });

  it("refuses a session for an unknown user", async () => {
    for (const [, store] of backends()) {
      await expect(
        store.create({
          userId: createId(),
          tokenHash: hashAccessToken(createId()),
          identityProvider: "development",
          expiresAt,
        }),
      ).rejects.toThrow(/The user does not exist/);
    }
  });

  it("resolves only live sessions and touches last_seen_at after the interval", async () => {
    const results = [];
    for (const [label, store] of backends()) {
      const { user } = await person(label);
      const tokenHash = hashAccessToken(`live-${label}`);
      const created = await store.create({
        userId: user.id,
        tokenHash,
        identityProvider: "development",
        expiresAt,
      });
      const soon = later(created.lastSeenAt, touchIntervalMs - 1_000);
      const untouched = await store.resolve(tokenHash, soon);
      const afterInterval = later(created.lastSeenAt, touchIntervalMs);
      const touched = await store.resolve(tokenHash, afterInterval);
      const expired = await store.resolve(tokenHash, expiresAt);
      const unknown = await store.resolve(hashAccessToken("nobody"), soon);
      results.push({
        untouched: {
          user: untouched?.user.id === user.id,
          lastSeenKept:
            untouched?.session.lastSeenAt.getTime() ===
            created.lastSeenAt.getTime(),
        },
        touched: {
          user: touched?.user.id === user.id,
          lastSeenAdvanced:
            touched?.session.lastSeenAt.getTime() === afterInterval.getTime(),
        },
        expired,
        unknown,
      });
    }
    const [postgres, cloud] = results;
    expect(cloud).toEqual(postgres);
    expect(postgres).toEqual({
      untouched: { user: true, lastSeenKept: true },
      touched: { user: true, lastSeenAdvanced: true },
      expired: null,
      unknown: null,
    });
  });

  it("revokes one session with its audit event, once", async () => {
    const results = [];
    for (const [label, store] of backends()) {
      const { user, workspace } = await person(label);
      const tokenHash = hashAccessToken(`revoke-${label}`);
      await store.create({
        userId: user.id,
        tokenHash,
        identityProvider: "development",
        expiresAt,
      });
      const requestId = createId();
      const first = await store.revoke(tokenHash, issuedAt, requestId);
      const second = await store.revoke(tokenHash, issuedAt, createId());
      const afterwards = await store.resolve(tokenHash, issuedAt);
      const unknown = await store.revoke(
        hashAccessToken("nobody"),
        issuedAt,
        createId(),
      );
      const audits = await database.connection.db
        .select({
          action: auditEvents.action,
          actorId: auditEvents.actorId,
          requestId: auditEvents.requestId,
          scope: auditEvents.metadata,
        })
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, workspace.id));
      results.push({
        first,
        second,
        afterwards,
        unknown,
        audits: audits.map((audit) => ({
          action: audit.action,
          byUser: audit.actorId === user.id,
          forRequest: audit.requestId === requestId,
          scope: audit.scope.scope,
          hasSessionId: typeof audit.scope.sessionId === "string",
        })),
      });
    }
    const [postgres, cloud] = results;
    expect(cloud).toEqual(postgres);
    expect(postgres).toEqual({
      first: true,
      second: false,
      afterwards: null,
      unknown: false,
      audits: [
        {
          action: "session.revoked",
          byUser: true,
          forRequest: true,
          scope: "current",
          hasSessionId: true,
        },
      ],
    });
  });

  it("revokes every live session of a user and counts them", async () => {
    const results = [];
    for (const [label, store] of backends()) {
      const { user, workspace } = await person(label);
      const hashes = [1, 2, 3].map((n) => hashAccessToken(`all-${label}-${n}`));
      for (const tokenHash of hashes) {
        await store.create({
          userId: user.id,
          tokenHash,
          identityProvider: "development",
          expiresAt,
        });
      }
      // One already revoked and one already expired do not count.
      await store.revoke(hashes[0] as string, issuedAt, createId());
      await store.create({
        userId: user.id,
        tokenHash: hashAccessToken(`stale-${label}`),
        identityProvider: "development",
        expiresAt: later(issuedAt, 1_000),
      });
      const revoked = await store.revokeAll(
        user.id,
        later(issuedAt, 2_000),
        createId(),
      );
      const again = await store.revokeAll(
        user.id,
        later(issuedAt, 3_000),
        createId(),
      );
      const stillLive = await Promise.all(
        hashes.map((tokenHash) =>
          store.resolve(tokenHash, later(issuedAt, 4_000)),
        ),
      );
      const audits = await database.connection.db
        .select({ action: auditEvents.action, metadata: auditEvents.metadata })
        .from(auditEvents)
        .where(eq(auditEvents.workspaceId, workspace.id))
        .orderBy(auditEvents.id);
      results.push({
        revoked,
        again,
        stillLive,
        audits: audits.map((audit) => ({
          action: audit.action,
          scope: audit.metadata.scope,
          count: audit.metadata.count,
        })),
      });
    }
    const [postgres, cloud] = results;
    expect(cloud).toEqual(postgres);
    expect(postgres).toEqual({
      revoked: 2,
      again: 0,
      stillLive: [null, null, null],
      audits: [
        { action: "session.revoked", scope: "current", count: undefined },
        { action: "session.revoked", scope: "all", count: 2 },
      ],
    });
  });
});
