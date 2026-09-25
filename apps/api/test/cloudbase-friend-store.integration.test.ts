import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  auditEvents,
  persons,
  type UserRow,
  userInvitations,
} from "@livtales/db";
import {
  applyMigrations,
  createCloudBaseRpcDouble,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthIdentity } from "../src/authentication/auth-provider.js";
import { CloudBaseFriendStore } from "../src/friends/cloudbase-friend-store.js";
import {
  FriendConflictError,
  FriendLimitError,
  type FriendStore,
  FriendUnavailableError,
  InvalidFriendRequestError,
  PostgresFriendStore,
} from "../src/friends/friend-store.js";
import { PostgresIdentityStore } from "../src/identity/identity-store.js";

// The chronelle_friend_* functions must leave and return what the
// PostgreSQL friend store leaves and returns: the same lists, the same
// rows, the same refusals with the same messages, and the same audit
// events in the actor's personal workspace.

let database: TestDatabase;
let identity: PostgresIdentityStore;
let reference: FriendStore;
let cloudbase: FriendStore;
let counter = 0;

const clock = () => new Date("2030-08-01T12:00:00.000Z");
const digest = (seed: string) =>
  createHash("sha256").update(seed).digest("hex");
const requestId = () =>
  `01a0a000-0000-7000-8000-${String(++counter).padStart(12, "0")}`;

async function account(suffix: string): Promise<UserRow> {
  const auth: AuthIdentity = {
    provider: "test",
    subject: `subject-${suffix}`,
    email: `${suffix}@example.test`,
    displayName: `Person ${suffix}`,
  };
  return (await identity.signIn(auth, requestId())).user;
}

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  identity = new PostgresIdentityStore(database.connection.db);
  reference = new PostgresFriendStore(database.connection.db, clock);
  cloudbase = new CloudBaseFriendStore({
    rpc: createCloudBaseRpcDouble(database.connection.sql),
  });
});

afterAll(async () => {
  await database?.close();
});

const backends = () =>
  [
    ["postgres", () => reference],
    ["cloudbase", () => cloudbase],
  ] as const;

/** A token as the service makes one: 32 bytes, URL-safe, here from a seed. */
const token = (seed: string) =>
  createHash("sha256").update(`token:${seed}`).digest("base64url");

describe.each(backends())("%s friend store", (name, store) => {
  const invite = (
    userId: string,
    email: string | null,
    extra: Record<string, unknown> = {},
  ) => {
    const seed = `${name}${email}${counter}`;
    return store().invite(userId, {
      email,
      channel: email === null ? "link" : "email",
      message: null,
      personId: null,
      workspaceId: null,
      token: token(seed),
      tokenDigest: digest(seed),
      expiresAt: new Date("2030-08-15T12:00:00.000Z"),
      dailyLimit: 0,
      requestId: requestId(),
      ...extra,
    });
  };
  const renewal = (seed: string, extra: Record<string, unknown> = {}) => ({
    token: token(seed),
    tokenDigest: digest(seed),
    expiresAt: new Date("2030-08-15T12:00:00.000Z"),
    minIntervalMs: 0,
    requestId: requestId(),
    ...extra,
  });

  it("invites an account, lists it on both sides, accepts, and removes", async () => {
    const ana = await account(`${name}-ana`);
    const ben = await account(`${name}-ben`);
    const sent = await invite(ana.id, `${name}-ben@example.test`, {
      message: "Hello there",
    });
    expect(sent.kind).toBe("connection");
    expect(sent.recipient).toEqual({
      userId: ben.id,
      email: `${name}-ben@example.test`,
      displayName: `Person ${name}-ben`,
      locale: null,
    });
    expect(sent.sender).toEqual({
      displayName: `Person ${name}-ana`,
      email: `${name}-ana@example.test`,
      locale: null,
    });
    expect(sent.item).toMatchObject({
      kind: "connection",
      email: `${name}-ben@example.test`,
      message: "Hello there",
      personId: null,
      expiresAt: null,
    });
    expect(sent.item.createdAt).toBeInstanceOf(Date);

    const anasView = await store().list(ana.id);
    expect(anasView.friends).toEqual([]);
    expect(anasView.sent).toEqual([sent.item]);
    const bensView = await store().list(ben.id);
    expect(bensView.incoming).toMatchObject([
      {
        id: sent.item.id,
        status: "pending",
        direction: "received",
        userId: ana.id,
        displayName: `Person ${name}-ana`,
        email: `${name}-ana@example.test`,
        message: "Hello there",
      },
    ]);

    await expect(invite(ana.id, `${name}-ben@example.test`)).rejects.toThrow(
      new FriendConflictError("An invitation is already waiting."),
    );
    await expect(invite(ben.id, `${name}-ana@example.test`)).rejects.toThrow(
      new FriendConflictError("This person has already invited you."),
    );

    const accepted = await store().respond(
      ben.id,
      sent.item.id,
      true,
      requestId(),
    );
    expect(accepted).toMatchObject({
      id: sent.item.id,
      status: "accepted",
      direction: "received",
      userId: ana.id,
    });
    expect(accepted.respondedAt).toBeInstanceOf(Date);
    expect((await store().list(ana.id)).friends).toMatchObject([
      { id: sent.item.id, userId: ben.id, direction: "sent" },
    ]);
    await expect(invite(ben.id, `${name}-ana@example.test`)).rejects.toThrow(
      new FriendConflictError("You are already friends."),
    );

    expect(await store().remove(ana.id, sent.item.id, requestId())).toEqual({
      id: sent.item.id,
      kind: "connection",
      status: "removed",
    });
    expect((await store().list(ben.id)).friends).toEqual([]);
    await expect(
      store().remove(ana.id, sent.item.id, requestId()),
    ).rejects.toThrow(new FriendUnavailableError("The friend does not exist."));

    const actions = await database.connection.db
      .select({ action: auditEvents.action, actor: auditEvents.actorId })
      .from(auditEvents)
      .where(eq(auditEvents.action, "friend.removed"));
    expect(actions).toContainEqual({ action: "friend.removed", actor: ana.id });
  });

  it("declines, withdraws, resends after the interval, and caps the day", async () => {
    const ana = await account(`${name}-dana`);
    const ben = await account(`${name}-eben`);
    const first = await invite(ana.id, `${name}-eben@example.test`);
    await expect(
      store().resend(
        ana.id,
        first.item.id,
        renewal("b", { minIntervalMs: 60_000 }),
      ),
    ).rejects.toThrow(new FriendLimitError("Wait before sending again."));
    const resent = await store().resend(ana.id, first.item.id, renewal("b"));
    expect(resent.kind).toBe("connection");
    expect(resent.recipient?.userId).toBe(ben.id);

    expect(
      await store().respond(ben.id, first.item.id, false, requestId()),
    ).toMatchObject({
      status: "declined",
    });
    await expect(
      store().respond(ben.id, first.item.id, true, requestId()),
    ).rejects.toThrow(
      new FriendUnavailableError("The request does not exist."),
    );

    const second = await invite(ana.id, `${name}-eben@example.test`);
    await expect(
      store().withdraw(ben.id, second.item.id, requestId()),
    ).rejects.toThrow(
      new FriendUnavailableError("The invitation does not exist."),
    );
    expect(await store().withdraw(ana.id, second.item.id, requestId())).toEqual(
      {
        id: second.item.id,
        kind: "connection",
        status: "withdrawn",
      },
    );
    expect((await store().list(ben.id)).incoming).toEqual([]);

    await invite(ana.id, `${name}-eben@example.test`, { dailyLimit: 3 });
    await expect(
      invite(ana.id, `${name}-nobody@example.test`, { dailyLimit: 3 }),
    ).rejects.toThrow(new FriendLimitError("Too many invitations today."));
    await expect(invite(ana.id, `${name}-dana@example.test`)).rejects.toThrow(
      new InvalidFriendRequestError("You cannot invite yourself."),
    );
    await expect(
      invite(ana.id, `${name}-x@example.test`, { message: " padded " }),
    ).rejects.toThrow(
      new InvalidFriendRequestError("message is at most 500 characters."),
    );
    await expect(
      invite(ana.id, `${name}-x@example.test`, { personId: ana.id }),
    ).rejects.toThrow(
      new InvalidFriendRequestError(
        "personId names a person of the current workspace.",
      ),
    );
  });

  it("keeps an invitation for an address without an account until it signs up", async () => {
    const ana = await account(`${name}-fana`);
    const sent = await invite(ana.id, `${name}-new@example.test`, {
      message: "Come along",
      token: token(`${name}new`),
      tokenDigest: digest(`${name}new`),
    });
    expect(sent.kind).toBe("invitation");
    expect(sent.recipient).toBeNull();
    expect(sent.item).toMatchObject({
      kind: "invitation",
      email: `${name}-new@example.test`,
      channel: "email",
      token: token(`${name}new`),
      message: "Come along",
      expiresAt: new Date("2030-08-15T12:00:00.000Z"),
    });
    expect((await store().list(ana.id)).sent).toEqual([sent.item]);
    await expect(invite(ana.id, `${name}-new@example.test`)).rejects.toThrow(
      new FriendConflictError("An invitation is already waiting."),
    );
    const renewed = await store().resend(
      ana.id,
      sent.item.id,
      renewal(`${name}renewed`, {
        expiresAt: new Date("2030-08-20T12:00:00.000Z"),
      }),
    );
    expect(renewed).toMatchObject({
      kind: "invitation",
      recipient: null,
      item: {
        id: sent.item.id,
        token: token(`${name}renewed`),
        expiresAt: new Date("2030-08-20T12:00:00.000Z"),
      },
    });

    // Signing up with the address (and no link, or another link) turns
    // the invitation into a request from Ana; signing up through the link
    // itself would leave it open for the claim page.
    const newcomer = await account(`${name}-new`);
    expect(
      await store().claimInvitations(
        newcomer.id,
        digest(`${name}renewed`),
        requestId(),
      ),
    ).toBe(0);
    expect((await store().list(newcomer.id)).incoming).toEqual([]);
    expect(
      await store().claimInvitations(
        newcomer.id,
        digest("unknown"),
        requestId(),
      ),
    ).toBe(1);
    expect(await store().claimInvitations(newcomer.id, null, requestId())).toBe(
      0,
    );
    const view = await store().list(newcomer.id);
    expect(view.incoming).toMatchObject([
      { userId: ana.id, message: "Come along", direction: "received" },
    ]);
    expect((await store().list(ana.id)).sent).toMatchObject([
      { kind: "connection", email: `${name}-new@example.test` },
    ]);
    // A withdrawn invitation is gone for good.
    const other = await invite(ana.id, `${name}-gone@example.test`, {
      token: token(`${name}gone`),
      tokenDigest: digest(`${name}gone`),
    });
    expect(await store().withdraw(ana.id, other.item.id, requestId())).toEqual({
      id: other.item.id,
      kind: "invitation",
      status: "withdrawn",
    });
    const gone = await account(`${name}-gone`);
    expect(await store().claimInvitations(gone.id, null, requestId())).toBe(0);
  });

  it("makes a link without an address, renews it, peeks it, and reconciles the accept", async () => {
    const ana = await account(`${name}-lana`);
    const seed = `${name}-first-link`;
    const sent = await invite(ana.id, null, {
      message: "Scan me",
      token: token(seed),
      tokenDigest: digest(seed),
    });
    expect(sent).toMatchObject({
      kind: "invitation",
      recipient: null,
      item: {
        kind: "invitation",
        email: null,
        channel: "link",
        token: token(seed),
        message: "Scan me",
        expiresAt: new Date("2030-08-15T12:00:00.000Z"),
      },
    });
    // Links for someone new do not collide; an emailed one is required to have an address.
    const second = await invite(ana.id, null);
    expect(second.item.id).not.toBe(sent.item.id);
    await expect(invite(ana.id, null, { channel: "email" })).rejects.toThrow(
      new InvalidFriendRequestError("Give an email to send the invitation to."),
    );
    // A link without an address cannot be emailed, but can be renewed.
    await expect(
      store().resend(ana.id, sent.item.id, renewal(`${name}-resent`)),
    ).rejects.toThrow(
      new InvalidFriendRequestError(
        "The invitation has no address to send to.",
      ),
    );
    await expect(
      store().link(
        ana.id,
        sent.item.id,
        renewal(`${name}-early`, { minIntervalMs: 60_000 }),
      ),
    ).rejects.toThrow(new FriendLimitError("Wait before sending again."));
    const renewed = await store().link(
      ana.id,
      sent.item.id,
      renewal(`${name}-renewed`, {
        expiresAt: new Date("2030-08-20T12:00:00.000Z"),
      }),
    );
    expect(renewed.item).toMatchObject({
      id: sent.item.id,
      channel: "link",
      token: token(`${name}-renewed`),
      expiresAt: new Date("2030-08-20T12:00:00.000Z"),
    });
    await expect(store().peek(digest(seed))).rejects.toThrow(
      new FriendUnavailableError("The invitation does not exist."),
    );
    expect(await store().peek(digest(`${name}-renewed`))).toEqual({
      requester: { displayName: `Person ${name}-lana`, username: ana.username },
      message: "Scan me",
      queued: [],
      expiresAt: new Date("2030-08-20T12:00:00.000Z"),
      status: "open",
    });

    // The requester's own link is refused; a newcomer's accept makes the friendship at once.
    await expect(
      store().accept(ana.id, digest(`${name}-renewed`), requestId()),
    ).rejects.toThrow(
      new InvalidFriendRequestError("This is your own invitation link."),
    );
    const cleo = await account(`${name}-lcleo`);
    const accepted = await store().accept(
      cleo.id,
      digest(`${name}-renewed`),
      requestId(),
    );
    expect(accepted).toMatchObject({
      friendship: "made",
      connection: {
        status: "accepted",
        direction: "received",
        userId: ana.id,
        message: "Scan me",
      },
      shared: [],
      alreadyHad: [],
      personId: null,
      workspaceId: null,
    });
    expect(accepted.connection.respondedAt).toBeInstanceOf(Date);
    expect((await store().list(ana.id)).friends).toMatchObject([
      { id: accepted.connection.id, userId: cleo.id, direction: "sent" },
    ]);
    expect((await store().list(ana.id)).sent).toMatchObject([
      { id: second.item.id },
    ]);
    await expect(
      store().accept(cleo.id, digest(`${name}-renewed`), requestId()),
    ).rejects.toThrow(
      new FriendConflictError("This invitation was already accepted."),
    );
    expect((await store().peek(digest(`${name}-renewed`))).status).toBe("used");

    // A friend who opens another link keeps the friendship; a pending
    // request either way is resolved into it.
    const forFriend = await invite(ana.id, null, {
      token: token(`${name}-again`),
      tokenDigest: digest(`${name}-again`),
    });
    expect(
      await store().accept(cleo.id, digest(`${name}-again`), requestId()),
    ).toMatchObject({
      friendship: "existing",
      connection: { id: accepted.connection.id, status: "accepted" },
    });
    expect(forFriend.item.id).not.toBe(accepted.connection.id);
    const dan = await account(`${name}-ldan`);
    const request = await store().request(dan.id, {
      addresseeId: ana.id,
      message: null,
      personId: null,
      workspaceId: null,
      dailyLimit: 0,
      requestId: requestId(),
    });
    expect(request.item.kind).toBe("connection");
    await invite(ana.id, null, {
      token: token(`${name}-dan`),
      tokenDigest: digest(`${name}-dan`),
    });
    expect(
      await store().accept(dan.id, digest(`${name}-dan`), requestId()),
    ).toMatchObject({
      friendship: "made",
      connection: { id: request.item.id, status: "accepted", userId: ana.id },
    });
    expect((await store().list(dan.id)).friends).toMatchObject([
      { id: request.item.id, userId: ana.id },
    ]);

    // A withdrawn link and an expired one are refused and say so.
    const withdrawn = await invite(ana.id, null, {
      token: token(`${name}-withdrawn`),
      tokenDigest: digest(`${name}-withdrawn`),
    });
    await store().withdraw(ana.id, withdrawn.item.id, requestId());
    expect((await store().peek(digest(`${name}-withdrawn`))).status).toBe(
      "withdrawn",
    );
    const eve = await account(`${name}-leve`);
    await expect(
      store().accept(eve.id, digest(`${name}-withdrawn`), requestId()),
    ).rejects.toThrow(
      new FriendConflictError("This invitation is no longer open."),
    );
    const stale = await invite(ana.id, null, {
      token: token(`${name}-stale`),
      tokenDigest: digest(`${name}-stale`),
    });
    await database.connection.db
      .update(userInvitations)
      .set({
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
        expiresAt: new Date("2020-01-15T00:00:00.000Z"),
      })
      .where(eq(userInvitations.id, stale.item.id));
    expect((await store().peek(digest(`${name}-stale`))).status).toBe(
      "expired",
    );
    await expect(
      store().accept(eve.id, digest(`${name}-stale`), requestId()),
    ).rejects.toThrow(new FriendConflictError("This invitation has expired."));
    await expect(
      store().accept(eve.id, digest("nowhere"), requestId()),
    ).rejects.toThrow(
      new FriendUnavailableError("The invitation does not exist."),
    );
  });

  it("refuses an unknown card and accepts an unlinked, viewable one", async () => {
    const ana = await account(`${name}-gana`);
    const workspace = (
      await identity.signIn(
        {
          provider: "test",
          subject: `subject-${name}-gana`,
          email: `${name}-gana@example.test`,
          displayName: `Person ${name}-gana`,
        },
        requestId(),
      )
    ).workspace;
    await expect(
      invite(ana.id, `${name}-h@example.test`, {
        personId: "01a0a000-0000-7000-8000-000000000999",
        workspaceId: workspace.id,
      }),
    ).rejects.toThrow(
      new InvalidFriendRequestError(
        "personId must name an unlinked person you can view.",
      ),
    );
    const linked = await database.connection.db
      .select({ id: persons.objectId })
      .from(persons)
      .where(eq(persons.workspaceId, workspace.id));
    expect(linked).toEqual([]);
  });
});
