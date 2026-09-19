import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  type CloudBaseRdbClient,
  CloudBaseRpcError,
  objectTypes,
  roles,
} from "@chronelle/db";

import { cloudbaseScopeJson } from "@chronelle/object-model";
import { instant, record, text } from "../identity/cloudbase-rows.js";
import type {
  PersonShareStore,
  PersonShareView,
} from "./person-share-store.js";

function oneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  field: string,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return value;
}

function shareView(value: unknown): PersonShareView {
  const row = record(value, "person share");
  return {
    id: text(row.id, "share id"),
    kind: oneOf(row.kind, ["grant", "pending"], "share kind"),
    direction: oneOf(row.direction, ["outgoing", "incoming"], "direction"),
    resourceId: text(row.resourceId, "resourceId"),
    objectType: oneOf(row.objectType, objectTypes, "object type"),
    displayName: text(row.displayName, "displayName"),
    role: oneOf(row.role, roles, "role"),
    createdAt: instant(row.createdAt, "createdAt"),
    scope: cloudbaseScopeJson(row.scope),
  };
}

/**
 * The person's shares through the gateway: chronelle_person_shares_list
 * (migration 0054), with the PostgreSQL store's rules and order.
 */
export class CloudBasePersonShareStore implements PersonShareStore {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async list(
    principal: UserPrincipal,
    personId: string,
  ): Promise<readonly PersonShareView[]> {
    let outcome: unknown;
    try {
      outcome = await this.#client.rpc("chronelle_person_shares_list", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        person_id: personId,
      });
    } catch (error) {
      if (error instanceof CloudBaseRpcError && error.status === 403)
        throw new AuthorizationDeniedError();
      if (error instanceof CloudBaseRpcError)
        throw new Error(`Person share listing failed: ${error.message}`);
      throw error;
    }
    const items = record(outcome, "person shares").items;
    if (!Array.isArray(items))
      throw new Error("CloudBase returned an invalid person share list.");
    return items.map(shareView);
  }
}
