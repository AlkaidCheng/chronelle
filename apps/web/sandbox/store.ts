import {
  eventCalendarDatesSchema,
  eventLayoutResponseSchema,
  eventLayoutUpdateSchema,
  eventLayoutRestoreSchema,
  eventLayoutHistoryQuerySchema,
  type EventLayoutResponse,
  eventContextCreateRequestSchema,
  eventCreateRequestSchema,
  eventListQuerySchema,
  eventPlanningResourceResponseSchema,
  eventUpdateRequestSchema,
  labelCreateRequestSchema,
  labelDeleteQuerySchema,
  labelResponseSchema,
  labelUpdateRequestSchema,
  type LabelResponse,
  personCreateRequestSchema,
  personListQuerySchema,
  personUpdateRequestSchema,
  taskCreateRequestSchema,
  taskListQuerySchema,
  taskUpdateRequestSchema,
  expenseUpdateRequestSchema,
  reminderUpdateRequestSchema,
  objectSearchQuerySchema,
  relationCreateRequestSchema,
  relationResponseSchema,
  type EventPlanningResourceResponse as Resource,
  type TimelineResponse,
} from "@chronelle/schemas";
import { eventPeriod } from "../lib/event-collection";

export const sandboxWorkspaceId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
export const sandboxStorageKey = "chronelle.design-sandbox.v1";
const workspace = { id: sandboxWorkspaceId, displayName: "Design playground" };
const maximumCharacters = 1_000_000;
type StoragePort = Pick<Storage, "getItem" | "setItem">;
type RelationResponse = ReturnType<typeof relationResponseSchema.parse>;
interface State {
  objects: Resource[];
  relations: RelationResponse[];
  layouts: EventLayoutResponse[];
  labels: LabelResponse[];
}

class SandboxError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function canonical(
  objectType: Resource["objectType"],
  input: Record<string, unknown>,
  scope?: string,
): Resource {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const defaults = {
    event: { startsAt: null, endsAt: null, timezone: null, isAllDay: false },
    task: {
      dueOn: null,
      dueAt: null,
      completedAt: null,
      status: "todo",
      parentTaskId: null,
      assigneeId: null,
      location: null,
      labelIds: [],
    },
    expense: {},
    reminder: { status: "pending" },
    document: {},
    person: { email: null, userId: null },
  }[objectType];
  return eventPlanningResourceResponseSchema.parse({
    ...defaults,
    ...input,
    objectType,
    id,
    workspaceId: sandboxWorkspaceId,
    permissionScopeId: scope ?? id,
    createdBy: userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    archivedAt: null,
    deletedAt: null,
    customProperties: input.customProperties ?? {},
    metadata: input.metadata ?? {},
  });
}

function relation(source: string, target: string): RelationResponse {
  return {
    id: crypto.randomUUID(),
    workspaceId: sandboxWorkspaceId,
    sourceObjectId: source,
    targetObjectId: target,
    relationType: "includes",
    version: 1,
    metadata: {},
    createdBy: userId,
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
}

function seed(): State {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  date.setHours(10, 0, 0, 0);
  const timestamp = date.toISOString();
  const event = canonical("event", {
    displayName: "Autumn gathering",
    startsAt: timestamp,
  });
  const children = [
    canonical(
      "task",
      { displayName: "Confirm the garden venue", dueAt: timestamp },
      event.id,
    ),
    canonical(
      "task",
      {
        displayName: "Send invitations",
        status: "done",
        completedAt: timestamp,
      },
      event.id,
    ),
    canonical(
      "event",
      { displayName: "Welcome and coffee", startsAt: timestamp },
      event.id,
    ),
    canonical(
      "expense",
      {
        displayName: "Venue deposit",
        amount: "240.0000",
        currency: "USD",
        occurredAt: timestamp,
      },
      event.id,
    ),
    canonical(
      "reminder",
      { displayName: "Check the weather forecast", remindAt: timestamp },
      event.id,
    ),
  ];
  return {
    layouts: [],
    labels: [],
    objects: [
      event,
      canonical("event", { displayName: "A quiet studio weekend" }),
      ...children,
    ],
    relations: children.map((child) => relation(event.id, child.id)),
  };
}

function parseState(raw: string): State {
  if (raw.length > maximumCharacters)
    throw new Error("Snapshot exceeds the sandbox limit.");
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== "object" ||
    value === null ||
    !("objects" in value) ||
    !("relations" in value)
  )
    throw new Error("Invalid snapshot.");
  const objects = eventPlanningResourceResponseSchema
    .array()
    .max(200)
    .parse(value.objects);
  for (const object of objects)
    if (object.objectType === "event") {
      eventCalendarDatesSchema.parse(object);
      if (
        object.startsOn !== null &&
        (object.startsAt !== null || object.endsAt !== null)
      )
        throw new Error("Calendar dates cannot include timestamps.");
      if (
        object.endsAt !== null &&
        (object.startsAt === null || object.endsAt < object.startsAt)
      )
        throw new Error("Invalid event interval.");
    }
  const relations = relationResponseSchema
    .array()
    .max(400)
    .parse(value.relations);
  const ids = new Set(objects.map((object) => object.id));
  if (
    ids.size !== objects.length ||
    objects.some(
      (object) =>
        object.workspaceId !== sandboxWorkspaceId ||
        !ids.has(object.permissionScopeId),
    ) ||
    new Set(relations.map((link) => link.id)).size !== relations.length ||
    relations.some(
      (link) =>
        link.workspaceId !== sandboxWorkspaceId ||
        link.relationType !== "includes" ||
        !ids.has(link.sourceObjectId) ||
        !ids.has(link.targetObjectId),
    )
  )
    throw new Error("Invalid sandbox references.");
  const layouts = eventLayoutResponseSchema
    .array()
    .max(2000)
    .parse("layouts" in value ? value.layouts : []);
  if (
    new Set(layouts.map((layout) => `${layout.eventId}:${layout.version}`))
      .size !== layouts.length ||
    layouts.some(
      (layout) =>
        !objects.some(
          (object) =>
            object.id === layout.eventId && object.objectType === "event",
        ),
    )
  ) {
    throw new Error("Invalid sandbox page references.");
  }
  const labels = labelResponseSchema
    .array()
    .max(200)
    .parse("labels" in value ? value.labels : []);
  return {
    objects,
    relations,
    layouts: layouts.sort((a, b) => b.version - a.version),
    labels,
  };
}

function browserStorage(): StoragePort | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export class SandboxStore {
  #state: State = seed();
  #raw: string | null = null;
  #storage: StoragePort | undefined;
  #invalid = false;
  get notice(): string {
    if (this.#invalid)
      return "Saved sandbox data is unreadable. It is preserved; reset explicitly to edit sample data.";
    return this.#storage
      ? "Sample changes are saved in this browser."
      : "Browser storage unavailable: changes last until reload.";
  }

  constructor(storage = browserStorage()) {
    this.#storage = storage;
    if (storage) {
      try {
        this.#raw = storage.getItem(sandboxStorageKey);
      } catch {
        this.#storage = undefined;
      }
      if (this.#raw !== null) {
        try {
          this.#state = parseState(this.#raw);
        } catch {
          this.#invalid = true;
        }
      }
    }
  }

  reset() {
    const next = seed();
    const raw = JSON.stringify(next);
    this.#storage?.setItem(sandboxStorageKey, raw);
    this.#state = next;
    this.#raw = raw;
    this.#invalid = false;
  }

  #commit(next: State) {
    if (this.#invalid)
      throw new SandboxError(
        409,
        "sandbox_storage",
        "Reset the unreadable sandbox snapshot before editing.",
      );
    const raw = JSON.stringify(next);
    parseState(raw);
    if (this.#storage) {
      if (this.#storage.getItem(sandboxStorageKey) !== this.#raw)
        throw new SandboxError(
          409,
          "version_conflict",
          "Another tab changed this sandbox. Reload before editing.",
        );
      this.#storage.setItem(sandboxStorageKey, raw);
    }
    this.#state = next;
    this.#raw = raw;
  }

  // Labels: unique names per workspace, versioned renames and deletes, and
  // every task keeps only labels that exist.
  #labelWrite(
    method: string,
    id: string | undefined,
    url: URL,
    body: unknown,
  ): LabelResponse {
    const conflict = (name: string, except?: string) => {
      if (
        this.#state.labels.some(
          (label) =>
            label.id !== except &&
            label.name.toLowerCase() === name.toLowerCase(),
        )
      )
        throw new SandboxError(
          409,
          "label_name_taken",
          "A label with this name already exists.",
        );
    };
    const timestamp = new Date().toISOString();
    if (method === "POST" && !id) {
      const { name } = labelCreateRequestSchema.parse(body);
      conflict(name);
      const label = labelResponseSchema.parse({
        id: crypto.randomUUID(),
        workspaceId: sandboxWorkspaceId,
        name,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.#commit({ ...this.#state, labels: [...this.#state.labels, label] });
      return label;
    }
    const current = this.#state.labels.find((label) => label.id === id);
    if (current === undefined)
      throw new SandboxError(404, "not_found", "The label is unavailable.");
    if (method === "PATCH") {
      const { expectedVersion, name } = labelUpdateRequestSchema.parse(body);
      if (expectedVersion !== current.version)
        throw new SandboxError(
          409,
          "version_conflict",
          "The label changed. Refresh before saving.",
        );
      conflict(name, current.id);
      const label = {
        ...current,
        name,
        version: current.version + 1,
        updatedAt: timestamp,
      };
      this.#commit({
        ...this.#state,
        labels: this.#state.labels.map((item) =>
          item.id === id ? label : item,
        ),
      });
      return label;
    }
    const { expectedVersion } = labelDeleteQuerySchema.parse(
      Object.fromEntries(url.searchParams),
    );
    if (expectedVersion !== current.version)
      throw new SandboxError(
        409,
        "version_conflict",
        "The label changed. Refresh before saving.",
      );
    this.#commit({
      ...this.#state,
      labels: this.#state.labels.filter((item) => item.id !== id),
      objects: this.#state.objects.map((object) =>
        object.objectType === "task"
          ? {
              ...object,
              labelIds: object.labelIds.filter((labelId) => labelId !== id),
            }
          : object,
      ),
    });
    return current;
  }

  // Standalone creations replay by command id within the session: the same
  // input returns the object created, a different input is a conflict.
  readonly #createCommands = new Map<
    string,
    { readonly key: string; readonly objectId: string }
  >();

  #replayCreate(
    commandId: unknown,
    fields: Record<string, unknown>,
  ): Resource | undefined {
    if (typeof commandId !== "string") return undefined;
    const known = this.#createCommands.get(commandId);
    if (known === undefined) return undefined;
    if (known.key !== JSON.stringify(fields))
      throw new SandboxError(
        409,
        "command_conflict",
        "The command ID was already used with different input.",
      );
    return this.#object(known.objectId);
  }

  #rememberCreate(
    commandId: unknown,
    fields: Record<string, unknown>,
    objectId: string,
  ): void {
    if (typeof commandId === "string")
      this.#createCommands.set(commandId, {
        key: JSON.stringify(fields),
        objectId,
      });
  }

  // A person's linked account is the sample planner's and belongs to one
  // person, as the API requires of a workspace member.
  #checkPerson(person: Resource): Resource {
    if (person.objectType !== "person") return person;
    if (person.userId !== null) {
      if (person.userId !== userId)
        throw new SandboxError(
          400,
          "invalid_request",
          "userId must name a member of this workspace.",
        );
      if (
        this.#state.objects.some(
          (other) =>
            other.objectType === "person" &&
            other.id !== person.id &&
            other.userId === userId,
        )
      )
        throw new SandboxError(
          400,
          "invalid_request",
          "userId is already linked to another person.",
        );
    }
    return person;
  }

  // A task's assignee is a live person of the workspace and its labels are
  // the workspace's labels only, in name order.
  #checkTask(task: Resource): Resource {
    if (task.objectType !== "task") return task;
    if (
      task.assigneeId !== null &&
      !this.#state.objects.some(
        (object) =>
          object.objectType === "person" &&
          object.id === task.assigneeId &&
          object.deletedAt === null,
      )
    )
      throw new SandboxError(
        400,
        "invalid_request",
        "assigneeId must name a live person in this workspace.",
      );
    const names = new Map(
      this.#state.labels.map((label) => [label.id, label.name.toLowerCase()]),
    );
    if (task.labelIds.some((labelId) => !names.has(labelId)))
      throw new SandboxError(
        400,
        "invalid_request",
        "labelIds must name labels of this workspace.",
      );
    return {
      ...task,
      labelIds: [...new Set(task.labelIds)].sort(
        (a, b) =>
          (names.get(a) ?? "").localeCompare(names.get(b) ?? "") ||
          a.localeCompare(b),
      ),
    };
  }

  // The parent rules the API enforces: a live task of the same scope with
  // no parent of its own, and no subtasks under the new subtask.
  #assertTaskParent(task: Resource): void {
    if (task.objectType !== "task" || task.parentTaskId === null) return;
    const refuse = (message: string): never => {
      throw new SandboxError(400, "invalid_request", message);
    };
    if (task.parentTaskId === task.id)
      refuse("A task cannot be its own parent.");
    const parent = this.#state.objects.find(
      (object): object is Extract<Resource, { objectType: "task" }> =>
        object.id === task.parentTaskId &&
        object.objectType === "task" &&
        object.deletedAt === null,
    );
    if (parent === undefined)
      throw new SandboxError(
        400,
        "invalid_request",
        "parentTaskId must name a live task in this workspace.",
      );
    if (parent.parentTaskId !== null)
      refuse("A subtask cannot have subtasks of its own.");
    if (
      this.#state.objects.some(
        (object) =>
          object.objectType === "task" && object.parentTaskId === task.id,
      )
    )
      refuse("A task with subtasks cannot become a subtask.");
    if (parent.permissionScopeId !== task.permissionScopeId)
      refuse("A subtask shares its parent's permission scope.");
  }

  #object(id: string): Resource {
    const object = this.#state.objects.find(
      (object) => object.id === id && object.deletedAt === null,
    );
    if (!object)
      throw new SandboxError(
        404,
        "resource_unavailable",
        "This sample object is unavailable.",
      );
    return object;
  }

  async fetch(
    input: Parameters<typeof fetch>[0],
    options: RequestInit = {},
    role: "owner" | "viewer" = "owner",
  ): Promise<Response> {
    options.signal?.throwIfAborted();
    try {
      const url = new URL(String(input), "https://sandbox.invalid");
      if (url.origin !== "https://sandbox.invalid")
        throw new SandboxError(
          403,
          "sandbox_network",
          "External requests are disabled in the design sandbox.",
        );
      const method = options.method ?? "GET";
      if (method !== "GET" && role === "viewer")
        throw new SandboxError(
          403,
          "forbidden",
          "Viewer preview cannot edit sample data.",
        );
      const headers = new Headers(options.headers);
      if (
        headers.has("x-workspace-id") &&
        headers.get("x-workspace-id") !== sandboxWorkspaceId
      )
        throw new SandboxError(
          403,
          "workspace_unavailable",
          "Only the design workspace is available.",
        );
      const body: unknown = options.body
        ? JSON.parse(String(options.body))
        : undefined;
      const result = this.#dispatch(url, method, body, role);
      return Response.json(result);
    } catch (error) {
      if (error instanceof SandboxError)
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        );
      return Response.json(
        {
          error: {
            code: "sandbox_operation",
            message:
              "The sample change could not be saved. Check the values and available browser storage.",
          },
        },
        { status: 400 },
      );
    }
  }

  #read(url: URL, role: "owner" | "viewer"): unknown {
    const [, , collection, id, operation, action] = url.pathname.split("/");
    const all = this.#state.objects.filter(
      (object) => object.deletedAt === null,
    );
    if (collection === "labels" && !id)
      return {
        items: [...this.#state.labels].sort(
          (a, b) =>
            a.name.toLowerCase().localeCompare(b.name.toLowerCase()) ||
            a.id.localeCompare(b.id),
        ),
      };
    if (collection === "auth" && id === "session")
      return {
        user: {
          id: userId,
          displayName: "Sample planner",
          email: "planner@example.test",
        },
        principal: { type: "user", userId, workspaceId: sandboxWorkspaceId },
        workspace,
        availableWorkspaces: [workspace],
      };
    if (collection === "commands")
      return { version: 0, undo: null, redo: null };
    if (collection === "trash") return { items: [], nextCursor: null };
    if (collection === "search") {
      const query = objectSearchQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      const matches = all.filter(
        (object) =>
          object.displayName
            .toLowerCase()
            .includes(query.query.toLowerCase()) &&
          (!query.objectType || object.objectType === query.objectType),
      );
      const offset =
        query.cursor === undefined
          ? 0
          : matches.findIndex((object) => object.id === query.cursor) + 1;
      if (query.cursor !== undefined && offset === 0)
        throw new SandboxError(
          400,
          "invalid_cursor",
          "Search position is unavailable.",
        );
      const items = matches.slice(offset, offset + query.limit);
      return {
        items,
        nextCursor:
          offset + items.length < matches.length
            ? (items.at(-1)?.id ?? null)
            : null,
      };
    }
    if (collection === "persons" && !id) {
      // The workspace's people: name order, the first `limit` matching the query.
      const query = personListQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      return {
        items: all
          .filter((object) => object.objectType === "person")
          .filter((person) =>
            person.displayName
              .toLowerCase()
              .includes(query.query.toLowerCase()),
          )
          .sort(
            (a, b) =>
              a.displayName
                .toLowerCase()
                .localeCompare(b.displayName.toLowerCase()) ||
              a.id.localeCompare(b.id),
          )
          .slice(0, query.limit),
      };
    }
    if (collection === "tasks" && !id) {
      // The workspace task list: status filter, due/name/updated order, and
      // a cursor that names the last task of the previous page.
      const query = taskListQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      const duePosition = (task: Resource) =>
        task.objectType === "task"
          ? task.dueOn
            ? `${task.dueOn}T00:00:00.000Z`
            : (task.dueAt ?? "z")
          : "z";
      // The day a task is due in the query's time zone; undated tasks are
      // in no range.
      const dueDay = (task: { dueOn: string | null; dueAt: string | null }) => {
        if (task.dueOn !== null) return task.dueOn;
        if (task.dueAt === null) return null;
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: query.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(new Date(task.dueAt));
        const part = (type: string) =>
          parts.find((candidate) => candidate.type === type)?.value ?? "";
        return `${part("year")}-${part("month")}-${part("day")}`;
      };
      const inDueRange = (task: {
        dueOn: string | null;
        dueAt: string | null;
      }) => {
        if (query.dueFrom === undefined && query.dueTo === undefined)
          return true;
        const day = dueDay(task);
        return (
          day !== null &&
          (query.dueFrom === undefined || day >= query.dueFrom) &&
          (query.dueTo === undefined || day <= query.dueTo)
        );
      };
      const matches = all
        .filter(
          (object): object is Extract<Resource, { objectType: "task" }> =>
            object.objectType === "task",
        )
        .filter(
          (task) =>
            task.displayName
              .toLowerCase()
              .includes(query.query.toLowerCase()) &&
            (query.filter === "all" ||
              (query.filter === "done"
                ? task.status === "done"
                : task.status === "todo" || task.status === "in_progress")) &&
            (query.label === undefined ||
              task.labelIds.includes(query.label)) &&
            (query.assignee === undefined ||
              task.assigneeId === query.assignee) &&
            inDueRange(task),
        )
        .sort((a, b) =>
          query.sort === "name"
            ? a.displayName.localeCompare(b.displayName) ||
              a.id.localeCompare(b.id)
            : query.sort === "updated"
              ? b.updatedAt.localeCompare(a.updatedAt) ||
                a.id.localeCompare(b.id)
              : duePosition(a).localeCompare(duePosition(b)) ||
                a.displayName.localeCompare(b.displayName) ||
                a.id.localeCompare(b.id),
        );
      const offset =
        query.cursor === undefined
          ? 0
          : matches.findIndex((task) => task.id === query.cursor) + 1;
      if (query.cursor !== undefined && offset === 0)
        throw new SandboxError(
          400,
          "invalid_request",
          "The task cursor is invalid for this query.",
        );
      const items = matches.slice(offset, offset + query.limit);
      const liveTasks = all.filter(
        (object): object is Extract<Resource, { objectType: "task" }> =>
          object.objectType === "task",
      );
      const progress: Record<string, { done: number; total: number }> = {};
      const parents: Record<string, { taskId: string; displayName: string }> =
        {};
      for (const task of items) {
        const subtasks = liveTasks.filter(
          (candidate) => candidate.parentTaskId === task.id,
        );
        if (subtasks.length > 0)
          progress[task.id] = {
            done: subtasks.filter((candidate) => candidate.status === "done")
              .length,
            total: subtasks.length,
          };
        const parent =
          task.parentTaskId === null
            ? undefined
            : liveTasks.find((candidate) => candidate.id === task.parentTaskId);
        if (parent !== undefined)
          parents[task.id] = {
            taskId: parent.id,
            displayName: parent.displayName,
          };
      }
      const contexts: Record<string, { eventId: string; displayName: string }> =
        {};
      for (const task of items) {
        const relation = this.#state.relations.find(
          (candidate) =>
            candidate.targetObjectId === task.id &&
            candidate.relationType === "includes" &&
            candidate.deletedAt === null,
        );
        const event =
          relation === undefined
            ? undefined
            : all.find((object) => object.id === relation.sourceObjectId);
        if (event !== undefined)
          contexts[task.id] = {
            eventId: event.id,
            displayName: event.displayName,
          };
      }
      return {
        items,
        contexts,
        progress,
        parents,
        nextCursor:
          offset + items.length < matches.length
            ? (items.at(-1)?.id ?? null)
            : null,
        asOf: new Date().toISOString(),
      };
    }
    if (collection === "events" && !id) {
      const query = eventListQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      const now = Date.now();
      const items = all
        .filter((object) => object.objectType === "event")
        .filter(
          (event) =>
            event.displayName
              .toLowerCase()
              .includes(query.query.toLowerCase()) &&
            (query.filter === "all" ||
              eventPeriod(event, now) === query.filter),
        );
      items.sort((a, b) =>
        query.sort === "name"
          ? a.displayName.localeCompare(b.displayName)
          : query.sort === "updated"
            ? b.updatedAt.localeCompare(a.updatedAt)
            : (a.startsOn ?? a.startsAt ?? "z").localeCompare(
                b.startsOn ?? b.startsAt ?? "z",
              ),
      );
      return { items, nextCursor: null, asOf: new Date(now).toISOString() };
    }
    if (
      id &&
      (collection === "tasks" ||
        collection === "expenses" ||
        collection === "reminders" ||
        collection === "persons") &&
      !operation
    ) {
      const object = this.#object(id);
      const type = collection.slice(0, -1);
      if (object.objectType !== type)
        throw new SandboxError(404, "not_found", "Record is unavailable.");
      return object;
    }
    if (id && (collection === "objects" || collection === "events")) {
      const object = this.#object(id);
      if (!operation) return object;
      if (
        collection === "events" &&
        operation === "layout" &&
        object.objectType === "event"
      ) {
        if (action === "history") {
          const query = eventLayoutHistoryQuerySchema.parse(
            Object.fromEntries(url.searchParams),
          );
          const revisions = this.#state.layouts.filter(
            (layout) =>
              layout.eventId === id &&
              (query.beforeVersion === undefined ||
                layout.version < query.beforeVersion),
          );
          const items = revisions.slice(0, query.limit);
          return {
            items,
            nextBeforeVersion:
              revisions.length > query.limit ? items.at(-1)?.version : null,
          };
        }
        if (action) return undefined;
        return (
          this.#state.layouts.find((layout) => layout.eventId === id) ?? {
            eventId: id,
            version: 0,
            updatedAt: null,
            pages: [],
          }
        );
      }
      if (operation === "access")
        return {
          resourceId: id,
          actions: role === "owner" ? ["view", "edit"] : ["view"],
        };
      if (operation === "documents")
        return { items: [], lockedAttachmentCount: 0 };
      if (operation === "shares") return { items: [] };
      if (operation === "revisions")
        return { items: [], nextBeforeVersion: null };
      if (operation === "removed-relations")
        return { items: [], nextCursor: null };
      const links = this.#state.relations.filter(
        (link) => link.sourceObjectId === id && link.deletedAt === null,
      );
      if (operation === "relations") return { items: links, nextCursor: null };
      const children = all.filter((child) =>
        links.some((link) => link.targetObjectId === child.id),
      );
      const events = children
        .filter((child) => child.objectType === "event")
        .sort((a, b) =>
          (a.startsOn ?? a.startsAt ?? "z").localeCompare(
            b.startsOn ?? b.startsAt ?? "z",
          ),
        );
      // A date-only due sorts at the start of its day, ahead of timed tasks.
      const tasks = children
        .filter((child) => child.objectType === "task")
        .sort((a, b) =>
          (a.dueOn
            ? `${a.dueOn}T00:00:00.000Z`
            : (a.dueAt ?? "z")
          ).localeCompare(
            b.dueOn ? `${b.dueOn}T00:00:00.000Z` : (b.dueAt ?? "z"),
          ),
        );
      const expenses = children.filter(
        (child) => child.objectType === "expense",
      );
      const reminders = children.filter(
        (child) => child.objectType === "reminder",
      );
      const persons = children
        .filter((child) => child.objectType === "person")
        .sort(
          (a, b) =>
            a.displayName
              .toLowerCase()
              .localeCompare(b.displayName.toLowerCase()) ||
            a.id.localeCompare(b.id),
        );
      if (operation === "detail")
        return {
          event: object,
          events,
          tasks,
          expenses,
          reminders,
          persons,
          documents: [],
          lockedRelationCount: 0,
        };
      const projections: Record<string, Resource[]> = {
        todos: tasks,
        calendar: events,
        itinerary: events,
        expenses,
        reminders,
        people: persons,
      };
      const projection = projections[operation];
      if (projection) return { sourceEventId: id, items: projection };
      if (operation === "timeline")
        return {
          sourceEventId: id,
          items: children
            .flatMap<TimelineResponse["items"][number]>((child) => {
              if (
                child.objectType === "document" ||
                child.objectType === "person"
              )
                return [];
              const occursOn =
                child.objectType === "event"
                  ? child.startsOn
                  : child.objectType === "task"
                    ? child.dueOn
                    : null;
              if (occursOn)
                return [
                  {
                    canonicalObjectId: child.id,
                    objectType: child.objectType,
                    displayName: child.displayName,
                    occursAt: null,
                    occursOn,
                    version: child.version,
                  },
                ];
              const occursAt =
                child.objectType === "event"
                  ? child.startsAt
                  : child.objectType === "task"
                    ? child.dueAt
                    : child.objectType === "expense"
                      ? child.occurredAt
                      : child.objectType === "reminder"
                        ? child.remindAt
                        : null;
              return occursAt
                ? [
                    {
                      canonicalObjectId: child.id,
                      objectType: child.objectType,
                      displayName: child.displayName,
                      occursAt,
                      occursOn: null,
                      version: child.version,
                    },
                  ]
                : [];
            })
            .sort((a, b) =>
              (a.occursOn ?? a.occursAt ?? "").localeCompare(
                b.occursOn ?? b.occursAt ?? "",
              ),
            ),
        };
    }
  }

  #dispatch(
    url: URL,
    method: string,
    body: unknown,
    role: "owner" | "viewer",
  ): unknown {
    const [, api, collection, id, operation, action] = url.pathname.split("/");
    if (api !== "api")
      throw new SandboxError(404, "sandbox_route", "Unknown sandbox route.");
    if (method === "GET") {
      const response = this.#read(url, role);
      if (response !== undefined) return response;
    }
    if (
      collection === "labels" &&
      (method === "POST" || method === "PATCH" || method === "DELETE")
    )
      return this.#labelWrite(method, id, url, body);
    if (
      method === "POST" &&
      collection === "objects" &&
      id &&
      operation === "relations"
    ) {
      // An Event includes a live person the workspace already knows; the
      // relation is refused for other targets and for a repeat.
      const input = relationCreateRequestSchema.parse(body);
      const source = this.#object(id);
      const target = this.#object(input.targetObjectId);
      if (
        input.relationType !== "includes" ||
        source.objectType !== "event" ||
        target.objectType !== "person"
      )
        throw new SandboxError(
          400,
          "invalid_relation",
          "Only a person can be included in an event here.",
        );
      if (
        this.#state.relations.some(
          (link) =>
            link.sourceObjectId === id &&
            link.targetObjectId === target.id &&
            link.deletedAt === null,
        )
      )
        throw new SandboxError(
          409,
          "relation_exists",
          "The person is already part of this event.",
        );
      const link = relation(id, target.id);
      this.#commit({
        ...this.#state,
        relations: [...this.#state.relations, link],
      });
      return link;
    }
    if (method === "DELETE" && collection === "relations" && id) {
      const link = this.#state.relations.find(
        (candidate) => candidate.id === id && candidate.deletedAt === null,
      );
      if (link === undefined)
        throw new SandboxError(404, "not_found", "The link is unavailable.");
      const removed = {
        ...link,
        version: link.version + 1,
        deletedAt: new Date().toISOString(),
      };
      this.#commit({
        ...this.#state,
        relations: this.#state.relations.map((candidate) =>
          candidate.id === id ? removed : candidate,
        ),
      });
      return { id, version: removed.version, deletedAt: removed.deletedAt };
    }
    if (method === "POST" && collection === "persons" && !id) {
      const input = JSON.parse(
        JSON.stringify(personCreateRequestSchema.parse(body)),
      ) as Record<string, unknown>;
      const { permissionScopeId, commandId, ...fields } = input;
      const replay = this.#replayCreate(commandId, fields);
      if (replay !== undefined) return replay;
      const person = this.#checkPerson(
        canonical(
          "person",
          fields,
          typeof permissionScopeId === "string" ? permissionScopeId : undefined,
        ),
      );
      this.#commit({
        ...this.#state,
        objects: [...this.#state.objects, person],
      });
      this.#rememberCreate(commandId, fields, person.id);
      return person;
    }
    if (method === "POST" && collection === "tasks" && !id) {
      const input = JSON.parse(
        JSON.stringify(taskCreateRequestSchema.parse(body)),
      ) as Record<string, unknown>;
      const { permissionScopeId, commandId, ...fields } = input;
      const replay = this.#replayCreate(commandId, fields);
      if (replay !== undefined) return replay;
      const object = canonical(
        "task",
        fields,
        typeof permissionScopeId === "string" ? permissionScopeId : undefined,
      );
      this.#assertTaskParent(object);
      const labelled = this.#checkTask(object);
      this.#commit({
        ...this.#state,
        objects: [...this.#state.objects, labelled],
      });
      this.#rememberCreate(commandId, fields, labelled.id);
      return labelled;
    }
    if (method === "POST" && collection === "events") {
      if (!id) {
        const input = JSON.parse(
          JSON.stringify(eventCreateRequestSchema.parse(body)),
        ) as Record<string, unknown>;
        const object = canonical("event", input);
        this.#commit({
          ...this.#state,
          objects: [...this.#state.objects, object],
        });
        return object;
      }
      if (operation === "resources") {
        const parent = this.#object(id);
        if (parent.objectType !== "event")
          throw new SandboxError(
            400,
            "invalid_request",
            "A planning context must be an Event.",
          );
        const input = eventContextCreateRequestSchema.parse(body);
        const resource = canonical(
          input.resource.objectType,
          JSON.parse(JSON.stringify(input.resource)),
          parent.permissionScopeId,
        );
        this.#assertTaskParent(resource);
        const labelled = this.#checkTask(resource);
        const link = relation(id, labelled.id);
        this.#commit({
          ...this.#state,
          objects: [...this.#state.objects, labelled],
          relations: [...this.#state.relations, link],
        });
        return { resource: labelled, relationId: link.id };
      }
    }
    if (
      ((method === "PATCH" && action === undefined) ||
        (method === "POST" && action === "restore")) &&
      collection === "events" &&
      id &&
      operation === "layout"
    ) {
      if (this.#object(id).objectType !== "event")
        throw new SandboxError(
          400,
          "invalid_request",
          "Page layouts belong to Events.",
        );
      const input =
        method === "POST"
          ? eventLayoutRestoreSchema.parse(body)
          : eventLayoutUpdateSchema.parse(body);
      const version =
        this.#state.layouts.find((layout) => layout.eventId === id)?.version ??
        0;
      if (version !== input.expectedVersion)
        throw new SandboxError(
          409,
          "version_conflict",
          "The page layout changed. Refresh before saving.",
        );
      let pages: EventLayoutResponse["pages"];
      if ("pages" in input) pages = input.pages;
      else if (input.targetVersion === 0) pages = [];
      else {
        const revision = this.#state.layouts.find(
          (layout) =>
            layout.eventId === id && layout.version === input.targetVersion,
        );
        if (!revision)
          throw new SandboxError(
            404,
            "resource_unavailable",
            "This layout revision is unavailable.",
          );
        pages = revision.pages;
      }
      const saved = {
        eventId: id,
        version: version + 1,
        updatedAt: new Date().toISOString(),
        pages,
      };
      this.#commit({
        ...this.#state,
        layouts: [saved, ...this.#state.layouts],
      });
      return saved;
    }
    if (method === "PATCH" && id && !operation) {
      const object = this.#object(id);
      const contracts = {
        events: { type: "event", schema: eventUpdateRequestSchema },
        tasks: { type: "task", schema: taskUpdateRequestSchema },
        expenses: { type: "expense", schema: expenseUpdateRequestSchema },
        reminders: { type: "reminder", schema: reminderUpdateRequestSchema },
        persons: { type: "person", schema: personUpdateRequestSchema },
      };
      const contract =
        collection && Object.hasOwn(contracts, collection)
          ? contracts[collection as keyof typeof contracts]
          : undefined;
      if (contract && object.objectType === contract.type) {
        const { expectedVersion, ...patch } = contract.schema.parse(body);
        if (expectedVersion !== object.version)
          throw new SandboxError(
            409,
            "version_conflict",
            "The sample object changed. Refresh before saving.",
          );
        const saved = this.#checkPerson(
          this.#checkTask(
            eventPlanningResourceResponseSchema.parse({
              ...object,
              ...JSON.parse(JSON.stringify(patch)),
              version: object.version + 1,
              updatedAt: new Date().toISOString(),
            }),
          ),
        );
        if (
          saved.objectType === "task" &&
          saved.dueOn !== null &&
          saved.dueAt !== null
        )
          throw new SandboxError(
            400,
            "invalid_request",
            "dueOn and dueAt cannot both be set.",
          );
        this.#commit({
          ...this.#state,
          objects: this.#state.objects.map((current) =>
            current.id === id ? saved : current,
          ),
        });
        return saved;
      }
    }
    throw new SandboxError(
      501,
      "sandbox_unsupported",
      "This operation needs the full application. Real sign-in, sharing, file transfers and recovery are not simulated in this design sandbox.",
    );
  }
}
