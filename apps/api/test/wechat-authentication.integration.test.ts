import { resolve } from "node:path";
import {
  auditEvents,
  createId,
  identityExchanges,
  userIdentities,
  userSessions,
} from "@livtales/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import { and, eq, inArray } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import { passwordIdentityProvider } from "../src/authentication/auth-provider.js";
import { hashAccessToken } from "../src/authentication/session-auth-provider.js";
import type { WeChatIdentityVerifier } from "../src/authentication/wechat-identity-verifier.js";
import { cloudBaseWeChatIdentityProvider } from "../src/authentication/wechat-identity-verifier.js";
import { createAppDependencies } from "../src/dependencies.js";

const now = new Date("2030-01-01T00:00:00.000Z");
const proofExpiresAt = new Date("2030-01-01T00:10:00.000Z");
const weChatSubject = "livtales-test:cloud-user-1";
const rejection = {
  error: {
    code: "invalid_wechat_credential",
    message: "The WeChat credential could not be accepted.",
  },
};

function token(label: string): string {
  return `cloudbase-${label}-token-000000000000`;
}

const subjects = new Map([
  [token("link"), weChatSubject],
  [token("conflict"), weChatSubject],
  [token("sign-in"), weChatSubject],
  [token("unlinked"), "livtales-test:unlinked-user"],
]);

const verifier: WeChatIdentityVerifier = {
  async verify(accessToken) {
    if (accessToken === token("invalid")) return null;
    if (accessToken === token("expired")) {
      return {
        provider: cloudBaseWeChatIdentityProvider,
        subject: weChatSubject,
        expiresAt: now,
      };
    }
    const subject = subjects.get(accessToken);
    return subject === undefined
      ? null
      : {
          provider: cloudBaseWeChatIdentityProvider,
          subject,
          expiresAt: proofExpiresAt,
        };
  },
};

describe.sequential("WeChat authentication", () => {
  let database: TestDatabase;
  let app: FastifyInstance;

  beforeAll(async () => {
    database = await createTestDatabase();
    await applyMigrations(
      { DATABASE_URL: database.databaseUrl },
      resolve(import.meta.dirname, "../../../infrastructure/migrations"),
    );
  });

  afterAll(async () => {
    await app?.close();
    await database?.close();
  });

  it("links one canonical account and exchanges replay-safe durable sessions", async () => {
    const dependencies = createAppDependencies(database.connection, undefined, {
      clock: () => now,
      sessionTtlMs: 60_000,
      weChatIdentityVerifier: verifier,
    });
    app = buildApp(dependencies);
    const password = await dependencies.identity.signIn(
      {
        provider: passwordIdentityProvider,
        subject: "person@example.test",
        email: "person@example.test",
        displayName: "Person",
        username: "person",
      },
      createId(),
    );
    const other = await dependencies.identity.signIn(
      {
        provider: passwordIdentityProvider,
        subject: "other@example.test",
        email: "other@example.test",
        displayName: "Other Person",
        username: "other_person",
      },
      createId(),
    );
    const passwordSession = await dependencies.sessions.issue(
      password.user,
      passwordIdentityProvider,
    );
    const otherSession = await dependencies.sessions.issue(
      other.user,
      passwordIdentityProvider,
    );
    const authorization = (accessToken: string) => ({
      authorization: `Bearer ${accessToken}`,
    });
    const link = (accessToken: string, cloudBaseToken: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/wechat/link",
        headers: authorization(accessToken),
        payload: { accessToken: cloudBaseToken },
      });
    const exchange = (accessToken: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/wechat",
        payload: { accessToken },
      });

    const unauthenticatedLink = await app.inject({
      method: "POST",
      url: "/api/auth/wechat/link",
      payload: { accessToken: token("link") },
    });
    expect(unauthenticatedLink.statusCode).toBe(401);

    const linked = await link(passwordSession.accessToken, token("link"));
    expect(linked.statusCode).toBe(200);
    expect(linked.json()).toEqual({ linked: true });

    const replayedLink = await link(passwordSession.accessToken, token("link"));
    const conflictingLink = await link(
      otherSession.accessToken,
      token("conflict"),
    );
    const invalid = await exchange(token("invalid"));
    const expired = await exchange(token("expired"));
    const unlinked = await exchange(token("unlinked"));
    for (const response of [
      replayedLink,
      conflictingLink,
      invalid,
      expired,
      unlinked,
    ]) {
      expect(response.statusCode).toBe(401);
      expect(response.json()).toEqual(rejection);
    }

    const signedIn = await exchange(token("sign-in"));
    expect(signedIn.statusCode).toBe(200);
    const session = signedIn.json<{
      accessToken: string;
      expiresAt: string;
      user: { id: string };
      workspace: { id: string };
    }>();
    expect(session).toMatchObject({
      expiresAt: "2030-01-01T00:01:00.000Z",
      user: { id: password.user.id },
      workspace: { id: password.workspace.id },
    });
    expect(session.accessToken).not.toBe(token("sign-in"));

    const replayedExchange = await exchange(token("sign-in"));
    expect(replayedExchange.statusCode).toBe(401);
    expect(replayedExchange.json()).toEqual(rejection);

    const restored = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: authorization(session.accessToken),
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({
      principal: {
        userId: password.user.id,
        workspaceId: password.workspace.id,
      },
      user: { id: password.user.id },
      workspace: { id: password.workspace.id },
    });

    const identities = await database.connection.db
      .select({
        userId: userIdentities.userId,
        provider: userIdentities.provider,
        subject: userIdentities.subject,
      })
      .from(userIdentities)
      .where(eq(userIdentities.userId, password.user.id));
    expect(identities).toEqual(
      expect.arrayContaining([
        {
          userId: password.user.id,
          provider: passwordIdentityProvider,
          subject: "person@example.test",
        },
        {
          userId: password.user.id,
          provider: cloudBaseWeChatIdentityProvider,
          subject: weChatSubject,
        },
      ]),
    );
    expect(identities).toHaveLength(2);

    const exchanges = await database.connection.db
      .select({
        proofHash: identityExchanges.proofHash,
        purpose: identityExchanges.purpose,
      })
      .from(identityExchanges)
      .where(eq(identityExchanges.userId, password.user.id));
    expect(exchanges).toEqual(
      expect.arrayContaining([
        { proofHash: hashAccessToken(token("link")), purpose: "link" },
        {
          proofHash: hashAccessToken(token("sign-in")),
          purpose: "sign_in",
        },
      ]),
    );
    expect(JSON.stringify(exchanges)).not.toContain(token("link"));
    expect(JSON.stringify(exchanges)).not.toContain(token("sign-in"));

    const [storedSession] = await database.connection.db
      .select({
        identityProvider: userSessions.identityProvider,
        tokenHash: userSessions.tokenHash,
      })
      .from(userSessions)
      .where(eq(userSessions.tokenHash, hashAccessToken(session.accessToken)));
    expect(storedSession).toEqual({
      identityProvider: cloudBaseWeChatIdentityProvider,
      tokenHash: hashAccessToken(session.accessToken),
    });

    const audits = await database.connection.db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.actorId, password.user.id),
          inArray(auditEvents.action, [
            "identity.linked",
            "identity.wechat_signed_in",
          ]),
        ),
      );
    expect(audits).toEqual(
      expect.arrayContaining([
        { action: "identity.linked" },
        { action: "identity.wechat_signed_in" },
      ]),
    );
    expect(audits).toHaveLength(2);
  });
});
