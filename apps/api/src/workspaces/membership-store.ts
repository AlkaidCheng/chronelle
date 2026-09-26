import { AuthorizationDeniedError } from "@livtales/authorization";
import {
  auditEvents,
  createId,
  type Database,
  type DatabaseTransaction,
  type Role,
  roles,
  userConnections,
  users,
  workspaceMembers,
  workspaces,
} from "@livtales/db";
import { and, eq, ne, or, sql } from "drizzle-orm";

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

/** A workspace as the switcher lists it for the caller. */
export interface WorkspaceView {
  readonly id: string;
  readonly displayName: string;
  /** Whether it is its owner's personal workspace. */
  readonly personal: boolean;
  /** Its personal owner's name, else its creator's. */
  readonly ownerDisplayName: string | null;
  readonly role: Role | null;
}

/** The change would leave a shared workspace without an Owner. */
export class WorkspaceMemberConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkspaceMemberConflictError";
  }
}

/**
 * Shared workspaces and their members. Anyone creates a workspace and is
 * its Owner; any member reads the members; an Owner renames it, adds a
 * friend with any role (or changes that friend's role), changes a
 * member's role, and removes a member other than the personal owner and
 * themselves; any member but the personal owner leaves. A personal
 * workspace keeps its name and its account as its only Owner, and a shared
 * one keeps at least one Owner. Every change is audited in the workspace
 * and takes the workspace's lock first, so changes to one workspace's
 * members run one at a time.
 */
export interface MembershipStore {
  create(
    userId: string,
    displayName: string,
    requestId: string,
  ): Promise<WorkspaceView>;
  rename(
    actor: MembershipActor,
    displayName: string,
    requestId: string,
  ): Promise<WorkspaceView>;
  list(actor: MembershipActor): Promise<readonly WorkspaceMemberView[]>;
  add(
    actor: MembershipActor,
    friendId: string,
    role: Role,
    requestId: string,
  ): Promise<WorkspaceMemberView>;
  changeRole(
    actor: MembershipActor,
    memberId: string,
    role: Role,
    requestId: string,
  ): Promise<WorkspaceMemberView>;
  remove(
    actor: MembershipActor,
    memberId: string,
    requestId: string,
  ): Promise<void>;
  leave(actor: MembershipActor, requestId: string): Promise<void>;
}

/** The PostgreSQL store: each operation is one transaction with its audit event. */
export class PostgresMembershipStore implements MembershipStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async create(
    userId: string,
    displayName: string,
    requestId: string,
  ): Promise<WorkspaceView> {
    return this.#database.transaction(async (transaction) => {
      const name = requiredName(displayName);
      const [workspace] = await transaction
        .insert(workspaces)
        .values({ id: createId(), displayName: name, createdBy: userId })
        .returning();
      if (workspace === undefined)
        throw new Error("The workspace was not recorded.");
      await transaction
        .insert(workspaceMembers)
        .values({ workspaceId: workspace.id, userId, role: "owner" });
      await transaction.insert(auditEvents).values({
        id: createId(),
        workspaceId: workspace.id,
        actorType: "user",
        actorId: userId,
        action: "workspace.created",
        resourceId: null,
        requestId,
        metadata: { displayName: name },
      });
      return workspaceView(transaction, workspace.id, userId);
    });
  }

  async rename(
    actor: MembershipActor,
    displayName: string,
    requestId: string,
  ): Promise<WorkspaceView> {
    return this.#database.transaction(async (transaction) => {
      await requireOwner(transaction, actor);
      const name = requiredName(displayName);
      const [workspace] = await transaction
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, actor.workspaceId))
        .limit(1);
      if (workspace === undefined) throw new AuthorizationDeniedError();
      if (workspace.personalOwnerId !== null)
        throw new InvalidFriendRequestError("A Personal space keeps its name.");
      await transaction
        .update(workspaces)
        .set({
          displayName: name,
          updatedAt: sql`GREATEST(now(), ${workspaces.createdAt})`,
        })
        .where(eq(workspaces.id, actor.workspaceId));
      await transaction.insert(auditEvents).values({
        id: createId(),
        workspaceId: actor.workspaceId,
        actorType: "user",
        actorId: actor.userId,
        action: "workspace.renamed",
        resourceId: null,
        requestId,
        metadata: { displayName: name, previousName: workspace.displayName },
      });
      return workspaceView(transaction, actor.workspaceId, actor.userId);
    });
  }

  async list(actor: MembershipActor): Promise<readonly WorkspaceMemberView[]> {
    return this.#database.transaction(async (transaction) => {
      await requireMembership(transaction, actor);
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
    role: Role,
    requestId: string,
  ): Promise<WorkspaceMemberView> {
    return this.#database.transaction(async (transaction) => {
      await requireOwner(transaction, actor);
      if (!roles.includes(role))
        throw new InvalidFriendRequestError(
          "role must be owner, editor, or viewer.",
        );
      if (
        role === "owner" &&
        (await personalOwnerOf(transaction, actor.workspaceId)) !== null
      )
        throw new InvalidFriendRequestError("A Personal space has one Owner.");
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

  async changeRole(
    actor: MembershipActor,
    memberId: string,
    role: Role,
    requestId: string,
  ): Promise<WorkspaceMemberView> {
    return this.#database.transaction(async (transaction) => {
      await requireOwner(transaction, actor);
      if (!roles.includes(role))
        throw new InvalidFriendRequestError(
          "role must be owner, editor, or viewer.",
        );
      const [current] = await transaction
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, actor.workspaceId),
            eq(workspaceMembers.userId, memberId),
          ),
        )
        .limit(1);
      if (current === undefined)
        throw new FriendUnavailableError("The member does not exist.");
      const personalOwner = await personalOwnerOf(
        transaction,
        actor.workspaceId,
      );
      if (personalOwner === memberId)
        throw new InvalidFriendRequestError(
          "The Owner of a Personal space keeps the role.",
        );
      if (personalOwner !== null && role === "owner")
        throw new InvalidFriendRequestError("A Personal space has one Owner.");
      if (
        current.role === "owner" &&
        role !== "owner" &&
        !(await hasAnotherOwner(transaction, actor.workspaceId, memberId))
      )
        throw new WorkspaceMemberConflictError(
          "A space keeps at least one Owner.",
        );
      const [member] = await transaction
        .update(workspaceMembers)
        .set({ role })
        .where(
          and(
            eq(workspaceMembers.workspaceId, actor.workspaceId),
            eq(workspaceMembers.userId, memberId),
          ),
        )
        .returning();
      if (member === undefined)
        throw new Error("The membership was not recorded.");
      await transaction.insert(auditEvents).values({
        id: createId(),
        workspaceId: actor.workspaceId,
        actorType: "user",
        actorId: actor.userId,
        action: "workspace.member_role_changed",
        resourceId: null,
        requestId,
        metadata: { memberId, role, previousRole: current.role },
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
      await requireOwner(transaction, actor);
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

  async leave(actor: MembershipActor, requestId: string): Promise<void> {
    return this.#database.transaction(async (transaction) => {
      const role = await lockedRole(transaction, actor);
      if (role === null) throw new AuthorizationDeniedError();
      if (
        (await personalOwnerOf(transaction, actor.workspaceId)) === actor.userId
      )
        throw new InvalidFriendRequestError(
          "The Owner of a Personal space cannot leave it.",
        );
      if (
        role === "owner" &&
        !(await hasAnotherOwner(transaction, actor.workspaceId, actor.userId))
      )
        throw new WorkspaceMemberConflictError(
          "A space keeps at least one Owner.",
        );
      await transaction
        .delete(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, actor.workspaceId),
            eq(workspaceMembers.userId, actor.userId),
          ),
        );
      await transaction.insert(auditEvents).values({
        id: createId(),
        workspaceId: actor.workspaceId,
        actorType: "user",
        actorId: actor.userId,
        action: "workspace.member_left",
        resourceId: null,
        requestId,
        metadata: { role },
      });
    });
  }
}

/**
 * The caller's role in the workspace, or null, read after locking the
 * workspace row as protected mutations in it do.
 */
async function lockedRole(
  transaction: DatabaseTransaction,
  actor: MembershipActor,
): Promise<Role | null> {
  await transaction
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, actor.workspaceId))
    .for("no key update");
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
  return membership?.role ?? null;
}

async function requireOwner(
  transaction: DatabaseTransaction,
  actor: MembershipActor,
): Promise<void> {
  if ((await lockedRole(transaction, actor)) !== "owner")
    throw new AuthorizationDeniedError();
}

async function personalOwnerOf(
  transaction: DatabaseTransaction,
  workspaceId: string,
): Promise<string | null> {
  const [workspace] = await transaction
    .select({ personalOwnerId: workspaces.personalOwnerId })
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  return workspace?.personalOwnerId ?? null;
}

async function hasAnotherOwner(
  transaction: DatabaseTransaction,
  workspaceId: string,
  userId: string,
): Promise<boolean> {
  const [owner] = await transaction
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, "owner"),
        ne(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return owner !== undefined;
}

function requiredName(displayName: string): string {
  const name = displayName.trim();
  if (name === "")
    throw new InvalidFriendRequestError("displayName is required.");
  return name;
}

async function workspaceView(
  transaction: DatabaseTransaction,
  workspaceId: string,
  userId: string,
): Promise<WorkspaceView> {
  const [row] = await transaction
    .select({
      workspace: workspaces,
      ownerDisplayName: users.displayName,
      role: workspaceMembers.role,
    })
    .from(workspaces)
    .leftJoin(
      users,
      eq(
        users.id,
        sql`coalesce(${workspaces.personalOwnerId}, ${workspaces.createdBy})`,
      ),
    )
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.workspaceId, workspaces.id),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (row === undefined) throw new Error("The workspace does not exist.");
  return {
    id: row.workspace.id,
    displayName: row.workspace.displayName,
    personal: row.workspace.personalOwnerId !== null,
    ownerDisplayName: row.ownerDisplayName,
    role: row.role,
  };
}

async function requireMembership(
  transaction: DatabaseTransaction,
  actor: MembershipActor,
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
  if (membership === undefined) throw new AuthorizationDeniedError();
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
