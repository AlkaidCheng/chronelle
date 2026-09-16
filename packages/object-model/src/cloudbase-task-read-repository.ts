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
  readCloudBaseInclusionsOf,
  readCloudBaseObjectRows,
  readCloudBaseObjects,
  readCloudBaseSubtasks,
  readCloudBaseTaskLabels,
  readCloudBaseTasks,
  readCloudBaseVisibility,
  readCloudBaseVisibleObjects,
} from "./cloudbase-read-support.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import { InvalidObjectStateError } from "./errors.js";
import {
  type TaskContext,
  type TaskPage,
  type TaskParent,
  type TaskProgress,
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

/** The calendar day of an instant in a time zone, as YYYY-MM-DD. */
function dayIn(instant: Date, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const part = (type: string) =>
    parts.find((candidate) => candidate.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** The day a task is due in the query's time zone; none when undated. */
function dueDay(task: TaskResource, timezone: string): string | null {
  if (task.dueOn !== null) return task.dueOn;
  return task.dueAt === null ? null : dayIn(task.dueAt, timezone);
}

function matchesDueRange(task: TaskResource, input: TaskListQuery): boolean {
  if (input.dueFrom === undefined && input.dueTo === undefined) return true;
  const day = dueDay(task, input.timezone);
  return (
    day !== null &&
    (input.dueFrom === undefined || day >= input.dueFrom) &&
    (input.dueTo === undefined || day <= input.dueTo)
  );
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
    const [taskRows, taskLabels] = await Promise.all([
      readCloudBaseTasks(this.#client, principal, objectIds),
      readCloudBaseTaskLabels(this.#client, principal, objectIds),
    ]);
    const byId = new Map(
      taskRows.map((task) => [
        cloudbaseText(task.object_id, "task object"),
        task,
      ]),
    );
    let tasks = objects.flatMap((object) => {
      const id = cloudbaseText(object.id, "object id");
      const task = byId.get(id);
      return task === undefined
        ? []
        : [cloudbaseTaskResource(object, task, taskLabels.get(id) ?? [])];
    });
    tasks = tasks.filter(
      (task) =>
        (input.query === "" ||
          task.displayName
            .toLocaleLowerCase()
            .includes(input.query.toLocaleLowerCase())) &&
        matchesStatus(task, input.filter) &&
        (input.label === undefined || task.labelIds.includes(input.label)) &&
        (input.assignee === undefined || task.assigneeId === input.assignee) &&
        matchesDueRange(task, input),
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
    // The including Event, only where the caller may view it; the earliest
    // inclusion names the context when more than one Event includes a task.
    const inclusions = await readCloudBaseInclusionsOf(
      this.#client,
      principal,
      page.map((task) => task.id),
    );
    const events = await readCloudBaseObjects(
      this.#client,
      principal,
      [
        ...new Set(
          inclusions.map((row) => cloudbaseText(row.source_object_id, "event")),
        ),
      ],
      "event",
    );
    const viewable = new Map(
      events
        .filter((row) => visibility.canView(row))
        .map((row) => [
          cloudbaseText(row.id, "event id"),
          cloudbaseText(row.display_name, "display name"),
        ]),
    );
    const contexts: Record<string, TaskContext> = {};
    for (const row of inclusions) {
      const eventId = cloudbaseText(row.source_object_id, "event");
      const displayName = viewable.get(eventId);
      if (displayName !== undefined)
        contexts[cloudbaseText(row.target_object_id, "task")] ??= {
          eventId,
          displayName,
        };
    }
    // Subtask progress of the listed parents and the parent of each listed
    // subtask, both through the same visibility as the tasks themselves.
    const pageIds = page.map((task) => task.id);
    const subtaskRows = await readCloudBaseSubtasks(
      this.#client,
      principal,
      pageIds,
    );
    const parentIds = [
      ...new Set(
        page.flatMap((task) =>
          task.parentTaskId === null ? [] : [task.parentTaskId],
        ),
      ),
    ];
    const relatedObjects = await readCloudBaseObjectRows(
      this.#client,
      principal,
      [
        ...new Set([
          ...subtaskRows.map((row) => cloudbaseText(row.object_id, "task")),
          ...parentIds,
        ]),
      ],
      ["task"],
    );
    const viewableRows = new Map(
      relatedObjects
        .filter((row) => visibility.canView(row))
        .map((row) => [cloudbaseText(row.id, "task id"), row]),
    );
    const progress: Record<string, TaskProgress> = {};
    for (const row of subtaskRows) {
      if (!viewableRows.has(cloudbaseText(row.object_id, "task"))) continue;
      const parentId = cloudbaseText(row.parent_task_id, "parent task");
      const current = progress[parentId] ?? { done: 0, total: 0 };
      progress[parentId] = {
        done:
          current.done +
          (cloudbaseText(row.status, "status") === "done" ? 1 : 0),
        total: current.total + 1,
      };
    }
    const parents: Record<string, TaskParent> = {};
    for (const task of page) {
      const parent =
        task.parentTaskId === null
          ? undefined
          : viewableRows.get(task.parentTaskId);
      if (task.parentTaskId !== null && parent !== undefined)
        parents[task.id] = {
          taskId: task.parentTaskId,
          displayName: cloudbaseText(parent.display_name, "display name"),
        };
    }
    return {
      items: page,
      contexts,
      progress,
      parents,
      asOf: asOfValue,
      nextCursor:
        tasks.length > input.limit && page.at(-1) !== undefined
          ? pageCursor(page.at(-1) as TaskResource, context, asOfValue)
          : null,
    };
  }
}
