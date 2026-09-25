import {
  AuthorizationDeniedError,
  type GrantMutationContext,
  type UserPrincipal,
  withReadAuthorization,
  withStableAuthorization,
} from "@livtales/authorization";
import {
  auditEvents,
  createId,
  type Database,
  type DatabaseTransaction,
  objects,
  type PendingShareRow,
  pendingShares,
  persons,
  resourceGrants,
  type Role,
  roles,
  type UserConnectionRow,
  userConnections,
  userInvitations,
  users,
} from "@livtales/db";
import { and, asc, eq, gt, or, sql } from "drizzle-orm";

import {
  accountEmail,
  FriendUnavailableError,
  InvalidFriendRequestError,
} from "../friends/friend-store.js";

/** A share waiting on a request or invitation, as the Share dialog lists it. */
export interface PendingShareView {
  readonly id: string;
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly role: Role;
  readonly status: "pending";
  readonly kind: "connection" | "invitation";
  readonly itemId: string;
  readonly person: { readonly id: string; readonly displayName: string } | null;
  readonly email: string | null;
  readonly grantedBy: string;
  readonly createdAt: Date;
}

export interface QueueShareInput {
  readonly resourceId: string;
  readonly role: Role;
  /** The pending request or invitation the acting account sent. */
  readonly itemId: string;
  /** The person card the share was ticked from, when there was one. */
  readonly personId: string | null;
}

export interface RevokedPendingShare {
  readonly id: string;
  readonly revokedAt: Date;
}

/**
 * Shares that wait on a friend request or an invitation the acting
 * account sent: listed with the grants of a resource, queued by whoever
 * can share the resource, taken back by whoever can revoke its grants.
 * The friend store settles them when the request is answered.
 */
export interface PendingShareStore {
  list(
    principal: UserPrincipal,
    resourceId: string,
  ): Promise<readonly PendingShareView[]>;
  queue(
    context: GrantMutationContext,
    input: QueueShareInput,
  ): Promise<PendingShareView>;
  revoke(
    context: GrantMutationContext,
    pendingId: string,
    revokedAt: Date,
  ): Promise<RevokedPendingShare>;
}

/** The PostgreSQL store: each operation is one authorized transaction with its audit event. */
export class PostgresPendingShareStore implements PendingShareStore {
  readonly #database: Database;
  readonly #clock: () => Date;

  constructor(database: Database, clock: () => Date = () => new Date()) {
    this.#database = database;
    this.#clock = clock;
  }

  async list(
    principal: UserPrincipal,
    resourceId: string,
  ): Promise<readonly PendingShareView[]> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "recover", {
          id: resourceId,
          workspaceId: principal.workspaceId,
        });
        const rows = await transaction
          .select()
          .from(pendingShares)
          .where(
            and(
              eq(pendingShares.workspaceId, principal.workspaceId),
              eq(pendingShares.resourceId, resourceId),
              eq(pendingShares.status, "pending"),
            ),
          )
          .orderBy(asc(pendingShares.createdAt), asc(pendingShares.id));
        return Promise.all(rows.map((row) => pendingView(transaction, row)));
      },
    );
  }

  async queue(
    context: GrantMutationContext,
    input: QueueShareInput,
  ): Promise<PendingShareView> {
    const { principal } = context;
    const now = this.#clock();
    return withStableAuthorization(
      this.#database,
      principal.workspaceId,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "share", {
          id: input.resourceId,
          workspaceId: principal.workspaceId,
        });
        if (!roles.includes(input.role))
          throw new InvalidFriendRequestError(
            "role must be owner, editor, or viewer.",
          );
        const item = await sentItem(
          transaction,
          principal.userId,
          input.itemId,
          now,
        );
        if (input.personId !== null) {
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
                eq(persons.workspaceId, principal.workspaceId),
                eq(persons.objectId, input.personId),
                sql`${objects.deletedAt} IS NULL`,
                authorization.resourcePredicate(principal, "view"),
              ),
            )
            .limit(1);
          if (person === undefined)
            throw new FriendUnavailableError(
              "The requested user is unavailable.",
            );
        }
        const [standing] = await transaction
          .select()
          .from(pendingShares)
          .where(
            and(
              eq(pendingShares.workspaceId, principal.workspaceId),
              eq(pendingShares.resourceId, input.resourceId),
              eq(pendingShares.status, "pending"),
              item.kind === "connection"
                ? eq(pendingShares.connectionId, item.id)
                : eq(pendingShares.invitationId, item.id),
            ),
          )
          .for("update");
        const [pending] =
          standing === undefined
            ? await transaction
                .insert(pendingShares)
                .values({
                  id: createId(),
                  workspaceId: principal.workspaceId,
                  resourceId: input.resourceId,
                  personId: input.personId,
                  connectionId: item.kind === "connection" ? item.id : null,
                  invitationId: item.kind === "invitation" ? item.id : null,
                  role: input.role,
                  grantedBy: principal.userId,
                  createdAt: now,
                })
                .returning()
            : await transaction
                .update(pendingShares)
                .set({
                  role: input.role,
                  personId: input.personId ?? standing.personId,
                  grantedBy: principal.userId,
                })
                .where(eq(pendingShares.id, standing.id))
                .returning();
        if (pending === undefined)
          throw new Error("The pending share was not recorded.");
        await transaction.insert(auditEvents).values({
          id: createId(),
          workspaceId: principal.workspaceId,
          actorType: "user",
          actorId: principal.userId,
          action: "resource.share_queued",
          resourceId: input.resourceId,
          requestId: context.requestId,
          metadata: {
            pendingShareId: pending.id,
            role: pending.role,
            itemId: input.itemId,
            ...(input.personId === null ? {} : { personId: input.personId }),
          },
        });
        return pendingView(transaction, pending);
      },
    );
  }

  async revoke(
    context: GrantMutationContext,
    pendingId: string,
    revokedAt: Date,
  ): Promise<RevokedPendingShare> {
    const { principal } = context;
    return withStableAuthorization(
      this.#database,
      principal.workspaceId,
      async (transaction, authorization) => {
        const [pending] = await transaction
          .select()
          .from(pendingShares)
          .where(
            and(
              eq(pendingShares.workspaceId, principal.workspaceId),
              eq(pendingShares.id, pendingId),
              eq(pendingShares.status, "pending"),
            ),
          )
          .for("update");
        if (pending === undefined) throw new AuthorizationDeniedError();
        await authorization.assertCan(principal, "recover", {
          id: pending.resourceId,
          workspaceId: principal.workspaceId,
        });
        await transaction
          .update(pendingShares)
          .set({ status: "revoked", resolvedAt: laterOf(revokedAt, pending) })
          .where(eq(pendingShares.id, pendingId));
        await transaction.insert(auditEvents).values({
          id: createId(),
          workspaceId: principal.workspaceId,
          actorType: "user",
          actorId: principal.userId,
          action: "resource.share_queue_revoked",
          resourceId: pending.resourceId,
          requestId: context.requestId,
          metadata: { pendingShareId: pendingId },
        });
        return { id: pendingId, revokedAt };
      },
    );
  }
}

/**
 * Grants the shares waiting on an accepted connection to the side that
 * did not queue them, audited as shares by the account that queued them
 * while it can still share the resource; the rest lapse. Returns how
 * many were granted.
 */
export async function settlePendingShares(
  transaction: DatabaseTransaction,
  connection: UserConnectionRow,
  settledBy: string,
  requestId: string,
  now: Date,
): Promise<number> {
  if (connection.status !== "accepted") return 0;
  const waiting = await transaction
    .select()
    .from(pendingShares)
    .where(
      and(
        eq(pendingShares.connectionId, connection.id),
        eq(pendingShares.status, "pending"),
      ),
    )
    .orderBy(asc(pendingShares.createdAt), asc(pendingShares.id))
    .for("update");
  let granted = 0;
  for (const pending of waiting) {
    const grantee =
      connection.requesterId === pending.grantedBy
        ? connection.addresseeId
        : connection.requesterId;
    const sharerOnConnection =
      connection.requesterId === pending.grantedBy ||
      connection.addresseeId === pending.grantedBy;
    const [allowed] = await transaction
      .select({ id: objects.id })
      .from(objects)
      .where(
        and(
          eq(objects.workspaceId, pending.workspaceId),
          eq(objects.id, pending.resourceId),
          sql`chronelle_can_share(${pending.workspaceId}::uuid, ${pending.grantedBy}::uuid, ${pending.resourceId}::uuid)`,
        ),
      )
      .limit(1);
    if (
      grantee !== pending.grantedBy &&
      sharerOnConnection &&
      allowed !== undefined
    ) {
      const [grant] = await transaction
        .insert(resourceGrants)
        .values({
          id: createId(),
          workspaceId: pending.workspaceId,
          resourceId: pending.resourceId,
          principalId: grantee,
          role: pending.role,
          grantedBy: pending.grantedBy,
        })
        .onConflictDoUpdate({
          target: [
            resourceGrants.workspaceId,
            resourceGrants.resourceId,
            resourceGrants.principalType,
            resourceGrants.principalId,
            resourceGrants.scopeKey,
          ],
          set: {
            role: pending.role,
            grantedBy: pending.grantedBy,
            expiresAt: null,
          },
        })
        .returning();
      if (grant === undefined) throw new Error("The grant was not recorded.");
      await transaction.insert(auditEvents).values({
        id: createId(),
        workspaceId: pending.workspaceId,
        actorType: "user",
        actorId: pending.grantedBy,
        action: "resource.shared",
        resourceId: pending.resourceId,
        requestId,
        metadata: {
          grantId: grant.id,
          principalId: grantee,
          role: grant.role,
          pendingShareId: pending.id,
          acceptedBy: settledBy,
          ...(pending.personId === null ? {} : { personId: pending.personId }),
        },
      });
      await transaction
        .update(pendingShares)
        .set({
          status: "granted",
          grantId: grant.id,
          resolvedAt: laterOf(now, pending),
        })
        .where(eq(pendingShares.id, pending.id));
      granted += 1;
    } else {
      await transaction
        .update(pendingShares)
        .set({ status: "lapsed", resolvedAt: laterOf(now, pending) })
        .where(eq(pendingShares.id, pending.id));
    }
  }
  return granted;
}

/** Lapses the shares waiting on a request or invitation that ended without acceptance. */
export async function lapsePendingShares(
  transaction: DatabaseTransaction,
  item: { connectionId?: string; invitationId?: string },
  now: Date,
): Promise<void> {
  const waiting = await transaction
    .select({ id: pendingShares.id, createdAt: pendingShares.createdAt })
    .from(pendingShares)
    .where(
      and(
        eq(pendingShares.status, "pending"),
        or(
          item.connectionId === undefined
            ? sql`false`
            : eq(pendingShares.connectionId, item.connectionId),
          item.invitationId === undefined
            ? sql`false`
            : eq(pendingShares.invitationId, item.invitationId),
        ),
      ),
    );
  for (const pending of waiting)
    await transaction
      .update(pendingShares)
      .set({ status: "lapsed", resolvedAt: laterOf(now, pending) })
      .where(eq(pendingShares.id, pending.id));
}

/**
 * Moves the shares waiting on a claimed invitation to the connection it
 * became (or the live one that already stood), lapsing any that would
 * double a share already waiting there, then settles them if the
 * connection is accepted.
 */
export async function carryPendingShares(
  transaction: DatabaseTransaction,
  invitationId: string,
  connection: UserConnectionRow,
  settledBy: string,
  requestId: string,
  now: Date,
): Promise<void> {
  const waiting = await transaction
    .select()
    .from(pendingShares)
    .where(
      and(
        eq(pendingShares.invitationId, invitationId),
        eq(pendingShares.status, "pending"),
      ),
    );
  for (const pending of waiting) {
    const [doubled] = await transaction
      .select({ id: pendingShares.id })
      .from(pendingShares)
      .where(
        and(
          eq(pendingShares.status, "pending"),
          eq(pendingShares.connectionId, connection.id),
          eq(pendingShares.workspaceId, pending.workspaceId),
          eq(pendingShares.resourceId, pending.resourceId),
        ),
      )
      .limit(1);
    await transaction
      .update(pendingShares)
      .set(
        doubled === undefined
          ? { connectionId: connection.id }
          : { status: "lapsed", resolvedAt: laterOf(now, pending) },
      )
      .where(eq(pendingShares.id, pending.id));
  }
  await settlePendingShares(transaction, connection, settledBy, requestId, now);
}

function laterOf(instant: Date, row: { createdAt: Date }): Date {
  return instant.getTime() >= row.createdAt.getTime() ? instant : row.createdAt;
}

async function sentItem(
  transaction: DatabaseTransaction,
  userId: string,
  itemId: string,
  now: Date,
): Promise<{ kind: "connection" | "invitation"; id: string }> {
  const [connection] = await transaction
    .select({ id: userConnections.id })
    .from(userConnections)
    .where(
      and(
        eq(userConnections.id, itemId),
        eq(userConnections.requesterId, userId),
        eq(userConnections.status, "pending"),
      ),
    )
    .limit(1);
  if (connection !== undefined)
    return { kind: "connection", id: connection.id };
  const [invitation] = await transaction
    .select({ id: userInvitations.id })
    .from(userInvitations)
    .where(
      and(
        eq(userInvitations.id, itemId),
        eq(userInvitations.requesterId, userId),
        eq(userInvitations.status, "pending"),
        gt(userInvitations.expiresAt, now),
      ),
    )
    .limit(1);
  if (invitation === undefined)
    throw new FriendUnavailableError("The invitation does not exist.");
  return { kind: "invitation", id: invitation.id };
}

async function pendingView(
  transaction: DatabaseTransaction,
  row: PendingShareRow,
): Promise<PendingShareView> {
  let person: PendingShareView["person"] = null;
  if (row.personId !== null) {
    const [card] = await transaction
      .select({ nickname: persons.nickname, displayName: objects.displayName })
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
          eq(persons.workspaceId, row.workspaceId),
          eq(persons.objectId, row.personId),
        ),
      )
      .limit(1);
    if (card !== undefined)
      person = {
        id: row.personId,
        displayName: card.nickname ?? card.displayName,
      };
  }
  let email: string | null = null;
  let kind: PendingShareView["kind"];
  let itemId: string;
  if (row.connectionId !== null) {
    kind = "connection";
    itemId = row.connectionId;
    const [connection] = await transaction
      .select()
      .from(userConnections)
      .where(eq(userConnections.id, row.connectionId))
      .limit(1);
    if (connection !== undefined) {
      const [other] = await transaction
        .select()
        .from(users)
        .where(
          eq(
            users.id,
            connection.requesterId === row.grantedBy
              ? connection.addresseeId
              : connection.requesterId,
          ),
        )
        .limit(1);
      email = other === undefined ? null : accountEmail(other);
    }
  } else if (row.invitationId !== null) {
    kind = "invitation";
    itemId = row.invitationId;
    const [invitation] = await transaction
      .select({ email: userInvitations.email })
      .from(userInvitations)
      .where(eq(userInvitations.id, row.invitationId))
      .limit(1);
    email = invitation?.email ?? null;
  } else {
    throw new Error("The pending share names no item.");
  }
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    resourceId: row.resourceId,
    role: row.role,
    status: "pending",
    kind,
    itemId,
    person,
    email,
    grantedBy: row.grantedBy,
    createdAt: row.createdAt,
  };
}
