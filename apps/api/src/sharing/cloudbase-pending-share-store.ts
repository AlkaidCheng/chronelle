import {
  AuthorizationDeniedError,
  type GrantMutationContext,
  type UserPrincipal,
} from "@livtales/authorization";
import {
  type CloudBaseRdbClient,
  CloudBaseRpcError,
  roles,
} from "@livtales/db";

import {
  FriendUnavailableError,
  InvalidFriendRequestError,
} from "../friends/friend-store.js";
import {
  type CloudBaseRow,
  instant,
  nullableText,
  record,
  text,
} from "../identity/cloudbase-rows.js";
import type {
  PendingShareStore,
  PendingShareView,
  QueueShareInput,
  RevokedPendingShare,
} from "./pending-share-store.js";

function role(value: unknown): PendingShareView["role"] {
  if (typeof value !== "string" || !roles.includes(value as never))
    throw new Error("CloudBase returned an invalid role.");
  return value as PendingShareView["role"];
}

function pendingView(value: unknown): PendingShareView {
  const row = record(value, "pending share");
  const person =
    row.person === null || row.person === undefined
      ? null
      : record(row.person, "person");
  const kind = text(row.kind, "kind");
  if (kind !== "connection" && kind !== "invitation")
    throw new Error("CloudBase returned an invalid pending share kind.");
  return {
    id: text(row.id, "pending share id"),
    workspaceId: text(row.workspaceId, "workspaceId"),
    resourceId: text(row.resourceId, "resourceId"),
    role: role(row.role),
    status: "pending",
    kind,
    itemId: text(row.itemId, "itemId"),
    person:
      person === null
        ? null
        : {
            id: text(person.id, "person id"),
            displayName: text(person.displayName, "person name"),
          },
    email: nullableText(row.email, "email"),
    grantedBy: text(row.grantedBy, "grantedBy"),
    createdAt: instant(row.createdAt, "createdAt"),
  };
}

function list(value: unknown): readonly CloudBaseRow[] {
  const outcome = record(value, "pending shares");
  if (!Array.isArray(outcome.items))
    throw new Error("CloudBase returned an invalid pending share list.");
  return outcome.items.map((item) => record(item, "pending share"));
}

/** The store's errors for the statuses the functions raise; anything else is a transport failure. */
function failure(error: unknown): Error {
  if (error instanceof CloudBaseRpcError) {
    switch (error.status) {
      case 403:
        return new AuthorizationDeniedError();
      case 404:
        return new FriendUnavailableError(error.message);
      case 422:
        return new InvalidFriendRequestError(error.message);
      default:
        return new Error(`Pending share persistence failed: ${error.message}`);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Pending shares through the gateway: chronelle_pending_share_list,
 * _create, and _revoke (migration 0052), with the PostgreSQL store's
 * rules and messages.
 */
export class CloudBasePendingShareStore implements PendingShareStore {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async #call(name: string, input: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.#client.rpc(name, input);
    } catch (error) {
      throw failure(error);
    }
  }

  async list(
    principal: UserPrincipal,
    resourceId: string,
  ): Promise<readonly PendingShareView[]> {
    return list(
      await this.#call("chronelle_pending_share_list", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        resource_id: resourceId,
      }),
    ).map(pendingView);
  }

  async queue(
    context: GrantMutationContext,
    input: QueueShareInput,
  ): Promise<PendingShareView> {
    return pendingView(
      await this.#call("chronelle_pending_share_create", {
        workspace_id: context.principal.workspaceId,
        user_id: context.principal.userId,
        request_id: context.requestId,
        resource_id: input.resourceId,
        role: input.role,
        item_id: input.itemId,
        person_id: input.personId,
      }),
    );
  }

  async revoke(
    context: GrantMutationContext,
    pendingId: string,
    revokedAt: Date,
  ): Promise<RevokedPendingShare> {
    const outcome = record(
      await this.#call("chronelle_pending_share_revoke", {
        workspace_id: context.principal.workspaceId,
        user_id: context.principal.userId,
        request_id: context.requestId,
        pending_id: pendingId,
        revoked_at: revokedAt.toISOString(),
      }),
      "revocation",
    );
    return {
      id: text(outcome.id, "pending share id"),
      revokedAt: instant(outcome.revokedAt, "revokedAt"),
    };
  }
}
