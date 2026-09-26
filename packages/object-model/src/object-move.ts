import {
  type AuthorizationDatabase,
  AuthorizationDeniedError,
  type AuthorizationService,
  type UserPrincipal,
  withReadAuthorization,
  withStableAuthorizationAcross,
} from "@livtales/authorization";
import {
  auditEvents,
  commandChanges,
  commandStacks,
  createId,
  type DatabaseTransaction,
  eventPageRevisions,
  labels,
  objectRelations,
  objects,
  pendingShares,
  resourceGrants,
  type Role,
  sections,
  taskLabels,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from "@livtales/db";
import {
  type AccessibleWorkspace,
  type ObjectMoveCounts,
  type ObjectMovePreview,
  type ObjectMoveRequest,
  type ObjectMoveSummary,
  type ObjectMoveTargetsResponse,
  objectMoveListLimit,
} from "@livtales/schemas";
import {
  and,
  arrayOverlaps,
  count,
  desc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { CommandConflictError } from "./errors.js";
import { recordObjectRevision } from "./object-revisions.js";
import { readObjectState } from "./object-state.js";
import type { EventResource, MutationContext } from "./types.js";

// Moving an Event, with everything in its permission scope, to another
// space. The records keep their ids, versions, and history, and the rows
// that live with them follow through the cascading keys of migration 0073.
// What linked them to records that stay behind is dropped: relations that
// cross the scope, task assignees, and the scope of People cards scoped to
// the Event. chronelle_object_move (migration 0077) runs the same steps on
// the rpc route.

/** Why a move is refused before anything changes. */
export type ObjectMoveRefusal =
  "forbidden" | "not_movable" | "same_space" | "target_unavailable";

const refusalMessages: Readonly<Record<ObjectMoveRefusal, string>> = {
  forbidden:
    "Only an Owner of the space moves its records, into a space where they can add records.",
  not_movable: "Only an Event that is its own scope and not in Trash moves.",
  same_space: "The record is already in that space.",
  target_unavailable: "The workspace is unavailable.",
};

/**
 * The caller may not make this move: they are not an Owner of the record's
 * space or cannot add records in the target (`forbidden`), the record is
 * not an Event that is its own scope and not in Trash (`not_movable`), the
 * target is the record's space (`same_space`), or the target is not a
 * space the caller is a member of (`target_unavailable`).
 */
export class ObjectMoveRefusedError extends Error {
  readonly reason: ObjectMoveRefusal;

  constructor(reason: ObjectMoveRefusal) {
    super(refusalMessages[reason]);
    this.name = "ObjectMoveRefusedError";
    this.reason = reason;
  }

  /** The refusal a database function reported with this message, if any. */
  static fromMessage(message: string): ObjectMoveRefusedError | undefined {
    const reason = (
      Object.entries(refusalMessages) as [ObjectMoveRefusal, string][]
    ).find(([, text]) => text === message)?.[0];
    return reason === undefined
      ? undefined
      : new ObjectMoveRefusedError(reason);
  }
}

/**
 * The move would drop a different number of links than the caller
 * reviewed, or a concurrent write changed what the move covers. Nothing
 * was changed; preview again.
 */
export class ObjectMoveChangedError extends Error {
  constructor() {
    super("The move changed since it was previewed.");
    this.name = "ObjectMoveChangedError";
  }
}

/** A completed move: the Event in its new space, and what the move did. */
export interface ObjectMoveResult {
  readonly event: EventResource;
  readonly move: ObjectMoveSummary;
}

/**
 * Moving an Event to another space: the spaces it can go to, a preview of
 * what moves and what stays behind, and the move itself. The principal's
 * workspace is the Event's. A move by an Owner of that space goes into a
 * space where the caller is an Owner or an Editor, and is refused with
 * ObjectMoveChangedError when the links it would drop with a warning are
 * not `expectedDroppedLinks`. A repeat with the same `commandId` returns
 * the recorded result; the same `commandId` for another target is a
 * CommandConflictError.
 */
export interface ObjectMoveRepository {
  targets(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<ObjectMoveTargetsResponse>;
  preview(
    principal: UserPrincipal,
    objectId: string,
    targetWorkspaceId: string,
  ): Promise<ObjectMovePreview>;
  move(
    context: MutationContext,
    objectId: string,
    request: ObjectMoveRequest,
  ): Promise<ObjectMoveResult>;
}

/** The Event, the caller, and the space a plan is read for. */
export interface MovePlanInput {
  readonly workspaceId: string;
  readonly userId: string;
  readonly objectId: string;
  readonly targetWorkspaceId: string;
}

export class PostgresObjectMoveRepository implements ObjectMoveRepository {
  readonly #database: AuthorizationDatabase;
  readonly #clock: () => Date;

  constructor(
    database: AuthorizationDatabase,
    clock: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#clock = clock;
  }

  async targets(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<ObjectMoveTargetsResponse> {
    const eventId = objectId.toLowerCase();
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        await assertMovable(transaction, authorization, principal, eventId);
        return { items: await readTargets(transaction, principal) };
      },
    );
  }

  async preview(
    principal: UserPrincipal,
    objectId: string,
    targetWorkspaceId: string,
  ): Promise<ObjectMovePreview> {
    const input = {
      workspaceId: principal.workspaceId,
      userId: principal.userId,
      objectId: objectId.toLowerCase(),
      targetWorkspaceId: targetWorkspaceId.toLowerCase(),
    };
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        await assertMovable(
          transaction,
          authorization,
          principal,
          input.objectId,
        );
        await assertTarget(transaction, input);
        return readMovePlan(transaction, input);
      },
    );
  }

  async move(
    context: MutationContext,
    objectId: string,
    request: ObjectMoveRequest,
  ): Promise<ObjectMoveResult> {
    const { principal } = context;
    const input = {
      workspaceId: principal.workspaceId,
      userId: principal.userId,
      objectId: objectId.toLowerCase(),
      targetWorkspaceId: request.workspaceId.toLowerCase(),
    };
    const movedAt = this.#clock();
    const connection =
      "authorization" in this.#database
        ? this.#database.database
        : this.#database;
    // A target that does not exist has no fence to take.
    const [target] = await connection
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.id, input.targetWorkspaceId));
    if (target === undefined)
      throw new ObjectMoveRefusedError("target_unavailable");
    try {
      return await withStableAuthorizationAcross(
        this.#database,
        [input.workspaceId, input.targetWorkspaceId],
        async (transaction, authorization) => {
          if (request.commandId !== undefined) {
            const replayed = await replayMove(
              transaction,
              authorization,
              input,
              request.commandId.toLowerCase(),
            );
            if (replayed !== undefined) return replayed;
          }
          await transaction
            .select({ id: objects.id })
            .from(objects)
            .where(
              and(
                eq(objects.workspaceId, input.workspaceId),
                eq(objects.id, input.objectId),
              ),
            )
            .for("update");
          await assertMovable(
            transaction,
            authorization,
            principal,
            input.objectId,
          );
          await assertTarget(transaction, input);
          return carryScope(transaction, context, input, request, movedAt);
        },
      );
    } catch (error) {
      if (isConcurrentChange(error)) throw new ObjectMoveChangedError();
      throw error;
    }
  }
}

/** The records a move carries, in id order: the Event and its scope but People cards. */
async function readScopeIds(
  transaction: DatabaseTransaction,
  workspaceId: string,
  eventId: string,
): Promise<string[]> {
  const rows = await transaction
    .select({ id: objects.id })
    .from(objects)
    .where(
      and(
        eq(objects.workspaceId, workspaceId),
        or(
          eq(objects.id, eventId),
          and(
            eq(objects.permissionScopeId, eventId),
            ne(objects.objectType, "person"),
          ),
        ),
      ),
    )
    .orderBy(objects.id);
  return rows.map((row) => row.id);
}

const liveGrant = or(
  isNull(resourceGrants.expiresAt),
  sql`${resourceGrants.expiresAt} > now()`,
);

const roleRank: Readonly<Record<Role, number>> = {
  owner: 3,
  editor: 2,
  viewer: 1,
};

/** The strongest of the roles. */
function strongest(roles: readonly Role[]): Role {
  return roles.reduce((best, role) =>
    roleRank[role] > roleRank[best] ? role : best,
  );
}

/**
 * The live grants on the carried records with each grantee's name and
 * role in the target space, by grantee name; a grant is covered when that
 * role gives at least as much.
 */
async function readMoveGrants(
  transaction: DatabaseTransaction,
  grantWorkspaceId: string,
  targetWorkspaceId: string,
  scope: readonly string[],
) {
  const member = alias(workspaceMembers, "target_member");
  const rows = await transaction
    .select({
      id: resourceGrants.id,
      resourceId: resourceGrants.resourceId,
      principalId: resourceGrants.principalId,
      role: resourceGrants.role,
      memberRole: member.role,
      displayName: users.displayName,
    })
    .from(resourceGrants)
    .innerJoin(users, eq(users.id, resourceGrants.principalId))
    .leftJoin(
      member,
      and(
        eq(member.workspaceId, targetWorkspaceId),
        eq(member.userId, resourceGrants.principalId),
      ),
    )
    .where(
      and(
        eq(resourceGrants.workspaceId, grantWorkspaceId),
        inArray(resourceGrants.resourceId, [...scope]),
        liveGrant,
      ),
    )
    .orderBy(users.displayName, users.id, resourceGrants.id);
  return rows.map((row) => ({
    ...row,
    covered:
      row.memberRole !== null && roleRank[row.memberRole] >= roleRank[row.role],
  }));
}

type MoveGrant = Awaited<ReturnType<typeof readMoveGrants>>[number];

/** One entry per grantee in the grants' order, with their strongest role. */
function byGrantee(grants: readonly MoveGrant[]) {
  const grantees = new Map<string, MoveGrant[]>();
  for (const grant of grants)
    grantees.set(grant.principalId, [
      ...(grantees.get(grant.principalId) ?? []),
      grant,
    ]);
  return [...grantees.values()].map((held) => {
    const [first] = held as [MoveGrant, ...MoveGrant[]];
    return {
      userId: first.principalId,
      displayName: first.displayName,
      role: strongest(held.map((grant) => grant.role)),
      memberRole: first.memberRole,
    };
  });
}

function listed<Item>(items: readonly Item[]) {
  return { items: items.slice(0, objectMoveListLimit), total: items.length };
}

/**
 * What a move of the Event into the target space carries, drops, and
 * changes, as the preview reports it and as chronelle_object_move_plan
 * reads it. The caller has passed the move's checks.
 */
export async function readMovePlan(
  transaction: DatabaseTransaction,
  input: MovePlanInput,
): Promise<ObjectMovePreview> {
  const { workspaceId, userId, objectId, targetWorkspaceId } = input;
  const scope = await readScopeIds(transaction, workspaceId, objectId);
  const inScope = new Set(scope);

  const records = await transaction
    .select({
      id: objects.id,
      objectType: objects.objectType,
      deletedAt: objects.deletedAt,
      parentTaskId: tasks.parentTaskId,
    })
    .from(objects)
    .leftJoin(tasks, eq(tasks.objectId, objects.id))
    .where(
      and(eq(objects.workspaceId, workspaceId), inArray(objects.id, scope)),
    );
  const live = records.filter((record) => record.deletedAt === null);
  const liveOf = (objectType: string) =>
    live.filter((record) => record.objectType === objectType);
  const [sectionCount] = await transaction
    .select({ count: count() })
    .from(sections)
    .where(
      and(
        eq(sections.workspaceId, workspaceId),
        eq(sections.eventId, objectId),
      ),
    );
  const [layout] = await transaction
    .select({ pages: eventPageRevisions.pages })
    .from(eventPageRevisions)
    .where(eq(eventPageRevisions.eventId, objectId))
    .orderBy(desc(eventPageRevisions.version))
    .limit(1);
  const grants = await readMoveGrants(
    transaction,
    workspaceId,
    targetWorkspaceId,
    scope,
  );
  const [pendingCount] = await transaction
    .select({ count: count() })
    .from(pendingShares)
    .where(
      and(
        eq(pendingShares.workspaceId, workspaceId),
        inArray(pendingShares.resourceId, scope),
        eq(pendingShares.status, "pending"),
      ),
    );
  const moves: ObjectMoveCounts = {
    scheduleItems: liveOf("event").filter((record) => record.id !== objectId)
      .length,
    todos: liveOf("task").filter((record) => record.parentTaskId === null)
      .length,
    subtasks: liveOf("task").filter((record) => record.parentTaskId !== null)
      .length,
    expenses: liveOf("expense").length,
    reminders: liveOf("reminder").length,
    notes: liveOf("note").length,
    files: liveOf("document").length,
    sections: sectionCount?.count ?? 0,
    pages: Array.isArray(layout?.pages) ? layout.pages.length : 0,
    inTrash: records.length - live.length,
    shares: grants.filter((grant) => !grant.covered).length,
    pendingShares: pendingCount?.count ?? 0,
  };

  const relations = await transaction
    .select({
      id: objectRelations.id,
      relationType: objectRelations.relationType,
      sourceObjectId: objectRelations.sourceObjectId,
      targetObjectId: objectRelations.targetObjectId,
      deletedAt: objectRelations.deletedAt,
    })
    .from(objectRelations)
    .where(
      and(
        eq(objectRelations.workspaceId, workspaceId),
        or(
          inArray(objectRelations.sourceObjectId, scope),
          inArray(objectRelations.targetObjectId, scope),
        ),
      ),
    )
    .orderBy(objectRelations.id);
  const crossing = relations.filter(
    (relation) =>
      inScope.has(relation.sourceObjectId) !==
      inScope.has(relation.targetObjectId),
  );
  const endpointIds = [
    ...new Set(
      crossing.flatMap((relation) => [
        relation.sourceObjectId,
        relation.targetObjectId,
      ]),
    ),
  ];
  const endpoints = new Map(
    endpointIds.length === 0
      ? []
      : (
          await transaction
            .select({
              id: objects.id,
              objectType: objects.objectType,
              displayName: objects.displayName,
              deletedAt: objects.deletedAt,
            })
            .from(objects)
            .where(inArray(objects.id, endpointIds))
        ).map((endpoint) => [endpoint.id, endpoint]),
  );
  const droppedLinks = crossing.flatMap((relation) => {
    const [scopedId, otherId] = inScope.has(relation.sourceObjectId)
      ? [relation.sourceObjectId, relation.targetObjectId]
      : [relation.targetObjectId, relation.sourceObjectId];
    const scoped = endpoints.get(scopedId);
    const other = endpoints.get(otherId);
    if (
      relation.deletedAt !== null ||
      scoped === undefined ||
      other === undefined ||
      scoped.deletedAt !== null ||
      other.deletedAt !== null
    )
      return [];
    return [
      {
        relationId: relation.id,
        relationType: relation.relationType,
        scoped: {
          id: scoped.id,
          objectType: scoped.objectType,
          displayName: scoped.displayName,
        },
        other: {
          id: other.id,
          objectType: other.objectType,
          displayName: other.displayName,
        },
      },
    ];
  });

  const person = alias(objects, "assignee");
  const assigned = await transaction
    .select({
      taskId: objects.id,
      displayName: objects.displayName,
      deletedAt: objects.deletedAt,
      personId: person.id,
      personName: person.displayName,
      personDeletedAt: person.deletedAt,
    })
    .from(tasks)
    .innerJoin(objects, eq(objects.id, tasks.objectId))
    .innerJoin(person, eq(person.id, tasks.assigneePersonId))
    .where(
      and(eq(tasks.workspaceId, workspaceId), inArray(tasks.objectId, scope)),
    )
    .orderBy(objects.id);
  const unassignedTasks = assigned
    .filter((task) => task.deletedAt === null && task.personDeletedAt === null)
    .map((task) => ({
      taskId: task.taskId,
      displayName: task.displayName,
      person: { id: task.personId, displayName: task.personName },
    }));

  const targetLabel = alias(labels, "target_label");
  const labelNames = await transaction
    .select({
      name: labels.name,
      existing: exists(
        transaction
          .select({ id: targetLabel.id })
          .from(targetLabel)
          .where(
            and(
              eq(targetLabel.workspaceId, targetWorkspaceId),
              sql`lower(${targetLabel.name}) = lower(${labels.name})`,
            ),
          ),
      ).mapWith(Boolean),
    })
    .from(taskLabels)
    .innerJoin(labels, eq(labels.id, taskLabels.labelId))
    .where(
      and(
        eq(taskLabels.workspaceId, workspaceId),
        inArray(taskLabels.taskId, scope),
      ),
    )
    .groupBy(labels.name)
    .orderBy(sql`lower(${labels.name})`, labels.name);

  const peopleKept = await transaction
    .select({ id: objects.id, displayName: objects.displayName })
    .from(objects)
    .where(
      and(
        eq(objects.workspaceId, workspaceId),
        eq(objects.permissionScopeId, objectId),
        ne(objects.id, objectId),
        eq(objects.objectType, "person"),
        isNull(objects.deletedAt),
      ),
    )
    .orderBy(objects.displayName, objects.id);

  const targetMember = alias(workspaceMembers, "target_member");
  const losingAccess = await transaction
    .select({ userId: users.id, displayName: users.displayName })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        notExists(
          transaction
            .select({ userId: targetMember.userId })
            .from(targetMember)
            .where(
              and(
                eq(targetMember.workspaceId, targetWorkspaceId),
                eq(targetMember.userId, workspaceMembers.userId),
              ),
            ),
        ),
        notExists(
          transaction
            .select({ id: resourceGrants.id })
            .from(resourceGrants)
            .where(
              and(
                eq(resourceGrants.workspaceId, workspaceId),
                eq(resourceGrants.resourceId, objectId),
                eq(resourceGrants.principalId, workspaceMembers.userId),
                liveGrant,
              ),
            ),
        ),
      ),
    )
    .orderBy(users.displayName, users.id);

  const memberRoles = await transaction
    .select({ role: workspaceMembers.role, count: count() })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.workspaceId, targetWorkspaceId))
    .groupBy(workspaceMembers.role);
  const membersWith = (role: Role) =>
    memberRoles.find((members) => members.role === role)?.count ?? 0;

  // A share waiting on an invitation is granted when accepted only if its
  // sharer can still share the record; after the move that takes Owner in
  // the target space or an Owner share of the record or the Event.
  const [lapsing] = await transaction
    .select({ count: count() })
    .from(pendingShares)
    .where(
      and(
        eq(pendingShares.workspaceId, workspaceId),
        inArray(pendingShares.resourceId, scope),
        eq(pendingShares.status, "pending"),
        notExists(
          transaction
            .select({ userId: workspaceMembers.userId })
            .from(workspaceMembers)
            .where(
              and(
                eq(workspaceMembers.workspaceId, targetWorkspaceId),
                eq(workspaceMembers.userId, pendingShares.grantedBy),
                eq(workspaceMembers.role, "owner"),
              ),
            ),
        ),
        notExists(
          transaction
            .select({ id: resourceGrants.id })
            .from(resourceGrants)
            .where(
              and(
                eq(resourceGrants.workspaceId, workspaceId),
                eq(resourceGrants.principalId, pendingShares.grantedBy),
                eq(resourceGrants.role, "owner"),
                eq(resourceGrants.scope, "all"),
                or(
                  eq(resourceGrants.resourceId, pendingShares.resourceId),
                  eq(resourceGrants.resourceId, objectId),
                ),
                liveGrant,
              ),
            ),
        ),
      ),
    );

  const covered = grants.filter((grant) => grant.covered);
  const keeping = byGrantee(
    grants.filter((grant) => grant.resourceId === objectId && !grant.covered),
  );
  const clearedLinks =
    crossing.length -
    droppedLinks.length +
    assigned.length -
    unassignedTasks.length;
  return {
    eventId: objectId,
    from: await readWorkspace(transaction, workspaceId, userId),
    to: await readWorkspace(transaction, targetWorkspaceId, userId),
    moves,
    droppedLinks: listed(droppedLinks),
    unassignedTasks: listed(unassignedTasks),
    labels: listed(labelNames),
    peopleKept: listed(peopleKept),
    clearedLinks,
    access: {
      targetMembers: {
        owner: membersWith("owner"),
        editor: membersWith("editor"),
        viewer: membersWith("viewer"),
      },
      keepingShares: listed(
        keeping.map(({ userId, displayName, role }) => ({
          userId,
          displayName,
          role,
        })),
      ),
      droppedGrants: listed(
        byGrantee(covered).map(({ userId, displayName, role, memberRole }) => ({
          userId,
          displayName,
          role,
          memberRole: memberRole ?? role,
        })),
      ),
      losingAccess: listed(losingAccess),
      lapsingShares: lapsing?.count ?? 0,
    },
    expectedDroppedLinks: droppedLinks.length + unassignedTasks.length,
  };
}

/** A workspace as the switcher lists it for the caller. */
async function readWorkspace(
  transaction: DatabaseTransaction,
  workspaceId: string,
  userId: string,
): Promise<AccessibleWorkspace> {
  const owner = alias(users, "owner");
  const [workspace] = await transaction
    .select({
      id: workspaces.id,
      displayName: workspaces.displayName,
      personalOwnerId: workspaces.personalOwnerId,
      ownerDisplayName: owner.displayName,
      role: workspaceMembers.role,
    })
    .from(workspaces)
    .leftJoin(
      owner,
      eq(
        owner.id,
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
    .where(eq(workspaces.id, workspaceId));
  if (workspace === undefined) throw new AuthorizationDeniedError();
  return {
    id: workspace.id,
    displayName: workspace.displayName,
    personal: workspace.personalOwnerId !== null,
    ownerDisplayName: workspace.ownerDisplayName,
    role: workspace.role,
  };
}

/**
 * The spaces the caller is a member of: their own Personal space first,
 * then by name. A space is allowed when it is not the Event's and the
 * caller can add records there.
 */
async function readTargets(
  transaction: DatabaseTransaction,
  principal: UserPrincipal,
): Promise<ObjectMoveTargetsResponse["items"]> {
  const owner = alias(users, "owner");
  const counted = alias(workspaceMembers, "counted");
  const rows = await transaction
    .select({
      id: workspaces.id,
      displayName: workspaces.displayName,
      personalOwnerId: workspaces.personalOwnerId,
      ownerDisplayName: owner.displayName,
      role: workspaceMembers.role,
      memberCount: sql<number>`(${transaction
        .select({ count: count() })
        .from(counted)
        .where(eq(counted.workspaceId, workspaces.id))})`.mapWith(Number),
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .leftJoin(
      owner,
      eq(
        owner.id,
        sql`coalesce(${workspaces.personalOwnerId}, ${workspaces.createdBy})`,
      ),
    )
    .where(eq(workspaceMembers.userId, principal.userId))
    .orderBy(
      sql`${workspaces.personalOwnerId} IS NOT DISTINCT FROM ${principal.userId} DESC`,
      workspaces.displayName,
      workspaces.id,
    );
  return rows.map((row) => ({
    workspace: {
      id: row.id,
      displayName: row.displayName,
      personal: row.personalOwnerId !== null,
      ownerDisplayName: row.ownerDisplayName,
      role: row.role,
    },
    memberCount: row.memberCount,
    current: row.id === principal.workspaceId,
    allowed:
      row.id !== principal.workspaceId &&
      (row.role === "owner" || row.role === "editor"),
  }));
}

async function memberRole(
  transaction: DatabaseTransaction,
  workspaceId: string,
  userId: string,
): Promise<Role | null> {
  const [membership] = await transaction
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.userId, userId),
      ),
    )
    .limit(1);
  return membership?.role ?? null;
}

/**
 * Refuses a move of the object that the caller may not make, in the order
 * the API reports it: an object the caller cannot see is unavailable, only
 * an Owner of its space moves it, and only an Event that is its own scope
 * and not in Trash moves.
 */
async function assertMovable(
  transaction: DatabaseTransaction,
  authorization: AuthorizationService,
  principal: UserPrincipal,
  objectId: string,
): Promise<void> {
  const [moved] = await transaction
    .select({
      id: objects.id,
      objectType: objects.objectType,
      permissionScopeId: objects.permissionScopeId,
      deletedAt: objects.deletedAt,
    })
    .from(objects)
    .where(
      and(
        eq(objects.workspaceId, principal.workspaceId),
        eq(objects.id, objectId),
      ),
    );
  const role = await memberRole(
    transaction,
    principal.workspaceId,
    principal.userId,
  );
  if (
    moved === undefined ||
    (role === null &&
      !(await authorization.can(principal, "view", {
        id: objectId,
        workspaceId: principal.workspaceId,
      })))
  )
    throw new AuthorizationDeniedError();
  if (role !== "owner") throw new ObjectMoveRefusedError("forbidden");
  if (
    moved.objectType !== "event" ||
    moved.permissionScopeId !== moved.id ||
    moved.deletedAt !== null
  )
    throw new ObjectMoveRefusedError("not_movable");
}

/** Refuses the record's own space, a space the caller is not in, and one where they only view. */
async function assertTarget(
  transaction: DatabaseTransaction,
  input: MovePlanInput,
): Promise<void> {
  if (input.targetWorkspaceId === input.workspaceId)
    throw new ObjectMoveRefusedError("same_space");
  const role = await memberRole(
    transaction,
    input.targetWorkspaceId,
    input.userId,
  );
  if (role === null) throw new ObjectMoveRefusedError("target_unavailable");
  if (role !== "owner" && role !== "editor")
    throw new ObjectMoveRefusedError("forbidden");
}

/**
 * The recorded result of the caller's earlier move of the object with this
 * command id, with the object as it is now; a command id that moved it to
 * another space is a conflict.
 */
async function replayMove(
  transaction: DatabaseTransaction,
  authorization: AuthorizationService,
  input: MovePlanInput,
  commandId: string,
): Promise<ObjectMoveResult | undefined> {
  const [recorded] = await transaction
    .select({
      workspaceId: auditEvents.workspaceId,
      metadata: auditEvents.metadata,
    })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.resourceId, input.objectId),
        eq(auditEvents.action, "object.moved"),
        eq(auditEvents.actorId, input.userId),
        sql`${auditEvents.metadata} ->> 'direction' = 'in'`,
        sql`${auditEvents.metadata} ->> 'commandId' = ${commandId}`,
      ),
    )
    .orderBy(desc(auditEvents.createdAt), desc(auditEvents.id))
    .limit(1);
  if (recorded === undefined) return undefined;
  if (recorded.workspaceId !== input.targetWorkspaceId)
    throw new CommandConflictError();
  const principal = {
    type: "user" as const,
    userId: input.userId,
    workspaceId: input.targetWorkspaceId,
  };
  await authorization.assertCan(principal, "view", {
    id: input.objectId,
    workspaceId: input.targetWorkspaceId,
  });
  const { direction: _direction, ...move } = recorded.metadata as Record<
    string,
    unknown
  >;
  return {
    event: (await readObjectState(
      transaction,
      input.targetWorkspaceId,
      input.objectId,
    )) as EventResource,
    move: move as ObjectMoveSummary,
  };
}

/**
 * The move's writes, after the fences, the checks, and the Event's lock:
 * lock the scope, re-read the plan, then detach the People cards, drop the
 * crossing relations, prune the old space's command stacks, carry the
 * scope, join the labels, clear the assignees and step the changed tasks'
 * versions, and revoke the shares the target's membership covers.
 */
async function carryScope(
  transaction: DatabaseTransaction,
  context: MutationContext,
  input: MovePlanInput,
  request: ObjectMoveRequest,
  movedAt: Date,
): Promise<ObjectMoveResult> {
  const {
    workspaceId: source,
    targetWorkspaceId: target,
    objectId,
    userId,
  } = input;
  const actor = {
    actorId: userId,
    actorType: "user" as const,
    requestId: context.requestId,
  };

  await transaction
    .select({ id: objects.id })
    .from(objects)
    .where(
      and(
        eq(objects.workspaceId, source),
        or(eq(objects.id, objectId), eq(objects.permissionScopeId, objectId)),
      ),
    )
    .orderBy(objects.id)
    .for("update");
  const scope = await readScopeIds(transaction, source, objectId);
  const inScope = new Set(scope);
  await transaction
    .select({ id: tasks.objectId })
    .from(tasks)
    .where(inArray(tasks.objectId, scope))
    .orderBy(tasks.objectId)
    .for("update");
  const touching = await transaction
    .select()
    .from(objectRelations)
    .where(
      and(
        eq(objectRelations.workspaceId, source),
        or(
          inArray(objectRelations.sourceObjectId, scope),
          inArray(objectRelations.targetObjectId, scope),
        ),
      ),
    )
    .orderBy(objectRelations.id)
    .for("update");

  const subtasks = await transaction
    .select({ id: tasks.objectId, parentTaskId: tasks.parentTaskId })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, source),
        isNotNull(tasks.parentTaskId),
        or(inArray(tasks.objectId, scope), inArray(tasks.parentTaskId, scope)),
      ),
    );
  if (
    subtasks.some(
      (task) =>
        task.parentTaskId !== null &&
        inScope.has(task.id) !== inScope.has(task.parentTaskId),
    )
  )
    throw new Error("A subtask and its task are in different scopes.");

  const plan = await readMovePlan(transaction, input);
  if (plan.expectedDroppedLinks !== request.expectedDroppedLinks)
    throw new ObjectMoveChangedError();

  // People cards scoped to the Event stay and become their own scope.
  const cards = await transaction
    .select({ id: objects.id, version: objects.version })
    .from(objects)
    .where(
      and(
        eq(objects.workspaceId, source),
        eq(objects.permissionScopeId, objectId),
        ne(objects.id, objectId),
        eq(objects.objectType, "person"),
      ),
    )
    .orderBy(objects.id);
  for (const card of cards) {
    await transaction
      .update(objects)
      .set({
        permissionScopeId: card.id,
        version: sql`${objects.version} + 1`,
        updatedAt: movedAt,
      })
      .where(and(eq(objects.workspaceId, source), eq(objects.id, card.id)));
    await recordObjectRevision(
      transaction,
      await readObjectState(transaction, source, card.id),
      actor,
      "permission_scope_updated",
      {
        cause: "object.moved",
        permissionScopeId: card.id,
        previousPermissionScopeId: objectId,
        previousVersion: card.version,
      },
    );
  }

  // Relations that cross the scope, live or removed, are dropped.
  const crossing = touching.filter(
    (relation) =>
      inScope.has(relation.sourceObjectId) !==
      inScope.has(relation.targetObjectId),
  );
  for (const relation of crossing)
    await transaction.insert(auditEvents).values({
      id: createId(),
      workspaceId: source,
      ...actor,
      action: "relation.dropped",
      resourceId: relation.sourceObjectId,
      metadata: {
        cause: "object.moved",
        relationId: relation.id,
        relationType: relation.relationType,
        targetObjectId: relation.targetObjectId,
        version: relation.version,
        removed: relation.deletedAt !== null,
        toWorkspaceId: target,
      },
    });
  if (crossing.length > 0) {
    await transaction.execute(
      sql`SELECT set_config('chronelle.relation_drop', 'move', true)`,
    );
    await transaction.delete(objectRelations).where(
      inArray(
        objectRelations.id,
        crossing.map((relation) => relation.id),
      ),
    );
    await transaction.execute(
      sql`SELECT set_config('chronelle.relation_drop', '', true)`,
    );
  }

  await pruneCommandStacks(transaction, source, scope);

  const rewritten = await transaction
    .select({ id: tasks.objectId })
    .from(tasks)
    .where(
      and(
        eq(tasks.workspaceId, source),
        inArray(tasks.objectId, scope),
        or(
          isNotNull(tasks.assigneePersonId),
          exists(
            transaction
              .select({ taskId: taskLabels.taskId })
              .from(taskLabels)
              .where(eq(taskLabels.taskId, tasks.objectId)),
          ),
        ),
      ),
    )
    .orderBy(tasks.objectId);

  const carried = await transaction
    .update(objects)
    .set({ workspaceId: target })
    .where(and(eq(objects.workspaceId, source), inArray(objects.id, scope)))
    .returning({ id: objects.id });
  if (carried.length !== scope.length) throw new ObjectMoveChangedError();

  const { joined, created } = await joinLabels(transaction, input, scope);
  await transaction
    .update(tasks)
    .set({ assigneePersonId: null })
    .where(
      and(
        eq(tasks.workspaceId, target),
        inArray(tasks.objectId, scope),
        isNotNull(tasks.assigneePersonId),
      ),
    );
  for (const { id } of rewritten) {
    const [saved] = await transaction
      .update(objects)
      .set({ version: sql`${objects.version} + 1`, updatedAt: movedAt })
      .where(and(eq(objects.workspaceId, target), eq(objects.id, id)))
      .returning({ version: objects.version });
    if (saved === undefined) throw new ObjectMoveChangedError();
    await recordObjectRevision(
      transaction,
      await readObjectState(transaction, target, id),
      actor,
      "updated",
      { cause: "object.moved", previousVersion: saved.version - 1 },
    );
  }

  // A waiting share no longer names a People card of the old space.
  await transaction
    .update(pendingShares)
    .set({ personId: null })
    .where(
      and(
        eq(pendingShares.workspaceId, target),
        inArray(pendingShares.resourceId, scope),
        isNotNull(pendingShares.personId),
      ),
    );

  // A share the grantee's membership of the target covers is revoked.
  const covered = (await readMoveGrants(transaction, target, target, scope))
    .filter((grant) => grant.covered)
    .sort((left, right) => compareIds(left.id, right.id));
  for (const grant of covered)
    await transaction.insert(auditEvents).values({
      id: createId(),
      workspaceId: target,
      ...actor,
      action: "resource.share_revoked",
      resourceId: grant.resourceId,
      metadata: {
        grantId: grant.id,
        principalId: grant.principalId,
        role: grant.role,
        memberRole: grant.memberRole,
        reason: "covered_by_membership",
      },
    });
  if (covered.length > 0)
    await transaction.delete(resourceGrants).where(
      inArray(
        resourceGrants.id,
        covered.map((grant) => grant.id),
      ),
    );

  const move: ObjectMoveSummary = {
    commandId: request.commandId?.toLowerCase() ?? null,
    from: { id: source, displayName: plan.from.displayName },
    to: { id: target, displayName: plan.to.displayName },
    moves: plan.moves,
    droppedLinks: plan.droppedLinks.total,
    unassignedTasks: plan.unassignedTasks.total,
    clearedLinks: plan.clearedLinks,
    labelsJoined: joined,
    labelsCreated: created,
    grantsDropped: covered.length,
    peopleKept: plan.peopleKept.total,
    movedAt: movedAt.toISOString(),
  };
  for (const [workspaceId, direction] of [
    [source, "out"],
    [target, "in"],
  ] as const)
    await transaction.insert(auditEvents).values({
      id: createId(),
      workspaceId,
      ...actor,
      action: "object.moved",
      resourceId: objectId,
      metadata: { ...move, direction },
    });
  return {
    event: (await readObjectState(
      transaction,
      target,
      objectId,
    )) as EventResource,
    move,
  };
}

/**
 * Removes the undo and redo entries that changed a carried record from
 * the old space's stacks, with the versions only they expected; the
 * command records stay.
 */
async function pruneCommandStacks(
  transaction: DatabaseTransaction,
  workspaceId: string,
  scope: readonly string[],
): Promise<void> {
  const pruned = (
    await transaction
      .selectDistinct({ commandId: commandChanges.commandId })
      .from(commandChanges)
      .where(
        and(
          eq(commandChanges.workspaceId, workspaceId),
          inArray(commandChanges.objectId, [...scope]),
        ),
      )
  ).map((change) => change.commandId);
  if (pruned.length === 0) return;
  const removed = new Set(pruned);
  const stacks = await transaction
    .select()
    .from(commandStacks)
    .where(
      and(
        eq(commandStacks.workspaceId, workspaceId),
        or(
          arrayOverlaps(commandStacks.undoIds, pruned),
          arrayOverlaps(commandStacks.redoIds, pruned),
        ),
      ),
    )
    .orderBy(commandStacks.userId)
    .for("update");
  for (const stack of stacks) {
    const undoIds = stack.undoIds.filter((id) => !removed.has(id));
    const redoIds = stack.redoIds.filter((id) => !removed.has(id));
    const retained = [...undoIds, ...redoIds];
    const expected = new Set(
      retained.length === 0
        ? []
        : (
            await transaction
              .select({ objectId: commandChanges.objectId })
              .from(commandChanges)
              .where(
                and(
                  eq(commandChanges.workspaceId, workspaceId),
                  eq(commandChanges.userId, stack.userId),
                  inArray(commandChanges.commandId, retained),
                ),
              )
          ).map((change) => change.objectId),
    );
    await transaction
      .update(commandStacks)
      .set({
        version: sql`${commandStacks.version} + 1`,
        undoIds,
        redoIds,
        expectedVersions: Object.fromEntries(
          Object.entries(stack.expectedVersions).filter(([id]) =>
            expected.has(id),
          ),
        ),
      })
      .where(
        and(
          eq(commandStacks.workspaceId, workspaceId),
          eq(commandStacks.userId, stack.userId),
        ),
      );
  }
}

/**
 * Points the carried tasks' labels at the target's labels of the same
 * names, creating the missing ones; returns how many joined and how many
 * were created.
 */
async function joinLabels(
  transaction: DatabaseTransaction,
  input: MovePlanInput,
  scope: readonly string[],
): Promise<{ joined: number; created: number }> {
  const { workspaceId: source, targetWorkspaceId: target, userId } = input;
  const carried = await transaction
    .select({ id: labels.id, name: labels.name })
    .from(labels)
    .where(
      inArray(
        labels.id,
        transaction
          .select({ id: taskLabels.labelId })
          .from(taskLabels)
          .where(
            and(
              eq(taskLabels.workspaceId, source),
              inArray(taskLabels.taskId, [...scope]),
            ),
          ),
      ),
    )
    .orderBy(sql`lower(${labels.name})`, labels.id);
  const named = async (name: string) => {
    const [label] = await transaction
      .select({ id: labels.id })
      .from(labels)
      .where(
        and(
          eq(labels.workspaceId, target),
          sql`lower(${labels.name}) = lower(${name})`,
        ),
      );
    return label?.id;
  };
  let joined = 0;
  let created = 0;
  for (const label of carried) {
    let mapped = await named(label.name);
    if (mapped === undefined) {
      const [inserted] = await transaction
        .insert(labels)
        .values({
          id: createId(),
          workspaceId: target,
          name: label.name,
          createdBy: userId,
        })
        .onConflictDoNothing()
        .returning({ id: labels.id });
      mapped = inserted?.id ?? (await named(label.name));
      if (inserted !== undefined) created += 1;
      else joined += 1;
    } else joined += 1;
    if (mapped === undefined) throw new ObjectMoveChangedError();
    await transaction
      .update(taskLabels)
      .set({ workspaceId: target, labelId: mapped })
      .where(
        and(
          eq(taskLabels.workspaceId, source),
          inArray(taskLabels.taskId, [...scope]),
          eq(taskLabels.labelId, label.id),
        ),
      );
  }
  return { joined, created };
}

/** Orders ids as PostgreSQL orders uuids. */
function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** A key violation or deadlock from a write that raced the move. */
function isConcurrentChange(error: unknown): boolean {
  const code = (candidate: unknown) =>
    typeof candidate === "object" &&
    candidate !== null &&
    "code" in candidate &&
    (candidate.code === "23503" || candidate.code === "40P01");
  return (
    code(error) ||
    (error instanceof Error && error.cause !== undefined && code(error.cause))
  );
}
