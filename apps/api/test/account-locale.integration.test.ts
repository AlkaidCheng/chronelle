import { resolve } from "node:path";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  apiErrorResponseSchema,
  developmentSignInResponseSchema,
  sessionResponseSchema,
  signInResponseSchema,
  userResponseSchema,
} from "@chronelle/schemas";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildApp } from "../src/app.js";
import type {
  EmailMessage,
  EmailSender,
} from "../src/authentication/email-sender.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);

class RecordingEmailSender implements EmailSender {
  readonly messages: EmailMessage[] = [];
  async send(message: EmailMessage): Promise<void> {
    this.messages.push(message);
  }
  codeFor(email: string): string {
    const message = [...this.messages]
      .reverse()
      .find((candidate) => candidate.to === email);
    const code = /\b(\d{6})\b/.exec(message?.text ?? "")?.[1];
    if (code === undefined) throw new Error(`no code was sent to ${email}`);
    return code;
  }
}

let testDatabase: TestDatabase;
let app: FastifyInstance;
let email: RecordingEmailSender;

beforeEach(async () => {
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
  email = new RecordingEmailSender();
  app = buildApp(
    createDevelopmentAppDependencies(testDatabase.connection, {
      email,
      passwordAuth: {
        issuePolicy: { minIntervalMs: 0, windowMs: 0, maxPerWindow: 0 },
      },
    }),
  );
});

afterEach(async () => {
  await app.close();
  await testDatabase.close();
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function signIn() {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email: "owner@example.test", displayName: "Owner" },
  });
  expect(response.statusCode).toBe(200);
  return developmentSignInResponseSchema.parse(response.json());
}

describe("the language kept on the account", () => {
  it("is null until chosen, then round-trips through PATCH /api/auth/me and the session", async () => {
    const signedIn = await signIn();
    expect(signedIn.user.locale).toBeNull();

    const chosen = await app.inject({
      method: "PATCH",
      url: "/api/auth/me",
      headers: bearer(signedIn.accessToken),
      payload: { locale: "zh-Hant" },
    });
    expect(chosen.statusCode).toBe(200);
    expect(userResponseSchema.parse(chosen.json())).toEqual({
      id: signedIn.user.id,
      displayName: "Owner",
      email: "owner@example.test",
      locale: "zh-Hant",
    });

    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: bearer(signedIn.accessToken),
    });
    expect(sessionResponseSchema.parse(session.json()).user.locale).toBe(
      "zh-Hant",
    );
    // A later sign-in of the same identity reads the kept choice.
    expect((await signIn()).user.locale).toBe("zh-Hant");

    const cleared = await app.inject({
      method: "PATCH",
      url: "/api/auth/me",
      headers: bearer(signedIn.accessToken),
      payload: { locale: null },
    });
    expect(cleared.statusCode).toBe(200);
    expect(userResponseSchema.parse(cleared.json()).locale).toBeNull();
  });

  it("refuses a value that is not a language tag, and an unauthenticated change", async () => {
    const signedIn = await signIn();
    for (const locale of ["", "Chinese", "zh_Hans", "z", "en-", 42]) {
      const refused = await app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: bearer(signedIn.accessToken),
        payload: { locale },
      });
      expect(refused.statusCode).toBe(400);
      expect(apiErrorResponseSchema.parse(refused.json()).error.code).toBe(
        "invalid_request",
      );
    }
    const anonymous = await app.inject({
      method: "PATCH",
      url: "/api/auth/me",
      payload: { locale: "en" },
    });
    expect(anonymous.statusCode).toBe(401);
  });

  it("keeps the sign-up language and writes the first code email in it", async () => {
    const signedUp = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up",
      payload: {
        email: "reader@example.test",
        password: "correct horse battery",
        displayName: "Reader",
        locale: "zh-Hans",
      },
    });
    expect(signedUp.statusCode).toBe(202);
    expect(email.messages[0]?.subject).toMatch(
      /^Chronelle：您的验证码是 \d{6}$/,
    );

    const verified = await app.inject({
      method: "POST",
      url: "/api/auth/verify-email",
      payload: {
        email: "reader@example.test",
        code: email.codeFor("reader@example.test"),
      },
    });
    expect(verified.statusCode).toBe(200);
    expect(signInResponseSchema.parse(verified.json()).user.locale).toBe(
      "zh-Hans",
    );
  });

  it("writes the code email in English for an account with no language", async () => {
    const signedUp = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up",
      payload: {
        email: "plain@example.test",
        password: "correct horse battery",
        displayName: "Plain",
      },
    });
    expect(signedUp.statusCode).toBe(202);
    expect(email.messages[0]?.subject).toMatch(
      /^Chronelle: your code is \d{6}$/,
    );
  });
});
