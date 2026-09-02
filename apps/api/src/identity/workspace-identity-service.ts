import {
  createId,
  runAuditedMutation,
  users,
  workspaceMembers,
  workspaces,
  type Database,
  type UserRow,
  type WorkspaceRow,
} from "@chronelle/db";
import type {
  AuthorizationService,
  UserPrincipal,
} from "@chronelle/authorization";
import { and, eq, inArray } from "drizzle-orm";

import type { AuthIdentity } from "../authentication/auth-provider.js";
import { UnauthenticatedError, WorkspaceUnavailableError } from "../errors.js";

export interface IdentitySession {
  readonly principal: UserPrincipal;
  readonly user: UserRow;
  readonly workspace: WorkspaceRow;
}

export class WorkspaceIdentityService {
  readonly #authorization: AuthorizationService;
  readonly #database: Database;

  constructor(database: Database, authorization: AuthorizationService) {
    this.#database = database;
    this.#authorization = authorization;
  }

  async signIn(
    identity: AuthIdentity,
    requestId: string,
  ): Promise<IdentitySession> {
    return runAuditedMutation(this.#database, async (transaction) => {
      const [createdUser] = await transaction
        .insert(users)
        .values({
          id: createId(),
          identityProvider: identity.provider,
          providerSubject: identity.subject,
          email: identity.email,
          displayName: identity.displayName,
        })
        .onConflictDoNothing({
          target: [users.identityProvider, users.providerSubject],
        })
        .returning();
      const user = createdUser ?? (await this.#findUser(transaction, identity));

      if (user === undefined) {
        throw new Error("Identity persistence did not return a user.");
      }

      const workspaceId = createId();
      const [createdWorkspace] = await transaction
        .insert(workspaces)
        .values({
          id: workspaceId,
          displayName: `${user.displayName}'s workspace`,
          createdBy: user.id,
          personalOwnerId: user.id,
        })
        .onConflictDoNothing({ target: workspaces.personalOwnerId })
        .returning();
      const workspace =
        createdWorkspace ??
        (await this.#findPersonalWorkspace(transaction, user.id));

      if (workspace === undefined) {
        throw new Error(
          "Identity persistence did not return a personal workspace.",
        );
      }

      await transaction
        .insert(workspaceMembers)
        .values({
          workspaceId: workspace.id,
          userId: user.id,
          role: "owner",
        })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          set: { role: "owner" },
        });

      const value = this.#toSession(user, workspace);
      return {
        value,
        audit: {
          workspaceId: workspace.id,
          actorType: "user",
          actorId: user.id,
          action:
            createdWorkspace === undefined
              ? "identity.signed_in"
              : "workspace.personal_created",
          resourceId: null,
          requestId,
          metadata: { identityProvider: identity.provider },
        },
      };
    });
  }

  async resolvePrincipal(
    identity: AuthIdentity,
    requestedWorkspaceId?: string,
  ): Promise<IdentitySession> {
    const user = await this.#findUser(this.#database, identity);
    if (user === undefined) {
      throw new UnauthenticatedError();
    }

    const personalWorkspace = await this.#findPersonalWorkspace(
      this.#database,
      user.id,
    );
    if (personalWorkspace === undefined) {
      throw new UnauthenticatedError();
    }

    const workspaceId = requestedWorkspaceId ?? personalWorkspace.id;
    if (!(await this.#authorization.canAccessWorkspace(user.id, workspaceId))) {
      throw new WorkspaceUnavailableError();
    }

    const [workspace] = await this.#database
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (workspace === undefined) {
      throw new WorkspaceUnavailableError();
    }

    return this.#toSession(user, workspace);
  }

  async listAccessibleWorkspaces(
    userId: string,
    activeWorkspaceId: string,
  ): Promise<readonly WorkspaceRow[]> {
    const availableWorkspaceIds =
      await this.#authorization.listAccessibleWorkspaceIds(userId);
    const availableWorkspaces =
      availableWorkspaceIds.length === 0
        ? []
        : await this.#database
            .select()
            .from(workspaces)
            .where(inArray(workspaces.id, availableWorkspaceIds));
    availableWorkspaces.sort((first, second) => {
      if (first.id === activeWorkspaceId) {
        return -1;
      }
      if (second.id === activeWorkspaceId) {
        return 1;
      }
      return first.displayName.localeCompare(second.displayName);
    });
    return availableWorkspaces;
  }

  async #findUser(
    database: Pick<Database, "select">,
    identity: AuthIdentity,
  ): Promise<UserRow | undefined> {
    const [user] = await database
      .select()
      .from(users)
      .where(
        and(
          eq(users.identityProvider, identity.provider),
          eq(users.providerSubject, identity.subject),
        ),
      )
      .limit(1);
    return user;
  }

  async #findPersonalWorkspace(
    database: Pick<Database, "select">,
    userId: string,
  ): Promise<WorkspaceRow | undefined> {
    const [workspace] = await database
      .select()
      .from(workspaces)
      .where(eq(workspaces.personalOwnerId, userId))
      .limit(1);
    return workspace;
  }

  #toSession(user: UserRow, workspace: WorkspaceRow): IdentitySession {
    return {
      principal: {
        type: "user",
        userId: user.id,
        workspaceId: workspace.id,
      },
      user,
      workspace,
    };
  }
}
