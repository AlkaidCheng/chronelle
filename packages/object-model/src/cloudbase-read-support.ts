import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@chronelle/authorization";
import type { CloudBaseRdbClient, CloudBaseRdbFilter } from "@chronelle/db";

import type { EventResource } from "./types.js";

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

export type CloudBaseGrantRow = {
  readonly resource_id: unknown;
  readonly role: unknown;
  readonly expires_at: unknown;
};

type WorkspaceMemberRow = { readonly role: unknown };

export type CloudBaseRelationRow = { readonly target_object_id: unknown };

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

function cloudbaseInteger(value: unknown, field: string): number {
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

export function cloudbaseEventResource(
  object: CloudBaseObjectRow,
  event: CloudBaseEventRow,
): EventResource {
  const objectId = cloudbaseText(object.id, "object id");
  const objectWorkspace = cloudbaseText(
    object.workspace_id,
    "object workspace",
  );
  if (cloudbaseText(event.object_id, "event object") !== objectId)
    throw new Error("CloudBase returned mismatched event object data.");
  if (cloudbaseText(event.workspace_id, "event workspace") !== objectWorkspace)
    throw new Error("CloudBase returned mismatched event workspace data.");
  if (cloudbaseText(object.object_type, "object type") !== "event")
    throw new Error("CloudBase returned a non-event in the event projection.");
  return {
    id: objectId,
    workspaceId: objectWorkspace,
    objectType: "event",
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
  client: CloudBaseRdbClient,
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

export async function readCloudBaseVisibleObjects(
  client: CloudBaseRdbClient,
  principal: UserPrincipal,
  visibility: CloudBaseVisibility,
): Promise<readonly CloudBaseObjectRow[]> {
  if (
    visibility.workspaceRole !== null &&
    viewRoles.has(visibility.workspaceRole)
  )
    return readCloudBaseObjects(client, principal);
  if (visibility.resourceIds.length === 0) return [];
  const [direct, inherited] = await Promise.all([
    readCloudBaseObjectsByFilter(
      client,
      principal,
      "id",
      visibility.resourceIds,
    ),
    readCloudBaseObjectsByFilter(
      client,
      principal,
      "permission_scope_id",
      visibility.resourceIds,
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
  client: CloudBaseRdbClient,
  principal: UserPrincipal,
  ids?: readonly string[],
): Promise<readonly CloudBaseObjectRow[]> {
  if (ids !== undefined && ids.length === 0) return [];
  const filters = cloudbaseFilters(
    ["workspace_id", "eq", principal.workspaceId],
    ["object_type", "eq", "event"],
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
  client: CloudBaseRdbClient,
  principal: UserPrincipal,
  column: "id" | "permission_scope_id",
  values: readonly string[],
): Promise<readonly CloudBaseObjectRow[]> {
  const filters = cloudbaseFilters(
    ["workspace_id", "eq", principal.workspaceId],
    ["object_type", "eq", "event"],
    ["deleted_at", "is", null],
    [column, "in", values],
  );
  return client.select<CloudBaseObjectRow>("objects", {
    columns: cloudbaseObjectColumns,
    filters,
  });
}

export async function readCloudBaseEvents(
  client: CloudBaseRdbClient,
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
  client: CloudBaseRdbClient,
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

export function assertCloudBaseRoot(
  root: CloudBaseObjectRow | undefined,
): CloudBaseObjectRow {
  if (root === undefined) throw new AuthorizationDeniedError();
  return root;
}
