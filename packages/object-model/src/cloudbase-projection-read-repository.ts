import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  objectTypes,
  type CloudBaseRdbReader,
  type ObjectType,
} from "@chronelle/db";

import {
  assertCloudBaseRoot,
  type CloudBaseDocumentRow,
  type CloudBaseEventRow,
  type CloudBaseExpenseRow,
  type CloudBaseObjectRow,
  type CloudBasePersonRow,
  type CloudBaseReminderRow,
  type CloudBaseTaskRow,
  cloudbaseTaskColumns,
  type CloudBaseVisibility,
  cloudbaseDocumentResource,
  cloudbaseEventColumns,
  cloudbaseEventResource,
  cloudbaseExpenseResource,
  cloudbaseFilters,
  cloudbasePersonColumns,
  cloudbasePersonResource,
  cloudbaseReminderResource,
  cloudbaseTaskResource,
  cloudbaseText,
  readCloudBaseIncludes,
  readCloudBaseObjectRows,
  readCloudBaseTaskLabels,
  readCloudBaseObjects,
  readCloudBaseVisibility,
} from "./cloudbase-read-support.js";
import type {
  EventDetailReadResult,
  ProjectionObjectType,
  ProjectionReadRepository,
} from "./projection-service.js";
import type {
  DocumentResource,
  EventPlanningResource,
  EventResource,
} from "./types.js";

// The gateway encodes numeric and bigint columns as JSON numbers, which lose
// the scale of an amount and the range of a size; the column list casts them
// to text so the row carries the column's canonical text under its own name.

const expenseColumns =
  "object_id,workspace_id,amount::text,currency,occurred_at";
const reminderColumns = "object_id,workspace_id,remind_at,status,rank";
const documentColumns =
  "object_id,workspace_id,storage_provider,storage_key,original_filename,mime_type,size_bytes::text,checksum_sha256,encryption_mode";

type TypedRow = { readonly object_id: unknown };
type AttachmentSourceRow = { readonly source_object_id: unknown };

interface RootContext {
  readonly event: EventResource;
  readonly rootId: string;
  readonly visibility: CloudBaseVisibility;
}

interface VisibleTargets {
  readonly lockedRelationCount: number;
  readonly resources: readonly EventPlanningResource[];
}

function objectId(row: CloudBaseObjectRow): string {
  return cloudbaseText(row.id, "object id");
}

function scopeId(row: CloudBaseObjectRow): string {
  return cloudbaseText(row.permission_scope_id, "permission scope");
}

function objectType(row: CloudBaseObjectRow): ObjectType {
  const value = cloudbaseText(row.object_type, "object type");
  if (!objectTypes.includes(value as ObjectType))
    throw new Error("CloudBase returned an invalid object type.");
  return value as ObjectType;
}

function requireTyped<Row extends TypedRow>(
  rows: ReadonlyMap<string, Row>,
  object: CloudBaseObjectRow,
): Row {
  const typed = rows.get(objectId(object));
  if (typed === undefined)
    throw new Error("The canonical object is missing its typed state.");
  return typed;
}

/**
 * Read-only CloudBase adapter for the Event detail and focused projections.
 * Every read authorizes the root Event, follows active `includes` and
 * `attached_to` relations to live objects, and re-applies the workspace,
 * membership, grant, expiry, inherited-scope, and deletion rules before a
 * resource is returned. Mutations stay on the transaction-capable
 * PostgreSQL path.
 */
export class CloudBaseProjectionReadRepository implements ProjectionReadRepository {
  readonly #client: CloudBaseRdbReader;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseRdbReader,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async listIncludedResources<Type extends ProjectionObjectType>(
    principal: UserPrincipal,
    eventId: string,
    objectTypes: readonly Type[],
  ): Promise<readonly Extract<EventPlanningResource, { objectType: Type }>[]> {
    const [context, targetIds] = await Promise.all([
      this.#readRoot(principal, eventId),
      readCloudBaseIncludes(this.#client, principal, eventId),
    ]);
    const included = await this.#readTargets(
      principal,
      context,
      targetIds,
      objectTypes,
    );
    return included.resources.filter(
      (
        resource,
      ): resource is Extract<EventPlanningResource, { objectType: Type }> =>
        objectTypes.some((type) => resource.objectType === type),
    );
  }

  async readEventDetail(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventDetailReadResult> {
    const [context, targetIds, sourceIds] = await Promise.all([
      this.#readRoot(principal, eventId),
      readCloudBaseIncludes(this.#client, principal, eventId),
      this.#readAttachmentSources(principal, eventId),
    ]);
    const [included, attached] = await Promise.all([
      this.#readTargets(principal, context, targetIds),
      this.#readTargets(principal, context, sourceIds, ["document"]),
    ]);
    return {
      event: context.event,
      includedResources: included.resources,
      attachedDocuments: attached.resources.filter(
        (resource): resource is DocumentResource =>
          resource.objectType === "document",
      ),
      lockedRelationCount:
        included.lockedRelationCount + attached.lockedRelationCount,
    };
  }

  /** The root Event the principal may view, or the denial the PostgreSQL path raises. */
  async #readRoot(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<RootContext> {
    const [roots, eventRows, visibility] = await Promise.all([
      readCloudBaseObjects(this.#client, principal, [eventId]),
      this.#typedRows<CloudBaseEventRow>(
        principal,
        "events",
        cloudbaseEventColumns,
        [eventId],
      ),
      readCloudBaseVisibility(this.#client, principal, this.#clock),
    ]);
    const root = assertCloudBaseRoot(roots[0]);
    const visible = await this.#visibleRows(principal, visibility, [root], []);
    if (visible.length === 0) throw new AuthorizationDeniedError();
    return {
      event: cloudbaseEventResource(root, requireTyped(eventRows, root)),
      rootId: objectId(root),
      visibility,
    };
  }

  async #readAttachmentSources(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<readonly string[]> {
    const relations = await this.#client.select<AttachmentSourceRow>(
      "object_relations",
      {
        columns: "source_object_id",
        filters: cloudbaseFilters(
          ["workspace_id", "eq", principal.workspaceId],
          ["target_object_id", "eq", eventId],
          ["relation_type", "eq", "attached_to"],
          ["deleted_at", "is", null],
        ),
      },
    );
    return [
      ...new Set(
        relations.map((relation) =>
          cloudbaseText(relation.source_object_id, "source object"),
        ),
      ),
    ];
  }

  /** Live relation targets in relation order, split into the visible resources and the locked count. */
  async #readTargets(
    principal: UserPrincipal,
    context: RootContext,
    ids: readonly string[],
    objectTypes?: readonly ObjectType[],
  ): Promise<VisibleTargets> {
    const candidates = await readCloudBaseObjectRows(
      this.#client,
      principal,
      ids,
      objectTypes,
    );
    const byId = new Map(candidates.map((row) => [objectId(row), row]));
    const live = ids.flatMap((id) => byId.get(id) ?? []);
    const visible = await this.#visibleRows(
      principal,
      context.visibility,
      live,
      [context.rootId],
    );
    return {
      resources: await this.#typedResources(principal, visible),
      lockedRelationCount: live.length - visible.length,
    };
  }

  /**
   * The rows the principal may view. A grant on a row's permission scope
   * counts only while that scope object is live, as in the PostgreSQL
   * evaluator; a deleted scope leaves membership and direct grants.
   */
  async #visibleRows(
    principal: UserPrincipal,
    visibility: CloudBaseVisibility,
    rows: readonly CloudBaseObjectRow[],
    liveIds: readonly string[],
  ): Promise<readonly CloudBaseObjectRow[]> {
    const live = new Set([...liveIds, ...rows.map(objectId)]);
    const unknownScopes = [
      ...new Set(rows.map(scopeId).filter((scope) => !live.has(scope))),
    ];
    const scopes = await readCloudBaseObjectRows(
      this.#client,
      principal,
      unknownScopes,
    );
    for (const scope of scopes) live.add(objectId(scope));
    return rows.filter((row) =>
      visibility.canView(
        live.has(scopeId(row)) ? row : { ...row, permission_scope_id: row.id },
      ),
    );
  }

  /** Typed resources for canonical rows, in row order; a row without typed state is a data fault. */
  async #typedResources(
    principal: UserPrincipal,
    rows: readonly CloudBaseObjectRow[],
  ): Promise<EventPlanningResource[]> {
    const idsOf = (type: ObjectType) =>
      rows.filter((row) => objectType(row) === type).map(objectId);
    const [events, tasks, expenses, reminders, documents, persons, taskLabels] =
      await Promise.all([
        this.#typedRows<CloudBaseEventRow>(
          principal,
          "events",
          cloudbaseEventColumns,
          idsOf("event"),
        ),
        this.#typedRows<CloudBaseTaskRow>(
          principal,
          "tasks",
          cloudbaseTaskColumns,
          idsOf("task"),
        ),
        this.#typedRows<CloudBaseExpenseRow>(
          principal,
          "expenses",
          expenseColumns,
          idsOf("expense"),
        ),
        this.#typedRows<CloudBaseReminderRow>(
          principal,
          "reminders",
          reminderColumns,
          idsOf("reminder"),
        ),
        this.#typedRows<CloudBaseDocumentRow>(
          principal,
          "documents",
          documentColumns,
          idsOf("document"),
        ),
        this.#typedRows<CloudBasePersonRow>(
          principal,
          "persons",
          cloudbasePersonColumns,
          idsOf("person"),
        ),
        readCloudBaseTaskLabels(this.#client, principal, idsOf("task")),
      ]);
    const decode: Record<
      ObjectType,
      (object: CloudBaseObjectRow) => EventPlanningResource
    > = {
      event: (object) =>
        cloudbaseEventResource(object, requireTyped(events, object)),
      task: (object) =>
        cloudbaseTaskResource(
          object,
          requireTyped(tasks, object),
          taskLabels.get(objectId(object)) ?? [],
        ),
      expense: (object) =>
        cloudbaseExpenseResource(object, requireTyped(expenses, object)),
      reminder: (object) =>
        cloudbaseReminderResource(object, requireTyped(reminders, object)),
      document: (object) =>
        cloudbaseDocumentResource(object, requireTyped(documents, object)),
      person: (object) =>
        cloudbasePersonResource(object, requireTyped(persons, object)),
    };
    return rows.map((row) => decode[objectType(row)](row));
  }

  async #typedRows<Row extends TypedRow>(
    principal: UserPrincipal,
    table: string,
    columns: string,
    ids: readonly string[],
  ): Promise<ReadonlyMap<string, Row>> {
    if (ids.length === 0) return new Map();
    const rows = await this.#client.select<Row>(table, {
      columns,
      filters: cloudbaseFilters(
        ["workspace_id", "eq", principal.workspaceId],
        ["object_id", "in", ids],
      ),
    });
    return new Map(
      rows.map((row) => [cloudbaseText(row.object_id, "typed object"), row]),
    );
  }
}
