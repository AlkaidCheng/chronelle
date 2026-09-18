import {
  CloudBaseRpcError,
  type CloudBaseRdbClient,
  type CloudBaseRdbFilter,
  type UserRow,
  type WorkspaceRow,
} from "@chronelle/db";

import type { AuthIdentity } from "../authentication/auth-provider.js";
import { InvalidRequestError, WorkspaceUnavailableError } from "../errors.js";
import {
  type CloudBaseRow as Row,
  instant,
  record,
  text,
  userRow,
  workspaceRow,
} from "./cloudbase-rows.js";
import type {
  IdentitySessionRows,
  IdentityStore,
  SignInResult,
  UserPreferences,
} from "./identity-store.js";

const filters = (
  ...items: readonly [string, CloudBaseRdbFilter["operator"], unknown][]
): readonly CloudBaseRdbFilter[] =>
  items.map(([column, operator, value]) => ({ column, operator, value }));

/**
 * Identity persistence through the gateway: the sign-in as
 * chronelle_identity_sign_in, the account preferences as
 * chronelle_user_preferences_update,
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
