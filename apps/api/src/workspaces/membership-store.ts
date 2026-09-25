import { AuthorizationDeniedError } from "@livtales/authorization";
import {
  auditEvents,
  createId,
  type Database,
  type DatabaseTransaction,
  type Role,
  userConnections,
  users,
  workspaceMembers,
  workspaces,
} from "@livtales/db";
import { and, eq, or, sql } from "drizzle-orm";

import {
  accountEmail,
  FriendUnavailableError,
  InvalidFriendRequestError,
} from "../friends/friend-store.js";

/** A member of a workspace, as its members list shows them to the caller. */
export interface WorkspaceMemberView {
  readonly userId: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly role: Role;
  /** Whether the workspace is this member's personal one. */
  readonly personal: boolean;
  /** The caller's accepted connection to the member, when they are friends. */
  readonly friendId: string | null;
  readonly joinedAt: Date;
}

/** The workspace and account a membership action runs for. */
export interface MembershipActor {
  readonly workspaceId: string;
  readonly userId: string;
}

/** The member is an Owner and is not changed this way. */
export class WorkspaceMemberConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceMemberConflictError";
  }
}

/**
 * Workspace membership from the friends list: any member reads the list,
 * an Owner adds a friend as viewer or editor (or changes that friend's
 * role) and removes a member other than the personal owner and
 * themselves. Every change is audited in the workspace.
 */
export interface MembershipStore {
  list(actor: MembershipActor): Promise<readonly WorkspaceMemberView[]>;
  add(
    actor: MembershipActor,
    friendId: string,
    role: "editor" | "viewer",
    requestId: string,
  ): Promise<WorkspaceMemberView>;
  remove(
    actor: MembershipActor,
    memberId: string,
    requestId: string,
  ): Promise<void>;
}

/** The PostgreSQL store: each operation is one transaction with its audit event. */
export class PostgresMembershipStore implements MembershipStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async list(actor: MembershipActor): Promise<readonly WorkspaceMemberView[]> {
    return this.#database.transaction(async (transaction) => {
      await requireMembership(transaction, actor, false);
      const rows = await transaction
        .select()
        .from(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, actor.workspaceId));
      const views = await Promise.all(
        rows.map((row) => memberView(transaction, actor, row)),
      );
      views.sort(
        (a, b) =>
          Number(b.personal) - Number(a.personal) ||
          a.displayName.localeCompare(b.displayName) ||
          a.userId.localeCompare(b.userId),
      );
      return views;
    });
  }

  async add(
    actor: MembershipActor,
    friendId: string,
    role: "editor" | "viewer",
    requestId: string,
  ): Promise<WorkspaceMemberView> {
    return this.#database.transaction(async (transaction) => {
      await requireMembership(transaction, actor, true);
      if (role !== "editor" && role !== "viewer")
        throw new InvalidFriendRequestError("role must be editor or viewer.");
      const [connection] = await transaction
        .select()
        .from(userConnections)
        .where(
          and(
            eq(userConnections.id, friendId),
            eq(userConnections.status, "accepted"),
            or(
              eq(userConnections.requesterId, actor.userId),
              eq(userConnections.addresseeId, actor.userId),
            ),
          ),
        )
        .limit(1);
      if (connection === undefined)
        throw new FriendUnavailableError("The friend does not exist.");
      const memberId =
        connection.requesterId === actor.userId
          ? connection.addresseeId
          : connection.requesterId;
      const [owner] = await transaction
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, actor.workspaceId),
            eq(workspaceMembers.userId, memberId),
            eq(workspaceMembers.role, "owner"),
          ),
        )
        .limit(1);
      if (owner !== undefined)
        throw new WorkspaceMemberConflictError(
          "The member is an Owner of this workspace.",
        );
      const [member] = await transaction
        .insert(workspaceMembers)
        .values({ workspaceId: actor.workspaceId, userId: memberId, role })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          set: { role },
        })
        .returning();
      if (member === undefined)
        throw new Error("The membership was not recorded.");
      await transaction.insert(auditEvents).values({
        id: createId(),
        workspaceId: actor.workspaceId,
        actorType: "user",
        actorId: actor.userId,
        action: "workspace.member_added",
        resourceId: null,
        requestId,
        metadata: { memberId, role, friendId },
      });
      return memberView(transaction, actor, member);
    });
  }

  async remove(
    actor: MembershipActor,
    memberId: string,
    requestId: string,
  ): Promise<void> {
    return this.#database.transaction(async (transaction) => {
      await requireMembership(transaction, actor, true);
      const [personal] = await transaction
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(
          and(
            eq(workspaces.id, actor.workspaceId),
            eq(workspaces.personalOwnerId, memberId),
          ),
        )
        .limit(1);
      if (memberId === actor.userId || personal !== undefined)
        throw new InvalidFriendRequestError("The member cannot be removed.");
      const [member] = await transaction
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, actor.workspaceId),
            eq(workspaceMembers.userId, memberId),
          ),
        )
        .returning();
      if (member === undefined)
        throw new FriendUnavailableError("The member does not exist.");
      await transaction.insert(auditEvents).values({
        id: createId(),
        workspaceId: actor.workspaceId,
        actorType: "user",
        actorId: actor.userId,
        action: "workspace.member_removed",
        resourceId: null,
        requestId,
        metadata: { memberId, role: member.role },
      });
    });
  }
}

async function requireMembership(
  transaction: DatabaseTransaction,
  actor: MembershipActor,
  asOwner: boolean,
): Promise<void> {
  const [membership] = await transaction
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, actor.workspaceId),
        eq(workspaceMembers.userId, actor.userId),
      ),
    )
    .limit(1);
  if (membership === undefined || (asOwner && membership.role !== "owner"))
    throw new AuthorizationDeniedError();
}

async function memberView(
  transaction: DatabaseTransaction,
  actor: MembershipActor,
  row: { userId: string; role: Role; createdAt: Date },
): Promise<WorkspaceMemberView> {
  const [account] = await transaction
    .select()
    .from(users)
    .where(eq(users.id, row.userId))
    .limit(1);
  if (account === undefined) throw new Error("The member does not exist.");
  const [connection] = await transaction
    .select({ id: userConnections.id })
    .from(userConnections)
    .where(
      and(
        eq(userConnections.status, "accepted"),
        sql`LEAST(${userConnections.requesterId}, ${userConnections.addresseeId}) = LEAST(${actor.userId}::uuid, ${row.userId}::uuid)`,
        sql`GREATEST(${userConnections.requesterId}, ${userConnections.addresseeId}) = GREATEST(${actor.userId}::uuid, ${row.userId}::uuid)`,
      ),
    )
    .limit(1);
  const [workspace] = await transaction
    .select({ personalOwnerId: workspaces.personalOwnerId })
    .from(workspaces)
    .where(eq(workspaces.id, actor.workspaceId))
    .limit(1);
  return {
    userId: row.userId,
    displayName: account.displayName,
    email: accountEmail(account),
    role: row.role,
    personal: workspace?.personalOwnerId === row.userId,
    friendId: connection?.id ?? null,
    joinedAt: row.createdAt,
  };
}
