import { createHash } from "node:crypto";
import { resolve } from "node:path";

import { auditEvents, persons, type UserRow } from "@chronelle/db";
import {
  applyMigrations,
  createCloudBaseRpcDouble,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
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

describe.each(backends())("%s friend store", (name, store) => {
  const invite = (
    userId: string,
    email: string,
    extra: Record<string, unknown> = {},
  ) =>
    store().invite(userId, {
      email,
      message: null,
      personId: null,
      workspaceId: null,
      tokenDigest: digest(`${name}${email}${counter}`),
      expiresAt: new Date("2030-08-15T12:00:00.000Z"),
      dailyLimit: 0,
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
      store().resend(ana.id, first.item.id, {
        tokenDigest: digest("b"),
        expiresAt: new Date("2030-08-15T12:00:00.000Z"),
        minIntervalMs: 60_000,
        requestId: requestId(),
      }),
    ).rejects.toThrow(new FriendLimitError("Wait before sending again."));
    const resent = await store().resend(ana.id, first.item.id, {
      tokenDigest: digest("b"),
      expiresAt: new Date("2030-08-15T12:00:00.000Z"),
      minIntervalMs: 0,
      requestId: requestId(),
    });
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
      tokenDigest: digest(`${name}new`),
    });
    expect(sent.kind).toBe("invitation");
    expect(sent.recipient).toBeNull();
    expect(sent.item).toMatchObject({
      kind: "invitation",
      email: `${name}-new@example.test`,
      message: "Come along",
      expiresAt: new Date("2030-08-15T12:00:00.000Z"),
    });
    expect((await store().list(ana.id)).sent).toEqual([sent.item]);
    await expect(invite(ana.id, `${name}-new@example.test`)).rejects.toThrow(
      new FriendConflictError("An invitation is already waiting."),
    );
    const renewed = await store().resend(ana.id, sent.item.id, {
      tokenDigest: digest(`${name}renewed`),
      expiresAt: new Date("2030-08-20T12:00:00.000Z"),
      minIntervalMs: 0,
      requestId: requestId(),
    });
    expect(renewed).toMatchObject({
      kind: "invitation",
      recipient: null,
      item: {
        id: sent.item.id,
        expiresAt: new Date("2030-08-20T12:00:00.000Z"),
      },
    });

    // The new account claims by token, then sees the request from Ana.
    const newcomer = await account(`${name}-new`);
    expect(
      await store().claimInvitations(
        newcomer.id,
        digest("unknown"),
        requestId(),
      ),
    ).toBe(1);
    expect(
      await store().claimInvitations(
        newcomer.id,
        digest(`${name}renewed`),
        requestId(),
      ),
    ).toBe(0);
    const view = await store().list(newcomer.id);
    expect(view.incoming).toMatchObject([
      { userId: ana.id, message: "Come along", direction: "received" },
    ]);
    expect((await store().list(ana.id)).sent).toMatchObject([
      { kind: "connection", email: `${name}-new@example.test` },
    ]);
    // A withdrawn invitation is gone for good.
    const other = await invite(ana.id, `${name}-gone@example.test`, {
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
