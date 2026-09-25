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

describe("the preferences kept on the account", () => {
  it("are null until chosen, then round-trip through PATCH /api/auth/me and the session", async () => {
    const signedIn = await signIn();
    expect(signedIn.user).toEqual({
      id: signedIn.user.id,
      displayName: "Owner",
      email: "owner@example.test",
      username: "owner",
      findByName: true,
      findByEmail: true,
      // A development identity brings its name: no Welcome step ahead.
      onboardedAt: expect.any(String),
      locale: null,
      timeZone: null,
      hourCycle: null,
      weekStart: null,
      rail: {},
      eventTabs: {},
      workspaceRecency: {},
    });

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
      username: "owner",
      findByName: true,
      findByEmail: true,
      onboardedAt: expect.any(String),
      locale: "zh-Hant",
      timeZone: null,
      hourCycle: null,
      weekStart: null,
      rail: {},
      eventTabs: {},
      workspaceRecency: {},
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

  it("merges the time zone, clock, and week start one key at a time and reads them on the next session", async () => {
    const signedIn = await signIn();
    const patch = (payload: Record<string, unknown>) =>
      app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: bearer(signedIn.accessToken),
        payload,
      });

    const zoned = await patch({ timeZone: "Asia/Shanghai" });
    expect(zoned.statusCode).toBe(200);
    expect(userResponseSchema.parse(zoned.json())).toMatchObject({
      timeZone: "Asia/Shanghai",
      hourCycle: null,
      weekStart: null,
    });

    const clocked = await patch({ hourCycle: "h23", weekStart: 1 });
    expect(clocked.statusCode).toBe(200);
    expect(userResponseSchema.parse(clocked.json())).toMatchObject({
      timeZone: "Asia/Shanghai",
      hourCycle: "h23",
      weekStart: 1,
    });

    // An empty object changes nothing; a null clears one key and keeps the rest.
    const untouched = await patch({});
    expect(userResponseSchema.parse(untouched.json())).toMatchObject({
      timeZone: "Asia/Shanghai",
      hourCycle: "h23",
      weekStart: 1,
    });
    const cleared = await patch({ hourCycle: null, weekStart: 7 });
    expect(userResponseSchema.parse(cleared.json())).toMatchObject({
      timeZone: "Asia/Shanghai",
      hourCycle: null,
      weekStart: 7,
    });

    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: bearer(signedIn.accessToken),
    });
    expect(sessionResponseSchema.parse(session.json()).user).toMatchObject({
      timeZone: "Asia/Shanghai",
      hourCycle: null,
      weekStart: 7,
    });
    expect((await signIn()).user).toMatchObject({
      timeZone: "Asia/Shanghai",
      hourCycle: null,
      weekStart: 7,
    });
  });

  it("keeps the rail order and hidden collections, resets them with null, and keeps keys it does not know", async () => {
    const signedIn = await signIn();
    const patch = (payload: Record<string, unknown>) =>
      app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: bearer(signedIn.accessToken),
        payload,
      });

    const arranged = await patch({
      rail: { order: ["people", "events", "tasks"], hidden: ["tasks"] },
    });
    expect(arranged.statusCode).toBe(200);
    expect(userResponseSchema.parse(arranged.json()).rail).toEqual({
      order: ["people", "events", "tasks"],
      hidden: ["tasks"],
    });

    // Another preference leaves the rail alone; a key the app does not
    // know is kept as given for the client to ignore.
    const clocked = await patch({ hourCycle: "h12" });
    expect(userResponseSchema.parse(clocked.json()).rail).toEqual({
      order: ["people", "events", "tasks"],
      hidden: ["tasks"],
    });
    const later = await patch({ rail: { order: ["reminders", "events"] } });
    expect(userResponseSchema.parse(later.json()).rail).toEqual({
      order: ["reminders", "events"],
    });
    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: bearer(signedIn.accessToken),
    });
    expect(sessionResponseSchema.parse(session.json()).user.rail).toEqual({
      order: ["reminders", "events"],
    });

    const reset = await patch({ rail: null });
    expect(reset.statusCode).toBe(200);
    expect(userResponseSchema.parse(reset.json()).rail).toEqual({});

    for (const rail of [
      "events",
      ["events"],
      { order: "events" },
      { order: [1] },
      { hidden: [null] },
      { order: Array.from({ length: 51 }, (_, index) => `k${index}`) },
      { order: [""] },
    ]) {
      const refused = await patch({ rail });
      expect(refused.statusCode, JSON.stringify(rail)).toBe(400);
      expect(apiErrorResponseSchema.parse(refused.json()).error.code).toBe(
        "invalid_request",
      );
    }
    expect(userResponseSchema.parse((await patch({})).json()).rail).toEqual({});
  });

  it("merges an event's tabs one event at a time, drops them with null, and keeps up to 200 events", async () => {
    const signedIn = await signIn();
    const patch = (payload: Record<string, unknown>) =>
      app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: bearer(signedIn.accessToken),
        payload,
      });
    const kyoto = "01a0b355-cad8-73d2-89f8-0a12abf666a8";
    const lisbon = "01a0b355-cad8-73d2-89f8-0a12abf666a9";

    const arranged = await patch({
      eventTabs: {
        [kyoto]: { order: ["todos", "overview"], removed: ["timeline"] },
      },
    });
    expect(arranged.statusCode).toBe(200);
    expect(userResponseSchema.parse(arranged.json()).eventTabs).toEqual({
      [kyoto]: { order: ["todos", "overview"], removed: ["timeline"] },
    });

    // A second event joins; the first keeps its tabs. Another preference
    // leaves both alone.
    const joined = await patch({
      eventTabs: { [lisbon]: { hidden: ["files", "page-1"] } },
    });
    expect(userResponseSchema.parse(joined.json()).eventTabs).toEqual({
      [kyoto]: { order: ["todos", "overview"], removed: ["timeline"] },
      [lisbon]: { hidden: ["files", "page-1"] },
    });
    const clocked = await patch({ weekStart: 7 });
    expect(userResponseSchema.parse(clocked.json()).eventTabs).toEqual({
      [kyoto]: { order: ["todos", "overview"], removed: ["timeline"] },
      [lisbon]: { hidden: ["files", "page-1"] },
    });

    // An object replaces one event's tabs whole; null drops them; the
    // session read shows the same.
    const replaced = await patch({
      eventTabs: { [kyoto]: { hidden: ["sharing"] }, [lisbon]: null },
    });
    expect(userResponseSchema.parse(replaced.json()).eventTabs).toEqual({
      [kyoto]: { hidden: ["sharing"] },
    });
    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: bearer(signedIn.accessToken),
    });
    expect(sessionResponseSchema.parse(session.json()).user.eventTabs).toEqual({
      [kyoto]: { hidden: ["sharing"] },
    });

    for (const eventTabs of [
      "todos",
      ["todos"],
      { plan: {} },
      { [kyoto]: "todos" },
      { [kyoto]: { order: "todos" } },
      { [kyoto]: { hidden: [1] } },
      { [kyoto]: { removed: [""] } },
      {
        [kyoto]: {
          order: Array.from({ length: 41 }, (_, index) => `k${index}`),
        },
      },
    ]) {
      const refused = await patch({ eventTabs });
      expect(refused.statusCode, JSON.stringify(eventTabs)).toBe(400);
      expect(apiErrorResponseSchema.parse(refused.json()).error.code).toBe(
        "invalid_request",
      );
    }

    // Tabs are kept for up to 200 events; the 201st is refused and the
    // stored ones stay.
    const many = Object.fromEntries(
      Array.from({ length: 199 }, (_, index) => [
        `01a0b355-cad8-73d2-89f8-${String(index).padStart(12, "0")}`,
        { hidden: ["files"] },
      ]),
    );
    expect((await patch({ eventTabs: many })).statusCode).toBe(200);
    const overflow = await patch({ eventTabs: { [lisbon]: {} } });
    expect(overflow.statusCode).toBe(400);
    expect(
      Object.keys(userResponseSchema.parse((await patch({})).json()).eventTabs),
    ).toHaveLength(200);
  });

  it("merges when each workspace was last opened one workspace at a time, drops it with null, and keeps the 50 most recent", async () => {
    const signedIn = await signIn();
    const patch = (payload: Record<string, unknown>) =>
      app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: bearer(signedIn.accessToken),
        payload,
      });
    const kyoto = "01a0b355-cad8-73d2-89f8-0a12abf666a8";
    const lisbon = "01a0b355-cad8-73d2-89f8-0a12abf666a9";
    const recencyOf = (response: { json(): unknown }) =>
      userResponseSchema.parse(response.json()).workspaceRecency;

    const opened = await patch({
      workspaceRecency: { [kyoto]: "2026-09-20T00:10:00.000Z" },
    });
    expect(opened.statusCode).toBe(200);
    expect(recencyOf(opened)).toEqual({ [kyoto]: "2026-09-20T00:10:00.000Z" });

    // A second workspace joins with its zone kept as written; the first
    // keeps its instant, and another preference leaves both alone.
    const joined = await patch({
      workspaceRecency: { [lisbon]: "2026-09-19T08:00:00+08:00" },
    });
    expect(recencyOf(joined)).toEqual({
      [kyoto]: "2026-09-20T00:10:00.000Z",
      [lisbon]: "2026-09-19T08:00:00+08:00",
    });
    expect(recencyOf(await patch({ weekStart: 7 }))).toEqual({
      [kyoto]: "2026-09-20T00:10:00.000Z",
      [lisbon]: "2026-09-19T08:00:00+08:00",
    });

    // An instant replaces one workspace's entry; null drops it; the
    // session read shows the same.
    const replaced = await patch({
      workspaceRecency: { [kyoto]: "2026-09-21T00:00:00Z", [lisbon]: null },
    });
    expect(recencyOf(replaced)).toEqual({ [kyoto]: "2026-09-21T00:00:00Z" });
    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: bearer(signedIn.accessToken),
    });
    expect(
      sessionResponseSchema.parse(session.json()).user.workspaceRecency,
    ).toEqual({ [kyoto]: "2026-09-21T00:00:00Z" });

    for (const workspaceRecency of [
      "2026-09-21T00:00:00Z",
      [kyoto],
      { plan: "2026-09-21T00:00:00Z" },
      { [kyoto]: "yesterday" },
      { [kyoto]: "2026-09-21" },
      { [kyoto]: 1_700_000_000 },
      { [kyoto]: {} },
    ]) {
      const refused = await patch({ workspaceRecency });
      expect(refused.statusCode, JSON.stringify(workspaceRecency)).toBe(400);
      expect(apiErrorResponseSchema.parse(refused.json()).error.code).toBe(
        "invalid_request",
      );
    }

    // The 50 most recent instants are kept: the oldest fall off as more
    // workspaces are opened.
    const many = Object.fromEntries(
      Array.from({ length: 60 }, (_, index) => [
        `01a0b355-cad8-73d2-89f8-${String(index).padStart(12, "0")}`,
        `2026-01-${String((index % 28) + 1).padStart(2, "0")}T00:00:00Z`,
      ]),
    );
    const kept = recencyOf(await patch({ workspaceRecency: many }));
    expect(Object.keys(kept)).toHaveLength(50);
    expect(kept[kyoto]).toBe("2026-09-21T00:00:00Z");
    expect(kept["01a0b355-cad8-73d2-89f8-000000000000"]).toBeUndefined();
    expect(kept["01a0b355-cad8-73d2-89f8-000000000027"]).toBe(
      "2026-01-28T00:00:00Z",
    );
  });

  it("refuses a value that is not a language tag, a zone, a clock, or a week start, and an unauthenticated change", async () => {
    const signedIn = await signIn();
    const refusals: (Record<string, unknown> | unknown[])[] = [
      ...["", "Chinese", "zh_Hans", "z", "en-", 42].map((locale) => ({
        locale,
      })),
      ...[
        "",
        "Mars/Olympus_Mons",
        "Asia Shanghai",
        "asia/shanghai;drop",
        "+08:00",
        8,
      ].map((timeZone) => ({ timeZone })),
      ...["", "h11", "h24", "12", 12].map((hourCycle) => ({ hourCycle })),
      ...[0, 2, 6, 8, "1", "monday"].map((weekStart) => ({ weekStart })),
      [],
    ];
    for (const payload of refusals) {
      const refused = await app.inject({
        method: "PATCH",
        url: "/api/auth/me",
        headers: bearer(signedIn.accessToken),
        payload,
      });
      expect(refused.statusCode, JSON.stringify(payload)).toBe(400);
      expect(apiErrorResponseSchema.parse(refused.json()).error.code).toBe(
        "invalid_request",
      );
    }
    // A refused key leaves the account as it was.
    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: bearer(signedIn.accessToken),
    });
    expect(sessionResponseSchema.parse(session.json()).user).toMatchObject({
      locale: null,
      timeZone: null,
      hourCycle: null,
      weekStart: null,
    });
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
        username: "reader",
        password: "correct horse battery",
        displayName: "Reader",
        locale: "zh-Hans",
      },
    });
    expect(signedUp.statusCode).toBe(202);
    expect(email.messages[0]?.subject).toMatch(
      /^LivTales：您的验证码是 \d{6}$/,
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
        username: "plain",
        password: "correct horse battery",
        displayName: "Plain",
      },
    });
    expect(signedUp.statusCode).toBe(202);
    expect(email.messages[0]?.subject).toMatch(
      /^LivTales: your code is \d{6}$/,
    );
  });
});
