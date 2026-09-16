import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@chronelle/authorization";
import type { CloudBaseRdbFilter, CloudBaseRdbReader } from "@chronelle/db";
import { trashQuerySchema, type TrashQueryInput } from "@chronelle/schemas";

import {
  cloudbaseIdBatchSize,
  cloudbaseInteger,
  cloudbaseObjectId,
  cloudbaseObjectType,
  cloudbaseOptionalFilter,
  compareCloudBaseIds,
  readCloudBaseObjectRow,
  readCloudBasePrincipalAccess,
  type CloudBaseObjectAccessRow,
  type CloudBasePrincipalAccess,
} from "./cloudbase-object-read-support.js";
import {
  cloudbaseFilters,
  cloudbaseNullableDate,
  cloudbaseNullableText,
  cloudbaseText,
} from "./cloudbase-read-support.js";
import {
  readTrashCursor,
  recoveryBlockedByParentReason,
  recoveryBlockedByScopeReason,
  trashCursor,
  trashListContext,
  type RecoveryPreview,
  type RecoveryReadRepository,
  type TrashItem,
  type TrashPage,
} from "./recovery-reads.js";

/** The canonical columns Trash reads; the scope is needed for the recovery predicate. */
const trashColumns =
  "id,workspace_id,object_type,display_name,version,deleted_at,permission_scope_id";

type TrashRow = CloudBaseObjectAccessRow & {
  readonly display_name: unknown;
  readonly version: unknown;
};

function trashItem(row: TrashRow, deletedAt: Date): TrashItem {
  return {
    id: cloudbaseObjectId(row),
    objectType: cloudbaseObjectType(row),
    displayName: cloudbaseText(row.display_name, "display name"),
    version: cloudbaseInteger(row.version, "version"),
    deletedAt: deletedAt.toISOString(),
  };
}

/**
 * Read-only CloudBase adapter for Trash. The recovery predicate is evaluated
 * in application code: a workspace Owner sees every tombstone, another
 * principal only those it holds an Owner grant on directly or through the
 * canonical scope. The transport has no "is not null" filter, so tombstones
 * are separated from live rows after the read.
 */
export class CloudBaseRecoveryReadRepository implements RecoveryReadRepository {
  readonly #client: CloudBaseRdbReader;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseRdbReader,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async listTrash(
    principal: UserPrincipal,
    options: TrashQueryInput = {},
  ): Promise<TrashPage> {
    const input = trashQuerySchema.parse(options);
    const context = trashListContext(principal, input);
    const cursor = readTrashCursor(input.cursor, context);
    const access = await readCloudBasePrincipalAccess(
      this.#client,
      principal,
      this.#clock,
    );
    const filters = [
      ...cloudbaseFilters(["workspace_id", "eq", principal.workspaceId]),
      ...cloudbaseOptionalFilter("object_type", "eq", input.objectType),
      ...cloudbaseOptionalFilter("permission_scope_id", "eq", input.scopeId),
    ];
    const rows = await this.#readCandidates(access, filters);
    const ordered = rows
      .flatMap((row) => {
        const deletedAt = cloudbaseNullableDate(row.deleted_at, "deleted_at");
        return deletedAt !== null && access.canRecover(row)
          ? [trashItem(row, deletedAt)]
          : [];
      })
      .sort((first, second) => compareCloudBaseIds(second.id, first.id))
      .filter(
        (item) =>
          cursor === undefined || compareCloudBaseIds(item.id, cursor.id) < 0,
      );
    const items = ordered.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        ordered.length > input.limit && last !== undefined
          ? trashCursor(context, last.id)
          : null,
    };
  }

  async previewRecovery(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<RecoveryPreview> {
    const [access, object] = await Promise.all([
      readCloudBasePrincipalAccess(this.#client, principal, this.#clock),
      readCloudBaseObjectRow(this.#client, principal, objectId, {
        includeDeleted: true,
      }),
    ]);
    if (!access.canRecover(object)) throw new AuthorizationDeniedError();
    const deletedAt = cloudbaseNullableDate(object.deleted_at, "deleted_at");
    if (deletedAt === null) throw new AuthorizationDeniedError();
    const scopeId = cloudbaseText(
      object.permission_scope_id,
      "permission scope",
    );
    let blockedReason: string | null = null;
    if (scopeId !== objectId) {
      const [scope] = await this.#client.select<TrashRow>("objects", {
        columns: trashColumns,
        filters: cloudbaseFilters(
          ["workspace_id", "eq", principal.workspaceId],
          ["id", "eq", scopeId],
        ),
        limit: 1,
      });
      if (
        scope === undefined ||
        cloudbaseNullableDate(scope.deleted_at, "deleted_at") !== null
      )
        blockedReason = recoveryBlockedByScopeReason;
    }
    // A subtask cannot come back under a parent that is still in Trash.
    if (
      blockedReason === null &&
      cloudbaseText(object.object_type, "object type") === "task"
    ) {
      const [task] = await this.#client.select<{
        readonly parent_task_id: unknown;
      }>("tasks", {
        columns: "parent_task_id",
        filters: cloudbaseFilters(
          ["workspace_id", "eq", principal.workspaceId],
          ["object_id", "eq", objectId],
        ),
        limit: 1,
      });
      const parentId = cloudbaseNullableText(
        task?.parent_task_id,
        "parent_task_id",
      );
      if (parentId !== null) {
        const [parent] = await this.#client.select<TrashRow>("objects", {
          columns: trashColumns,
          filters: cloudbaseFilters(
            ["workspace_id", "eq", principal.workspaceId],
            ["id", "eq", parentId],
          ),
          limit: 1,
        });
        if (
          parent === undefined ||
          cloudbaseNullableDate(parent.deleted_at, "deleted_at") !== null
        )
          blockedReason = recoveryBlockedByParentReason;
      }
    }
    return {
      object: trashItem(object, deletedAt),
      canRecover: blockedReason === null,
      blockedReason,
    };
  }

  /** Rows the recovery predicate can match; a workspace Owner needs no grant. */
  async #readCandidates(
    access: CloudBasePrincipalAccess,
    filters: readonly CloudBaseRdbFilter[],
  ): Promise<readonly TrashRow[]> {
    if (access.workspaceRole === "owner")
      return this.#client.select<TrashRow>("objects", {
        columns: trashColumns,
        filters,
      });
    const owned = [...access.grantRoles]
      .filter(([, role]) => role === "owner")
      .map(([resourceId]) => resourceId);
    const rows = new Map<string, TrashRow>();
    for (const column of ["id", "permission_scope_id"] as const) {
      for (let start = 0; start < owned.length; start += cloudbaseIdBatchSize) {
        const matched = await this.#client.select<TrashRow>("objects", {
          columns: trashColumns,
          filters: [
            ...filters,
            {
              column,
              operator: "in",
              value: owned.slice(start, start + cloudbaseIdBatchSize),
            },
          ],
        });
        for (const row of matched)
          rows.set(cloudbaseText(row.id, "object id"), row);
      }
    }
    return [...rows.values()];
  }
}
