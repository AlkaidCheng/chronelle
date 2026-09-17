import {
  InvalidShareError,
  type GrantMutationContext,
  type ResourceGrantResource,
  type RevokedGrantResource,
  type ShareResourceInput,
  type ShareWriteRepository,
} from "@chronelle/authorization";
import {
  CloudBaseRpcError,
  roles,
  type CloudBaseRdbClient,
  type Role,
} from "@chronelle/db";

import {
  cloudbaseDate,
  cloudbaseNullableDate,
  cloudbaseNullableText,
  cloudbaseResourceFromRows,
  cloudbaseText,
} from "./cloudbase-read-support.js";
import { mapRpcError } from "./cloudbase-rpc-errors.js";
import type { PermissionScopeWriteRepository } from "./object-writes.js";
import type { EventPlanningResource, MutationContext } from "./types.js";

/**
 * Sharing through chronelle_resource_share and
 * chronelle_resource_share_revoke, and permission-scope changes through
 * chronelle_object_scope_update. Each call is one transaction that applies
 * the service's authorization, state, version, audit, and revision rules.
 */
export class CloudBaseSharingWriteRepository
  implements ShareWriteRepository, PermissionScopeWriteRepository
{
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async share(
    context: GrantMutationContext,
    input: ShareResourceInput,
  ): Promise<ResourceGrantResource> {
    const row = await this.#call("chronelle_resource_share", {
      ...principalArguments(context),
      resource_id: input.resourceId,
      role: input.role,
      ...(input.principalEmail === undefined
        ? {}
        : { principal_email: input.principalEmail }),
      ...(input.personId === undefined ? {} : { person_id: input.personId }),
      ...(input.friendId === undefined ? {} : { friend_id: input.friendId }),
    });
    return decodeGrant(row);
  }

  async revoke(
    context: GrantMutationContext,
    grantId: string,
    revokedAt: Date,
  ): Promise<RevokedGrantResource> {
    const row = await this.#call("chronelle_resource_share_revoke", {
      ...principalArguments(context),
      grant_id: grantId,
      revoked_at: revokedAt.toISOString(),
    });
    const record = asRecord(row, "revocation");
    return {
      id: cloudbaseText(record.id, "grant id"),
      revokedAt: cloudbaseDate(record.revokedAt, "revokedAt"),
    };
  }

  async updatePermissionScope(
    context: MutationContext,
    objectId: string,
    expectedVersion: number,
    permissionScopeId: string,
    updatedAt: Date,
  ): Promise<EventPlanningResource> {
    return cloudbaseResourceFromRows(
      await this.#call("chronelle_object_scope_update", {
        ...principalArguments(context),
        object_id: objectId,
        expected_version: expectedVersion,
        permission_scope_id: permissionScopeId,
        updated_at: updatedAt.toISOString(),
      }),
    );
  }

  async #call(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.#client.rpc(functionName, args);
    } catch (error) {
      if (error instanceof CloudBaseRpcError)
        throw mapRpcError(error, {
          invalidRequest: (message) => new InvalidShareError(message),
        });
      throw error;
    }
  }
}

function principalArguments(context: GrantMutationContext | MutationContext) {
  return {
    workspace_id: context.principal.workspaceId,
    user_id: context.principal.userId,
    request_id: context.requestId,
  };
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (value === null || typeof value !== "object")
    throw new Error(`CloudBase returned an invalid ${what}.`);
  return value as Record<string, unknown>;
}

/** The grant row with its principal, as chronelle_resource_share returns it. */
function decodeGrant(row: unknown): ResourceGrantResource {
  const grant = asRecord(row, "grant");
  const principal = asRecord(grant.principal, "grant principal");
  const role = cloudbaseText(grant.role, "role");
  if (!roles.includes(role as Role))
    throw new Error("CloudBase returned an invalid grant role.");
  return {
    id: cloudbaseText(grant.id, "grant id"),
    workspaceId: cloudbaseText(grant.workspace_id, "grant workspace"),
    resourceId: cloudbaseText(grant.resource_id, "resource_id"),
    role: role as Role,
    grantedBy: cloudbaseText(grant.granted_by, "granted_by"),
    createdAt: cloudbaseDate(grant.created_at, "created_at"),
    expiresAt: cloudbaseNullableDate(grant.expires_at, "expires_at"),
    principal: {
      id: cloudbaseText(principal.id, "principal id"),
      displayName: cloudbaseText(
        principal.displayName,
        "principal displayName",
      ),
      email: cloudbaseNullableText(principal.email, "principal email"),
    },
  };
}
