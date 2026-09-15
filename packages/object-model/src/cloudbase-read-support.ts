import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  relationTypes,
  type CloudBaseRdbFilter,
  type CloudBaseRdbReader,
  type ObjectType,
  type ReminderStatus,
  type RelationType,
  type TaskStatus,
} from "@chronelle/db";

import type {
  DocumentResource,
  EventPlanningResource,
  EventResource,
  ExpenseResource,
  ObjectRelationResource,
  ReminderResource,
  TaskResource,
} from "./types.js";

export const cloudbaseObjectColumns =
  "id,workspace_id,object_type,display_name,created_by,permission_scope_id,created_at,updated_at,version,archived_at,deleted_at,custom_properties,metadata";
export const cloudbaseEventColumns =
  "object_id,workspace_id,starts_at,ends_at,starts_on,ends_on,timezone,is_all_day";

export type CloudBaseObjectRow = {
  readonly id: unknown;
  readonly workspace_id: unknown;
  readonly object_type: unknown;
  readonly display_name: unknown;
  readonly created_by: unknown;
  readonly permission_scope_id: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
  readonly version: unknown;
  readonly archived_at: unknown;
  readonly deleted_at: unknown;
  readonly custom_properties: unknown;
  readonly metadata: unknown;
};

export type CloudBaseEventRow = {
  readonly object_id: unknown;
  readonly workspace_id: unknown;
  readonly starts_at: unknown;
  readonly ends_at: unknown;
  readonly starts_on: unknown;
  readonly ends_on: unknown;
  readonly timezone: unknown;
  readonly is_all_day: unknown;
};

export type CloudBaseTaskRow = {
  readonly object_id: unknown;
  readonly workspace_id: unknown;
  readonly status: unknown;
  readonly due_on: unknown;
  readonly due_at: unknown;
  readonly completed_at: unknown;
  readonly parent_task_id: unknown;
};

export type CloudBaseExpenseRow = {
  readonly object_id: unknown;
  readonly workspace_id: unknown;
  readonly amount: unknown;
  readonly currency: unknown;
  readonly occurred_at: unknown;
};

export type CloudBaseReminderRow = {
  readonly object_id: unknown;
  readonly workspace_id: unknown;
  readonly remind_at: unknown;
  readonly status: unknown;
};

export type CloudBaseDocumentRow = {
  readonly object_id: unknown;
  readonly workspace_id: unknown;
  readonly storage_provider: unknown;
  readonly storage_key: unknown;
  readonly original_filename: unknown;
  readonly mime_type: unknown;
  readonly size_bytes: unknown;
  readonly checksum_sha256: unknown;
  readonly encryption_mode: unknown;
};

export type CloudBaseRelationWriteRow = {
  readonly id: unknown;
  readonly workspace_id: unknown;
  readonly source_object_id: unknown;
  readonly relation_type: unknown;
  readonly target_object_id: unknown;
  readonly metadata: unknown;
  readonly created_by: unknown;
  readonly created_at: unknown;
  readonly deleted_at: unknown;
  readonly version: unknown;
};

export type CloudBaseGrantRow = {
  readonly resource_id: unknown;
  readonly role: unknown;
  readonly expires_at: unknown;
};

type WorkspaceMemberRow = { readonly role: unknown };

export type CloudBaseRelationRow = { readonly target_object_id: unknown };

export type CloudBaseInclusionRow = {
  readonly source_object_id: unknown;
  readonly target_object_id: unknown;
  readonly created_at: unknown;
  readonly id: unknown;
};

const viewRoles = new Set(["owner", "editor", "viewer"]);

export function cloudbaseFilters(
  ...items: readonly [string, CloudBaseRdbFilter["operator"], unknown][]
): readonly CloudBaseRdbFilter[] {
  return items.map(([column, operator, value]) => ({
    column,
    operator,
    value,
  }));
}

export function cloudbaseText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return value;
}

export function cloudbaseNullableText(
  value: unknown,
  field: string,
): string | null {
  if (value === null || value === undefined) return null;
  return cloudbaseText(value, field);
}

export function cloudbaseDate(value: unknown, field: string): Date {
  const parsed = new Date(cloudbaseText(value, field));
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return parsed;
}

export function cloudbaseNullableDate(
  value: unknown,
  field: string,
): Date | null {
  if (value === null || value === undefined) return null;
  return cloudbaseDate(value, field);
}

function cloudbaseJsonObject(
  value: unknown,
  field: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return value as Record<string, unknown>;
}

export function cloudbaseBigInt(value: unknown, field: string): bigint {
  if (typeof value === "string" && /^-?\d+$/u.test(value)) return BigInt(value);
  if (typeof value === "number" && Number.isSafeInteger(value))
    return BigInt(value);
  throw new Error(`CloudBase returned an invalid ${field}.`);
}

export function cloudbaseInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return parsed;
}

function cloudbaseBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean")
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return value;
}

/** The canonical columns shared by every typed resource, with the typed row checked against them. */
function cloudbaseCanonicalFields(
  object: CloudBaseObjectRow,
  typed: { readonly object_id: unknown; readonly workspace_id: unknown },
  objectType: EventPlanningResource["objectType"],
) {
  const objectId = cloudbaseText(object.id, "object id");
  const objectWorkspace = cloudbaseText(
    object.workspace_id,
    "object workspace",
  );
  if (cloudbaseText(typed.object_id, `${objectType} object`) !== objectId)
    throw new Error(`CloudBase returned mismatched ${objectType} object data.`);
  if (
    cloudbaseText(typed.workspace_id, `${objectType} workspace`) !==
    objectWorkspace
  )
    throw new Error(
      `CloudBase returned mismatched ${objectType} workspace data.`,
    );
  if (cloudbaseText(object.object_type, "object type") !== objectType)
    throw new Error(
      `CloudBase returned a non-${objectType} in the ${objectType} projection.`,
    );
  return {
    id: objectId,
    workspaceId: objectWorkspace,
    displayName: cloudbaseText(object.display_name, "display name"),
    createdBy: cloudbaseText(object.created_by, "created by"),
    permissionScopeId: cloudbaseText(
      object.permission_scope_id,
      "permission scope",
    ),
    createdAt: cloudbaseDate(object.created_at, "created_at"),
    updatedAt: cloudbaseDate(object.updated_at, "updated_at"),
    version: cloudbaseInteger(object.version, "version"),
    archivedAt: cloudbaseNullableDate(object.archived_at, "archived_at"),
    deletedAt: cloudbaseNullableDate(object.deleted_at, "deleted_at"),
    customProperties: cloudbaseJsonObject(
      object.custom_properties,
      "custom_properties",
    ),
    metadata: cloudbaseJsonObject(object.metadata, "metadata"),
  };
}

const taskStatuses: readonly TaskStatus[] = [
  "todo",
  "in_progress",
  "done",
  "cancelled",
];

export function cloudbaseTaskResource(
  object: CloudBaseObjectRow,
  task: CloudBaseTaskRow,
  labelIds: readonly string[] = [],
): TaskResource {
  const status = cloudbaseText(task.status, "status");
  if (!taskStatuses.includes(status as TaskStatus))
    throw new Error("CloudBase returned an invalid task status.");
  return {
    ...cloudbaseCanonicalFields(object, task, "task"),
    objectType: "task",
    status: status as TaskStatus,
    dueOn: cloudbaseNullableText(task.due_on, "due_on"),
    dueAt: cloudbaseNullableDate(task.due_at, "due_at"),
    completedAt: cloudbaseNullableDate(task.completed_at, "completed_at"),
    parentTaskId: cloudbaseNullableText(task.parent_task_id, "parent_task_id"),
    labelIds: [...labelIds],
  };
}

/** The label ids a `labels` entry of chronelle_task_rows carries, or none. */
export function cloudbaseLabelIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new Error("CloudBase returned invalid task labels.");
  return value.map((id) => cloudbaseText(id, "label id"));
}

type CloudBaseTaskLabelRow = {
  readonly task_id: unknown;
  readonly label_id: unknown;
};

type CloudBaseLabelNameRow = { readonly id: unknown; readonly name: unknown };

/** The labels of the given tasks in name order, by task id. */
export async function readCloudBaseTaskLabels(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  taskIds: readonly string[],
): Promise<ReadonlyMap<string, string[]>> {
  if (taskIds.length === 0) return new Map();
  const rows = await client.select<CloudBaseTaskLabelRow>("task_labels", {
    columns: "task_id,label_id",
    filters: [
      { column: "workspace_id", operator: "eq", value: principal.workspaceId },
      { column: "task_id", operator: "in", value: taskIds },
    ],
  });
  if (rows.length === 0) return new Map();
  const labelRows = await client.select<CloudBaseLabelNameRow>("labels", {
    columns: "id,name",
    filters: [
      { column: "workspace_id", operator: "eq", value: principal.workspaceId },
      {
        column: "id",
        operator: "in",
        value: [
          ...new Set(
            rows.map((row) => cloudbaseText(row.label_id, "label id")),
          ),
        ],
      },
    ],
  });
  const names = new Map(
    labelRows.map((row) => [
      cloudbaseText(row.id, "label id"),
      cloudbaseText(row.name, "label name").toLowerCase(),
    ]),
  );
  const byTask = new Map<string, string[]>();
  for (const row of rows) {
    const taskId = cloudbaseText(row.task_id, "task id");
    byTask.set(taskId, [
      ...(byTask.get(taskId) ?? []),
      cloudbaseText(row.label_id, "label id"),
    ]);
  }
  for (const ids of byTask.values())
    ids.sort(
      (first, second) =>
        (names.get(first) ?? "").localeCompare(names.get(second) ?? "") ||
        first.localeCompare(second),
    );
  return byTask;
}

const reminderStatuses: readonly ReminderStatus[] = [
  "pending",
  "triggered",
  "dismissed",
  "cancelled",
];

export function cloudbaseReminderResource(
  object: CloudBaseObjectRow,
  reminder: CloudBaseReminderRow,
): ReminderResource {
  const status = cloudbaseText(reminder.status, "status");
  if (!reminderStatuses.includes(status as ReminderStatus))
    throw new Error("CloudBase returned an invalid reminder status.");
  return {
    ...cloudbaseCanonicalFields(object, reminder, "reminder"),
    objectType: "reminder",
    remindAt: cloudbaseDate(reminder.remind_at, "remind_at"),
    status: status as ReminderStatus,
  };
}

export function cloudbaseExpenseResource(
  object: CloudBaseObjectRow,
  expense: CloudBaseExpenseRow,
): ExpenseResource {
  return {
    ...cloudbaseCanonicalFields(object, expense, "expense"),
    objectType: "expense",
    amount: cloudbaseText(expense.amount, "amount"),
    currency: cloudbaseText(expense.currency, "currency"),
    occurredAt: cloudbaseDate(expense.occurred_at, "occurred_at"),
  };
}

export function cloudbaseDocumentResource(
  object: CloudBaseObjectRow,
  document: CloudBaseDocumentRow,
): DocumentResource {
  return {
    ...cloudbaseCanonicalFields(object, document, "document"),
    objectType: "document",
    storageProvider: cloudbaseText(
      document.storage_provider,
      "storage_provider",
    ),
    storageKey: cloudbaseText(document.storage_key, "storage_key"),
    originalFilename: cloudbaseText(
      document.original_filename,
      "original_filename",
    ),
    mimeType: cloudbaseText(document.mime_type, "mime_type"),
    sizeBytes: cloudbaseBigInt(document.size_bytes, "size_bytes"),
    checksumSha256: cloudbaseText(document.checksum_sha256, "checksum_sha256"),
    encryptionMode: cloudbaseText(document.encryption_mode, "encryption_mode"),
  };
}

/** Decodes `{ object, <typed> }` rows of any canonical type, as chronelle_object_rows returns them. */
export function cloudbaseResourceFromRows(
  rows: unknown,
): EventPlanningResource {
  if (rows === null || typeof rows !== "object")
    throw new Error("CloudBase returned an invalid object.");
  const record = rows as Record<string, unknown>;
  const object = record.object as CloudBaseObjectRow | undefined;
  if (object === undefined)
    throw new Error("CloudBase returned an invalid object.");
  const objectType = cloudbaseText(object.object_type, "object type");
  const typed = record[objectType];
  if (typed === undefined || typed === null)
    throw new Error(`CloudBase returned an invalid ${objectType}.`);
  switch (objectType) {
    case "event":
      return cloudbaseEventResource(object, typed as CloudBaseEventRow);
    case "task":
      return cloudbaseTaskResource(
        object,
        typed as CloudBaseTaskRow,
        cloudbaseLabelIds(record.labels),
      );
    case "expense":
      return cloudbaseExpenseResource(object, typed as CloudBaseExpenseRow);
    case "reminder":
      return cloudbaseReminderResource(object, typed as CloudBaseReminderRow);
    case "document":
      return cloudbaseDocumentResource(object, typed as CloudBaseDocumentRow);
    default:
      throw new Error(
        `CloudBase returned an unknown object type ${objectType}.`,
      );
  }
}

export function cloudbaseRelationResource(
  relation: CloudBaseRelationWriteRow,
): ObjectRelationResource {
  const relationType = cloudbaseText(relation.relation_type, "relation_type");
  if (!relationTypes.includes(relationType as RelationType))
    throw new Error("CloudBase returned an invalid relation type.");
  return {
    id: cloudbaseText(relation.id, "relation id"),
    workspaceId: cloudbaseText(relation.workspace_id, "relation workspace"),
    sourceObjectId: cloudbaseText(
      relation.source_object_id,
      "source_object_id",
    ),
    relationType: relationType as RelationType,
    targetObjectId: cloudbaseText(
      relation.target_object_id,
      "target_object_id",
    ),
    metadata: cloudbaseJsonObject(relation.metadata, "relation metadata"),
    createdBy: cloudbaseText(relation.created_by, "created_by"),
    createdAt: cloudbaseDate(relation.created_at, "created_at"),
    deletedAt: cloudbaseNullableDate(relation.deleted_at, "deleted_at"),
    version: cloudbaseInteger(relation.version, "version"),
  };
}

export function cloudbaseEventResource(
  object: CloudBaseObjectRow,
  event: CloudBaseEventRow,
): EventResource {
  return {
    ...cloudbaseCanonicalFields(object, event, "event"),
    objectType: "event",
    startsAt: cloudbaseNullableDate(event.starts_at, "starts_at"),
    endsAt: cloudbaseNullableDate(event.ends_at, "ends_at"),
    startsOn: cloudbaseNullableText(event.starts_on, "starts_on"),
    endsOn: cloudbaseNullableText(event.ends_on, "ends_on"),
    timezone: cloudbaseNullableText(event.timezone, "timezone"),
    isAllDay: cloudbaseBoolean(event.is_all_day, "is_all_day"),
  };
}

export interface CloudBaseVisibility {
  readonly canView: (row: CloudBaseObjectRow) => boolean;
  readonly resourceIds: readonly string[];
  readonly workspaceRole: string | null;
}

function activeGrant(row: CloudBaseGrantRow, now: Date): boolean {
  const role = cloudbaseText(row.role, "grant role");
  if (!viewRoles.has(role)) return false;
  const expiresAt = cloudbaseNullableDate(row.expires_at, "grant expiry");
  return expiresAt === null || expiresAt > now;
}

export async function readCloudBaseVisibility(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  clock: () => Date,
): Promise<CloudBaseVisibility> {
  const [membership, grants] = await Promise.all([
    client.select<WorkspaceMemberRow>("workspace_members", {
      columns: "role",
      filters: cloudbaseFilters(
        ["workspace_id", "eq", principal.workspaceId],
        ["user_id", "eq", principal.userId],
      ),
      limit: 1,
    }),
    client.select<CloudBaseGrantRow>("resource_grants", {
      columns: "resource_id,role,expires_at",
      filters: cloudbaseFilters(
        ["workspace_id", "eq", principal.workspaceId],
        ["principal_type", "eq", "user"],
        ["principal_id", "eq", principal.userId],
      ),
    }),
  ]);
  const workspaceRole =
    membership[0] === undefined
      ? null
      : cloudbaseText(membership[0].role, "workspace role");
  const now = clock();
  const resourceIds = grants.map((grant) =>
    cloudbaseText(grant.resource_id, "grant resource"),
  );
  return {
    workspaceRole,
    resourceIds,
    canView: (row) => {
      if (workspaceRole !== null && viewRoles.has(workspaceRole)) return true;
      const objectId = cloudbaseText(row.id, "object id");
      const scopeId = cloudbaseText(
        row.permission_scope_id,
        "permission scope",
      );
      return grants.some(
        (grant) =>
          activeGrant(grant, now) &&
          [objectId, scopeId].includes(
            cloudbaseText(grant.resource_id, "grant resource"),
          ),
      );
    },
  };
}

/** The live objects of one type the principal may view: all of them for a member, else the granted and inherited ones. */
export async function readCloudBaseVisibleObjects(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  visibility: CloudBaseVisibility,
  objectType: ObjectType = "event",
): Promise<readonly CloudBaseObjectRow[]> {
  if (
    visibility.workspaceRole !== null &&
    viewRoles.has(visibility.workspaceRole)
  )
    return readCloudBaseObjects(client, principal, undefined, objectType);
  if (visibility.resourceIds.length === 0) return [];
  const [direct, inherited] = await Promise.all([
    readCloudBaseObjectsByFilter(
      client,
      principal,
      "id",
      visibility.resourceIds,
      objectType,
    ),
    readCloudBaseObjectsByFilter(
      client,
      principal,
      "permission_scope_id",
      visibility.resourceIds,
      objectType,
    ),
  ]);
  const rows = [...direct, ...inherited];
  return rows.filter(
    (row, index) =>
      rows.findIndex((candidate) => candidate.id === row.id) === index &&
      visibility.canView(row),
  );
}

export async function readCloudBaseObjects(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  ids?: readonly string[],
  objectType: ObjectType = "event",
): Promise<readonly CloudBaseObjectRow[]> {
  if (ids !== undefined && ids.length === 0) return [];
  const filters = cloudbaseFilters(
    ["workspace_id", "eq", principal.workspaceId],
    ["object_type", "eq", objectType],
    ["deleted_at", "is", null],
  );
  return client.select<CloudBaseObjectRow>("objects", {
    columns: cloudbaseObjectColumns,
    filters:
      ids === undefined
        ? filters
        : [...filters, { column: "id", operator: "in", value: ids }],
  });
}

async function readCloudBaseObjectsByFilter(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  column: "id" | "permission_scope_id",
  values: readonly string[],
  objectType: ObjectType,
): Promise<readonly CloudBaseObjectRow[]> {
  const filters = cloudbaseFilters(
    ["workspace_id", "eq", principal.workspaceId],
    ["object_type", "eq", objectType],
    ["deleted_at", "is", null],
    [column, "in", values],
  );
  return client.select<CloudBaseObjectRow>("objects", {
    columns: cloudbaseObjectColumns,
    filters,
  });
}

/** Live canonical rows of any object type by id, optionally narrowed to some types. */
export async function readCloudBaseObjectRows(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  ids: readonly string[],
  objectTypes?: readonly ObjectType[],
): Promise<readonly CloudBaseObjectRow[]> {
  if (ids.length === 0 || objectTypes?.length === 0) return [];
  const filters = cloudbaseFilters(
    ["workspace_id", "eq", principal.workspaceId],
    ["deleted_at", "is", null],
    ["id", "in", ids],
  );
  return client.select<CloudBaseObjectRow>("objects", {
    columns: cloudbaseObjectColumns,
    filters:
      objectTypes === undefined
        ? filters
        : [
            ...filters,
            { column: "object_type", operator: "in", value: objectTypes },
          ],
  });
}

export const cloudbaseTaskColumns =
  "object_id,workspace_id,status,due_on,due_at,completed_at,parent_task_id";

export async function readCloudBaseTasks(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  ids: readonly string[],
): Promise<readonly CloudBaseTaskRow[]> {
  if (ids.length === 0) return [];
  return client.select<CloudBaseTaskRow>("tasks", {
    columns: cloudbaseTaskColumns,
    filters: [
      { column: "workspace_id", operator: "eq", value: principal.workspaceId },
      { column: "object_id", operator: "in", value: ids },
    ],
  });
}

export async function readCloudBaseEvents(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  ids: readonly string[],
): Promise<readonly CloudBaseEventRow[]> {
  if (ids.length === 0) return [];
  return client.select<CloudBaseEventRow>("events", {
    columns: cloudbaseEventColumns,
    filters: [
      { column: "workspace_id", operator: "eq", value: principal.workspaceId },
      { column: "object_id", operator: "in", value: ids },
    ],
  });
}

export async function readCloudBaseIncludes(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  eventId: string,
): Promise<readonly string[]> {
  const relations = await client.select<CloudBaseRelationRow>(
    "object_relations",
    {
      columns: "target_object_id",
      filters: cloudbaseFilters(
        ["workspace_id", "eq", principal.workspaceId],
        ["source_object_id", "eq", eventId],
        ["relation_type", "eq", "includes"],
        ["deleted_at", "is", null],
      ),
    },
  );
  return [
    ...new Set(
      relations.map((relation) =>
        cloudbaseText(relation.target_object_id, "target object"),
      ),
    ),
  ];
}

/** The task rows whose parent is one of the given tasks. */
export async function readCloudBaseSubtasks(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  parentIds: readonly string[],
): Promise<readonly CloudBaseTaskRow[]> {
  if (parentIds.length === 0) return [];
  return client.select<CloudBaseTaskRow>("tasks", {
    columns: cloudbaseTaskColumns,
    filters: [
      { column: "workspace_id", operator: "eq", value: principal.workspaceId },
      { column: "parent_task_id", operator: "in", value: parentIds },
    ],
  });
}

/** Live inclusions of the given targets, earliest first. */
export async function readCloudBaseInclusionsOf(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  targetIds: readonly string[],
): Promise<readonly CloudBaseInclusionRow[]> {
  if (targetIds.length === 0) return [];
  const rows = await client.select<CloudBaseInclusionRow>("object_relations", {
    columns: "id,source_object_id,target_object_id,created_at",
    filters: cloudbaseFilters(
      ["workspace_id", "eq", principal.workspaceId],
      ["relation_type", "eq", "includes"],
      ["deleted_at", "is", null],
      ["target_object_id", "in", targetIds],
    ),
  });
  return [...rows].sort(
    (first, second) =>
      cloudbaseDate(first.created_at, "created_at").getTime() -
        cloudbaseDate(second.created_at, "created_at").getTime() ||
      cloudbaseText(first.id, "relation id").localeCompare(
        cloudbaseText(second.id, "relation id"),
      ),
  );
}

/** A root Event owns its permission scope; included children inherit a root's scope. */
export function isCloudBaseRootObject(object: CloudBaseObjectRow): boolean {
  return (
    cloudbaseText(object.permission_scope_id, "permission scope") ===
    cloudbaseText(object.id, "object id")
  );
}

export function assertCloudBaseRoot(
  root: CloudBaseObjectRow | undefined,
): CloudBaseObjectRow {
  if (root === undefined) throw new AuthorizationDeniedError();
  return root;
}
