import type { UserPrincipal } from "@chronelle/authorization";
import {
  taskListCursorSchema,
  taskListQuerySchema,
  type TaskListCursor,
  type TaskListQuery,
  type TaskListQueryInput,
} from "@chronelle/schemas";

import {
  cloudbaseDate,
  cloudbaseNullableDate,
  cloudbaseNullableText,
  cloudbaseTaskResource,
  cloudbaseText,
  readCloudBaseInclusionsOf,
  readCloudBaseObjectRows,
  readCloudBaseObjects,
  readCloudBaseSubtasks,
  readCloudBaseTaskLabels,
  readCloudBaseTasks,
  readCloudBaseVisibility,
} from "./cloudbase-read-support.js";
import {
  cloudbaseListRows,
  type CloudBaseListClient,
} from "./cloudbase-list-candidates.js";
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

type TaskCandidate = Pick<
  TaskResource,
  "id" | "displayName" | "updatedAt" | "dueAt" | "dueOn" | "rank"
>;

function cursorTimestamp(value: Date): string {
  return value.toISOString().replace("Z", "000Z");
}

/** Where a task sits in due order: its instant, or the start of its date in UTC. */
function duePosition(task: TaskCandidate): Date | null {
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
function dueDay(task: TaskCandidate, timezone: string): string | null {
  if (task.dueOn !== null) return task.dueOn;
  return task.dueAt === null ? null : dayIn(task.dueAt, timezone);
}

function matchesDueRange(task: TaskCandidate, input: TaskListQuery): boolean {
  if (input.dueFrom === undefined && input.dueTo === undefined) return true;
  const day = dueDay(task, input.timezone);
  return (
    day !== null &&
    (input.dueFrom === undefined || day >= input.dueFrom) &&
    (input.dueTo === undefined || day <= input.dueTo)
  );
}

function compareName(first: TaskCandidate, second: TaskCandidate): number {
  return (
    first.displayName
      .toLocaleLowerCase()
      .localeCompare(second.displayName.toLocaleLowerCase()) ||
    first.id.localeCompare(second.id)
  );
}

function compareDue(first: TaskCandidate, second: TaskCandidate): number {
  const firstDue = duePosition(first);
  const secondDue = duePosition(second);
  if (firstDue === null && secondDue !== null) return 1;
  if (firstDue !== null && secondDue === null) return -1;
  return (
    (firstDue?.getTime() ?? 0) - (secondDue?.getTime() ?? 0) ||
    compareName(first, second)
  );
}

function compareRank(first: TaskCandidate, second: TaskCandidate): number {
  return (
    (first.rank < second.rank ? -1 : first.rank > second.rank ? 1 : 0) ||
    first.id.localeCompare(second.id)
  );
}

function compareUpdated(first: TaskCandidate, second: TaskCandidate): number {
  return (
    second.updatedAt.getTime() - first.updatedAt.getTime() ||
    first.id.localeCompare(second.id)
  );
}

function afterCursor(
  task: TaskCandidate,
  cursor: TaskListCursor,
  sort: TaskListQuery["sort"],
): boolean {
  if (sort === "manual")
    return (
      task.rank > cursor.rank ||
      (task.rank === cursor.rank && task.id > cursor.id)
    );
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

function pageCursor(
  task: TaskCandidate,
  context: string,
  asOf: string,
): string {
  const due = duePosition(task);
  return encodeCursor({
    formatVersion: 1,
    context,
    asOf,
    id: task.id,
    name: task.displayName.toLocaleLowerCase(),
    dueAt: due === null ? null : cursorTimestamp(due),
    updatedAt: cursorTimestamp(task.updatedAt),
    rank: task.rank,
  } satisfies TaskListCursor);
}

/** Read-only CloudBase task list with the PostgreSQL cursor envelope. */
export class CloudBaseTaskReadRepository implements TaskReadRepository {
  readonly #client: CloudBaseListClient;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseListClient,
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
    const now = this.#clock();
    // Keep locale and IANA calendar-day semantics in this runtime. Without
    // those filters, updated/manual order can use a bounded SQL keyset.
    const bounded =
      input.query === "" &&
      input.dueFrom === undefined &&
      input.dueTo === undefined &&
      (input.sort === "updated" || input.sort === "manual");
    const [raw, visibility] = await Promise.all([
      this.#client.rpc("chronelle_task_list_candidates", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        status_filter: input.filter,
        label_id: input.label ?? null,
        assignee_id: input.assignee ?? null,
        list_sort: input.sort,
        page_limit: bounded ? input.limit + 1 : null,
        after_position: bounded ? (cursor ?? null) : null,
        access_at: now.toISOString(),
      }),
      readCloudBaseVisibility(this.#client, principal, () => now),
    ]);
    let tasks = cloudbaseListRows(raw).map((row): TaskCandidate => ({
      id: cloudbaseText(row.id, "task id"),
      displayName: cloudbaseText(row.display_name, "display name"),
      updatedAt: cloudbaseDate(row.updated_at, "updated_at"),
      dueAt: cloudbaseNullableDate(row.due_at, "due_at"),
      dueOn: cloudbaseNullableText(row.due_on, "due_on"),
      rank: cloudbaseText(row.rank, "rank"),
    }));
    tasks = tasks.filter(
      (task) =>
        (input.query === "" ||
          task.displayName
            .toLocaleLowerCase()
            .includes(input.query.toLocaleLowerCase())) &&
        matchesDueRange(task, input),
    );
    tasks.sort(
      input.sort === "manual"
        ? compareRank
        : input.sort === "name"
          ? compareName
          : input.sort === "updated"
            ? compareUpdated
            : compareDue,
    );
    if (cursor !== undefined)
      tasks = tasks.filter((task) => afterCursor(task, cursor, input.sort));
    const candidates = tasks.slice(0, input.limit);
    const ids = candidates.map((task) => task.id);
    const [objects, taskRows, taskLabels] = await Promise.all([
      readCloudBaseObjects(this.#client, principal, ids, "task"),
      readCloudBaseTasks(this.#client, principal, ids),
      readCloudBaseTaskLabels(this.#client, principal, ids),
    ]);
    const objectsById = new Map(
      objects
        .filter((object) => visibility.canView(object))
        .map((object) => [cloudbaseText(object.id, "object id"), object]),
    );
    const tasksById = new Map(
      taskRows.map((task) => [cloudbaseText(task.object_id, "task id"), task]),
    );
    const page = candidates.flatMap(({ id }) => {
      const object = objectsById.get(id);
      const task = tasksById.get(id);
      return object === undefined || task === undefined
        ? []
        : [cloudbaseTaskResource(object, task, taskLabels.get(id) ?? [])];
    });
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
        tasks.length > input.limit && candidates.at(-1) !== undefined
          ? pageCursor(candidates.at(-1) as TaskCandidate, context, asOfValue)
          : null,
    };
  }
}
