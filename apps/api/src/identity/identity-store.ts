import { withReadAuthorization } from "@chronelle/authorization";
import {
  createId,
  runAuditedMutation,
  users,
  workspaceMembers,
  workspaces,
  type Database,
  type RailPreferenceRow,
  type UserRow,
  type WorkspaceRow,
} from "@chronelle/db";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { AuthIdentity } from "../authentication/auth-provider.js";
import { WorkspaceUnavailableError } from "../errors.js";

/** The rows a sign-in produces, and whether the personal workspace was created by it. */
export interface SignInResult {
  readonly user: UserRow;
  readonly workspace: WorkspaceRow;
  readonly createdWorkspace: boolean;
}

/** The user and the workspace a request acts in. */
export interface IdentitySessionRows {
  readonly user: UserRow;
  readonly workspace: WorkspaceRow;
}

/**
 * Identity persistence: sign-in (the user, their personal workspace, and
 * their Owner membership, created on first use, with the audit event, in
 * one transaction), the session for an authenticated identity in a
 * requested or the personal workspace (null when the user is unknown or
 * has no personal workspace; a workspace error when the user may not enter
 * the workspace), and the workspaces the user may enter through membership
 * or an active grant, and the preferences kept on the account (the
 * language, time zone, clock, and week start; a key that is present
 * replaces the stored value, null clears it, and an absent key keeps it;
 * the user is returned as the row then reads).
 */
export interface IdentityStore {
  signIn(identity: AuthIdentity, requestId: string): Promise<SignInResult>;
  resolveSession(
    identity: AuthIdentity,
    requestedWorkspaceId: string | undefined,
  ): Promise<IdentitySessionRows | null>;
  listAccessibleWorkspaces(userId: string): Promise<readonly WorkspaceRow[]>;
  updatePreferences(
    userId: string,
    preferences: UserPreferences,
  ): Promise<UserRow>;
}

/** The account preferences a store merges; an absent or undefined key keeps its value and null clears it. */
export interface UserPreferences {
  readonly locale?: string | null | undefined;
  readonly timeZone?: string | null | undefined;
  readonly hourCycle?: "h12" | "h23" | null | undefined;
  readonly weekStart?: 1 | 7 | null | undefined;
  readonly rail?: RailPreferenceRow | null | undefined;
}

/** The PostgreSQL store: each read runs in one repeatable-read snapshot with the authorization evaluator. */
export class PostgresIdentityStore implements IdentityStore {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async signIn(
    identity: AuthIdentity,
    requestId: string,
  ): Promise<SignInResult> {
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
      const user = createdUser ?? (await findUser(transaction, identity));
      if (user === null) {
        throw new Error("Identity persistence did not return a user.");
      }

      const [createdWorkspace] = await transaction
        .insert(workspaces)
        .values({
          id: createId(),
          displayName: `${user.displayName}'s workspace`,
          createdBy: user.id,
          personalOwnerId: user.id,
        })
        .onConflictDoNothing({ target: workspaces.personalOwnerId })
        .returning();
      const workspace =
        createdWorkspace ?? (await findPersonalWorkspace(transaction, user.id));
      if (workspace === null) {
        throw new Error(
          "Identity persistence did not return a personal workspace.",
        );
      }

      await transaction
        .insert(workspaceMembers)
        .values({ workspaceId: workspace.id, userId: user.id, role: "owner" })
        .onConflictDoUpdate({
          target: [workspaceMembers.workspaceId, workspaceMembers.userId],
          set: { role: "owner" },
        });

      return {
        value: {
          user,
          workspace,
          createdWorkspace: createdWorkspace !== undefined,
        },
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

  async resolveSession(
    identity: AuthIdentity,
    requestedWorkspaceId: string | undefined,
  ): Promise<IdentitySessionRows | null> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const user = await findUser(transaction, identity);
        if (user === null) return null;
        const personalWorkspace = await findPersonalWorkspace(
          transaction,
          user.id,
        );
        if (personalWorkspace === null) return null;
        const workspaceId = requestedWorkspaceId ?? personalWorkspace.id;
        if (!(await authorization.canAccessWorkspace(user.id, workspaceId)))
          throw new WorkspaceUnavailableError();
        const [workspace] = await transaction
          .select()
          .from(workspaces)
          .where(eq(workspaces.id, workspaceId))
          .limit(1);
        if (workspace === undefined) throw new WorkspaceUnavailableError();
        return { user, workspace };
      },
    );
  }

  async listAccessibleWorkspaces(
    userId: string,
  ): Promise<readonly WorkspaceRow[]> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const ids = await authorization.listAccessibleWorkspaceIds(userId);
        if (ids.length === 0) return [];
        return transaction
          .select()
          .from(workspaces)
          .where(inArray(workspaces.id, ids));
      },
    );
  }

  async updatePreferences(
    userId: string,
    preferences: UserPreferences,
  ): Promise<UserRow> {
    const [updated] = await this.#database
      .update(users)
      .set({
        ...(preferences.locale !== undefined && { locale: preferences.locale }),
        ...(preferences.timeZone !== undefined && {
          timeZone: preferences.timeZone,
        }),
        ...(preferences.hourCycle !== undefined && {
          hourCycle: preferences.hourCycle,
        }),
        ...(preferences.weekStart !== undefined && {
          weekStart: preferences.weekStart,
        }),
        ...(preferences.rail !== undefined && {
          rail: preferences.rail ?? {},
        }),
        updatedAt: sql`GREATEST(now(), ${users.createdAt})`,
      })
      .where(eq(users.id, userId))
      .returning();
    if (updated === undefined) throw new Error("The user does not exist.");
    return updated;
  }
}

async function findUser(
  database: Pick<Database, "select">,
  identity: AuthIdentity,
): Promise<UserRow | null> {
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
  return user ?? null;
}

async function findPersonalWorkspace(
  database: Pick<Database, "select">,
  userId: string,
): Promise<WorkspaceRow | null> {
  const [workspace] = await database
    .select()
    .from(workspaces)
    .where(eq(workspaces.personalOwnerId, userId))
    .limit(1);
  return workspace ?? null;
}
