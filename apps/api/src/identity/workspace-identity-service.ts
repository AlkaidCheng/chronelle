import type { Database, UserRow, WorkspaceRow } from "@chronelle/db";
import type { UserPrincipal } from "@chronelle/authorization";

import type { AuthIdentity } from "../authentication/auth-provider.js";
import { UnauthenticatedError } from "../errors.js";
import {
  PostgresIdentityStore,
  type IdentityStore,
  type UserPreferences,
} from "./identity-store.js";

export interface IdentitySession {
  readonly principal: UserPrincipal;
  readonly user: UserRow;
  readonly workspace: WorkspaceRow;
}

/** Sessions for authenticated identities over the identity store, PostgreSQL by default. */
export class WorkspaceIdentityService {
  readonly #store: IdentityStore;

  constructor(database: Database, store?: IdentityStore) {
    this.#store = store ?? new PostgresIdentityStore(database);
  }

  async signIn(
    identity: AuthIdentity,
    requestId: string,
  ): Promise<IdentitySession> {
    const { user, workspace } = await this.#store.signIn(identity, requestId);
    return toSession(user, workspace);
  }

  async resolvePrincipal(
    identity: AuthIdentity,
    requestedWorkspaceId?: string,
  ): Promise<IdentitySession> {
    const session = await this.#store.resolveSession(
      identity,
      requestedWorkspaceId,
    );
    if (session === null) throw new UnauthenticatedError();
    return toSession(session.user, session.workspace);
  }

  /** Merges the given preferences into the account; null clears a key. */
  updatePreferences(
    userId: string,
    preferences: UserPreferences,
  ): Promise<UserRow> {
    return this.#store.updatePreferences(userId, preferences);
  }

  async listAccessibleWorkspaces(
    userId: string,
    activeWorkspaceId: string,
  ): Promise<readonly WorkspaceRow[]> {
    const available = [...(await this.#store.listAccessibleWorkspaces(userId))];
    available.sort((first, second) => {
      if (first.id === activeWorkspaceId) return -1;
      if (second.id === activeWorkspaceId) return 1;
      return first.displayName.localeCompare(second.displayName);
    });
    return available;
  }
}

function toSession(user: UserRow, workspace: WorkspaceRow): IdentitySession {
  return {
    principal: { type: "user", userId: user.id, workspaceId: workspace.id },
    user,
    workspace,
  };
}
