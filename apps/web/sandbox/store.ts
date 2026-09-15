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
  taskUpdateRequestSchema,
  expenseUpdateRequestSchema,
  reminderUpdateRequestSchema,
  objectSearchQuerySchema,
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
    task: { dueOn: null, dueAt: null, completedAt: null, status: "todo" },
    expense: {},
    reminder: { status: "pending" },
    document: {},
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
    customProperties: {},
    metadata: {},
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
  return {
    objects,
    relations,
    layouts: layouts.sort((a, b) => b.version - a.version),
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
        collection === "reminders") &&
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
      if (operation === "detail")
        return {
          event: object,
          events,
          tasks,
          expenses,
          reminders,
          documents: [],
          lockedRelationCount: 0,
        };
      const projections: Record<string, Resource[]> = {
        todos: tasks,
        calendar: events,
        itinerary: events,
        expenses,
        reminders,
      };
      const projection = projections[operation];
      if (projection) return { sourceEventId: id, items: projection };
      if (operation === "timeline")
        return {
          sourceEventId: id,
          items: children
            .flatMap<TimelineResponse["items"][number]>((child) => {
              if (child.objectType === "document") return [];
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
        const link = relation(id, resource.id);
        this.#commit({
          ...this.#state,
          objects: [...this.#state.objects, resource],
          relations: [...this.#state.relations, link],
        });
        return { resource, relationId: link.id };
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
        const saved = eventPlanningResourceResponseSchema.parse({
          ...object,
          ...JSON.parse(JSON.stringify(patch)),
          version: object.version + 1,
          updatedAt: new Date().toISOString(),
        });
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
