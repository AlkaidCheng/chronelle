import {
  AuthorizationDeniedError,
  type GrantNarrowing,
  type ShareScope,
  type ShareView,
  type UserPrincipal,
  viewObjectTypes,
} from "@chronelle/authorization";
import {
  grantScopes,
  personContactKinds,
  relationTypes,
  type CloudBaseRdbFilter,
  type CloudBaseRdbReader,
  type GrantScope,
  type ObjectType,
  type ReminderStatus,
  type RelationType,
  type Role,
  type TaskRepeatRule,
  type TaskStatus,
} from "@chronelle/db";

import type {
  DocumentResource,
  EventPlanningResource,
  EventResource,
  ExpenseResource,
  NoteResource,
  ObjectRelationResource,
  PersonContact,
  PersonResource,
  ReminderResource,
  TaskResource,
} from "./types.js";

export const cloudbaseObjectColumns =
  "id,workspace_id,object_type,display_name,created_by,permission_scope_id,created_at,updated_at,version,archived_at,deleted_at,custom_properties,metadata";
export const cloudbaseEventColumns =
  "object_id,workspace_id,starts_at,ends_at,starts_on,ends_on,timezone,is_all_day,location,description";
export const cloudbasePersonColumns =
  "object_id,workspace_id,user_id,nickname,description";
export const cloudbaseNoteColumns = "object_id,workspace_id,body";

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
  readonly location: unknown;
  readonly description: unknown;
};

export type CloudBaseTaskRow = {
  readonly object_id: unknown;
  readonly workspace_id: unknown;
  readonly status: unknown;
  readonly due_on: unknown;
  readonly due_at: unknown;
  readonly duration_minutes: unknown;
  readonly repeat_rule: unknown;
  readonly repeat_until: unknown;
  readonly completed_at: unknown;
  readonly parent_task_id: unknown;
  readonly assignee_person_id: unknown;
  readonly location: unknown;
  readonly description: unknown;
  readonly rank: unknown;
  readonly section_id: unknown;
};

export type CloudBaseExpenseRow = {
  readonly object_id: unknown;
  readonly workspace_id: unknown;
  readonly amount: unknown;
  readonly currency: unknown;
  readonly occurred_at: unknown;
  readonly section_id: unknown;
};

export type CloudBaseReminderRow = {
  readonly object_id: unknown;
  readonly workspace_id: unknown;
  readonly remind_at: unknown;
  readonly status: unknown;
  readonly rank: unknown;
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

export type CloudBasePersonRow = {
  readonly object_id: unknown;
  readonly workspace_id: unknown;
  readonly user_id: unknown;
  readonly nickname: unknown;
  readonly description: unknown;
};

export type CloudBaseNoteRow = {
  readonly object_id: unknown;
  readonly workspace_id: unknown;
  readonly body: unknown;
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
  readonly granted_by?: unknown;
  /** Absent from a row read without the column: the whole resource. */
  readonly scope?: unknown;
  readonly section_id?: unknown;
};

/** An active grant of the principal, with its narrowing. */
export interface CloudBaseGrant {
  readonly resourceId: string;
  readonly role: string;
  readonly grantedBy: string | null;
  readonly scope: GrantScope;
  readonly sectionId: string | null;
}

export const cloudbaseGrantColumns =
  "resource_id,role,expires_at,granted_by,scope,section_id";

/** Reads the principal's grants that are active at the instant, with their narrowing. */
export async function readCloudBaseGrants(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  now: Date,
): Promise<readonly CloudBaseGrant[]> {
  const rows = await client.select<CloudBaseGrantRow>("resource_grants", {
    columns: cloudbaseGrantColumns,
    filters: cloudbaseFilters(
      ["workspace_id", "eq", principal.workspaceId],
      ["principal_type", "eq", "user"],
      ["principal_id", "eq", principal.userId],
    ),
  });
  return rows.flatMap((row) => {
    const expiresAt = cloudbaseNullableDate(row.expires_at, "grant expiry");
    if (expiresAt !== null && expiresAt <= now) return [];
    const scope =
      row.scope === undefined ? "all" : cloudbaseText(row.scope, "grant scope");
    if (!grantScopes.includes(scope as GrantScope))
      throw new Error("CloudBase returned an invalid grant scope.");
    return [
      {
        resourceId: cloudbaseText(row.resource_id, "grant resource"),
        role: cloudbaseText(row.role, "grant role"),
        grantedBy:
          row.granted_by === undefined
            ? null
            : cloudbaseText(row.granted_by, "granted_by"),
        scope: scope as GrantScope,
        sectionId:
          row.section_id === undefined
            ? null
            : cloudbaseNullableText(row.section_id, "grant section"),
      },
    ];
  });
}

/** A grant's narrowing from its `scope` and `section_id` columns; a row without the columns is whole. */
export function cloudbaseGrantScope(
  scope: unknown,
  sectionId: unknown,
): ShareScope | null {
  const view =
    scope === undefined ? "all" : cloudbaseText(scope, "grant scope");
  if (!grantScopes.includes(view as GrantScope))
    throw new Error("CloudBase returned an invalid grant scope.");
  if (view === "all") return null;
  return {
    view: view as ShareView,
    sectionId:
      sectionId === undefined
        ? null
        : cloudbaseNullableText(sectionId, "grant section"),
  };
}

/** A grant's narrowing as chronelle_resource_share returns it: null, or the view and section. */
export function cloudbaseScopeJson(value: unknown): ShareScope | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object")
    throw new Error("CloudBase returned an invalid grant scope.");
  const record = value as {
    readonly view?: unknown;
    readonly sectionId?: unknown;
  };
  const scope = cloudbaseGrantScope(record.view, record.sectionId ?? null);
  if (scope === null)
    throw new Error("CloudBase returned an invalid grant scope.");
  return scope;
}

/**
 * The records of the sections the principal's grants are narrowed to, by
 * section, read once so a section-scoped grant can be applied to a row
 * without its typed state.
 */
export async function readCloudBaseSectionMembers(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  grants: readonly CloudBaseGrant[],
): Promise<ReadonlyMap<string, ReadonlySet<string>>> {
  const members = new Map<string, Set<string>>();
  const sectionIds = [
    ...new Set(
      grants.flatMap((grant) =>
        grant.sectionId === null ? [] : [grant.sectionId],
      ),
    ),
  ];
  if (sectionIds.length === 0) return members;
  for (const table of ["tasks", "expenses"] as const) {
    const rows = await client.select<{
      readonly object_id: unknown;
      readonly section_id: unknown;
    }>(table, {
      columns: "object_id,section_id",
      filters: cloudbaseFilters(
        ["workspace_id", "eq", principal.workspaceId],
        ["section_id", "in", sectionIds],
      ),
    });
    for (const row of rows) {
      const sectionId = cloudbaseText(row.section_id, "section");
      const set = members.get(sectionId) ?? new Set<string>();
      set.add(cloudbaseText(row.object_id, "object id"));
      members.set(sectionId, set);
    }
  }
  return members;
}

/**
 * Whether a grant's narrowing admits a record reached through the grant's
 * scope: a whole grant admits everything; a view admits the records it
 * shows; a section admits its own tasks or expenses. The same rule as
 * chronelle_grant_admits.
 */
export function cloudbaseGrantAdmits(
  grant: CloudBaseGrant,
  objectId: string,
  objectType: string,
  sectionMembers: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (grant.scope === "all") return true;
  if (!viewObjectTypes[grant.scope].includes(objectType)) return false;
  return (
    grant.sectionId === null ||
    (sectionMembers.get(grant.sectionId)?.has(objectId) ?? false)
  );
}

/**
 * What of a resource the principal sees through narrowed grants alone,
 * or null for all of it (a member, or a whole grant).
 */
export function cloudbaseNarrowing(
  workspaceRole: string | null,
  grants: readonly CloudBaseGrant[],
  resourceId: string,
): GrantNarrowing | null {
  if (workspaceRole !== null) return null;
  const own = grants.filter((grant) => grant.resourceId === resourceId);
  if (own.some((grant) => grant.scope === "all")) return null;
  const views = new Set<ShareView>();
  const narrowed: { id: string; view: ShareView }[] = [];
  for (const grant of own) {
    if (grant.scope === "all") continue;
    if (grant.sectionId === null) views.add(grant.scope);
    else narrowed.push({ id: grant.sectionId, view: grant.scope });
  }
  return {
    views: [...views].sort(),
    sections: narrowed
      .filter((section) => !views.has(section.view))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}

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

export function cloudbaseNullableInteger(
  value: unknown,
  field: string,
): number | null {
  if (value === null || value === undefined) return null;
  return cloudbaseInteger(value, field);
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
const taskRepeatRules: readonly TaskRepeatRule[] = [
  "daily",
  "weekdays",
  "weekly",
  "biweekly",
  "monthly",
  "yearly",
];

export function cloudbaseTaskResource(
  object: CloudBaseObjectRow,
  task: CloudBaseTaskRow,
  labelIds: readonly string[] = [],
): TaskResource {
  const status = cloudbaseText(task.status, "status");
  if (!taskStatuses.includes(status as TaskStatus))
    throw new Error("CloudBase returned an invalid task status.");
  const repeatRule = cloudbaseNullableText(task.repeat_rule, "repeat_rule");
  if (
    repeatRule !== null &&
    !taskRepeatRules.includes(repeatRule as TaskRepeatRule)
  )
    throw new Error("CloudBase returned an invalid task repeat rule.");
  return {
    ...cloudbaseCanonicalFields(object, task, "task"),
    objectType: "task",
    status: status as TaskStatus,
    dueOn: cloudbaseNullableText(task.due_on, "due_on"),
    dueAt: cloudbaseNullableDate(task.due_at, "due_at"),
    durationMinutes: cloudbaseNullableInteger(
      task.duration_minutes,
      "duration_minutes",
    ),
    repeatRule: repeatRule as TaskRepeatRule | null,
    repeatUntil: cloudbaseNullableText(task.repeat_until, "repeat_until"),
    completedAt: cloudbaseNullableDate(task.completed_at, "completed_at"),
    parentTaskId: cloudbaseNullableText(task.parent_task_id, "parent_task_id"),
    assigneeId: cloudbaseNullableText(
      task.assignee_person_id,
      "assignee_person_id",
    ),
    location: cloudbaseNullableText(task.location, "location"),
    description: cloudbaseNullableText(task.description, "description"),
    rank: cloudbaseText(task.rank, "rank"),
    sectionId: cloudbaseNullableText(task.section_id, "section_id"),
    labelIds: [...labelIds],
  };
}

/** The label ids a `labels` entry of chronelle_<type>_rows carries, or none. */
export function cloudbaseLabelIds(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new Error("CloudBase returned invalid labels.");
  return value.map((id) => cloudbaseText(id, "label id"));
}

/** The contacts a `contacts` entry of chronelle_person_rows carries, or none. */
export function cloudbasePersonContacts(value: unknown): PersonContact[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value))
    throw new Error("CloudBase returned invalid person contacts.");
  return value.map((entry) => {
    const contact = entry as { kind?: unknown; value?: unknown } | null;
    const kind = cloudbaseText(contact?.kind, "contact kind");
    if (!personContactKinds.includes(kind as PersonContact["kind"]))
      throw new Error("CloudBase returned an invalid person contact kind.");
    return {
      kind: kind as PersonContact["kind"],
      value: cloudbaseText(contact?.value, "contact value"),
    };
  });
}

type CloudBaseLabelJoinRow = {
  readonly object_id: unknown;
  readonly label_id: unknown;
};

type CloudBaseLabelNameRow = { readonly id: unknown; readonly name: unknown };

/** A label join table and the column that names the labelled object. */
interface CloudBaseLabelJoin {
  readonly table: "task_labels" | "person_labels";
  readonly column: "task_id" | "person_id";
}

/** The labels of the given tasks in name order, by task id. */
export function readCloudBaseTaskLabels(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  taskIds: readonly string[],
): Promise<ReadonlyMap<string, string[]>> {
  return readCloudBaseLabels(
    client,
    principal,
    { table: "task_labels", column: "task_id" },
    taskIds,
  );
}

/** The labels of the given persons in name order, by person id. */
export function readCloudBasePersonLabels(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  personIds: readonly string[],
): Promise<ReadonlyMap<string, string[]>> {
  return readCloudBaseLabels(
    client,
    principal,
    { table: "person_labels", column: "person_id" },
    personIds,
  );
}

type CloudBasePersonContactRow = {
  readonly person_id: unknown;
  readonly kind: unknown;
  readonly value: unknown;
  readonly position: unknown;
};

/** The contacts of the given persons in kept order, by person id. */
export async function readCloudBasePersonContacts(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  personIds: readonly string[],
): Promise<ReadonlyMap<string, PersonContact[]>> {
  if (personIds.length === 0) return new Map();
  const rows = await client.select<CloudBasePersonContactRow>(
    "person_contacts",
    {
      columns: "person_id,kind,value,position",
      filters: [
        {
          column: "workspace_id",
          operator: "eq",
          value: principal.workspaceId,
        },
        { column: "person_id", operator: "in", value: personIds },
      ],
    },
  );
  const positioned = rows
    .map((row) => ({
      personId: cloudbaseText(row.person_id, "person id"),
      position: cloudbaseInteger(row.position, "contact position"),
      contact: cloudbasePersonContacts([row])[0] as PersonContact,
    }))
    .sort((first, second) => first.position - second.position);
  const byPerson = new Map<string, PersonContact[]>();
  for (const { personId, contact } of positioned)
    byPerson.set(personId, [...(byPerson.get(personId) ?? []), contact]);
  return byPerson;
}

async function readCloudBaseLabels(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  join: CloudBaseLabelJoin,
  ids: readonly string[],
): Promise<ReadonlyMap<string, string[]>> {
  if (ids.length === 0) return new Map();
  const rows = (
    await client.select<Record<string, unknown>>(join.table, {
      columns: `${join.column},label_id`,
      filters: [
        {
          column: "workspace_id",
          operator: "eq",
          value: principal.workspaceId,
        },
        { column: join.column, operator: "in", value: ids },
      ],
    })
  ).map((row): CloudBaseLabelJoinRow => ({
    object_id: row[join.column],
    label_id: row.label_id,
  }));
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
  const byObject = new Map<string, string[]>();
  for (const row of rows) {
    const objectId = cloudbaseText(row.object_id, "labelled object id");
    byObject.set(objectId, [
      ...(byObject.get(objectId) ?? []),
      cloudbaseText(row.label_id, "label id"),
    ]);
  }
  for (const labelIds of byObject.values())
    labelIds.sort(
      (first, second) =>
        (names.get(first) ?? "").localeCompare(names.get(second) ?? "") ||
        first.localeCompare(second),
    );
  return byObject;
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
    rank: cloudbaseText(reminder.rank, "rank"),
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
    sectionId: cloudbaseNullableText(expense.section_id, "section_id"),
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

export function cloudbasePersonResource(
  object: CloudBaseObjectRow,
  person: CloudBasePersonRow,
  contacts: readonly PersonContact[] = [],
  labelIds: readonly string[] = [],
): PersonResource {
  return {
    ...cloudbaseCanonicalFields(object, person, "person"),
    objectType: "person",
    userId: cloudbaseNullableText(person.user_id, "user_id"),
    nickname: cloudbaseNullableText(person.nickname, "nickname"),
    description: cloudbaseNullableText(person.description, "description"),
    contacts: contacts.map((contact) => ({ ...contact })),
    labelIds: [...labelIds],
  };
}

export function cloudbaseNoteResource(
  object: CloudBaseObjectRow,
  note: CloudBaseNoteRow,
): NoteResource {
  // The text is any string, the empty one included.
  if (typeof note.body !== "string")
    throw new Error("CloudBase returned an invalid body.");
  return {
    ...cloudbaseCanonicalFields(object, note, "note"),
    objectType: "note",
    body: note.body,
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
    case "person":
      return cloudbasePersonResource(
        object,
        typed as CloudBasePersonRow,
        cloudbasePersonContacts(record.contacts),
        cloudbaseLabelIds(record.labels),
      );
    case "note":
      return cloudbaseNoteResource(object, typed as CloudBaseNoteRow);
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
    location: cloudbaseNullableText(event.location, "location"),
    description: cloudbaseNullableText(event.description, "description"),
  };
}

export interface CloudBaseVisibility {
  readonly canView: (row: CloudBaseObjectRow) => boolean;
  readonly resourceIds: readonly string[];
  readonly workspaceRole: string | null;
  /** What of a resource the principal sees through narrowed grants alone; null for all of it. */
  readonly narrowing: (resourceId: string) => GrantNarrowing | null;
}

export async function readCloudBaseVisibility(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  clock: () => Date,
): Promise<CloudBaseVisibility> {
  const now = clock();
  const [membership, grants] = await Promise.all([
    client.select<WorkspaceMemberRow>("workspace_members", {
      columns: "role",
      filters: cloudbaseFilters(
        ["workspace_id", "eq", principal.workspaceId],
        ["user_id", "eq", principal.userId],
      ),
      limit: 1,
    }),
    readCloudBaseGrants(client, principal, now),
  ]);
  const workspaceRole =
    membership[0] === undefined
      ? null
      : cloudbaseText(membership[0].role, "workspace role");
  const sectionMembers = await readCloudBaseSectionMembers(
    client,
    principal,
    grants,
  );
  const resourceIds = [...new Set(grants.map((grant) => grant.resourceId))];
  return {
    workspaceRole,
    resourceIds,
    canView: (row) => {
      if (workspaceRole !== null && viewRoles.has(workspaceRole)) return true;
      const objectId = cloudbaseText(row.id, "object id");
      const objectType = cloudbaseText(row.object_type, "object type");
      const scopeId = cloudbaseText(
        row.permission_scope_id,
        "permission scope",
      );
      // A grant on the object itself opens it whatever its narrowing; one
      // on the object's scope reaches it only where the narrowing admits.
      return grants.some(
        (grant) =>
          viewRoles.has(grant.role) &&
          (grant.resourceId === objectId ||
            (grant.resourceId === scopeId &&
              cloudbaseGrantAdmits(
                grant,
                objectId,
                objectType,
                sectionMembers,
              ))),
      );
    },
    narrowing: (resourceId) =>
      cloudbaseNarrowing(workspaceRole, grants, resourceId),
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
  "object_id,workspace_id,status,due_on,due_at,duration_minutes,repeat_rule,repeat_until,completed_at,parent_task_id,assignee_person_id,location,description,rank,section_id";

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

/** The workspaces the account belongs to, whichever it acts in. */
export async function readCloudBaseMemberWorkspaceIds(
  client: CloudBaseRdbReader,
  userId: string,
): Promise<ReadonlySet<string>> {
  const rows = await client.select<{ readonly workspace_id: unknown }>(
    "workspace_members",
    {
      columns: "workspace_id",
      filters: cloudbaseFilters(["user_id", "eq", userId]),
    },
  );
  return new Set(
    rows.map((row) => cloudbaseText(row.workspace_id, "workspace id")),
  );
}

/** An active grant as the Events list reads it, on any Event in any workspace. */
export interface CloudBaseEventGrant {
  readonly workspaceId: string;
  readonly resourceId: string;
  readonly principalId: string;
  readonly role: Role;
  readonly scope: string;
  readonly grantedBy: string;
}

type EventGrantRow = {
  readonly workspace_id: unknown;
  readonly resource_id: unknown;
  readonly principal_id: unknown;
  readonly role: unknown;
  readonly scope: unknown;
  readonly granted_by: unknown;
  readonly expires_at: unknown;
};

function eventGrants(
  rows: readonly EventGrantRow[],
  now: Date,
): CloudBaseEventGrant[] {
  return rows.flatMap((row) => {
    const expiresAt = cloudbaseNullableDate(row.expires_at, "grant expiry");
    if (expiresAt !== null && expiresAt <= now) return [];
    const role = cloudbaseText(row.role, "grant role");
    if (!viewRoles.has(role)) return [];
    return [
      {
        workspaceId: cloudbaseText(row.workspace_id, "grant workspace"),
        resourceId: cloudbaseText(row.resource_id, "grant resource"),
        principalId: cloudbaseText(row.principal_id, "grant principal"),
        role: role as Role,
        scope: cloudbaseText(row.scope, "grant scope"),
        grantedBy: cloudbaseText(row.granted_by, "granted_by"),
      },
    ];
  });
}

const eventGrantColumns =
  "workspace_id,resource_id,principal_id,role,scope,granted_by,expires_at";

/** The account's active grants across every workspace: the Events shared with it. */
export async function readCloudBaseGrantsHeld(
  client: CloudBaseRdbReader,
  userId: string,
  now: Date,
): Promise<readonly CloudBaseEventGrant[]> {
  const rows = await client.select<EventGrantRow>("resource_grants", {
    columns: eventGrantColumns,
    filters: cloudbaseFilters(
      ["principal_type", "eq", "user"],
      ["principal_id", "eq", userId],
    ),
  });
  return eventGrants(rows, now);
}

/** Every account's active grants on the given Events, for their access lines. */
export async function readCloudBaseGrantsOn(
  client: CloudBaseRdbReader,
  resourceIds: readonly string[],
  now: Date,
): Promise<readonly CloudBaseEventGrant[]> {
  if (resourceIds.length === 0) return [];
  const rows = await client.select<EventGrantRow>("resource_grants", {
    columns: eventGrantColumns,
    filters: cloudbaseFilters(
      ["principal_type", "eq", "user"],
      ["resource_id", "in", resourceIds],
    ),
  });
  return eventGrants(rows, now);
}

/** Live Events by id, whichever workspace holds them. */
export async function readCloudBaseEventObjectsById(
  client: CloudBaseRdbReader,
  ids: readonly string[],
): Promise<readonly CloudBaseObjectRow[]> {
  if (ids.length === 0) return [];
  return client.select<CloudBaseObjectRow>("objects", {
    columns: cloudbaseObjectColumns,
    filters: cloudbaseFilters(
      ["object_type", "eq", "event"],
      ["deleted_at", "is", null],
      ["id", "in", ids],
    ),
  });
}

/** The Event rows by object id, whichever workspace holds them. */
export async function readCloudBaseEventsById(
  client: CloudBaseRdbReader,
  ids: readonly string[],
): Promise<readonly CloudBaseEventRow[]> {
  if (ids.length === 0) return [];
  return client.select<CloudBaseEventRow>("events", {
    columns: cloudbaseEventColumns,
    filters: cloudbaseFilters(["object_id", "in", ids]),
  });
}

/** The display names of the given accounts. */
export async function readCloudBaseDisplayNames(
  client: CloudBaseRdbReader,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await client.select<{
    readonly id: unknown;
    readonly display_name: unknown;
  }>("users", {
    columns: "id,display_name",
    filters: cloudbaseFilters(["id", "in", userIds]),
  });
  return new Map(
    rows.map((row) => [
      cloudbaseText(row.id, "user id"),
      cloudbaseText(row.display_name, "display name"),
    ]),
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
