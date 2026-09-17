import {
  auditEvents,
  createId,
  type Database,
  type DatabaseTransaction,
  objects,
  persons,
  type UserConnectionRow,
  type UserInvitationRow,
  type UserRow,
  userConnections,
  userInvitations,
  users,
  workspaces,
} from "@chronelle/db";
import { and, asc, eq, gt, isNull, or, sql } from "drizzle-orm";

import {
  carryPendingShares,
  lapsePendingShares,
  settlePendingShares,
} from "../sharing/pending-share-store.js";

/** A request or connection as one side of it sees the other. */
export interface ConnectionView {
  readonly id: string;
  readonly status:
    "pending" | "accepted" | "declined" | "withdrawn" | "removed";
  readonly direction: "sent" | "received";
  readonly userId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly message: string | null;
  readonly personId: string | null;
  readonly workspaceId: string | null;
  readonly createdAt: Date;
  readonly respondedAt: Date | null;
}

/** Something the account sent and is still waiting on. */
export interface SentItem {
  readonly id: string;
  readonly kind: "connection" | "invitation";
  readonly email: string;
  readonly message: string | null;
  readonly personId: string | null;
  readonly workspaceId: string | null;
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
}

export interface FriendsSnapshot {
  readonly friends: readonly ConnectionView[];
  readonly incoming: readonly ConnectionView[];
  readonly sent: readonly SentItem[];
}

/** An account as an email is addressed to it. */
export interface AccountContact {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly locale: string | null;
}

export interface Sender {
  readonly displayName: string;
  readonly email: string;
  readonly locale: string | null;
}

/** An invitation made or sent again: what waits, who receives the email, who sends it. */
export interface InviteOutcome {
  readonly kind: "connection" | "invitation";
  readonly item: SentItem;
  /** The account the request reached; null when an address without an account was invited. */
  readonly recipient: AccountContact | null;
  readonly sender: Sender;
}

export interface InviteInput {
  readonly email: string;
  readonly message: string | null;
  readonly personId: string | null;
  readonly workspaceId: string | null;
  readonly tokenDigest: string;
  readonly expiresAt: Date;
  readonly dailyLimit: number;
  readonly requestId: string;
}

export interface ResendInput {
  readonly tokenDigest: string;
  readonly expiresAt: Date;
  readonly minIntervalMs: number;
  readonly requestId: string;
}

export interface ItemState {
  readonly id: string;
  readonly kind: "connection" | "invitation";
  readonly status: "withdrawn" | "removed";
}

/** The request, invitation, or friend does not exist for this account. */
export class FriendUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FriendUnavailableError";
  }
}

/** A live request or connection already stands between the two accounts. */
export class FriendConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FriendConflictError";
  }
}

/** The daily cap or the resend interval refused the send. */
export class FriendLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FriendLimitError";
  }
}

/** The input cannot be acted on: the address, the message, or the person. */
export class InvalidFriendRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidFriendRequestError";
  }
}

/**
 * Friend persistence: what an account sees (its friends, the requests
 * waiting for it, what it sent), inviting an address (a pending
 * connection when one account has it, else an invitation keyed by the
 * digest of a sign-up token), answering, withdrawing, removing, sending
 * again, and turning the invitations waiting for a new account into
 * requests. One live connection per pair, one pending invitation per
 * requester and address, a daily cap on invitations, a resend interval,
 * and every change audited in the actor's personal workspace.
 */
export interface FriendStore {
  list(userId: string): Promise<FriendsSnapshot>;
  invite(userId: string, input: InviteInput): Promise<InviteOutcome>;
  respond(
    userId: string,
    connectionId: string,
    accept: boolean,
    requestId: string,
  ): Promise<ConnectionView>;
  withdraw(
    userId: string,
    itemId: string,
    requestId: string,
  ): Promise<ItemState>;
  remove(
    userId: string,
    connectionId: string,
    requestId: string,
  ): Promise<ItemState>;
  resend(
    userId: string,
    itemId: string,
    input: ResendInput,
  ): Promise<InviteOutcome>;
  claimInvitations(
    userId: string,
    tokenDigest: string | null,
    requestId: string,
  ): Promise<number>;
}

const digestShape = /^[0-9a-f]{64}$/u;

/** The address an account is reached at: its email, else the subject it signed up with. */
export function accountEmail(user: UserRow): string {
  return (user.email ?? user.providerSubject).toLowerCase();
}

function validAddress(email: string): boolean {
  return (
    email === email.trim().toLowerCase() &&
    email.length >= 3 &&
    email.length <= 254 &&
    email.indexOf("@") >= 1
  );
}

function validMessage(message: string | null): boolean {
  return (
    message === null ||
    (message === message.trim() && message !== "" && message.length <= 500)
  );
}

/** The PostgreSQL store: each operation is one transaction with its audit event. */
export class PostgresFriendStore implements FriendStore {
  readonly #database: Database;
  readonly #clock: () => Date;

  constructor(database: Database, clock: () => Date = () => new Date()) {
    this.#database = database;
    this.#clock = clock;
  }

  async list(userId: string): Promise<FriendsSnapshot> {
    return this.#database.transaction(async (transaction) => {
      await requireUser(transaction, userId);
      const now = this.#clock();
      const mine = or(
        eq(userConnections.requesterId, userId),
        eq(userConnections.addresseeId, userId),
      );
      const accepted = await transaction
        .select()
        .from(userConnections)
        .where(and(eq(userConnections.status, "accepted"), mine));
      const incoming = await transaction
        .select()
        .from(userConnections)
        .where(
          and(
            eq(userConnections.status, "pending"),
            eq(userConnections.addresseeId, userId),
          ),
        );
      const outgoing = await transaction
        .select()
        .from(userConnections)
        .where(
          and(
            eq(userConnections.status, "pending"),
            eq(userConnections.requesterId, userId),
          ),
        );
      const invitations = await transaction
        .select()
        .from(userInvitations)
        .where(
          and(
            eq(userInvitations.status, "pending"),
            eq(userInvitations.requesterId, userId),
            gt(userInvitations.expiresAt, now),
          ),
        );
      const friends = await Promise.all(
        accepted.map((row) => connectionView(transaction, row, userId)),
      );
      friends.sort(
        (a, b) =>
          a.displayName.localeCompare(b.displayName) ||
          a.id.localeCompare(b.id),
      );
      const received = await Promise.all(
        incoming.map((row) => connectionView(transaction, row, userId)),
      );
      received.sort(newestFirst);
      const sent: SentItem[] = [
        ...(await Promise.all(
          outgoing.map(async (row) =>
            sentConnection(await connectionView(transaction, row, userId)),
          ),
        )),
        ...invitations.map(sentInvitation),
      ];
      sent.sort(newestFirst);
      return { friends, incoming: received, sent };
    });
  }

  async invite(userId: string, input: InviteInput): Promise<InviteOutcome> {
    return this.#database.transaction(async (transaction) => {
      const me = await requireUser(transaction, userId);
      const home = await homeWorkspace(transaction, userId);
      const sentAt = this.#clock();
      if (!validAddress(input.email))
        throw new InvalidFriendRequestError("email must be a valid address.");
      if (input.email === accountEmail(me))
        throw new InvalidFriendRequestError("You cannot invite yourself.");
      if (!validMessage(input.message))
        throw new InvalidFriendRequestError(
          "message is at most 500 characters.",
        );
      if ((input.personId === null) !== (input.workspaceId === null))
        throw new InvalidFriendRequestError(
          "personId names a person of the current workspace.",
        );
      if (input.personId !== null && input.workspaceId !== null)
        await assertInvitablePerson(
          transaction,
          userId,
          input.workspaceId,
          input.personId,
        );
      if (input.dailyLimit > 0) {
        const since = new Date(sentAt.getTime() - 86_400_000);
        const [connections] = await transaction
          .select({ count: sql<number>`count(*)::int` })
          .from(userConnections)
          .where(
            and(
              eq(userConnections.requesterId, userId),
              gt(userConnections.createdAt, since),
            ),
          );
        const [invitations] = await transaction
          .select({ count: sql<number>`count(*)::int` })
          .from(userInvitations)
          .where(
            and(
              eq(userInvitations.requesterId, userId),
              gt(userInvitations.createdAt, since),
            ),
          );
        if (
          (connections?.count ?? 0) + (invitations?.count ?? 0) >=
          input.dailyLimit
        )
          throw new FriendLimitError("Too many invitations today.");
      }
      const recipients = await transaction
        .select()
        .from(users)
        .where(
          eq(
            sql`lower(coalesce(${users.email}, ${users.providerSubject}))`,
            input.email,
          ),
        );
      if (recipients.length > 1)
        throw new InvalidFriendRequestError(
          "The email belongs to more than one account.",
        );
      const sender = senderOf(me);
      const [recipient] = recipients;
      if (recipient !== undefined) {
        const existing = await liveConnection(
          transaction,
          userId,
          recipient.id,
        );
        if (existing !== undefined) {
          if (existing.status === "accepted")
            throw new FriendConflictError("You are already friends.");
          if (existing.requesterId === userId)
            throw new FriendConflictError("An invitation is already waiting.");
          throw new FriendConflictError("This person has already invited you.");
        }
        const [connection] = await transaction
          .insert(userConnections)
          .values({
            id: createId(),
            requesterId: userId,
            addresseeId: recipient.id,
            status: "pending",
            message: input.message,
            personId: input.personId,
            workspaceId: input.workspaceId,
            createdAt: sentAt,
            lastSentAt: sentAt,
          })
          .returning();
        if (connection === undefined)
          throw new Error("The connection was not recorded.");
        await audit(
          transaction,
          home,
          userId,
          "friend.invited",
          input.requestId,
          {
            connectionId: connection.id,
            addresseeId: recipient.id,
          },
        );
        return {
          kind: "connection",
          item: sentConnection(
            await connectionView(transaction, connection, userId),
          ),
          recipient: contactOf(recipient),
          sender,
        };
      }
      const [waiting] = await transaction
        .select({ id: userInvitations.id })
        .from(userInvitations)
        .where(
          and(
            eq(userInvitations.requesterId, userId),
            eq(userInvitations.email, input.email),
            eq(userInvitations.status, "pending"),
          ),
        )
        .limit(1);
      if (waiting !== undefined)
        throw new FriendConflictError("An invitation is already waiting.");
      if (!digestShape.test(input.tokenDigest) || input.expiresAt <= sentAt)
        throw new InvalidFriendRequestError("The invitation token is invalid.");
      const [invitation] = await transaction
        .insert(userInvitations)
        .values({
          id: createId(),
          requesterId: userId,
          email: input.email,
          message: input.message,
          personId: input.personId,
          workspaceId: input.workspaceId,
          status: "pending",
          tokenDigest: input.tokenDigest,
          createdAt: sentAt,
          lastSentAt: sentAt,
          expiresAt: input.expiresAt,
        })
        .returning();
      if (invitation === undefined)
        throw new Error("The invitation was not recorded.");
      await audit(
        transaction,
        home,
        userId,
        "friend.invitation_sent",
        input.requestId,
        { invitationId: invitation.id },
      );
      return {
        kind: "invitation",
        item: sentInvitation(invitation),
        recipient: null,
        sender,
      };
    });
  }

  async respond(
    userId: string,
    connectionId: string,
    accept: boolean,
    requestId: string,
  ): Promise<ConnectionView> {
    return this.#database.transaction(async (transaction) => {
      const home = await homeWorkspace(transaction, userId);
      const now = this.#clock();
      const [connection] = await transaction
        .update(userConnections)
        .set({
          status: accept ? "accepted" : "declined",
          respondedAt: sql`GREATEST(${now.toISOString()}::timestamptz, ${userConnections.createdAt})`,
        })
        .where(
          and(
            eq(userConnections.id, connectionId),
            eq(userConnections.addresseeId, userId),
            eq(userConnections.status, "pending"),
          ),
        )
        .returning();
      if (connection === undefined)
        throw new FriendUnavailableError("The request does not exist.");
      await audit(
        transaction,
        home,
        userId,
        accept ? "friend.accepted" : "friend.declined",
        requestId,
        { connectionId: connection.id, requesterId: connection.requesterId },
      );
      if (accept)
        await settlePendingShares(
          transaction,
          connection,
          userId,
          requestId,
          now,
        );
      else
        await lapsePendingShares(
          transaction,
          { connectionId: connection.id },
          now,
        );
      return connectionView(transaction, connection, userId);
    });
  }

  async withdraw(
    userId: string,
    itemId: string,
    requestId: string,
  ): Promise<ItemState> {
    return this.#database.transaction(async (transaction) => {
      const home = await homeWorkspace(transaction, userId);
      const now = this.#clock();
      const [connection] = await transaction
        .update(userConnections)
        .set({
          status: "withdrawn",
          respondedAt: sql`GREATEST(${now.toISOString()}::timestamptz, ${userConnections.createdAt})`,
        })
        .where(
          and(
            eq(userConnections.id, itemId),
            eq(userConnections.requesterId, userId),
            eq(userConnections.status, "pending"),
          ),
        )
        .returning();
      if (connection !== undefined) {
        await audit(transaction, home, userId, "friend.withdrawn", requestId, {
          connectionId: connection.id,
        });
        await lapsePendingShares(
          transaction,
          { connectionId: connection.id },
          now,
        );
        return { id: connection.id, kind: "connection", status: "withdrawn" };
      }
      const [invitation] = await transaction
        .update(userInvitations)
        .set({ status: "withdrawn" })
        .where(
          and(
            eq(userInvitations.id, itemId),
            eq(userInvitations.requesterId, userId),
            eq(userInvitations.status, "pending"),
          ),
        )
        .returning();
      if (invitation === undefined)
        throw new FriendUnavailableError("The invitation does not exist.");
      await audit(
        transaction,
        home,
        userId,
        "friend.invitation_withdrawn",
        requestId,
        { invitationId: invitation.id },
      );
      await lapsePendingShares(
        transaction,
        { invitationId: invitation.id },
        now,
      );
      return { id: invitation.id, kind: "invitation", status: "withdrawn" };
    });
  }

  async remove(
    userId: string,
    connectionId: string,
    requestId: string,
  ): Promise<ItemState> {
    return this.#database.transaction(async (transaction) => {
      const home = await homeWorkspace(transaction, userId);
      const now = this.#clock();
      const [connection] = await transaction
        .update(userConnections)
        .set({
          status: "removed",
          respondedAt: sql`GREATEST(${now.toISOString()}::timestamptz, ${userConnections.createdAt})`,
        })
        .where(
          and(
            eq(userConnections.id, connectionId),
            eq(userConnections.status, "accepted"),
            or(
              eq(userConnections.requesterId, userId),
              eq(userConnections.addresseeId, userId),
            ),
          ),
        )
        .returning();
      if (connection === undefined)
        throw new FriendUnavailableError("The friend does not exist.");
      await audit(transaction, home, userId, "friend.removed", requestId, {
        connectionId: connection.id,
      });
      return { id: connection.id, kind: "connection", status: "removed" };
    });
  }

  async resend(
    userId: string,
    itemId: string,
    input: ResendInput,
  ): Promise<InviteOutcome> {
    return this.#database.transaction(async (transaction) => {
      const me = await requireUser(transaction, userId);
      const home = await homeWorkspace(transaction, userId);
      const sentAt = this.#clock();
      const sender = senderOf(me);
      const [pending] = await transaction
        .select()
        .from(userConnections)
        .where(
          and(
            eq(userConnections.id, itemId),
            eq(userConnections.requesterId, userId),
            eq(userConnections.status, "pending"),
          ),
        )
        .for("update");
      if (pending !== undefined) {
        if (
          pending.lastSentAt.getTime() + input.minIntervalMs >
          sentAt.getTime()
        )
          throw new FriendLimitError("Wait before sending again.");
        const [connection] = await transaction
          .update(userConnections)
          .set({ lastSentAt: sentAt })
          .where(eq(userConnections.id, itemId))
          .returning();
        if (connection === undefined)
          throw new Error("The connection was not updated.");
        const [recipient] = await transaction
          .select()
          .from(users)
          .where(eq(users.id, connection.addresseeId))
          .limit(1);
        if (recipient === undefined)
          throw new Error("The addressee does not exist.");
        await audit(
          transaction,
          home,
          userId,
          "friend.resent",
          input.requestId,
          {
            connectionId: connection.id,
          },
        );
        return {
          kind: "connection",
          item: sentConnection(
            await connectionView(transaction, connection, userId),
          ),
          recipient: contactOf(recipient),
          sender,
        };
      }
      const [invitation] = await transaction
        .select()
        .from(userInvitations)
        .where(
          and(
            eq(userInvitations.id, itemId),
            eq(userInvitations.requesterId, userId),
            eq(userInvitations.status, "pending"),
          ),
        )
        .for("update");
      if (invitation === undefined)
        throw new FriendUnavailableError("The invitation does not exist.");
      if (
        invitation.lastSentAt.getTime() + input.minIntervalMs >
        sentAt.getTime()
      )
        throw new FriendLimitError("Wait before sending again.");
      if (!digestShape.test(input.tokenDigest) || input.expiresAt <= sentAt)
        throw new InvalidFriendRequestError("The invitation token is invalid.");
      const [renewed] = await transaction
        .update(userInvitations)
        .set({
          tokenDigest: input.tokenDigest,
          expiresAt: input.expiresAt,
          lastSentAt: sentAt,
        })
        .where(eq(userInvitations.id, itemId))
        .returning();
      if (renewed === undefined)
        throw new Error("The invitation was not updated.");
      await audit(
        transaction,
        home,
        userId,
        "friend.invitation_resent",
        input.requestId,
        { invitationId: renewed.id },
      );
      return {
        kind: "invitation",
        item: sentInvitation(renewed),
        recipient: null,
        sender,
      };
    });
  }

  async claimInvitations(
    userId: string,
    tokenDigest: string | null,
    requestId: string,
  ): Promise<number> {
    return this.#database.transaction(async (transaction) => {
      const me = await requireUser(transaction, userId);
      const claimedAt = this.#clock();
      const byToken =
        tokenDigest === null
          ? sql`false`
          : eq(userInvitations.tokenDigest, tokenDigest);
      const waiting = await transaction
        .select()
        .from(userInvitations)
        .where(
          and(
            eq(userInvitations.status, "pending"),
            gt(userInvitations.expiresAt, claimedAt),
            sql`${userInvitations.requesterId} <> ${userId}`,
            or(eq(userInvitations.email, accountEmail(me)), byToken),
          ),
        )
        .orderBy(asc(userInvitations.createdAt))
        .for("update");
      let claimed = 0;
      for (const invitation of waiting) {
        await transaction
          .update(userInvitations)
          .set({
            status: "consumed",
            consumedAt: claimedAt,
            consumedBy: userId,
          })
          .where(eq(userInvitations.id, invitation.id));
        let connection = await liveConnection(
          transaction,
          invitation.requesterId,
          userId,
        );
        if (connection === undefined) {
          [connection] = await transaction
            .insert(userConnections)
            .values({
              id: createId(),
              requesterId: invitation.requesterId,
              addresseeId: userId,
              status: "pending",
              message: invitation.message,
              personId: invitation.personId,
              workspaceId: invitation.workspaceId,
              createdAt: claimedAt,
              lastSentAt: claimedAt,
            })
            .returning();
          if (connection === undefined)
            throw new Error("The connection was not recorded.");
          await audit(
            transaction,
            await homeWorkspace(transaction, invitation.requesterId),
            userId,
            "friend.invitation_claimed",
            requestId,
            { invitationId: invitation.id, connectionId: connection.id },
          );
          claimed += 1;
        }
        await carryPendingShares(
          transaction,
          invitation.id,
          connection,
          userId,
          requestId,
          claimedAt,
        );
      }
      return claimed;
    });
  }
}

async function requireUser(
  transaction: DatabaseTransaction,
  userId: string,
): Promise<UserRow> {
  const [user] = await transaction
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (user === undefined)
    throw new FriendUnavailableError("The user does not exist.");
  return user;
}

async function homeWorkspace(
  transaction: DatabaseTransaction,
  userId: string,
): Promise<string> {
  const [workspace] = await transaction
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.personalOwnerId, userId))
    .limit(1);
  if (workspace === undefined)
    throw new FriendUnavailableError("The user does not exist.");
  return workspace.id;
}

async function assertInvitablePerson(
  transaction: DatabaseTransaction,
  userId: string,
  workspaceId: string,
  personId: string,
): Promise<void> {
  const [person] = await transaction
    .select({ id: persons.objectId })
    .from(persons)
    .innerJoin(
      objects,
      and(
        eq(objects.id, persons.objectId),
        eq(objects.workspaceId, persons.workspaceId),
      ),
    )
    .where(
      and(
        eq(persons.objectId, personId),
        eq(persons.workspaceId, workspaceId),
        isNull(persons.userId),
        isNull(objects.deletedAt),
        sql`chronelle_can_view(${workspaceId}::uuid, ${userId}::uuid, ${personId}::uuid)`,
      ),
    )
    .limit(1);
  if (person === undefined)
    throw new InvalidFriendRequestError(
      "personId must name an unlinked person you can view.",
    );
}

async function liveConnection(
  transaction: DatabaseTransaction,
  first: string,
  second: string,
): Promise<UserConnectionRow | undefined> {
  const [row] = await transaction
    .select()
    .from(userConnections)
    .where(
      and(
        sql`${userConnections.status} IN ('pending', 'accepted')`,
        sql`LEAST(${userConnections.requesterId}, ${userConnections.addresseeId}) = LEAST(${first}::uuid, ${second}::uuid)`,
        sql`GREATEST(${userConnections.requesterId}, ${userConnections.addresseeId}) = GREATEST(${first}::uuid, ${second}::uuid)`,
      ),
    )
    .limit(1);
  return row;
}

async function audit(
  transaction: DatabaseTransaction,
  workspaceId: string,
  actorId: string,
  action: string,
  requestId: string,
  metadata: Record<string, string>,
): Promise<void> {
  await transaction.insert(auditEvents).values({
    id: createId(),
    workspaceId,
    actorType: "user",
    actorId,
    action,
    resourceId: null,
    requestId,
    metadata,
  });
}

async function connectionView(
  transaction: DatabaseTransaction,
  row: UserConnectionRow,
  viewerId: string,
): Promise<ConnectionView> {
  const otherId =
    row.requesterId === viewerId ? row.addresseeId : row.requesterId;
  const [other] = await transaction
    .select()
    .from(users)
    .where(eq(users.id, otherId))
    .limit(1);
  if (other === undefined) throw new Error("The other account does not exist.");
  return {
    id: row.id,
    status: row.status,
    direction: row.requesterId === viewerId ? "sent" : "received",
    userId: other.id,
    displayName: other.displayName,
    email: accountEmail(other),
    message: row.message,
    personId: row.personId,
    workspaceId: row.workspaceId,
    createdAt: row.createdAt,
    respondedAt: row.respondedAt,
  };
}

function sentConnection(view: ConnectionView): SentItem {
  return {
    id: view.id,
    kind: "connection",
    email: view.email ?? "",
    message: view.message,
    personId: view.personId,
    workspaceId: view.workspaceId,
    createdAt: view.createdAt,
    expiresAt: null,
  };
}

function sentInvitation(row: UserInvitationRow): SentItem {
  return {
    id: row.id,
    kind: "invitation",
    email: row.email,
    message: row.message,
    personId: row.personId,
    workspaceId: row.workspaceId,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

function contactOf(user: UserRow): AccountContact {
  return {
    userId: user.id,
    email: accountEmail(user),
    displayName: user.displayName,
    locale: user.locale,
  };
}

function senderOf(user: UserRow): Sender {
  return {
    displayName: user.displayName,
    email: accountEmail(user),
    locale: user.locale,
  };
}

function newestFirst(
  a: { createdAt: Date; id: string },
  b: { createdAt: Date; id: string },
): number {
  return (
    b.createdAt.getTime() - a.createdAt.getTime() || a.id.localeCompare(b.id)
  );
}
