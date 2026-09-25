import type { UserPrincipal } from "@livtales/authorization";
import {
  taskListCursorSchema,
  taskListQuerySchema,
  type TaskListCursor,
  type TaskListQuery,
  type TaskListQueryInput,
} from "@livtales/schemas";

import {
  type CloudBaseObjectRow,
  type CloudBaseTaskRow,
  cloudbaseDate,
  cloudbaseNullableDate,
  cloudbaseNullableText,
  cloudbaseTaskResource,
  cloudbaseText,
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

interface TaskHydration {
  readonly objects: readonly CloudBaseObjectRow[];
  readonly tasks: readonly CloudBaseTaskRow[];
  readonly labels: readonly Record<string, unknown>[];
  readonly contexts: readonly Record<string, unknown>[];
  readonly subtasks: readonly Record<string, unknown>[];
  readonly parents: readonly Record<string, unknown>[];
}

const emptyTaskHydration: TaskHydration = {
  objects: [],
  tasks: [],
  labels: [],
  contexts: [],
  subtasks: [],
  parents: [],
};

function taskHydration(value: unknown): TaskHydration {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("CloudBase returned invalid task hydration.");
  const result = value as Record<string, unknown>;
  return {
    objects: cloudbaseListRows(result.objects) as CloudBaseObjectRow[],
    tasks: cloudbaseListRows(result.tasks) as CloudBaseTaskRow[],
    labels: cloudbaseListRows(result.labels),
    contexts: cloudbaseListRows(result.contexts),
    subtasks: cloudbaseListRows(result.subtasks),
    parents: cloudbaseListRows(result.parents),
  };
}

function taskLabels(
  rows: readonly Record<string, unknown>[],
): ReadonlyMap<string, string[]> {
  const labels = new Map<string, { id: string; name: string }[]>();
  for (const row of rows) {
    const taskId = cloudbaseText(row.task_id, "labelled task");
    const entries = labels.get(taskId) ?? [];
    entries.push({
      id: cloudbaseText(row.label_id, "label id"),
      name: cloudbaseText(row.label_name, "label name").toLowerCase(),
    });
    labels.set(taskId, entries);
  }
  return new Map(
    [...labels].map(([taskId, entries]) => [
      taskId,
      entries
        .sort(
          (first, second) =>
            first.name.localeCompare(second.name) ||
            first.id.localeCompare(second.id),
        )
        .map(({ id }) => id),
    ]),
  );
}

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
    const raw = await this.#client.rpc("chronelle_task_list_candidates", {
      workspace_id: principal.workspaceId,
      user_id: principal.userId,
      status_filter: input.filter,
      label_id: input.label ?? null,
      assignee_id: input.assignee ?? null,
      list_sort: input.sort,
      page_limit: bounded ? input.limit + 1 : null,
      after_position: bounded ? (cursor ?? null) : null,
      access_at: now.toISOString(),
    });
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
    const hydration =
      ids.length === 0
        ? emptyTaskHydration
        : taskHydration(
            await this.#client.rpc("chronelle_task_list_hydrate", {
              workspace_id: principal.workspaceId,
              user_id: principal.userId,
              task_ids: ids,
              access_at: now.toISOString(),
            }),
          );
    const labels = taskLabels(hydration.labels);
    const objectsById = new Map(
      hydration.objects.map((object) => [
        cloudbaseText(object.id, "object id"),
        object,
      ]),
    );
    const tasksById = new Map(
      hydration.tasks.map((task) => [
        cloudbaseText(task.object_id, "task id"),
        task,
      ]),
    );
    const page = candidates.flatMap(({ id }) => {
      const object = objectsById.get(id);
      const task = tasksById.get(id);
      return object === undefined || task === undefined
        ? []
        : [cloudbaseTaskResource(object, task, labels.get(id) ?? [])];
    });
    const asOfValue = cursor?.asOf ?? cursorTimestamp(asOf);
    // The including Event, only where the caller may view it; the earliest
    // inclusion names the context when more than one Event includes a task.
    const contexts: Record<string, TaskContext> = {};
    for (const row of hydration.contexts) {
      contexts[cloudbaseText(row.target_object_id, "task")] ??= {
        eventId: cloudbaseText(row.source_object_id, "event"),
        displayName: cloudbaseText(row.display_name, "display name"),
      };
    }
    // Subtask progress of the listed parents and the parent of each listed
    // subtask, both through the same visibility as the tasks themselves.
    const progress: Record<string, TaskProgress> = {};
    for (const row of hydration.subtasks) {
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
    for (const row of hydration.parents) {
      parents[cloudbaseText(row.task_id, "task")] = {
        taskId: cloudbaseText(row.parent_task_id, "parent task"),
        displayName: cloudbaseText(row.display_name, "display name"),
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
