import { createHash } from "node:crypto";
import { resolve } from "node:path";

import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@livtales/authorization";
import {
  auditEvents,
  resourceGrants,
  type UserRow,
  workspaceMembers,
} from "@livtales/db";
import {
  applyMigrations,
  createCloudBaseRpcDouble,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import type { EventPlanningObjectService } from "@livtales/object-model";
import type { ResourceGrantService } from "@livtales/authorization";
import { and, asc, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { AuthIdentity } from "../src/authentication/auth-provider.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";
import { CloudBaseFriendStore } from "../src/friends/cloudbase-friend-store.js";
import {
  type FriendStore,
  FriendUnavailableError,
  InvalidFriendRequestError,
  PostgresFriendStore,
} from "../src/friends/friend-store.js";
import { PostgresIdentityStore } from "../src/identity/identity-store.js";
import { CloudBasePendingShareStore } from "../src/sharing/cloudbase-pending-share-store.js";
import { CloudBasePersonShareStore } from "../src/sharing/cloudbase-person-share-store.js";
import {
  type PendingShareStore,
  PostgresPendingShareStore,
} from "../src/sharing/pending-share-store.js";
import {
  type PersonShareStore,
  PostgresPersonShareStore,
} from "../src/sharing/person-share-store.js";
import { CloudBaseMembershipStore } from "../src/workspaces/cloudbase-membership-store.js";
import {
  type MembershipStore,
  PostgresMembershipStore,
} from "../src/workspaces/membership-store.js";

// The chronelle_pending_share_* and chronelle_workspace_member_* functions,
// and the settling the redefined friend functions do, must leave and
// return what the PostgreSQL stores leave and return: the same lists, the
// same grants, the same refusals with the same messages, and the same
// audit events.

let database: TestDatabase;
let identity: PostgresIdentityStore;
let objects: EventPlanningObjectService;
let shares: ResourceGrantService;
let counter = 0;

const clock = () => new Date("2030-08-01T12:00:00.000Z");
const digest = (seed: string) =>
  createHash("sha256").update(seed).digest("hex");
const requestId = () =>
  `01a0a000-0000-7000-8000-${String(++counter).padStart(12, "0")}`;

interface Backend {
  readonly friends: FriendStore;
  readonly pending: PendingShareStore;
  readonly personShares: PersonShareStore;
  readonly members: MembershipStore;
}

let reference: Backend;
let cloudbase: Backend;

interface Account {
  readonly user: UserRow;
  readonly workspaceId: string;
  readonly principal: UserPrincipal;
}

async function account(suffix: string): Promise<Account> {
  const auth: AuthIdentity = {
    provider: "test",
    subject: `subject-${suffix}`,
    email: `${suffix}@example.test`,
    displayName: `Person ${suffix}`,
  };
  const session = await identity.signIn(auth, requestId());
  return {
    user: session.user,
    workspaceId: session.workspace.id,
    principal: {
      type: "user",
      userId: session.user.id,
      workspaceId: session.workspace.id,
    },
  };
}

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  identity = new PostgresIdentityStore(database.connection.db);
  const dependencies = createDevelopmentAppDependencies(database.connection, {
    clock,
  });
  objects = dependencies.objects;
  shares = dependencies.shares;
  const rpc = createCloudBaseRpcDouble(database.connection.sql);
  reference = {
    friends: new PostgresFriendStore(database.connection.db, clock),
    pending: new PostgresPendingShareStore(database.connection.db, clock),
    personShares: new PostgresPersonShareStore(database.connection.db, clock),
    members: new PostgresMembershipStore(database.connection.db),
  };
  cloudbase = {
    friends: new CloudBaseFriendStore({ rpc }),
    pending: new CloudBasePendingShareStore({ rpc }),
    personShares: new CloudBasePersonShareStore({ rpc }),
    members: new CloudBaseMembershipStore({ rpc }),
  };
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

const invite = (
  backend: Backend,
  from: Account,
  email: string | null,
  extra: Record<string, unknown> = {},
) => {
  const seed = `${email}${counter}${Math.random()}`;
  return backend.friends.invite(from.user.id, {
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

async function grantsOf(resourceId: string) {
  const rows = await database.connection.db
    .select({
      principalId: resourceGrants.principalId,
      role: resourceGrants.role,
      grantedBy: resourceGrants.grantedBy,
    })
    .from(resourceGrants)
    .where(eq(resourceGrants.resourceId, resourceId))
    .orderBy(asc(resourceGrants.createdAt));
  return rows;
}

async function auditsOf(workspaceId: string, actions: readonly string[]) {
  const rows = await database.connection.db
    .select({ action: auditEvents.action, metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, workspaceId),
        inArray(auditEvents.action, [...actions]),
      ),
    )
    .orderBy(asc(auditEvents.createdAt), asc(auditEvents.id));
  return rows.map(({ action, metadata }) => {
    const { grantId, pendingShareId, itemId, ...rest } = metadata as Record<
      string,
      unknown
    >;
    return {
      action,
      metadata: rest,
      ids: [grantId, pendingShareId, itemId].map((id) => typeof id),
    };
  });
}

describe.each(backends())("%s pending shares", (name, backend) => {
  it("queues on a request, lists it, changes its role, and grants it on acceptance", async () => {
    const ana = await account(`${name}-ana`);
    const ben = await account(`${name}-ben`);
    const event = await objects.createEvent(
      { principal: ana.principal, requestId: requestId() },
      { displayName: "Kyoto" },
    );
    const card = await objects.createPerson(
      { principal: ana.principal, requestId: requestId() },
      {
        displayName: "Benjamin",
        contacts: [{ kind: "email", value: `${name}-ben@example.test` }],
      },
    );
    const sent = await invite(backend(), ana, `${name}-ben@example.test`, {
      personId: card.id,
      workspaceId: ana.workspaceId,
    });
    expect(sent.kind).toBe("connection");

    const context = { principal: ana.principal, requestId: requestId() };
    const queued = await backend().pending.queue(context, {
      resourceId: event.id,
      role: "viewer",
      itemId: sent.item.id,
      personId: card.id,
    });
    expect(queued).toMatchObject({
      workspaceId: ana.workspaceId,
      resourceId: event.id,
      role: "viewer",
      status: "pending",
      kind: "connection",
      itemId: sent.item.id,
      person: { id: card.id, displayName: "Benjamin" },
      email: `${name}-ben@example.test`,
      grantedBy: ana.user.id,
    });
    expect(queued.createdAt).toBeInstanceOf(Date);
    const changed = await backend().pending.queue(
      { principal: ana.principal, requestId: requestId() },
      {
        resourceId: event.id,
        role: "editor",
        itemId: sent.item.id,
        personId: null,
      },
    );
    expect(changed).toMatchObject({
      id: queued.id,
      role: "editor",
      person: { id: card.id },
    });
    expect(await backend().pending.list(ana.principal, event.id)).toEqual([
      changed,
    ]);
    // Ben cannot see the queue on a resource he cannot recover.
    await expect(
      backend().pending.list(
        { ...ben.principal, workspaceId: ana.workspaceId },
        event.id,
      ),
    ).rejects.toThrow(AuthorizationDeniedError);

    await backend().friends.respond(
      ben.user.id,
      sent.item.id,
      true,
      requestId(),
    );
    expect(await backend().pending.list(ana.principal, event.id)).toEqual([]);
    expect(await grantsOf(event.id)).toEqual([
      { principalId: ben.user.id, role: "editor", grantedBy: ana.user.id },
    ]);
    expect(
      await auditsOf(ana.workspaceId, [
        "resource.share_queued",
        "resource.shared",
      ]),
    ).toEqual([
      {
        action: "resource.share_queued",
        metadata: { role: "viewer", personId: card.id },
        ids: ["undefined", "string", "string"],
      },
      {
        action: "resource.share_queued",
        metadata: { role: "editor" },
        ids: ["undefined", "string", "string"],
      },
      {
        action: "resource.shared",
        metadata: {
          principalId: ben.user.id,
          role: "editor",
          acceptedBy: ben.user.id,
          personId: card.id,
        },
        ids: ["string", "string", "undefined"],
      },
    ]);
  });

  it("carries a share from an invitation to the request it becomes", async () => {
    const ana = await account(`${name}-cana`);
    const event = await objects.createEvent(
      { principal: ana.principal, requestId: requestId() },
      { displayName: "Mum's 70th" },
    );
    const sent = await invite(backend(), ana, `${name}-priya@example.test`, {
      token: token(`${name}-priya-token`),
      tokenDigest: digest(`${name}-priya-token`),
    });
    expect(sent.kind).toBe("invitation");
    const queued = await backend().pending.queue(
      { principal: ana.principal, requestId: requestId() },
      {
        resourceId: event.id,
        role: "viewer",
        itemId: sent.item.id,
        personId: null,
      },
    );
    expect(queued).toMatchObject({
      kind: "invitation",
      person: null,
      email: `${name}-priya@example.test`,
    });
    // Priya signs up with the address on her own; the invitation becomes
    // a request and the share follows it.
    const priya = await account(`${name}-priya`);
    expect(
      await backend().friends.claimInvitations(
        priya.user.id,
        null,
        requestId(),
      ),
    ).toBe(1);
    const [carried] = await backend().pending.list(ana.principal, event.id);
    expect(carried).toMatchObject({
      id: queued.id,
      kind: "connection",
      email: `${name}-priya@example.test`,
    });
    if (carried === undefined) throw new Error("no carried share");
    await backend().friends.respond(
      priya.user.id,
      carried.itemId,
      true,
      requestId(),
    );
    expect(await grantsOf(event.id)).toEqual([
      { principalId: priya.user.id, role: "viewer", grantedBy: ana.user.id },
    ]);
  });

  it("lapses on a decline or a withdrawal, is revoked by the sharer, and refuses bad input", async () => {
    const ana = await account(`${name}-lana`);
    const ben = await account(`${name}-lben`);
    await account(`${name}-ldan`);
    const eve = await account(`${name}-leve`);
    const event = await objects.createEvent(
      { principal: ana.principal, requestId: requestId() },
      { displayName: "Spring cleaning" },
    );
    const context = () => ({
      principal: ana.principal,
      requestId: requestId(),
    });
    const toBen = await invite(backend(), ana, `${name}-lben@example.test`);
    const toDan = await invite(backend(), ana, `${name}-ldan@example.test`);
    const toEve = await invite(backend(), ana, `${name}-leve@example.test`);
    const forBen = await backend().pending.queue(context(), {
      resourceId: event.id,
      role: "viewer",
      itemId: toBen.item.id,
      personId: null,
    });
    const forDan = await backend().pending.queue(context(), {
      resourceId: event.id,
      role: "viewer",
      itemId: toDan.item.id,
      personId: null,
    });
    const forEve = await backend().pending.queue(context(), {
      resourceId: event.id,
      role: "owner",
      itemId: toEve.item.id,
      personId: null,
    });
    expect(
      (await backend().pending.list(ana.principal, event.id)).map((p) => p.id),
    ).toEqual([forBen.id, forDan.id, forEve.id]);

    await backend().friends.respond(
      ben.user.id,
      toBen.item.id,
      false,
      requestId(),
    );
    await backend().friends.withdraw(ana.user.id, toDan.item.id, requestId());
    const revoked = await backend().pending.revoke(
      context(),
      forEve.id,
      clock(),
    );
    expect(revoked).toEqual({ id: forEve.id, revokedAt: clock() });
    expect(await backend().pending.list(ana.principal, event.id)).toEqual([]);
    await backend().friends.respond(
      eve.user.id,
      toEve.item.id,
      true,
      requestId(),
    );
    expect(await grantsOf(event.id)).toEqual([]);
    await expect(
      backend().pending.revoke(context(), forEve.id, clock()),
    ).rejects.toThrow(AuthorizationDeniedError);

    // A foreign or unknown item, a bad role, a resource the caller cannot
    // share, and an unknown person are refused with the same messages.
    const foreign = await invite(backend(), eve, `${name}-lben@example.test`);
    const toFinn = await invite(backend(), ana, `${name}-lfinn@example.test`, {
      token: token(`${name}-finn`),
      tokenDigest: digest(`${name}-finn`),
    });
    const refusals: string[] = [];
    const attempt = async (
      input: Parameters<PendingShareStore["queue"]>[1],
    ) => {
      try {
        await backend().pending.queue(context(), input);
        refusals.push("accepted");
      } catch (error) {
        refusals.push(
          `${(error as Error).constructor.name}: ${(error as Error).message}`,
        );
      }
    };
    await attempt({
      resourceId: event.id,
      role: "viewer",
      itemId: foreign.item.id,
      personId: null,
    });
    await attempt({
      resourceId: event.id,
      role: "viewer",
      itemId: "01a0a000-0000-7000-8000-000000000999",
      personId: null,
    });
    await attempt({
      resourceId: event.id,
      role: "reader" as never,
      itemId: toFinn.item.id,
      personId: null,
    });
    await attempt({
      resourceId: event.id,
      role: "viewer",
      itemId: toFinn.item.id,
      personId: "01a0a000-0000-7000-8000-000000000998",
    });
    const bensEvent = await objects.createEvent(
      { principal: ben.principal, requestId: requestId() },
      { displayName: "Not Ana's" },
    );
    await attempt({
      resourceId: bensEvent.id,
      role: "viewer",
      itemId: toFinn.item.id,
      personId: null,
    });
    expect(refusals).toEqual([
      `${FriendUnavailableError.name}: The invitation does not exist.`,
      `${FriendUnavailableError.name}: The invitation does not exist.`,
      `${InvalidFriendRequestError.name}: role must be owner, editor, or viewer.`,
      `${FriendUnavailableError.name}: The requested user is unavailable.`,
      `${AuthorizationDeniedError.name}: The requested resource is unavailable.`,
    ]);
    expect(
      (await auditsOf(ana.workspaceId, ["resource.share_queue_revoked"])).map(
        (entry) => entry.action,
      ),
    ).toEqual(["resource.share_queue_revoked"]);
  });

  it("queues behind a link for a card without an email and applies the shares at accept, keeping a higher role and skipping Trash", async () => {
    const ana = await account(`${name}-kana`);
    const context = () => ({
      principal: ana.principal,
      requestId: requestId(),
    });
    const card = await objects.createPerson(context(), {
      displayName: "Priya",
      contacts: [{ kind: "phone", value: "+44 7700 900123" }],
    });
    const kyoto = await objects.createEvent(context(), {
      displayName: "Kyoto",
    });
    const lisbon = await objects.createEvent(context(), {
      displayName: "Lisbon",
    });
    const old = await objects.createEvent(context(), { displayName: "Old" });
    const link = await invite(backend(), ana, null, {
      personId: card.id,
      workspaceId: ana.workspaceId,
      token: token(`${name}-priya-link`),
      tokenDigest: digest(`${name}-priya-link`),
    });
    expect(link.item).toMatchObject({
      kind: "invitation",
      email: null,
      channel: "link",
      personId: card.id,
    });
    // One pending invitation per card.
    await expect(
      invite(backend(), ana, null, {
        personId: card.id,
        workspaceId: ana.workspaceId,
      }),
    ).rejects.toThrow("An invitation is already waiting.");
    for (const [resourceId, role] of [
      [kyoto.id, "viewer"],
      [lisbon.id, "viewer"],
      [old.id, "editor"],
    ] as const) {
      const queued = await backend().pending.queue(context(), {
        resourceId,
        role,
        itemId: link.item.id,
        personId: card.id,
      });
      expect(queued).toMatchObject({
        kind: "invitation",
        itemId: link.item.id,
        person: { id: card.id, displayName: "Priya" },
        email: null,
      });
    }
    expect(
      (await backend().friends.peek(digest(`${name}-priya-link`))).queued,
    ).toEqual([
      { resourceId: kyoto.id, displayName: "Kyoto", role: "viewer" },
      { resourceId: lisbon.id, displayName: "Lisbon", role: "viewer" },
      { resourceId: old.id, displayName: "Old", role: "editor" },
    ]);

    // Before the accept: Lisbon is shared with Priya's account as editor
    // already, and Old goes to Trash.
    const priya = await account(`${name}-kpriya`);
    await shares.share(context(), {
      resourceId: lisbon.id,
      principalEmail: `${name}-kpriya@example.test`,
      role: "editor",
    });
    await objects.softDelete(context(), old.id, old.version);
    expect(
      (await backend().friends.peek(digest(`${name}-priya-link`))).queued,
    ).toHaveLength(2);

    const accepted = await backend().friends.accept(
      priya.user.id,
      digest(`${name}-priya-link`),
      requestId(),
    );
    expect(accepted).toMatchObject({
      friendship: "made",
      connection: { status: "accepted", userId: ana.user.id },
      shared: [{ resourceId: kyoto.id, displayName: "Kyoto", role: "viewer" }],
      alreadyHad: [
        { resourceId: lisbon.id, displayName: "Lisbon", role: "editor" },
      ],
      personId: card.id,
      workspaceId: ana.workspaceId,
    });
    expect(await grantsOf(kyoto.id)).toEqual([
      { principalId: priya.user.id, role: "viewer", grantedBy: ana.user.id },
    ]);
    expect(await grantsOf(lisbon.id)).toEqual([
      { principalId: priya.user.id, role: "editor", grantedBy: ana.user.id },
    ]);
    expect(await grantsOf(old.id)).toEqual([]);
    expect(await backend().pending.list(ana.principal, kyoto.id)).toEqual([]);
    expect(await backend().pending.list(ana.principal, lisbon.id)).toEqual([]);
    expect(
      (await backend().friends.list(ana.user.id)).friends.map((f) => f.userId),
    ).toEqual([priya.user.id]);
    expect(
      (await auditsOf(ana.workspaceId, ["resource.shared"])).map(
        (entry) => entry.metadata,
      ),
    ).toEqual([
      { principalId: priya.user.id, role: "editor" },
      {
        principalId: priya.user.id,
        role: "viewer",
        acceptedBy: priya.user.id,
        personId: card.id,
      },
    ]);
  });
});

describe.each(backends())("%s workspace members", (name, backend) => {
  it("lists, adds a friend as viewer then editor, and removes them", async () => {
    const ana = await account(`${name}-mana`);
    const ben = await account(`${name}-mben`);
    const eve = await account(`${name}-meve`);
    const request = await invite(backend(), ana, `${name}-mben@example.test`);
    await backend().friends.respond(
      ben.user.id,
      request.item.id,
      true,
      requestId(),
    );
    const actor = { workspaceId: ana.workspaceId, userId: ana.user.id };

    expect(await backend().members.list(actor)).toEqual([
      {
        userId: ana.user.id,
        displayName: `Person ${name}-mana`,
        email: `${name}-mana@example.test`,
        role: "owner",
        personal: true,
        friendId: null,
        joinedAt: expect.any(Date),
      },
    ]);
    await expect(
      backend().members.list({
        workspaceId: ana.workspaceId,
        userId: ben.user.id,
      }),
    ).rejects.toThrow(AuthorizationDeniedError);

    const added = await backend().members.add(
      actor,
      request.item.id,
      "viewer",
      requestId(),
    );
    expect(added).toEqual({
      userId: ben.user.id,
      displayName: `Person ${name}-mben`,
      email: `${name}-mben@example.test`,
      role: "viewer",
      personal: false,
      friendId: request.item.id,
      joinedAt: expect.any(Date),
    });
    expect(
      (
        await backend().members.list({
          workspaceId: ana.workspaceId,
          userId: ben.user.id,
        })
      ).map((member) => [member.userId, member.role, member.friendId]),
    ).toEqual([
      [ana.user.id, "owner", request.item.id],
      [ben.user.id, "viewer", null],
    ]);
    expect(
      (
        await backend().members.add(
          actor,
          request.item.id,
          "editor",
          requestId(),
        )
      ).role,
    ).toBe("editor");

    const refusals: string[] = [];
    const attempt = async (run: () => Promise<unknown>) => {
      try {
        await run();
        refusals.push("accepted");
      } catch (error) {
        refusals.push(
          `${(error as Error).constructor.name}: ${(error as Error).message}`,
        );
      }
    };
    const strangers = await invite(backend(), eve, `${name}-mben@example.test`);
    await backend().friends.respond(
      ben.user.id,
      strangers.item.id,
      true,
      requestId(),
    );
    await attempt(() =>
      backend().members.add(actor, strangers.item.id, "viewer", requestId()),
    );
    await attempt(() =>
      backend().members.add(
        { workspaceId: ana.workspaceId, userId: ben.user.id },
        request.item.id,
        "viewer",
        requestId(),
      ),
    );
    await attempt(() =>
      backend().members.add(actor, request.item.id, "owner", requestId()),
    );
    await attempt(() =>
      backend().members.remove(actor, ana.user.id, requestId()),
    );
    await attempt(() =>
      backend().members.remove(actor, eve.user.id, requestId()),
    );
    // An Owner changes a co-owner's role by adding them again.
    const coOwner = await invite(backend(), ana, `${name}-meve@example.test`);
    await backend().friends.respond(
      eve.user.id,
      coOwner.item.id,
      true,
      requestId(),
    );
    await database.connection.db.insert(workspaceMembers).values({
      workspaceId: ana.workspaceId,
      userId: eve.user.id,
      role: "owner",
    });
    await attempt(() =>
      backend().members.add(actor, coOwner.item.id, "viewer", requestId()),
    );
    expect(refusals).toEqual([
      `${FriendUnavailableError.name}: The friend does not exist.`,
      `${AuthorizationDeniedError.name}: The requested resource is unavailable.`,
      `${InvalidFriendRequestError.name}: A Personal space has one Owner.`,
      `${InvalidFriendRequestError.name}: The member cannot be removed.`,
      `${FriendUnavailableError.name}: The member does not exist.`,
      "accepted",
    ]);

    await backend().members.remove(actor, ben.user.id, requestId());
    expect(
      (await backend().members.list(actor)).map((member) => member.userId),
    ).toEqual([ana.user.id, eve.user.id]);
    expect(
      (
        await auditsOf(ana.workspaceId, [
          "workspace.member_added",
          "workspace.member_removed",
        ])
      ).map((entry) => [entry.action, entry.metadata]),
    ).toEqual([
      [
        "workspace.member_added",
        { memberId: ben.user.id, role: "viewer", friendId: request.item.id },
      ],
      [
        "workspace.member_added",
        { memberId: ben.user.id, role: "editor", friendId: request.item.id },
      ],
      [
        "workspace.member_added",
        { memberId: eve.user.id, role: "viewer", friendId: coOwner.item.id },
      ],
      ["workspace.member_removed", { memberId: ben.user.id, role: "editor" }],
    ]);
  });
});

describe.each(backends())("%s person shares", (name, backend) => {
  it("lists what is shared each way with a person, queued shares included, and leaves out the expired, the trashed, and the unviewable", async () => {
    const ana = await account(`${name}-share-ana`);
    const ben = await account(`${name}-share-ben`);
    const context = () => ({
      principal: ana.principal,
      requestId: requestId(),
    });
    // Ben's card carries his account email; the card is not linked yet.
    const card = await objects.createPerson(context(), {
      displayName: "Benjamin",
      contacts: [{ kind: "email", value: `${name}-share-ben@example.test` }],
    });
    const kyoto = await objects.createEvent(context(), {
      displayName: "Kyoto",
    });
    const supper = await objects.createEvent(context(), {
      displayName: "Harvest supper",
    });
    const lapsed = await objects.createEvent(context(), {
      displayName: "Lapsed",
    });
    const cider = await objects.createTask(context(), {
      displayName: "Order the cider",
    });
    const spring = await objects.createEvent(
      { principal: ben.principal, requestId: requestId() },
      { displayName: "Spring cleaning" },
    );

    // Nothing shared yet, either way.
    expect(await backend().personShares.list(ana.principal, card.id)).toEqual(
      [],
    );

    // Ana shares two records with Ben's account through the card and the
    // email; Ben shares one back; one grant has expired; one record goes
    // to Trash after being shared.
    const kyotoGrant = await shares.share(context(), {
      resourceId: kyoto.id,
      personId: card.id,
      role: "editor",
    });
    const ciderGrant = await shares.share(context(), {
      resourceId: cider.id,
      principalEmail: `${name}-share-ben@example.test`,
      role: "viewer",
    });
    const springGrant = await shares.share(
      { principal: ben.principal, requestId: requestId() },
      {
        resourceId: spring.id,
        principalEmail: `${name}-share-ana@example.test`,
        role: "viewer",
      },
    );
    const lapsedGrant = await shares.share(context(), {
      resourceId: lapsed.id,
      personId: card.id,
      role: "viewer",
    });
    await database.connection.db
      .update(resourceGrants)
      .set({
        createdAt: new Date("2019-12-01T00:00:00.000Z"),
        expiresAt: new Date("2020-01-01T00:00:00.000Z"),
      })
      .where(eq(resourceGrants.id, lapsedGrant.id));
    await shares.share(context(), {
      resourceId: supper.id,
      personId: card.id,
      role: "viewer",
    });
    await objects.softDelete(context(), supper.id, supper.version);

    const listed = await backend().personShares.list(ana.principal, card.id);
    expect(listed.map(({ createdAt, ...item }) => item)).toEqual([
      {
        id: springGrant.id,
        kind: "grant",
        direction: "incoming",
        resourceId: spring.id,
        objectType: "event",
        displayName: "Spring cleaning",
        role: "viewer",
        scope: null,
      },
      {
        id: ciderGrant.id,
        kind: "grant",
        direction: "outgoing",
        resourceId: cider.id,
        objectType: "task",
        displayName: "Order the cider",
        role: "viewer",
        scope: null,
      },
      {
        id: kyotoGrant.id,
        kind: "grant",
        direction: "outgoing",
        resourceId: kyoto.id,
        objectType: "event",
        displayName: "Kyoto",
        role: "editor",
        scope: null,
      },
    ]);
    for (const item of listed) expect(item.createdAt).toBeInstanceOf(Date);

    // A queued share for an invited person lists as pending until it is
    // granted; Ben, no member of Ana's workspace, is refused Ana's cards,
    // even one shared with him, as is a card that does not exist.
    const priya = await objects.createPerson(context(), {
      displayName: "Priya",
      contacts: [{ kind: "email", value: `${name}-share-priya@example.test` }],
    });
    const sent = await invite(
      backend(),
      ana,
      `${name}-share-priya@example.test`,
      { personId: priya.id, workspaceId: ana.workspaceId },
    );
    const queued = await backend().pending.queue(context(), {
      resourceId: kyoto.id,
      role: "viewer",
      itemId: sent.item.id,
      personId: priya.id,
    });
    expect(
      (await backend().personShares.list(ana.principal, priya.id)).map(
        ({ createdAt, ...item }) => item,
      ),
    ).toEqual([
      {
        id: queued.id,
        kind: "pending",
        direction: "outgoing",
        resourceId: kyoto.id,
        objectType: "event",
        displayName: "Kyoto",
        role: "viewer",
        scope: null,
      },
    ]);
    const guest = { ...ben.principal, workspaceId: ana.workspaceId };
    await expect(backend().personShares.list(guest, card.id)).rejects.toThrow(
      AuthorizationDeniedError,
    );
    await shares.share(context(), {
      resourceId: priya.id,
      principalEmail: `${name}-share-ben@example.test`,
      role: "viewer",
    });
    await expect(backend().personShares.list(guest, priya.id)).rejects.toThrow(
      AuthorizationDeniedError,
    );
    await expect(
      backend().personShares.list(ana.principal, requestId()),
    ).rejects.toThrow(AuthorizationDeniedError);
  });
});
