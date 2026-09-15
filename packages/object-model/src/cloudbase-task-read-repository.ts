import type { UserPrincipal } from "@chronelle/authorization";
import type { CloudBaseRdbReader } from "@chronelle/db";
import {
  taskListCursorSchema,
  taskListQuerySchema,
  type TaskListCursor,
  type TaskListQuery,
  type TaskListQueryInput,
} from "@chronelle/schemas";

import {
  cloudbaseTaskResource,
  cloudbaseText,
  readCloudBaseTasks,
  readCloudBaseVisibility,
  readCloudBaseVisibleObjects,
} from "./cloudbase-read-support.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { InvalidObjectStateError } from "./errors.js";
import {
  type TaskPage,
  type TaskReadRepository,
  taskListContext,
} from "./task-list.js";
import type { TaskResource } from "./types.js";

function cursorTimestamp(value: Date): string {
  return value.toISOString().replace("Z", "000Z");
}

/** Where a task sits in due order: its instant, or the start of its date in UTC. */
function duePosition(task: TaskResource): Date | null {
  if (task.dueOn !== null) return new Date(`${task.dueOn}T00:00:00Z`);
  return task.dueAt;
}

function readCursor(
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

function matchesStatus(
  task: TaskResource,
  filter: TaskListQuery["filter"],
): boolean {
  if (filter === "all") return true;
  if (filter === "done") return task.status === "done";
  return task.status === "todo" || task.status === "in_progress";
}

function compareName(first: TaskResource, second: TaskResource): number {
  return (
    first.displayName
      .toLocaleLowerCase()
      .localeCompare(second.displayName.toLocaleLowerCase()) ||
    first.id.localeCompare(second.id)
  );
}

function compareDue(first: TaskResource, second: TaskResource): number {
  const firstDue = duePosition(first);
  const secondDue = duePosition(second);
  if (firstDue === null && secondDue !== null) return 1;
  if (firstDue !== null && secondDue === null) return -1;
  return (
    (firstDue?.getTime() ?? 0) - (secondDue?.getTime() ?? 0) ||
    compareName(first, second)
  );
}

function compareUpdated(first: TaskResource, second: TaskResource): number {
  return (
    second.updatedAt.getTime() - first.updatedAt.getTime() ||
    first.id.localeCompare(second.id)
  );
}

function afterCursor(
  task: TaskResource,
  cursor: TaskListCursor,
  sort: TaskListQuery["sort"],
): boolean {
  if (sort === "name") {
    const name = task.displayName.toLocaleLowerCase();
    return name > cursor.name || (name === cursor.name && task.id > cursor.id);
  }
  if (sort === "updated") {
    const updated = task.updatedAt.getTime();
    const cursorUpdated = new Date(cursor.updatedAt).getTime();
    return (
      updated < cursorUpdated ||
      (updated === cursorUpdated && task.id > cursor.id)
    );
  }
  const position = duePosition(task)?.getTime() ?? Number.POSITIVE_INFINITY;
  const cursorPosition =
    cursor.dueAt === null
      ? Number.POSITIVE_INFINITY
      : new Date(cursor.dueAt).getTime();
  if (position !== cursorPosition) return position > cursorPosition;
  const name = task.displayName.toLocaleLowerCase();
  return name > cursor.name || (name === cursor.name && task.id > cursor.id);
}

function pageCursor(task: TaskResource, context: string, asOf: string): string {
  const due = duePosition(task);
  return encodeCursor({
    formatVersion: 1,
    context,
    asOf,
    id: task.id,
    name: task.displayName.toLocaleLowerCase(),
    dueAt: due === null ? null : cursorTimestamp(due),
    updatedAt: cursorTimestamp(task.updatedAt),
  } satisfies TaskListCursor);
}

/** Read-only CloudBase task list with the PostgreSQL cursor envelope. */
export class CloudBaseTaskReadRepository implements TaskReadRepository {
  readonly #client: CloudBaseRdbReader;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseRdbReader,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async listTasks(
    principal: UserPrincipal,
    options: TaskListQueryInput = {},
  ): Promise<TaskPage> {
    const input = taskListQuerySchema.parse(options);
    const context = taskListContext(principal, input);
    const cursor = readCursor(input.cursor, context);
    const asOf = cursor === undefined ? this.#clock() : new Date(cursor.asOf);
    const visibility = await readCloudBaseVisibility(
      this.#client,
      principal,
      this.#clock,
    );
    const objects = await readCloudBaseVisibleObjects(
      this.#client,
      principal,
      visibility,
      "task",
    );
    const objectIds = objects.map((object) =>
      cloudbaseText(object.id, "object id"),
    );
    const taskRows = await readCloudBaseTasks(
      this.#client,
      principal,
      objectIds,
    );
    const byId = new Map(
      taskRows.map((task) => [
        cloudbaseText(task.object_id, "task object"),
        task,
      ]),
    );
    let tasks = objects.flatMap((object) => {
      const task = byId.get(cloudbaseText(object.id, "object id"));
      return task === undefined ? [] : [cloudbaseTaskResource(object, task)];
    });
    tasks = tasks.filter(
      (task) =>
        (input.query === "" ||
          task.displayName
            .toLocaleLowerCase()
            .includes(input.query.toLocaleLowerCase())) &&
        matchesStatus(task, input.filter),
    );
    tasks.sort(
      input.sort === "name"
        ? compareName
        : input.sort === "updated"
          ? compareUpdated
          : compareDue,
    );
    if (cursor !== undefined)
      tasks = tasks.filter((task) => afterCursor(task, cursor, input.sort));
    const page = tasks.slice(0, input.limit);
    const asOfValue = cursor?.asOf ?? cursorTimestamp(asOf);
    return {
      items: page,
      asOf: asOfValue,
      nextCursor:
        tasks.length > input.limit && page.at(-1) !== undefined
          ? pageCursor(page.at(-1) as TaskResource, context, asOfValue)
          : null,
    };
  }
}
