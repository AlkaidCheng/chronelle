import { AuthorizationDeniedError } from "@livtales/authorization";
import {
  auditEvents,
  createId,
  type Database,
  type DatabaseTransaction,
  objects,
  pendingShares,
  resourceGrants,
  type Role,
  roles,
  userConnections,
  users,
  workspaceMembers,
  workspaces,
} from "@livtales/db";
import type {
  WorkspaceDeletionRefusal,
  WorkspaceDeletionResponse,
} from "@livtales/schemas";
import {
  and,
  asc,
  count,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { WorkspaceUnavailableError } from "../errors.js";
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

const deletionRefusalMessages: Readonly<
  Record<WorkspaceDeletionRefusal, string>
> = {
  personal: "A Personal space is never deleted.",
  not_owner: "Only an Owner deletes a space.",
  holds_records:
    "The space holds records; move them to another space or to Trash first.",
};

/**
 * A space the caller may not delete: a Personal one (`personal`), one where
 * they are not an Owner (`not_owner`), or one that holds a live record
 * (`holds_records`).
 */
export class WorkspaceDeletionRefusedError extends Error {
  readonly reason: WorkspaceDeletionRefusal;

  constructor(reason: WorkspaceDeletionRefusal) {
    super(deletionRefusalMessages[reason]);
    this.name = "WorkspaceDeletionRefusedError";
    this.reason = reason;
  }

  /** The refusal a database function reported with this message, if any. */
  static fromMessage(
    message: string,
  ): WorkspaceDeletionRefusedError | undefined {
    const reason = (
      Object.entries(deletionRefusalMessages) as [
        WorkspaceDeletionRefusal,
        string,
      ][]
    ).find(([, text]) => text === message)?.[0];
    return reason === undefined
      ? undefined
      : new WorkspaceDeletionRefusedError(reason);
  }
}

/**
 * Shared workspaces and their members. Anyone creates a workspace and is
 * its Owner; any member reads the members; an Owner renames it, adds a
 * friend with any role (or changes that friend's role), changes a
 * member's role, and removes a member other than the personal owner and
 * themselves; any member but the personal owner leaves. A personal
 * workspace keeps its name and its account as its only Owner, and a shared
 * one keeps at least one Owner. An Owner deletes a shared workspace that
 * holds nothing but Trash: it keeps its row, records, and history, and
 * loses its waiting shares, the live grants on its records, and its
 * members. Every change is audited in the workspace and takes the
 * workspace's lock first, so changes to one workspace's members run one at
 * a time.
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
  /** Whether the caller may delete the workspace, for any member. */
  deletion(actor: MembershipActor): Promise<WorkspaceDeletionResponse>;
  /** An Owner deletes a shared workspace that holds nothing but Trash. */
  delete(actor: MembershipActor, requestId: string): Promise<void>;
}

/** The PostgreSQL store: each operation is one transaction with its audit event. */
export class PostgresMembershipStore implements MembershipStore {
  readonly #database: Database;
  readonly #clock: () => Date;

  constructor(database: Database, clock: () => Date = () => new Date()) {
    this.#database = database;
    this.#clock = clock;
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

  async deletion(actor: MembershipActor): Promise<WorkspaceDeletionResponse> {
    return this.#database.transaction(
      async (transaction) => {
        const workspace = await liveWorkspace(transaction, actor.workspaceId);
        const role = await requireMembership(transaction, actor);
        const records = await recordCounts(transaction, actor.workspaceId);
        const [members] = await transaction
          .select({ count: count() })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.workspaceId, actor.workspaceId));
        const reason: WorkspaceDeletionRefusal | null =
          workspace.personalOwnerId !== null
            ? "personal"
            : role !== "owner"
              ? "not_owner"
              : records.liveRecords > 0
                ? "holds_records"
                : null;
        return {
          deletable: reason === null,
          reason,
          ...records,
          memberCount: members?.count ?? 0,
        };
      },
      { isolationLevel: "repeatable read", accessMode: "read only" },
    );
  }

  async delete(actor: MembershipActor, requestId: string): Promise<void> {
    const deletedAt = this.#clock();
    return this.#database.transaction(async (transaction) => {
      const role = await lockedRole(transaction, actor);
      const workspace = await liveWorkspace(transaction, actor.workspaceId);
      if (workspace.personalOwnerId !== null)
        throw new WorkspaceDeletionRefusedError("personal");
      if (role !== "owner")
        throw new WorkspaceDeletionRefusedError("not_owner");
      const records = await recordCounts(transaction, actor.workspaceId);
      if (records.liveRecords > 0)
        throw new WorkspaceDeletionRefusedError("holds_records");
      const audit = {
        workspaceId: actor.workspaceId,
        actorType: "user" as const,
        actorId: actor.userId,
        requestId,
      };

      const pending = await transaction
        .select({ id: pendingShares.id, resourceId: pendingShares.resourceId })
        .from(pendingShares)
        .where(
          and(
            eq(pendingShares.workspaceId, actor.workspaceId),
            eq(pendingShares.status, "pending"),
          ),
        )
        .orderBy(asc(pendingShares.id))
        .for("update");
      for (const share of pending)
        await transaction.insert(auditEvents).values({
          id: createId(),
          ...audit,
          action: "resource.share_queue_revoked",
          resourceId: share.resourceId,
          metadata: { pendingShareId: share.id, reason: "workspace_deleted" },
        });
      if (pending.length > 0)
        await transaction
          .update(pendingShares)
          .set({
            status: "revoked",
            resolvedAt: sql`GREATEST(now(), ${pendingShares.createdAt})`,
          })
          .where(
            inArray(
              pendingShares.id,
              pending.map((share) => share.id),
            ),
          );

      const grants = await transaction
        .select({
          grantId: resourceGrants.id,
          resourceId: resourceGrants.resourceId,
          principalId: resourceGrants.principalId,
          role: resourceGrants.role,
        })
        .from(resourceGrants)
        .where(
          and(
            eq(resourceGrants.workspaceId, actor.workspaceId),
            or(
              isNull(resourceGrants.expiresAt),
              gt(resourceGrants.expiresAt, sql`now()`),
            ),
          ),
        )
        .orderBy(asc(resourceGrants.id))
        .for("update");
      for (const grant of grants)
        await transaction.insert(auditEvents).values({
          id: createId(),
          ...audit,
          action: "resource.share_revoked",
          resourceId: grant.resourceId,
          metadata: {
            grantId: grant.grantId,
            principalId: grant.principalId,
            role: grant.role,
            reason: "workspace_deleted",
          },
        });
      if (grants.length > 0)
        await transaction.delete(resourceGrants).where(
          inArray(
            resourceGrants.id,
            grants.map((grant) => grant.grantId),
          ),
        );

      const members = await transaction
        .delete(workspaceMembers)
        .where(eq(workspaceMembers.workspaceId, actor.workspaceId))
        .returning({
          userId: workspaceMembers.userId,
          role: workspaceMembers.role,
        });
      members.sort((a, b) =>
        a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0,
      );

      const deletedAfterCreation = sql`GREATEST(${deletedAt.toISOString()}::timestamptz, ${workspaces.createdAt})`;
      await transaction
        .update(workspaces)
        .set({
          deletedAt: deletedAfterCreation,
          deletedBy: actor.userId,
          updatedAt: deletedAfterCreation,
        })
        .where(eq(workspaces.id, actor.workspaceId));
      await transaction.insert(auditEvents).values({
        id: createId(),
        ...audit,
        action: "workspace.deleted",
        resourceId: null,
        metadata: {
          displayName: workspace.displayName,
          members,
          grants,
          pendingShares: pending.length,
          trashRecords: records.trashRecords,
        },
      });
    });
  }
}

/** The workspace, unless it does not exist or was deleted. */
async function liveWorkspace(
  transaction: DatabaseTransaction,
  workspaceId: string,
) {
  const [workspace] = await transaction
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (workspace === undefined || workspace.deletedAt !== null)
    throw new WorkspaceUnavailableError();
  return workspace;
}

/**
 * How many of the workspace's records are live and how many are in Trash;
 * a record whose permission scope is in Trash is in Trash with it.
 */
async function recordCounts(
  transaction: DatabaseTransaction,
  workspaceId: string,
): Promise<{ liveRecords: number; trashRecords: number }> {
  const scope = alias(objects, "scope");
  const live = sql`${objects.deletedAt} IS NULL AND ${scope.deletedAt} IS NULL`;
  const [counted] = await transaction
    .select({
      liveRecords: sql<number>`count(*) FILTER (WHERE ${live})`.mapWith(Number),
      trashRecords: sql<number>`count(*) FILTER (WHERE NOT (${live}))`.mapWith(
        Number,
      ),
    })
    .from(objects)
    .leftJoin(
      scope,
      and(
        eq(scope.workspaceId, objects.workspaceId),
        eq(scope.id, objects.permissionScopeId),
      ),
    )
    .where(eq(objects.workspaceId, workspaceId));
  return {
    liveRecords: counted?.liveRecords ?? 0,
    trashRecords: counted?.trashRecords ?? 0,
  };
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

/** The caller's role in the workspace; a caller who is not a member is refused. */
async function requireMembership(
  transaction: DatabaseTransaction,
  actor: MembershipActor,
): Promise<Role> {
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
  return membership.role;
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
