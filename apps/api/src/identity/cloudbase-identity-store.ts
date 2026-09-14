import {
  CloudBaseRpcError,
  type CloudBaseRdbClient,
  type CloudBaseRdbFilter,
  type UserRow,
  type WorkspaceRow,
} from "@chronelle/db";

import type { AuthIdentity } from "../authentication/auth-provider.js";
import { WorkspaceUnavailableError } from "../errors.js";
import type {
  IdentitySessionRows,
  IdentityStore,
  SignInResult,
} from "./identity-store.js";

type Row = Record<string, unknown>;

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return value;
}

function nullableText(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : text(value, field);
}

function instant(value: unknown, field: string): Date {
  const parsed = new Date(text(value, field));
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return parsed;
}

function record(value: unknown, label: string): Row {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`CloudBase returned an invalid ${label}.`);
  return value as Row;
}

function userRow(row: Row): UserRow {
  return {
    id: text(row.id, "user id"),
    identityProvider: text(row.identity_provider, "identity provider"),
    providerSubject: text(row.provider_subject, "provider subject"),
    email: nullableText(row.email, "email"),
    displayName: text(row.display_name, "display name"),
    createdAt: instant(row.created_at, "created_at"),
    updatedAt: instant(row.updated_at, "updated_at"),
  };
}

function workspaceRow(row: Row): WorkspaceRow {
  return {
    id: text(row.id, "workspace id"),
    displayName: text(row.display_name, "workspace name"),
    createdBy: text(row.created_by, "workspace creator"),
    personalOwnerId: nullableText(row.personal_owner_id, "personal owner"),
    createdAt: instant(row.created_at, "created_at"),
    updatedAt: instant(row.updated_at, "updated_at"),
  };
}

const filters = (
  ...items: readonly [string, CloudBaseRdbFilter["operator"], unknown][]
): readonly CloudBaseRdbFilter[] =>
  items.map(([column, operator, value]) => ({ column, operator, value }));

/**
 * Identity persistence through the gateway: the sign-in as
 * chronelle_identity_sign_in, and the user, workspace, membership, and
 * grant reads through the table route with the same access rules as the
 * PostgreSQL store (membership, or an unexpired grant on a live object, or
 * an Owner grant on any object). The reads of one session are sequential
 * requests rather than one snapshot.
 */
export class CloudBaseIdentityStore implements IdentityStore {
  readonly #client: Pick<CloudBaseRdbClient, "select" | "rpc">;
  readonly #clock: () => Date;

  constructor(
    client: Pick<CloudBaseRdbClient, "select" | "rpc">,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async signIn(
    identity: AuthIdentity,
    requestId: string,
  ): Promise<SignInResult> {
    let result: unknown;
    try {
      result = await this.#client.rpc("chronelle_identity_sign_in", {
        identity_provider: identity.provider,
        provider_subject: identity.subject,
        email: identity.email ?? null,
        display_name: identity.displayName,
        request_id: requestId,
      });
    } catch (error) {
      if (error instanceof CloudBaseRpcError)
        throw new Error(`Identity persistence failed: ${error.message}`);
      throw error;
    }
    const signedIn = record(result, "sign-in result");
    return {
      user: userRow(record(signedIn.user, "user")),
      workspace: workspaceRow(record(signedIn.workspace, "workspace")),
      createdWorkspace: signedIn.createdWorkspace === true,
    };
  }

  async resolveSession(
    identity: AuthIdentity,
    requestedWorkspaceId: string | undefined,
  ): Promise<IdentitySessionRows | null> {
    const [userFound] = await this.#client.select<Row>("users", {
      filters: filters(
        ["identity_provider", "eq", identity.provider],
        ["provider_subject", "eq", identity.subject],
      ),
      limit: 1,
    });
    if (userFound === undefined) return null;
    const user = userRow(userFound);
    const [personal] = await this.#client.select<Row>("workspaces", {
      filters: filters(["personal_owner_id", "eq", user.id]),
      limit: 1,
    });
    if (personal === undefined) return null;
    const workspaceId = requestedWorkspaceId ?? workspaceRow(personal).id;
    if (!(await this.#canAccessWorkspace(user.id, workspaceId)))
      throw new WorkspaceUnavailableError();
    const [found] = await this.#client.select<Row>("workspaces", {
      filters: filters(["id", "eq", workspaceId]),
      limit: 1,
    });
    if (found === undefined) throw new WorkspaceUnavailableError();
    return { user, workspace: workspaceRow(found) };
  }

  async #canAccessWorkspace(
    userId: string,
    workspaceId: string,
  ): Promise<boolean> {
    const membership = await this.#client.select<Row>("workspace_members", {
      columns: "user_id",
      filters: filters(
        ["workspace_id", "eq", workspaceId],
        ["user_id", "eq", userId],
      ),
      limit: 1,
    });
    if (membership.length > 0) return true;
    const granted = await this.#grantedWorkspaceIds(userId, workspaceId);
    return granted.has(workspaceId);
  }

  async listAccessibleWorkspaces(
    userId: string,
  ): Promise<readonly WorkspaceRow[]> {
    const memberships = await this.#client.select<Row>("workspace_members", {
      columns: "workspace_id",
      filters: filters(["user_id", "eq", userId]),
    });
    const ids = new Set([
      ...memberships.map((row) => text(row.workspace_id, "workspace id")),
      ...(await this.#grantedWorkspaceIds(userId)),
    ]);
    if (ids.size === 0) return [];
    const rows = await this.#client.select<Row>("workspaces", {
      filters: filters(["id", "in", [...ids]]),
    });
    return rows.map(workspaceRow);
  }

  /** Workspaces where the user holds an unexpired grant on a live object, or an Owner grant on any object. */
  async #grantedWorkspaceIds(
    userId: string,
    workspaceId?: string,
  ): Promise<Set<string>> {
    const scope: [string, CloudBaseRdbFilter["operator"], unknown][] =
      workspaceId === undefined ? [] : [["workspace_id", "eq", workspaceId]];
    const grants = await this.#client.select<Row>("resource_grants", {
      columns: "workspace_id,resource_id,role,expires_at",
      filters: filters(
        ["principal_type", "eq", "user"],
        ["principal_id", "eq", userId],
        ...scope,
      ),
    });
    const now = this.#clock();
    const active = grants.filter((grant) => {
      const expiresAt = grant.expires_at;
      return (
        expiresAt === null ||
        expiresAt === undefined ||
        instant(expiresAt, "grant expiry") > now
      );
    });
    if (active.length === 0) return new Set();
    const resources = await this.#client.select<Row>("objects", {
      columns: "id,workspace_id,deleted_at",
      filters: filters([
        "id",
        "in",
        [
          ...new Set(
            active.map((grant) => text(grant.resource_id, "grant resource")),
          ),
        ],
      ]),
    });
    const liveByKey = new Map(
      resources.map((row) => [
        `${text(row.workspace_id, "workspace id")}:${text(row.id, "object id")}`,
        row.deleted_at === null || row.deleted_at === undefined,
      ]),
    );
    const ids = new Set<string>();
    for (const grant of active) {
      const grantWorkspace = text(grant.workspace_id, "workspace id");
      const live = liveByKey.get(
        `${grantWorkspace}:${text(grant.resource_id, "grant resource")}`,
      );
      if (live === undefined) continue;
      if (live || grant.role === "owner") ids.add(grantWorkspace);
    }
    return ids;
  }
}
