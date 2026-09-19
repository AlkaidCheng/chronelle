import { resolve } from "node:path";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import {
  apiErrorResponseSchema,
  developmentSignInResponseSchema,
  eventResponseSchema,
  friendsResponseSchema,
  pendingShareSchema,
  personResponseSchema,
  personShareListResponseSchema,
  sentInvitationSchema,
  sessionResponseSchema,
  shareListResponseSchema,
  shareResponseSchema,
  workspaceMemberListResponseSchema,
  workspaceMemberSchema,
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
      clock: () => new Date("2030-08-01T12:00:00.000Z"),
      passwordAuth: {
        issuePolicy: { minIntervalMs: 0, windowMs: 0, maxPerWindow: 0 },
      },
      friends: { webBaseUrl: "https://chronelle.example" },
    }),
  );
});

afterEach(async () => {
  await app.close();
  await testDatabase.close();
});

type Headers = Record<string, string>;
const bearer = (token: string): Headers => ({
  authorization: `Bearer ${token}`,
});

async function signIn(address: string, displayName: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/development/sign-in",
    payload: { email: address, displayName },
  });
  expect(response.statusCode).toBe(200);
  const session = developmentSignInResponseSchema.parse(response.json());
  return { ...session, headers: bearer(session.accessToken) };
}

/** Two accounts become friends: one invites, the other accepts. */
async function befriend(
  requester: Headers,
  addressee: Headers,
  address: string,
) {
  const sent = await app.inject({
    method: "POST",
    url: "/api/friends/invitations",
    headers: requester,
    payload: { email: address },
  });
  expect(sent.statusCode).toBe(201);
  const item = sentInvitationSchema.parse(sent.json());
  const accepted = await app.inject({
    method: "POST",
    url: `/api/friends/requests/${item.id}/accept`,
    headers: addressee,
  });
  expect(accepted.statusCode).toBe(200);
  return item.id;
}

async function createEvent(headers: Headers, displayName: string) {
  const response = await app.inject({
    method: "POST",
    url: "/api/events",
    headers,
    payload: { displayName },
  });
  expect(response.statusCode).toBe(201);
  return eventResponseSchema.parse(response.json());
}

async function sharesOf(headers: Headers, resourceId: string) {
  const response = await app.inject({
    method: "GET",
    url: `/api/objects/${resourceId}/shares`,
    headers,
  });
  expect(response.statusCode).toBe(200);
  return shareListResponseSchema.parse(response.json());
}

describe("sharing with friends", () => {
  it("shares a resource with a friend by the connection", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const ben = await signIn("ben@example.test", "Ben");
    const eve = await signIn("eve@example.test", "Eve");
    const friendId = await befriend(
      ana.headers,
      ben.headers,
      "ben@example.test",
    );
    const event = await createEvent(ana.headers, "Kyoto in November");

    const shared = await app.inject({
      method: "POST",
      url: "/api/shares",
      headers: ana.headers,
      payload: { resourceId: event.id, friendId, role: "editor" },
    });
    expect(shared.statusCode).toBe(201);
    expect(shareResponseSchema.parse(shared.json())).toMatchObject({
      resourceId: event.id,
      role: "editor",
      principal: { id: ben.user.id, displayName: "Ben" },
    });
    // Ben reaches the event in Ana's workspace; Eve, who is nobody's friend
    // here, cannot use the connection, and a bad grantee set is refused.
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}`,
          headers: { ...ben.headers, "x-workspace-id": ana.workspace.id },
        })
      ).statusCode,
    ).toBe(200);
    const foreign = await app.inject({
      method: "POST",
      url: "/api/shares",
      headers: eve.headers,
      payload: { resourceId: event.id, friendId, role: "viewer" },
    });
    expect(foreign.statusCode).toBe(404);
    const both = await app.inject({
      method: "POST",
      url: "/api/shares",
      headers: ana.headers,
      payload: {
        resourceId: event.id,
        friendId,
        principalEmail: "ben@example.test",
        role: "viewer",
      },
    });
    expect(both.statusCode).toBe(400);
    expect(await sharesOf(ana.headers, event.id)).toMatchObject({
      items: [{ principal: { id: ben.user.id }, role: "editor" }],
      pending: [],
    });
  });

  it("lists what is shared each way with a person", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const ben = await signIn("ben@example.test", "Ben");
    const eve = await signIn("eve@example.test", "Eve");
    const kyoto = await createEvent(ana.headers, "Kyoto in November");
    const spring = await createEvent(ben.headers, "Spring cleaning");
    const card = personResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/persons",
          headers: ana.headers,
          payload: { displayName: "Ben", email: "ben@example.test" },
        })
      ).json(),
    );
    const listing = (headers: Headers, personId: string) =>
      app.inject({
        method: "GET",
        url: `/api/persons/${personId}/shares`,
        headers,
      });
    expect(
      personShareListResponseSchema.parse(
        (await listing(ana.headers, card.id)).json(),
      ),
    ).toEqual({ items: [] });

    // Ana shares Kyoto with Ben's card; Ben shares Spring cleaning with Ana.
    const outgoing = shareResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/shares",
          headers: ana.headers,
          payload: { resourceId: kyoto.id, personId: card.id, role: "editor" },
        })
      ).json(),
    );
    const incoming = shareResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/shares",
          headers: ben.headers,
          payload: {
            resourceId: spring.id,
            principalEmail: "ana@example.test",
            role: "viewer",
          },
        })
      ).json(),
    );
    const listed = await listing(ana.headers, card.id);
    expect(listed.statusCode).toBe(200);
    expect(personShareListResponseSchema.parse(listed.json())).toEqual({
      items: [
        {
          id: incoming.id,
          kind: "grant",
          direction: "incoming",
          resourceId: spring.id,
          objectType: "event",
          displayName: "Spring cleaning",
          role: "viewer",
          createdAt: incoming.createdAt,
        },
        {
          id: outgoing.id,
          kind: "grant",
          direction: "outgoing",
          resourceId: kyoto.id,
          objectType: "event",
          displayName: "Kyoto in November",
          role: "editor",
          createdAt: outgoing.createdAt,
        },
      ],
    });
    // Eve cannot see Ana's card; a card that does not exist reads the same,
    // and neither reveals whether the card exists.
    expect(
      (
        await listing(
          { ...eve.headers, "x-workspace-id": ana.workspace.id },
          card.id,
        )
      ).statusCode,
    ).toBe(404);
    expect(
      (await listing(ana.headers, "01a0b5d1-0000-7000-8000-000000000000"))
        .statusCode,
    ).toBe(404);
  });

  it("queues a share for an unlinked person, invites them, and grants it when they accept", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const event = await createEvent(ana.headers, "Mum's 70th");
    const priya = personResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/persons",
          headers: ana.headers,
          payload: { displayName: "Priya Raman", email: "Priya@Example.test" },
        })
      ).json(),
    );
    const nameless = personResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/persons",
          headers: ana.headers,
          payload: { displayName: "Grandpa" },
        })
      ).json(),
    );

    // Ticking Priya sends the invitation and queues the share.
    const queued = await app.inject({
      method: "POST",
      url: "/api/shares/pending",
      headers: ana.headers,
      payload: { resourceId: event.id, personId: priya.id, role: "viewer" },
    });
    expect(queued.statusCode).toBe(201);
    const pending = pendingShareSchema.parse(queued.json());
    expect(pending).toMatchObject({
      resourceId: event.id,
      role: "viewer",
      kind: "invitation",
      person: { id: priya.id, displayName: "Priya Raman" },
      email: "priya@example.test",
      grantedBy: ana.user.id,
    });
    const notice = email.latestTo("priya@example.test");
    expect(notice.subject).toBe("Chronelle: Ana invited you");
    const link =
      /https:\/\/chronelle\.example\/sign-up\?invitation=([\w-]+)/u.exec(
        notice.text,
      );
    expect(link).not.toBeNull();
    expect((await friendsOf(ana.headers)).sent).toMatchObject([
      { id: pending.itemId, kind: "invitation", personId: priya.id },
    ]);
    // Ticking her again changes the role without a second invitation.
    const again = await app.inject({
      method: "POST",
      url: "/api/shares/pending",
      headers: ana.headers,
      payload: { resourceId: event.id, personId: priya.id, role: "editor" },
    });
    expect(again.statusCode).toBe(201);
    expect(pendingShareSchema.parse(again.json())).toMatchObject({
      id: pending.id,
      role: "editor",
      itemId: pending.itemId,
    });
    expect(
      email.messages.filter((m) => m.to === "priya@example.test"),
    ).toHaveLength(1);
    expect(await sharesOf(ana.headers, event.id)).toMatchObject({
      items: [],
      pending: [{ id: pending.id, role: "editor", kind: "invitation" }],
    });
    // A person without an email cannot be invited.
    const refused = await app.inject({
      method: "POST",
      url: "/api/shares/pending",
      headers: ana.headers,
      payload: { resourceId: event.id, personId: nameless.id, role: "viewer" },
    });
    expect(refused.statusCode).toBe(400);
    expect(apiErrorResponseSchema.parse(refused.json()).error.message).toBe(
      "Give the person an email to invite them.",
    );

    // Priya signs up with the link and accepts: the share becomes a grant.
    const signedUp = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up",
      payload: {
        displayName: "Priya",
        email: "priya@example.test",
        username: "priya",
        password: "correct horse battery",
        invitationToken: link?.[1],
      },
    });
    expect(signedUp.statusCode).toBe(202);
    const verified = await app.inject({
      method: "POST",
      url: "/api/auth/verify-email",
      payload: {
        email: "priya@example.test",
        code: email.codeFor("priya@example.test"),
      },
    });
    expect(verified.statusCode).toBe(200);
    const priyaHeaders = bearer(verified.json().accessToken);
    expect(await sharesOf(ana.headers, event.id)).toMatchObject({
      items: [],
      pending: [{ id: pending.id, kind: "connection", role: "editor" }],
    });
    const request = (await friendsOf(priyaHeaders)).incoming[0];
    if (request === undefined) throw new Error("no request");
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/friends/requests/${request.id}/accept`,
          headers: priyaHeaders,
        })
      ).statusCode,
    ).toBe(200);
    expect(await sharesOf(ana.headers, event.id)).toMatchObject({
      items: [
        {
          principal: {
            id: verified.json().user.id,
            email: "priya@example.test",
          },
          role: "editor",
          grantedBy: ana.user.id,
        },
      ],
      pending: [],
    });
    // Priya sees the event in Ana's workspace, which is now among hers.
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}`,
          headers: { ...priyaHeaders, "x-workspace-id": ana.workspace.id },
        })
      ).statusCode,
    ).toBe(200);
    const priyaSession = sessionResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/auth/session",
          headers: priyaHeaders,
        })
      ).json(),
    );
    expect(
      priyaSession.availableWorkspaces.map((workspace) => workspace.id),
    ).toContain(ana.workspace.id);
  });

  it("takes a queued share back, and lets a declined or withdrawn request lapse it", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const ben = await signIn("ben@example.test", "Ben");
    const dan = await signIn("dan@example.test", "Dan");
    const event = await createEvent(ana.headers, "Spring cleaning");
    const cardFor = async (name: string, address: string) =>
      personResponseSchema.parse(
        (
          await app.inject({
            method: "POST",
            url: "/api/persons",
            headers: ana.headers,
            payload: { displayName: name, email: address },
          })
        ).json(),
      );
    const benCard = await cardFor("Benjamin", "ben@example.test");
    const danCard = await cardFor("Daniel", "dan@example.test");
    const queue = async (personId: string) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/shares/pending",
        headers: ana.headers,
        payload: { resourceId: event.id, personId, role: "viewer" },
      });
      expect(response.statusCode).toBe(201);
      return pendingShareSchema.parse(response.json());
    };
    // Ben and Dan have accounts: the ticks send them requests.
    const forBen = await queue(benCard.id);
    const forDan = await queue(danCard.id);
    expect(forBen.kind).toBe("connection");
    expect((await sharesOf(ana.headers, event.id)).pending).toHaveLength(2);

    // Ben declines: his share lapses. Dan's is taken back by Ana, then Dan
    // accepts and gets nothing.
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/friends/requests/${forBen.itemId}/decline`,
          headers: ben.headers,
        })
      ).statusCode,
    ).toBe(200);
    const revoked = await app.inject({
      method: "DELETE",
      url: `/api/shares/pending/${forDan.id}`,
      headers: ana.headers,
    });
    expect(revoked.statusCode).toBe(200);
    expect(revoked.json()).toMatchObject({
      id: forDan.id,
      revokedAt: "2030-08-01T12:00:00.000Z",
    });
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/shares/pending/${forDan.id}`,
          headers: ana.headers,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/friends/requests/${forDan.itemId}/accept`,
          headers: dan.headers,
        })
      ).statusCode,
    ).toBe(200);
    expect(await sharesOf(ana.headers, event.id)).toEqual({
      items: [],
      pending: [],
    });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}`,
          headers: dan.headers,
        })
      ).statusCode,
    ).toBe(404);
  });

  it("adds a friend to the workspace as a member and removes them", async () => {
    const ana = await signIn("ana@example.test", "Ana");
    const ben = await signIn("ben@example.test", "Ben");
    const eve = await signIn("eve@example.test", "Eve");
    const friendId = await befriend(
      ana.headers,
      ben.headers,
      "ben@example.test",
    );
    const event = await createEvent(ana.headers, "Household");

    const members = async (headers: Headers) =>
      app.inject({
        method: "GET",
        url: "/api/workspaces/current/members",
        headers,
      });
    expect(
      workspaceMemberListResponseSchema.parse(
        (await members(ana.headers)).json(),
      ).items,
    ).toMatchObject([
      { userId: ana.user.id, role: "owner", personal: true, friendId: null },
    ]);
    // Ben is not a member yet: Ana's workspace is out of his reach.
    const bensHeaders = { ...ben.headers, "x-workspace-id": ana.workspace.id };
    expect((await members(bensHeaders)).statusCode).toBe(404);

    const added = await app.inject({
      method: "POST",
      url: "/api/workspaces/current/members",
      headers: ana.headers,
      payload: { friendId, role: "viewer" },
    });
    expect(added.statusCode).toBe(201);
    expect(workspaceMemberSchema.parse(added.json())).toMatchObject({
      userId: ben.user.id,
      displayName: "Ben",
      email: "ben@example.test",
      role: "viewer",
      personal: false,
      friendId,
    });
    // Ben sees the workspace, its event, and its members; he cannot add.
    const bensSession = sessionResponseSchema.parse(
      (
        await app.inject({
          method: "GET",
          url: "/api/auth/session",
          headers: ben.headers,
        })
      ).json(),
    );
    expect(
      bensSession.availableWorkspaces.map((workspace) => workspace.id),
    ).toContain(ana.workspace.id);
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}`,
          headers: bensHeaders,
        })
      ).statusCode,
    ).toBe(200);
    expect(
      workspaceMemberListResponseSchema.parse(
        (await members(bensHeaders)).json(),
      ).items,
    ).toMatchObject([
      { userId: ana.user.id, role: "owner", friendId },
      { userId: ben.user.id, role: "viewer", friendId: null },
    ]);
    const asViewer = await app.inject({
      method: "POST",
      url: "/api/workspaces/current/members",
      headers: bensHeaders,
      payload: { friendId, role: "editor" },
    });
    expect(asViewer.statusCode).toBe(404);
    // A stranger's connection is not Ana's friend; Ana cannot remove herself.
    const strangerFriendId = await befriend(
      eve.headers,
      ben.headers,
      "ben@example.test",
    );
    const stranger = await app.inject({
      method: "POST",
      url: "/api/workspaces/current/members",
      headers: ana.headers,
      payload: { friendId: strangerFriendId, role: "viewer" },
    });
    expect(stranger.statusCode).toBe(404);
    const self = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/current/members/${ana.user.id}`,
      headers: ana.headers,
    });
    expect(self.statusCode).toBe(400);
    // Adding Ben again changes his role; removing him ends his access.
    const promoted = await app.inject({
      method: "POST",
      url: "/api/workspaces/current/members",
      headers: ana.headers,
      payload: { friendId, role: "editor" },
    });
    expect(workspaceMemberSchema.parse(promoted.json()).role).toBe("editor");
    const removed = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/current/members/${ben.user.id}`,
      headers: ana.headers,
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toEqual({ userId: ben.user.id, removed: true });
    expect(
      (
        await app.inject({
          method: "GET",
          url: `/api/events/${event.id}`,
          headers: bensHeaders,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          method: "DELETE",
          url: `/api/workspaces/current/members/${ben.user.id}`,
          headers: ana.headers,
        })
      ).statusCode,
    ).toBe(404);
  });
});

async function friendsOf(headers: Headers) {
  const response = await app.inject({
    method: "GET",
    url: "/api/friends",
    headers,
  });
  expect(response.statusCode).toBe(200);
  return friendsResponseSchema.parse(response.json());
}
