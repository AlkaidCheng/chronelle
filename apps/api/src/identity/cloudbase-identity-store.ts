import {
  CloudBaseRpcError,
  type CloudBaseRdbClient,
  type CloudBaseRdbFilter,
  type UserRow,
} from "@chronelle/db";

import type { AuthIdentity } from "../authentication/auth-provider.js";
import {
  InvalidRequestError,
  UsernameTakenError,
  UserUnavailableError,
  WorkspaceUnavailableError,
} from "../errors.js";
import {
  type CloudBaseRow as Row,
  instant,
  record,
  role,
  text,
  userRow,
  workspaceRow,
} from "./cloudbase-rows.js";
import type {
  AccessibleWorkspaceRow,
  AccountUpdate,
  FriendRelation,
  IdentitySessionRows,
  IdentityStore,
  SignInResult,
  UserPreferences,
  UserSummary,
} from "./identity-store.js";

const relations = ["none", "friend", "requested", "incoming"] as const;

function userSummary(value: unknown): UserSummary {
  const row = record(value, "user summary");
  const relation = row.relation;
  if (
    typeof relation !== "string" ||
    !(relations as readonly string[]).includes(relation)
  )
    throw new Error("CloudBase returned an invalid relation.");
  return {
    id: text(row.id, "user id"),
    displayName: text(row.displayName, "display name"),
    username: text(row.username, "username"),
    relation: relation as FriendRelation,
  };
}

/** The account errors for the statuses the functions raise; anything else is a transport failure. */
function accountFailure(error: unknown): Error {
  if (error instanceof CloudBaseRpcError) {
    switch (error.status) {
      case 404:
        return new UserUnavailableError();
      case 409:
        return new UsernameTakenError();
      case 422:
        return new InvalidRequestError();
      default:
        return new Error(`Identity persistence failed: ${error.message}`);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

const filters = (
  ...items: readonly [string, CloudBaseRdbFilter["operator"], unknown][]
): readonly CloudBaseRdbFilter[] =>
  items.map(([column, operator, value]) => ({ column, operator, value }));

/**
 * Identity persistence through the gateway: the sign-in as
 * chronelle_identity_sign_in (which gives a new account its username), the
 * account preferences as
 * chronelle_user_preferences_update, the discovery switches as
 * chronelle_account_update, Find people as chronelle_users_search and
 * chronelle_user_lookup (migration 0055),
 * and the user, workspace, membership, and grant reads through the table
 * route with the same access rules as the PostgreSQL store (membership, or an unexpired grant on a live object, or
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
        username: identity.username ?? null,
        request_id: requestId,
      });
    } catch (error) {
      throw accountFailure(error);
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
    objectId?: string | undefined,
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
    let workspaceId = requestedWorkspaceId ?? workspaceRow(personal).id;
    if (objectId !== undefined) {
      const [object] = await this.#client.select<Row>("objects", {
        columns: "workspace_id",
        filters: filters(["id", "eq", objectId]),
        limit: 1,
      });
      const owner =
        object === undefined ? null : text(object.workspace_id, "workspace_id");
      if (
        owner !== null &&
        owner !== workspaceId &&
        (await this.#canAccessWorkspace(user.id, owner))
      )
        workspaceId = owner;
    }
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
  ): Promise<readonly AccessibleWorkspaceRow[]> {
    const memberships = await this.#client.select<Row>("workspace_members", {
      columns: "workspace_id,role",
      filters: filters(["user_id", "eq", userId]),
    });
    const roles = new Map(
      memberships.map((row) => [
        text(row.workspace_id, "workspace id"),
        role(row.role),
      ]),
    );
    const ids = new Set([
      ...roles.keys(),
      ...(await this.#grantedWorkspaceIds(userId)),
    ]);
    if (ids.size === 0) return [];
    const rows = (
      await this.#client.select<Row>("workspaces", {
        filters: filters(["id", "in", [...ids]]),
      })
    ).map(workspaceRow);
    const ownerIds = new Set(
      rows.map((workspace) => workspace.personalOwnerId ?? workspace.createdBy),
    );
    const owners = await this.#client.select<Row>("users", {
      columns: "id,display_name",
      filters: filters(["id", "in", [...ownerIds]]),
    });
    const ownerNames = new Map(
      owners.map((row) => [
        text(row.id, "user id"),
        text(row.display_name, "display name"),
      ]),
    );
    return rows.map((workspace) => ({
      ...workspace,
      ownerDisplayName:
        ownerNames.get(workspace.personalOwnerId ?? workspace.createdBy) ??
        null,
      role: roles.get(workspace.id) ?? null,
    }));
  }

  async updatePreferences(
    userId: string,
    preferences: UserPreferences,
  ): Promise<UserRow> {
    let result: unknown;
    try {
      result = await this.#client.rpc("chronelle_user_preferences_update", {
        user_id: userId,
        preferences: {
          ...(preferences.locale !== undefined && {
            locale: preferences.locale,
          }),
          ...(preferences.timeZone !== undefined && {
            time_zone: preferences.timeZone,
          }),
          ...(preferences.hourCycle !== undefined && {
            hour_cycle: preferences.hourCycle,
          }),
          ...(preferences.weekStart !== undefined && {
            week_start: preferences.weekStart,
          }),
          ...(preferences.rail !== undefined && { rail: preferences.rail }),
          ...(preferences.eventTabs !== undefined && {
            event_tabs: preferences.eventTabs,
          }),
          ...(preferences.workspaceRecency !== undefined && {
            workspace_recency: preferences.workspaceRecency,
          }),
        },
      });
    } catch (error) {
      if (error instanceof CloudBaseRpcError && error.code.endsWith("PT422"))
        throw new InvalidRequestError();
      if (error instanceof CloudBaseRpcError)
        throw new Error(`Identity persistence failed: ${error.message}`);
      throw error;
    }
    return userRow(record(result, "user"));
  }

  async updateAccount(
    userId: string,
    account: AccountUpdate,
  ): Promise<UserRow> {
    let result: unknown;
    try {
      result = await this.#client.rpc("chronelle_account_update", {
        user_id: userId,
        patch: {
          ...(account.displayName !== undefined && {
            displayName: account.displayName,
          }),
          ...(account.findByName !== undefined && {
            findByName: account.findByName,
          }),
          ...(account.findByEmail !== undefined && {
            findByEmail: account.findByEmail,
          }),
          ...(account.onboarded === true && { onboarded: true }),
        },
      });
    } catch (error) {
      throw accountFailure(error);
    }
    return userRow(record(result, "user"));
  }

  async searchUsers(
    userId: string,
    query: string,
  ): Promise<readonly UserSummary[]> {
    let result: unknown;
    try {
      result = await this.#client.rpc("chronelle_users_search", {
        user_id: userId,
        query,
      });
    } catch (error) {
      throw accountFailure(error);
    }
    const items = record(result, "search").items;
    if (!Array.isArray(items))
      throw new Error("CloudBase returned an invalid search.");
    return items.map(userSummary);
  }

  async usernameAvailable(username: string): Promise<boolean> {
    let result: unknown;
    try {
      result = await this.#client.rpc("chronelle_username_available", {
        candidate: username,
      });
    } catch (error) {
      throw accountFailure(error);
    }
    if (typeof result !== "boolean")
      throw new Error("CloudBase returned an invalid availability.");
    return result;
  }

  async lookupUser(userId: string, username: string): Promise<UserSummary> {
    let result: unknown;
    try {
      result = await this.#client.rpc("chronelle_user_lookup", {
        user_id: userId,
        username,
      });
    } catch (error) {
      throw accountFailure(error);
    }
    return userSummary(result);
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
