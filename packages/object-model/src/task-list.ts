import { createHash } from "node:crypto";
import {
  withReadAuthorization,
  type AuthorizationDatabase,
  type UserPrincipal,
} from "@chronelle/authorization";
import { objectRelations, objects, taskLabels, tasks } from "@chronelle/db";
import {
  taskListCursorSchema,
  taskListQuerySchema,
  type TaskListCursor,
  type TaskListQuery,
  type TaskListQueryInput,
} from "@chronelle/schemas";
import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  inArray,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";

import { decodeCursor, encodeCursor } from "./cursor.js";
import { InvalidObjectStateError } from "./errors.js";
import { readObjectStates } from "./object-state.js";
import type { TaskResource } from "./types.js";

/** The Event a listed task belongs to, when the caller may view that Event. */
export interface TaskContext {
  readonly eventId: string;
  readonly displayName: string;
}

/** How many subtasks a listed parent has, and how many are done. */
export interface TaskProgress {
  readonly done: number;
  readonly total: number;
}

/** The parent of a listed subtask, when the caller may view it. */
export interface TaskParent {
  readonly taskId: string;
  readonly displayName: string;
}

export interface TaskPage {
  readonly items: TaskResource[];
  /** By task ID; absent for a task outside any viewable Event. */
  readonly contexts: Readonly<Record<string, TaskContext>>;
  /** By parent task ID, for listed parents with live subtasks. */
  readonly progress: Readonly<Record<string, TaskProgress>>;
  /** By subtask ID, for listed subtasks whose parent the caller may view. */
  readonly parents: Readonly<Record<string, TaskParent>>;
  readonly nextCursor: string | null;
  readonly asOf: string;
}

/**
 * Read boundary for the workspace Task collection: every Task the caller
 * may view, on its own or inside an Event, in one authorized, paginated
 * order.
 */
export interface TaskReadRepository {
  listTasks(
    principal: UserPrincipal,
    input?: TaskListQueryInput,
  ): Promise<TaskPage>;
}

export class PostgresTaskReadRepository implements TaskReadRepository {
  readonly #database: AuthorizationDatabase;

  constructor(database: AuthorizationDatabase) {
    this.#database = database;
  }

  listTasks(
    principal: UserPrincipal,
    input: TaskListQueryInput = {},
  ): Promise<TaskPage> {
    return listTaskPage(this.#database, principal, input);
  }
}

// A date-only due sorts at the start of its day (UTC), ahead of any timed
// task that day; the same position the Event projections use.
const duePosition = sql`coalesce(${tasks.dueAt}, ${tasks.dueOn}::timestamp AT TIME ZONE 'UTC')`;

const foldedName = sql<string>`lower(${objects.displayName}) COLLATE "C"`;

/** The list's context: the caller and the query, so a cursor cannot cross queries. */
export function taskListContext(
  principal: UserPrincipal,
  input: TaskListQuery,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        principal.userId,
        principal.workspaceId,
        input.query,
        input.filter,
        input.sort,
        input.label ?? null,
        input.assignee ?? null,
      ]),
    )
    .digest("hex");
}

function taskOrder(
  sort: TaskListQuery["sort"],
  cursor: TaskListCursor | undefined,
) {
  const afterName =
    cursor === undefined
      ? undefined
      : or(
          gt(foldedName, cursor.name),
          and(eq(foldedName, cursor.name), gt(objects.id, cursor.id)),
        );
  switch (sort) {
    case "name":
      return { order: [asc(foldedName), asc(objects.id)], after: afterName };
    case "updated": {
      const time = sql`${cursor?.updatedAt}::timestamptz`;
      return {
        order: [desc(objects.updatedAt), asc(objects.id)],
        after:
          cursor === undefined
            ? undefined
            : or(
                lt(objects.updatedAt, time),
                and(eq(objects.updatedAt, time), gt(objects.id, cursor.id)),
              ),
      };
    }
    case "due": {
      const time = sql`${cursor?.dueAt}::timestamptz`;
      const after =
        cursor?.dueAt === null
          ? and(isNull(duePosition), afterName)
          : or(
              isNull(duePosition),
              gt(duePosition, time),
              and(eq(duePosition, time), afterName),
            );
      return {
        order: [
          sql`${duePosition} ASC NULLS LAST`,
          asc(foldedName),
          asc(objects.id),
        ],
        after: cursor === undefined ? undefined : after,
      };
    }
  }
}

function statusPredicate(filter: TaskListQuery["filter"]) {
  if (filter === "all") return undefined;
  if (filter === "done") return eq(tasks.status, "done");
  return inArray(tasks.status, ["todo", "in_progress"]);
}

function readPosition(
  token: string | undefined,
  context: string,
): TaskListCursor | undefined {
  if (token === undefined) return undefined;
  try {
    const cursor = taskListCursorSchema.parse(decodeCursor(token));
    if (cursor.context === context) return cursor;
  } catch {
    // Invalid encoding, shape, and context have the same public failure.
  }
  throw new InvalidObjectStateError(
    "The task cursor is invalid for this query.",
  );
}

export async function listTaskPage(
  database: AuthorizationDatabase,
  principal: UserPrincipal,
  options: TaskListQueryInput = {},
): Promise<TaskPage> {
  const input = taskListQuerySchema.parse(options);
  const context = taskListContext(principal, input);
  const cursor = readPosition(input.cursor, context);
  const asOf = cursor?.asOf ?? new Date().toISOString().replace("Z", "000Z");
  const { order, after } = taskOrder(input.sort, cursor);
  const pattern = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;

  return withReadAuthorization(database, async (transaction, authorization) => {
    const rows = await transaction
      .select({
        id: objects.id,
        name: foldedName,
        // API dates use milliseconds; keyset positions retain database precision.
        dueAt: sql<
          string | null
        >`to_char(${duePosition} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
        updatedAt: sql<string>`to_char(${objects.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
      })
      .from(objects)
      .innerJoin(
        tasks,
        and(
          eq(tasks.objectId, objects.id),
          eq(tasks.workspaceId, objects.workspaceId),
        ),
      )
      .where(
        and(
          eq(objects.objectType, "task"),
          authorization.resourcePredicate(principal, "view"),
          input.query === "" ? undefined : ilike(objects.displayName, pattern),
          statusPredicate(input.filter),
          input.label === undefined
            ? undefined
            : sql`EXISTS (SELECT 1 FROM ${taskLabels} WHERE ${taskLabels.taskId} = ${objects.id} AND ${taskLabels.labelId} = ${input.label})`,
          input.assignee === undefined
            ? undefined
            : eq(tasks.assigneePersonId, input.assignee),
          after,
        ),
      )
      .orderBy(...order)
      .limit(input.limit + 1);
    const page = rows.slice(0, input.limit);
    const states =
      page.length === 0
        ? []
        : await readObjectStates(
            transaction,
            and(
              eq(objects.workspaceId, principal.workspaceId),
              inArray(
                objects.id,
                page.map(({ id }) => id),
              ),
            ),
            input.limit,
          );
    const byId = new Map(states.map((state) => [state.id, state]));
    const items = page.map(({ id }) => {
      const task = byId.get(id);
      if (task?.objectType !== "task")
        throw new InvalidObjectStateError(
          "The canonical Task state is missing.",
        );
      return task;
    });
    // The including Event, only where the caller may view it; the earliest
    // inclusion names the context when more than one Event includes a task.
    const contexts: Record<string, TaskContext> = {};
    if (items.length > 0) {
      const inclusions = await transaction
        .select({
          taskId: objectRelations.targetObjectId,
          eventId: objects.id,
          displayName: objects.displayName,
        })
        .from(objectRelations)
        .innerJoin(
          objects,
          and(
            eq(objects.id, objectRelations.sourceObjectId),
            eq(objects.workspaceId, objectRelations.workspaceId),
          ),
        )
        .where(
          and(
            eq(objectRelations.workspaceId, principal.workspaceId),
            eq(objectRelations.relationType, "includes"),
            isNull(objectRelations.deletedAt),
            inArray(
              objectRelations.targetObjectId,
              items.map(({ id }) => id),
            ),
            eq(objects.objectType, "event"),
            isNull(objects.deletedAt),
            authorization.resourcePredicate(principal, "view"),
          ),
        )
        .orderBy(asc(objectRelations.createdAt), asc(objectRelations.id));
      for (const inclusion of inclusions)
        contexts[inclusion.taskId] ??= {
          eventId: inclusion.eventId,
          displayName: inclusion.displayName,
        };
    }
    // Subtask progress of the listed parents, and the parent of each listed
    // subtask; both under the view predicate, since a scope change can part
    // a subtask from its parent's scope.
    const progress: Record<string, TaskProgress> = {};
    const parents: Record<string, TaskParent> = {};
    if (items.length > 0) {
      const counts = await transaction
        .select({
          parentTaskId: tasks.parentTaskId,
          total: sql<number>`count(*)::int`,
          done: sql<number>`count(*) FILTER (WHERE ${tasks.status} = 'done')::int`,
        })
        .from(tasks)
        .innerJoin(
          objects,
          and(
            eq(objects.id, tasks.objectId),
            eq(objects.workspaceId, tasks.workspaceId),
          ),
        )
        .where(
          and(
            eq(tasks.workspaceId, principal.workspaceId),
            inArray(
              tasks.parentTaskId,
              items.map(({ id }) => id),
            ),
            authorization.resourcePredicate(principal, "view"),
          ),
        )
        .groupBy(tasks.parentTaskId);
      for (const row of counts)
        if (row.parentTaskId !== null)
          progress[row.parentTaskId] = { done: row.done, total: row.total };
      const parentIds = [
        ...new Set(
          items.flatMap((task) =>
            task.parentTaskId === null ? [] : [task.parentTaskId],
          ),
        ),
      ];
      if (parentIds.length > 0) {
        const parentRows = await transaction
          .select({ id: objects.id, displayName: objects.displayName })
          .from(objects)
          .where(
            and(
              eq(objects.workspaceId, principal.workspaceId),
              inArray(objects.id, parentIds),
              authorization.resourcePredicate(principal, "view"),
            ),
          );
        const named = new Map(
          parentRows.map((row) => [row.id, row.displayName]),
        );
        for (const task of items) {
          const displayName =
            task.parentTaskId === null
              ? undefined
              : named.get(task.parentTaskId);
          if (task.parentTaskId !== null && displayName !== undefined)
            parents[task.id] = { taskId: task.parentTaskId, displayName };
        }
      }
    }
    const last = page.at(-1);
    return {
      items,
      contexts,
      progress,
      parents,
      asOf,
      nextCursor:
        rows.length > input.limit && last !== undefined
          ? encodeCursor({
              formatVersion: 1,
              context,
              asOf,
              ...last,
            } satisfies TaskListCursor)
          : null,
    };
  });
}
