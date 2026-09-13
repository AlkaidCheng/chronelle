import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@chronelle/authorization";
import type { CloudBaseRdbClient, CloudBaseRdbFilter } from "@chronelle/db";

import type { CalendarReadRepository } from "./projection-service.js";
import type { EventResource } from "./types.js";

const objectColumns =
  "id,workspace_id,object_type,display_name,created_by,permission_scope_id,created_at,updated_at,version,archived_at,deleted_at,custom_properties,metadata";
const eventColumns =
  "object_id,workspace_id,starts_at,ends_at,starts_on,ends_on,timezone,is_all_day";

type ObjectRow = {
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

type EventRow = {
  readonly object_id: unknown;
  readonly workspace_id: unknown;
  readonly starts_at: unknown;
  readonly ends_at: unknown;
  readonly starts_on: unknown;
  readonly ends_on: unknown;
  readonly timezone: unknown;
  readonly is_all_day: unknown;
};

type RelationRow = { readonly target_object_id: unknown };
type WorkspaceMemberRow = { readonly role: unknown };
type GrantRow = {
  readonly resource_id: unknown;
  readonly role: unknown;
  readonly expires_at: unknown;
};

const viewRoles = new Set(["owner", "editor", "viewer"]);

function filters(
  ...items: readonly [string, CloudBaseRdbFilter["operator"], unknown][]
): readonly CloudBaseRdbFilter[] {
  return items.map(([column, operator, value]) => ({
    column,
    operator,
    value,
  }));
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return value;
}

function nullableText(value: unknown, field: string): string | null {
  if (value === null || value === undefined) return null;
  return text(value, field);
}

function date(value: unknown, field: string): Date {
  const parsed = new Date(text(value, field));
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return parsed;
}

function nullableDate(value: unknown, field: string): Date | null {
  if (value === null || value === undefined) return null;
  return date(value, field);
}

function jsonObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return value as Record<string, unknown>;
}

function integer(value: unknown, field: string): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(parsed))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return parsed;
}

function boolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean")
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return value;
}

function activeGrant(row: GrantRow, now: Date): boolean {
  const role = text(row.role, "grant role");
  if (!viewRoles.has(role)) return false;
  const expiresAt = nullableDate(row.expires_at, "grant expiry");
  return expiresAt === null || expiresAt > now;
}

function visible(
  row: ObjectRow,
  workspaceRole: string | null,
  grants: readonly GrantRow[],
  now: Date,
): boolean {
  if (workspaceRole !== null && viewRoles.has(workspaceRole)) return true;
  const objectId = text(row.id, "object id");
  const scopeId = text(row.permission_scope_id, "permission scope");
  return grants.some(
    (grant) =>
      activeGrant(grant, now) &&
      [objectId, scopeId].includes(text(grant.resource_id, "grant resource")),
  );
}

function resource(object: ObjectRow, event: EventRow): EventResource {
  const objectWorkspace = text(object.workspace_id, "object workspace");
  if (objectWorkspace !== text(event.workspace_id, "event workspace"))
    throw new Error("CloudBase returned mismatched event workspace data.");
  return {
    id: text(object.id, "object id"),
    workspaceId: objectWorkspace,
    objectType: "event",
    displayName: text(object.display_name, "display name"),
    createdBy: text(object.created_by, "created by"),
    permissionScopeId: text(object.permission_scope_id, "permission scope"),
    createdAt: date(object.created_at, "created_at"),
    updatedAt: date(object.updated_at, "updated_at"),
    version: integer(object.version, "version"),
    archivedAt: nullableDate(object.archived_at, "archived_at"),
    deletedAt: nullableDate(object.deleted_at, "deleted_at"),
    customProperties: jsonObject(object.custom_properties, "custom_properties"),
    metadata: jsonObject(object.metadata, "metadata"),
    startsAt: nullableDate(event.starts_at, "starts_at"),
    endsAt: nullableDate(event.ends_at, "ends_at"),
    startsOn: nullableText(event.starts_on, "starts_on"),
    endsOn: nullableText(event.ends_on, "ends_on"),
    timezone: nullableText(event.timezone, "timezone"),
    isAllDay: boolean(event.is_all_day, "is_all_day"),
  };
}

/**
 * Read-only CloudBase projection adapter. Authorization is evaluated from the
 * workspace membership and resource grants before any resource is returned.
 * Mutations intentionally remain on the transaction-capable PostgreSQL path.
 */
export class CloudBaseCalendarReadRepository implements CalendarReadRepository {
  readonly #client: CloudBaseRdbClient;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseRdbClient,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async listCalendarEvents(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<readonly EventResource[]> {
    const common = filters(
      ["workspace_id", "eq", principal.workspaceId],
      ["deleted_at", "is", null],
    );
    const [roots, relations, membership, grants] = await Promise.all([
      this.#client.select<ObjectRow>("objects", {
        columns: objectColumns,
        filters: [
          ...common,
          { column: "id", operator: "eq", value: eventId },
          { column: "object_type", operator: "eq", value: "event" },
        ],
      }),
      this.#client.select<RelationRow>("object_relations", {
        columns: "target_object_id",
        filters: filters(
          ["workspace_id", "eq", principal.workspaceId],
          ["source_object_id", "eq", eventId],
          ["relation_type", "eq", "includes"],
          ["deleted_at", "is", null],
        ),
      }),
      this.#client.select<WorkspaceMemberRow>("workspace_members", {
        columns: "role",
        filters: filters(
          ["workspace_id", "eq", principal.workspaceId],
          ["user_id", "eq", principal.userId],
        ),
        limit: 1,
      }),
      this.#client.select<GrantRow>("resource_grants", {
        columns: "resource_id,role,expires_at",
        filters: filters(
          ["workspace_id", "eq", principal.workspaceId],
          ["principal_type", "eq", "user"],
          ["principal_id", "eq", principal.userId],
        ),
      }),
    ]);
    const root = roots[0];
    if (root === undefined) throw new AuthorizationDeniedError();
    const targetIds = [
      ...new Set(
        relations.map((relation) => text(relation.target_object_id, "target")),
      ),
    ];
    const targets =
      targetIds.length === 0
        ? []
        : await this.#client.select<ObjectRow>("objects", {
            columns: objectColumns,
            filters: [
              ...common,
              { column: "object_type", operator: "eq", value: "event" },
              { column: "id", operator: "in", value: targetIds },
            ],
          });
    const workspaceRole =
      membership[0] === undefined
        ? null
        : text(membership[0].role, "workspace role");
    const now = this.#clock();
    if (!visible(root, workspaceRole, grants, now))
      throw new AuthorizationDeniedError();
    const objectsToRead = [root, ...targets].filter(
      (object, index, all) =>
        all.findIndex((candidate) => candidate.id === object.id) === index,
    );
    const visibleObjects = objectsToRead.filter((object) =>
      visible(object, workspaceRole, grants, now),
    );
    const childObjects = visibleObjects.filter(
      (object) => text(object.id, "object id") !== text(root.id, "root id"),
    );
    const ids = childObjects.map((object) => text(object.id, "object id"));
    const eventRows =
      ids.length === 0
        ? []
        : await this.#client.select<EventRow>("events", {
            columns: eventColumns,
            filters: [
              {
                column: "workspace_id",
                operator: "eq",
                value: principal.workspaceId,
              },
              { column: "object_id", operator: "in", value: ids },
            ],
          });
    const byId = new Map(
      eventRows.map((event) => [text(event.object_id, "event object"), event]),
    );
    return childObjects.flatMap((object) => {
      const event = byId.get(text(object.id, "object id"));
      return event === undefined ? [] : [resource(object, event)];
    });
  }
}
