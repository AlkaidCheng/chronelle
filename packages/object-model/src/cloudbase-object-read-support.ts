import {
  AuthorizationDeniedError,
  roleAllows,
  type AuthorizationAction,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  roles as roleNames,
  type CloudBaseRdbFilter,
  type CloudBaseRdbReader,
  type Role,
} from "@chronelle/db";

import {
  cloudbaseEventColumns,
  cloudbaseFilters,
  cloudbaseNullableDate,
  cloudbaseObjectColumns,
  cloudbasePersonColumns,
  cloudbaseResourceFromRows,
  cloudbaseTaskColumns,
  readCloudBasePersonContacts,
  readCloudBasePersonLabels,
  readCloudBaseTaskLabels,
  cloudbaseText,
  type CloudBaseGrantRow,
  type CloudBaseObjectRow,
} from "./cloudbase-read-support.js";
import type { EventPlanningResource } from "./types.js";

type WorkspaceMemberRow = { readonly role: unknown };

type TypedRow = { readonly object_id: unknown };

/** The canonical columns every access decision reads. */
export type CloudBaseObjectAccessRow = Pick<
  CloudBaseObjectRow,
  "id" | "workspace_id" | "object_type" | "permission_scope_id" | "deleted_at"
>;

/** The largest `in` list sent in one gateway request. */
export const cloudbaseIdBatchSize = 200;

/**
 * Typed columns per canonical type. The gateway serializes numeric and bigint
 * columns as JSON numbers, which would round a bigint and lose the numeric
 * scale; the `::text` select cast keeps `amount` and `size_bytes` as text for
 * the strict decoders.
 */
const typedColumns: Readonly<
  Record<EventPlanningResource["objectType"], string>
> = {
  event: cloudbaseEventColumns,
  task: cloudbaseTaskColumns,
  expense: "object_id,workspace_id,amount::text,currency,occurred_at",
  reminder: "object_id,workspace_id,remind_at,status,rank",
  document:
    "object_id,workspace_id,storage_provider,storage_key,original_filename,mime_type,size_bytes::text,checksum_sha256,encryption_mode",
  person: cloudbasePersonColumns,
};

const typedTables: Readonly<
  Record<EventPlanningResource["objectType"], string>
> = {
  event: "events",
  task: "tasks",
  expense: "expenses",
  reminder: "reminders",
  document: "documents",
  person: "persons",
};

const objectTypeNames = Object.keys(typedTables);

function cloudbaseRole(value: unknown, field: string): Role {
  const role = cloudbaseText(value, field);
  if (!roleNames.includes(role as Role))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return role as Role;
}

/** A filter for a query parameter that may be absent. */
export function cloudbaseOptionalFilter(
  column: string,
  operator: CloudBaseRdbFilter["operator"],
  value: unknown,
): readonly CloudBaseRdbFilter[] {
  return value === undefined ? [] : [{ column, operator, value }];
}

export function cloudbaseInteger(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return parsed;
}

/** Byte order of two ids, which is how PostgreSQL orders uuid columns. */
export function compareCloudBaseIds(first: string, second: string): number {
  return first < second ? -1 : first > second ? 1 : 0;
}

export function cloudbaseObjectId(row: CloudBaseObjectAccessRow): string {
  return cloudbaseText(row.id, "object id");
}

export function cloudbaseObjectType(
  row: CloudBaseObjectAccessRow,
): EventPlanningResource["objectType"] {
  const objectType = cloudbaseText(row.object_type, "object type");
  if (!objectTypeNames.includes(objectType))
    throw new Error("CloudBase returned an invalid object type.");
  return objectType as EventPlanningResource["objectType"];
}

/**
 * The principal's workspace membership and active grants, evaluated once at
 * the clock instant. `rolesFor` reproduces the role lookup of the PostgreSQL
 * authorization store: membership, a direct grant on the object, and a grant
 * on a live canonical scope; tombstones carry no normal capabilities.
 * `canRecover` reproduces the recovery predicate, which survives deletion of
 * both the object and its scope.
 */
export interface CloudBasePrincipalAccess {
  readonly workspaceRole: Role | null;
  readonly grantRoles: ReadonlyMap<string, Role>;
  /** The account that granted each active role, by resource. */
  readonly grantors: ReadonlyMap<string, string>;
  rolesFor(
    object: CloudBaseObjectAccessRow,
    scopes: ReadonlyMap<string, CloudBaseObjectAccessRow>,
  ): readonly Role[];
  allows(
    action: AuthorizationAction,
    object: CloudBaseObjectAccessRow,
    scopes: ReadonlyMap<string, CloudBaseObjectAccessRow>,
  ): boolean;
  canRecover(object: CloudBaseObjectAccessRow): boolean;
}

export async function readCloudBasePrincipalAccess(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  clock: () => Date,
): Promise<CloudBasePrincipalAccess> {
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
      columns: "resource_id,role,expires_at,granted_by",
      filters: cloudbaseFilters(
        ["workspace_id", "eq", principal.workspaceId],
        ["principal_type", "eq", "user"],
        ["principal_id", "eq", principal.userId],
      ),
    }),
  ]);
  const now = clock();
  const workspaceRole =
    membership[0] === undefined
      ? null
      : cloudbaseRole(membership[0].role, "workspace role");
  const grantRoles = new Map<string, Role>();
  const grantors = new Map<string, string>();
  for (const grant of grants) {
    const expiresAt = cloudbaseNullableDate(grant.expires_at, "grant expiry");
    if (expiresAt !== null && expiresAt <= now) continue;
    const resourceId = cloudbaseText(grant.resource_id, "grant resource");
    grantRoles.set(resourceId, cloudbaseRole(grant.role, "grant role"));
    grantors.set(resourceId, cloudbaseText(grant.granted_by, "granted_by"));
  }
  const inWorkspace = (object: CloudBaseObjectAccessRow) =>
    cloudbaseText(object.workspace_id, "object workspace") ===
    principal.workspaceId;
  const rolesFor: CloudBasePrincipalAccess["rolesFor"] = (object, scopes) => {
    if (
      !inWorkspace(object) ||
      cloudbaseNullableDate(object.deleted_at, "deleted_at") !== null
    )
      return [];
    const found: Role[] = [];
    if (workspaceRole !== null) found.push(workspaceRole);
    const direct = grantRoles.get(cloudbaseObjectId(object));
    if (direct !== undefined) found.push(direct);
    const scopeId = cloudbaseText(
      object.permission_scope_id,
      "permission scope",
    );
    const scope = scopes.get(scopeId);
    const inherited = grantRoles.get(scopeId);
    if (
      inherited !== undefined &&
      scope !== undefined &&
      cloudbaseNullableDate(scope.deleted_at, "deleted_at") === null
    )
      found.push(inherited);
    return found;
  };
  return {
    workspaceRole,
    grantRoles,
    grantors,
    rolesFor,
    allows: (action, object, scopes) =>
      rolesFor(object, scopes).some((role) => roleAllows(role, action)),
    canRecover: (object) => {
      if (!inWorkspace(object)) return false;
      if (workspaceRole === "owner") return true;
      return [
        cloudbaseObjectId(object),
        cloudbaseText(object.permission_scope_id, "permission scope"),
      ].some((resourceId) => grantRoles.get(resourceId) === "owner");
    },
  };
}

async function selectInBatches<Row>(
  client: CloudBaseRdbReader,
  table: string,
  columns: string,
  filters: readonly CloudBaseRdbFilter[],
  column: string,
  values: readonly string[],
): Promise<Row[]> {
  const rows: Row[] = [];
  const unique = [...new Set(values)];
  for (let start = 0; start < unique.length; start += cloudbaseIdBatchSize) {
    rows.push(
      ...(await client.select<Row>(table, {
        columns,
        filters: [
          ...filters,
          {
            column,
            operator: "in",
            value: unique.slice(start, start + cloudbaseIdBatchSize),
          },
        ],
      })),
    );
  }
  return rows;
}

/** Canonical rows of any type by id; tombstones are included only on request. */
export async function readCloudBaseObjectRows(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  ids: readonly string[],
  options: { readonly includeDeleted?: boolean | undefined } = {},
): Promise<readonly CloudBaseObjectRow[]> {
  if (ids.length === 0) return [];
  return selectInBatches<CloudBaseObjectRow>(
    client,
    "objects",
    cloudbaseObjectColumns,
    [
      ...cloudbaseFilters(["workspace_id", "eq", principal.workspaceId]),
      ...(options.includeDeleted === true
        ? []
        : cloudbaseFilters(["deleted_at", "is", null])),
    ],
    "id",
    ids,
  );
}

/** One live canonical row, or a denial that does not reveal whether the object exists. */
export async function readCloudBaseObjectRow(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  objectId: string,
  options: { readonly includeDeleted?: boolean | undefined } = {},
): Promise<CloudBaseObjectRow> {
  const [row] = await readCloudBaseObjectRows(
    client,
    principal,
    [objectId],
    options,
  );
  if (row === undefined) throw new AuthorizationDeniedError();
  return row;
}

/**
 * The canonical scope rows the given objects inherit from, keyed by id, so
 * inherited grants can be checked against a live scope. Rows already in hand
 * are reused; a self-scoped object is its own scope.
 */
export async function readCloudBaseScopes(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  objects: readonly CloudBaseObjectRow[],
): Promise<ReadonlyMap<string, CloudBaseObjectRow>> {
  const scopes = new Map(
    objects.map((object) => [cloudbaseObjectId(object), object] as const),
  );
  const missing = objects
    .map((object) =>
      cloudbaseText(object.permission_scope_id, "permission scope"),
    )
    .filter((scopeId) => !scopes.has(scopeId));
  for (const scope of await readCloudBaseObjectRows(
    client,
    principal,
    missing,
    { includeDeleted: true },
  ))
    scopes.set(cloudbaseObjectId(scope), scope);
  return scopes;
}

/** Complete typed states for canonical rows, keyed by object id. */
export async function readCloudBaseResources(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  objects: readonly CloudBaseObjectRow[],
): Promise<ReadonlyMap<string, EventPlanningResource>> {
  const byType = new Map<EventPlanningResource["objectType"], string[]>();
  for (const object of objects) {
    const objectType = cloudbaseObjectType(object);
    byType.set(objectType, [
      ...(byType.get(objectType) ?? []),
      cloudbaseObjectId(object),
    ]);
  }
  const typed = new Map<string, TypedRow>();
  const taskLabels = await readCloudBaseTaskLabels(
    client,
    principal,
    byType.get("task") ?? [],
  );
  const personLabels = await readCloudBasePersonLabels(
    client,
    principal,
    byType.get("person") ?? [],
  );
  const personContacts = await readCloudBasePersonContacts(
    client,
    principal,
    byType.get("person") ?? [],
  );
  for (const [objectType, ids] of byType) {
    const rows = await selectInBatches<TypedRow>(
      client,
      typedTables[objectType],
      typedColumns[objectType],
      cloudbaseFilters(["workspace_id", "eq", principal.workspaceId]),
      "object_id",
      ids,
    );
    for (const row of rows)
      typed.set(cloudbaseText(row.object_id, `${objectType} object`), row);
  }
  return new Map(
    objects.map((object) => {
      const id = cloudbaseObjectId(object);
      const row = typed.get(id);
      if (row === undefined)
        throw new Error("The canonical object is missing its typed state.");
      return [
        id,
        cloudbaseResourceFromRows({
          object,
          [cloudbaseObjectType(object)]: row,
          labels: taskLabels.get(id) ?? personLabels.get(id) ?? [],
          contacts: personContacts.get(id) ?? [],
        }),
      ] as const;
    }),
  );
}

/** Live objects among `ids` that the principal may view, keyed by id. */
export async function readCloudBaseViewableObjects(
  client: CloudBaseRdbReader,
  principal: UserPrincipal,
  access: CloudBasePrincipalAccess,
  ids: readonly string[],
): Promise<ReadonlyMap<string, CloudBaseObjectRow>> {
  const rows = await readCloudBaseObjectRows(client, principal, ids);
  const scopes = await readCloudBaseScopes(client, principal, rows);
  return new Map(
    rows
      .filter((row) => access.allows("view", row, scopes))
      .map((row) => [cloudbaseObjectId(row), row] as const),
  );
}
