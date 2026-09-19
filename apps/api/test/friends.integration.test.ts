import { resolve } from "node:path";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  apiErrorResponseSchema,
  developmentSignInResponseSchema,
  friendSchema,
  friendsResponseSchema,
  personResponseSchema,
  sentInvitationSchema,
  userResponseSchema,
  userSearchResponseSchema,
  userSummarySchema,
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
  latestTo(email: string): EmailMessage {
    const message = [...this.messages]
      .reverse()
      .find((candidate) => candidate.to === email);
    if (message === undefined) throw new Error(`nothing was sent to ${email}`);
    return message;
  }
  codeFor(email: string): string {
    const code = /\b(\d{6})\b/.exec(this.latestTo(email).text)?.[1];
    if (code === undefined) throw new Error(`no code was sent to ${email}`);
    return code;
  }
}

let testDatabase: TestDatabase;
let app: FastifyInstance;
let email: RecordingEmailSender;
let now: Date;

beforeEach(async () => {
  testDatabase = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: testDatabase.databaseUrl },
    migrationDirectory,
  );
  email = new RecordingEmailSender();
  now = new Date("2030-08-01T12:00:00.000Z");
  app = buildApp(
    createDevelopmentAppDependencies(testDatabase.connection, {
      email,
      clock: () => now,
      passwordAuth: {
        issuePolicy: { minIntervalMs: 0, windowMs: 0, maxPerWindow: 0 },
      },
      friends: {
        webBaseUrl: "https://chronelle.example/",
        dailyLimit: 3,
        resendIntervalMs: 60_000,
      },
    }),
  );
});

afterEach(async () => {
  await app.close();
  await testDatabase.close();
});

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

async function signIn(email: string, displayName: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email, displayName },
  });
  expect(response.statusCode).toBe(200);
  const session = developmentSignInResponseSchema.parse(response.json());
  return { ...session, headers: bearer(session.accessToken) };
}

async function friendsOf(headers: Record<string, string>) {
  const response = await app.inject({
    method: "GET",
    url: "/api/friends",
    headers,
  });
  expect(response.statusCode).toBe(200);
  return friendsResponseSchema.parse(response.json());
}

async function invite(
  headers: Record<string, string>,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: "/api/friends/invitations",
    headers,
    payload,
  });
}

describe("friends", () => {
  it("connects two accounts through a request, links the card, and can be undone", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const ben = await signIn("ben@example.test", "Ben");
    // Ana invites Ben from a card of her workspace.
    const card = personResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/persons",
          headers: ana.headers,
          payload: {
            displayName: "Benjamin",
            contacts: [{ kind: "email", value: "ben@example.test" }],
          },
        })
      ).json(),
    );
    const sent = await invite(ana.headers, {
      email: "Ben@Example.test",
      message: "Climbing on Saturday?",
      personId: card.id,
    });
    expect(sent.statusCode).toBe(201);
    const item = sentInvitationSchema.parse(sent.json());
    expect(item).toMatchObject({
      kind: "connection",
      email: "ben@example.test",
      message: "Climbing on Saturday?",
      personId: card.id,
      workspaceId: ana.workspace.id,
      expiresAt: null,
    });
    // Ben is emailed in his language with the note; nothing reveals more.
    const notice = email.latestTo("ben@example.test");
    expect(notice.subject).toBe("Chronelle: Ana wants to connect");
    expect(notice.text).toContain("Ana (ana@example.test)");
    expect(notice.text).toContain('"Climbing on Saturday?"');
    expect(notice.text).not.toContain("http");

    // Each side sees the request in its place; a second invite is refused.
    expect(await friendsOf(ana.headers)).toMatchObject({
      friends: [],
      incoming: [],
      sent: [{ id: item.id, kind: "connection", email: "ben@example.test" }],
    });
    const bensView = await friendsOf(ben.headers);
    expect(bensView.incoming).toMatchObject([
      {
        id: item.id,
        requester: {
          userId: ana.user.id,
          displayName: "Ana",
          email: "ana@example.test",
        },
        message: "Climbing on Saturday?",
      },
    ]);
    const again = await invite(ana.headers, { email: "ben@example.test" });
    expect(again.statusCode).toBe(409);
    expect(apiErrorResponseSchema.parse(again.json()).error).toMatchObject({
      code: "friend_conflict",
      message: "An invitation is already waiting.",
    });
    const reverse = await invite(ben.headers, { email: "ana@example.test" });
    expect(reverse.statusCode).toBe(409);
    expect(reverse.json().error.message).toBe(
      "This person has already invited you.",
    );

    // Ben accepts: both are friends, and Ana's card is linked to Ben.
    const accepted = await app.inject({
      method: "POST",
      url: `/api/friends/requests/${item.id}/accept`,
      headers: ben.headers,
    });
    expect(accepted.statusCode).toBe(200);
    expect(friendSchema.parse(accepted.json())).toMatchObject({
      id: item.id,
      userId: ana.user.id,
      displayName: "Ana",
      email: "ana@example.test",
    });
    expect((await friendsOf(ana.headers)).friends).toMatchObject([
      { id: item.id, userId: ben.user.id, displayName: "Ben" },
    ]);
    expect((await friendsOf(ben.headers)).friends).toMatchObject([
      { id: item.id, userId: ana.user.id, displayName: "Ana" },
    ]);
    const linked = personResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: `/api/persons/${card.id}`,
          headers: ana.headers,
        })
      ).json(),
    );
    expect(linked.userId).toBe(ben.user.id);
    expect(linked.version).toBe(2);

    // A friend may be linked to a person of any workspace of the other side.
    const cara = await signIn("cara@example.test", "Cara");
    const stranger = personResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/persons",
          headers: ana.headers,
          payload: { displayName: "Someone" },
        })
      ).json(),
    );
    const refused = await app.inject({
      method: "PATCH",
      url: `/api/persons/${stranger.id}`,
      headers: ana.headers,
      payload: { expectedVersion: 1, userId: cara.user.id },
    });
    expect(refused.statusCode).toBe(400);
    expect(refused.json().error.message).toBe(
      "userId must name a member of this workspace or a friend of one.",
    );
    expect(await friendsOf(cara.headers)).toEqual({
      friends: [],
      incoming: [],
      sent: [],
    });

    // Inviting again while friends is refused; removing ends it from either
    // side and leaves the card linked.
    expect(
      (await invite(ben.headers, { email: "ana@example.test" })).json().error
        .message,
    ).toBe("You are already friends.");
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/friends/${item.id}`,
      headers: ben.headers,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ id: item.id, status: "removed" });
    expect((await friendsOf(ana.headers)).friends).toEqual([]);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/persons/${card.id}`,
          headers: ana.headers,
        })
      ).json().userId,
    ).toBe(ben.user.id);
    // A fresh request may follow a removal.
    expect(
      (await invite(ana.headers, { email: "ben@example.test" })).statusCode,
    ).toBe(201);
  });

  it("declines, withdraws, resends within the interval, and caps the day", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const ben = await signIn("ben@example.test", "Ben");
    const first = sentInvitationSchema.parse(
      (await invite(ana.headers, { email: "ben@example.test" })).json(),
    );
    // Resending too soon is refused; after the interval it emails again.
    const soon = await app.inject({
      method: "POST",
      url: `/api/friends/invitations/${first.id}/resend`,
      headers: ana.headers,
    });
    expect(soon.statusCode).toBe(429);
    expect(soon.json().error).toMatchObject({
      code: "friend_limit",
      message: "Wait before sending again.",
    });
    now = new Date(now.getTime() + 61_000);
    const later = await app.inject({
      method: "POST",
      url: `/api/friends/invitations/${first.id}/resend`,
      headers: ana.headers,
    });
    expect(later.statusCode).toBe(202);
    expect(
      email.messages.filter((message) => message.to === "ben@example.test"),
    ).toHaveLength(2);

    // Declining answers it; Ana's sent list empties and no friend appears.
    const declined = await app.inject({
      method: "POST",
      url: `/api/friends/requests/${first.id}/decline`,
      headers: ben.headers,
    });
    expect(declined.json()).toEqual({ id: first.id, status: "declined" });
    expect(await friendsOf(ana.headers)).toEqual({
      friends: [],
      incoming: [],
      sent: [],
    });
    // Answering twice, or answering someone else's request, is not found.
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/friends/requests/${first.id}/accept`,
          headers: ben.headers,
        })
      ).statusCode,
    ).toBe(404);

    // A new request can be withdrawn by its sender only.
    const second = sentInvitationSchema.parse(
      (await invite(ana.headers, { email: "ben@example.test" })).json(),
    );
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/friends/invitations/${second.id}`,
          headers: ben.headers,
        })
      ).statusCode,
    ).toBe(404);
    const withdrawn = await app.inject({
      method: "DELETE",
      url: `/api/friends/invitations/${second.id}`,
      headers: ana.headers,
    });
    expect(withdrawn.json()).toEqual({ id: second.id, status: "withdrawn" });
    expect((await friendsOf(ben.headers)).incoming).toEqual([]);

    // Three invitations a day: the third is the cap.
    expect(
      (await invite(ana.headers, { email: "ben@example.test" })).statusCode,
    ).toBe(201);
    const capped = await invite(ana.headers, { email: "dan@example.test" });
    expect(capped.statusCode).toBe(429);
    expect(capped.json().error.message).toBe("Too many invitations today.");

    // Inviting yourself, a bad note, or an unknown card is refused.
    for (const [payload, message] of [
      [{ email: "ben@example.test" }, "You cannot invite yourself."],
      [
        { email: "eve@example.test", personId: ben.user.id },
        "personId must name an unlinked person you can view.",
      ],
    ] as const) {
      const response = await invite(ben.headers, payload);
      expect(response.statusCode).toBe(400);
      expect(response.json().error.message).toBe(message);
    }
    expect(
      (await invite(ben.headers, { email: "eve@example.test", message: "" }))
        .statusCode,
    ).toBe(400);
  });

  it("invites an address without an account and turns it into a request at sign-up", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const card = personResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/persons",
          headers: ana.headers,
          payload: { displayName: "Dan" },
        })
      ).json(),
    );
    const sent = await invite(ana.headers, {
      email: "dan@example.test",
      message: "Join us here.",
      personId: card.id,
    });
    expect(sent.statusCode).toBe(201);
    const item = sentInvitationSchema.parse(sent.json());
    expect(item).toMatchObject({
      kind: "invitation",
      email: "dan@example.test",
    });
    expect(item.expiresAt).toBe("2030-08-15T12:00:00.000Z");
    // The email carries a sign-up link with the token, in Ana's language.
    const notice = email.latestTo("dan@example.test");
    expect(notice.subject).toBe("Chronelle: Ana invited you");
    const link =
      /https:\/\/chronelle\.example\/sign-up\?invitation=([\w-]+)/u.exec(
        notice.text,
      );
    expect(link).not.toBeNull();
    expect(notice.text).toContain("14 days");
    expect((await friendsOf(ana.headers)).sent).toMatchObject([
      { id: item.id, kind: "invitation", email: "dan@example.test" },
    ]);
    // The same address cannot be invited twice while it waits.
    expect(
      (await invite(ana.headers, { email: "dan@example.test" })).statusCode,
    ).toBe(409);

    // Dan signs up with the link: the invitation becomes a request from Ana.
    const signedUp = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up",
      payload: {
        displayName: "Dan",
        email: "dan@example.test",
        username: "dan",
        password: "correct horse battery",
        invitationToken: link?.[1],
      },
    });
    expect(signedUp.statusCode).toBe(202);
    const verified = await app.inject({
      method: "POST",
      url: "/api/auth/verify-email",
      payload: {
        email: "dan@example.test",
        code: email.codeFor("dan@example.test"),
      },
    });
    expect(verified.statusCode).toBe(200);
    const dan = { headers: bearer(verified.json().accessToken) };
    const dansView = await friendsOf(dan.headers);
    expect(dansView.incoming).toMatchObject([
      {
        requester: { displayName: "Ana", email: "ana@example.test" },
        message: "Join us here.",
      },
    ]);
    const request = dansView.incoming[0];
    if (request === undefined) throw new Error("no request");
    expect((await friendsOf(ana.headers)).sent).toMatchObject([
      { id: request.id, kind: "connection", email: "dan@example.test" },
    ]);
    // Accepting links Ana's card to Dan's new account.
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/friends/requests/${request.id}/accept`,
          headers: dan.headers,
        })
      ).statusCode,
    ).toBe(200);
    const linked = await app.inject({
      method: "GET",
      url: `/api/persons/${card.id}`,
      headers: ana.headers,
    });
    expect(linked.json().userId).toBe(verified.json().user.id);
  });

  it("keeps friends on the account and out of reach of other accounts", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const ben = await signIn("ben@example.test", "Ben");
    const eve = await signIn("eve@example.test", "Eve");
    const item = sentInvitationSchema.parse(
      (await invite(ana.headers, { email: "ben@example.test" })).json(),
    );
    // Eve can neither answer, withdraw, nor remove what is not hers.
    for (const [method, url] of [
      ["POST", `/api/friends/requests/${item.id}/accept`],
      ["POST", `/api/friends/requests/${item.id}/decline`],
      ["DELETE", `/api/friends/invitations/${item.id}`],
      ["POST", `/api/friends/invitations/${item.id}/resend`],
    ] as const) {
      const response = await app.inject({ method, url, headers: eve.headers });
      expect(response.statusCode).toBe(404);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/friends/requests/${item.id}/accept`,
          headers: ben.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/friends/${item.id}`,
          headers: eve.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect((await friendsOf(eve.headers)).friends).toEqual([]);
    // Without a session nothing is served.
    expect(
      (await app.inject({ method: "GET", url: "/api/friends" })).statusCode,
    ).toBe(401);
  });

  it("finds people by username, name, or email as they allow, and sends a request by id", async () => {
    const ana = await signIn("ana@example.test", "Ana Lopez");
    const ben = await signIn("ben@example.test", "Ben Okafor");
    const cid = await signIn("cid@example.test", "Cid Lopez");
    const account = async (
      headers: Record<string, string>,
      payload: Record<string, unknown>,
    ) => app.inject({ method: "PATCH", url: "/api/account", headers, payload });

    // Usernames came from the names at sign-in; the switches change here,
    // the username does not.
    expect(ben.user.username).toBe("ben-okafor");
    expect(cid.user.username).toBe("cid-lopez");
    const hidden = await account(cid.headers, { findByName: false });
    expect(hidden.statusCode).toBe(200);
    expect(userResponseSchema.parse(hidden.json())).toMatchObject({
      username: "cid-lopez",
      findByName: false,
      findByEmail: true,
    });
    expect(
      (await account(cid.headers, { username: "another" })).statusCode,
    ).toBe(400);
    // The session carries the account fields.
    const session = await app.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: cid.headers,
    });
    expect(session.json().user).toMatchObject({
      username: "cid-lopez",
      findByName: false,
      findByEmail: true,
    });

    const search = async (headers: Record<string, string>, q: string) => {
      const response = await app.inject({
        method: "GET",
        url: `/api/users/search?q=${encodeURIComponent(q)}`,
        headers,
      });
      expect(response.statusCode).toBe(200);
      return userSearchResponseSchema.parse(response.json()).items;
    };
    // By name, Cid is hidden; by @username and by email he is found.
    expect(await search(ana.headers, "lopez")).toEqual([]);
    expect(await search(ana.headers, "@cid")).toEqual([
      {
        id: cid.user.id,
        displayName: "Cid Lopez",
        username: "cid-lopez",
        relation: "none",
      },
    ]);
    expect(await search(ana.headers, "cid@example.test")).toHaveLength(1);
    expect(await search(ana.headers, "okafor")).toEqual([
      {
        id: ben.user.id,
        displayName: "Ben Okafor",
        username: "ben-okafor",
        relation: "none",
      },
    ]);
    // Hidden by email: nothing, and the shape stays the same.
    await account(ben.headers, { findByEmail: false });
    expect(await search(ana.headers, "ben@example.test")).toEqual([]);

    // The code page's lookup, then a request by id, seen from both sides.
    const lookup = await app.inject({
      method: "GET",
      url: "/api/users/BEN-OKAFOR",
      headers: ana.headers,
    });
    expect(lookup.statusCode).toBe(200);
    expect(userSummarySchema.parse(lookup.json())).toEqual({
      id: ben.user.id,
      displayName: "Ben Okafor",
      username: "ben-okafor",
      relation: "none",
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/api/users/nobody",
          headers: ana.headers,
        })
      ).statusCode,
    ).toBe(404);
    const sent = await app.inject({
      method: "POST",
      url: "/api/friends/requests",
      headers: ana.headers,
      payload: { userId: ben.user.id, message: "Found you by name" },
    });
    expect(sent.statusCode).toBe(201);
    const item = sentInvitationSchema.parse(sent.json());
    expect(item).toMatchObject({
      kind: "connection",
      email: "ben@example.test",
      message: "Found you by name",
    });
    expect(email.latestTo("ben@example.test").text).toContain("Ana Lopez");
    expect((await search(ana.headers, "okafor"))[0]?.relation).toBe(
      "requested",
    );
    expect((await search(ben.headers, "ana@example.test"))[0]?.relation).toBe(
      "incoming",
    );
    expect((await friendsOf(ben.headers)).incoming[0]?.message).toBe(
      "Found you by name",
    );
    const again = await app.inject({
      method: "POST",
      url: "/api/friends/requests",
      headers: ana.headers,
      payload: { userId: ben.user.id },
    });
    expect(again.statusCode).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/friends/requests",
          headers: ana.headers,
          payload: { userId: ana.user.id },
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/friends/requests",
          headers: ana.headers,
          payload: { userId: "00000000-0000-7000-8000-000000000000" },
        })
      ).statusCode,
    ).toBe(404);
    // Without a session nothing is served.
    for (const url of ["/api/users/search?q=ben", "/api/users/ben-okafor"])
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: "PATCH", url: "/api/account", payload: {} }))
        .statusCode,
    ).toBe(401);
  });

  it("caps searches per account per minute", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    let last = 0;
    for (let index = 0; index < 61; index += 1) {
      last = (
        await app.inject({
          method: "GET",
          url: "/api/users/search?q=an",
          headers: ana.headers,
        })
      ).statusCode;
    }
    expect(last).toBe(429);
  });
});
