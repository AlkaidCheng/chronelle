import { withReadAuthorization } from "@chronelle/authorization";
import {
  createId,
  runAuditedMutation,
  userConnections,
  users,
  workspaceMembers,
  workspaces,
  type Database,
  type EventTabsPreferenceRow,
  type EventTabsRow,
  type RailPreferenceRow,
  type UserRow,
  type WorkspaceRow,
} from "@chronelle/db";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

import type { AuthIdentity } from "../authentication/auth-provider.js";
import {
  InvalidRequestError,
  UserUnavailableError,
  WorkspaceUnavailableError,
} from "../errors.js";
import { assignUsername, usernameShape } from "./username.js";

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
  updateAccount(userId: string, account: AccountUpdate): Promise<UserRow>;
  searchUsers(userId: string, query: string): Promise<readonly UserSummary[]>;
  lookupUser(userId: string, username: string): Promise<UserSummary>;
  usernameAvailable(username: string): Promise<boolean>;
}

/**
 * The account fields the account route changes: the discovery switches;
 * an absent key keeps its value. The username is chosen once, at sign-up.
 */
export interface AccountUpdate {
  readonly findByName?: boolean | undefined;
  readonly findByEmail?: boolean | undefined;
}

/** How the viewer and another account stand. */
export type FriendRelation = "none" | "friend" | "requested" | "incoming";

/** An account as Find people and the code page show it to the viewer. */
export interface UserSummary {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  readonly relation: FriendRelation;
}

/** How many accounts a search answers with. */
export const searchLimit = 10;

/**
 * The account preferences a store merges; an absent or undefined key keeps
 * its value and null clears it. `eventTabs` merges one event at a time:
 * an object replaces that event's tabs and null drops them.
 */
export interface UserPreferences {
  readonly locale?: string | null | undefined;
  readonly timeZone?: string | null | undefined;
  readonly hourCycle?: "h12" | "h23" | null | undefined;
  readonly weekStart?: 1 | 7 | null | undefined;
  readonly rail?: RailPreferenceRow | null | undefined;
  readonly eventTabs?:
    Readonly<Record<string, EventTabsPreferenceRow | null>> | undefined;
}

/** How many events keep tab preferences on one account. */
export const eventTabsLimit = 200;

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
      // An account that exists keeps its username; a new one gets the one
      // sign-up chose, else one from its name. A concurrent first sign-in
      // of the same identity, or of another taking the same username,
      // conflicts on insert: the identity is read again, and a username
      // taken meanwhile is assigned again.
      let user = await findUser(transaction, identity);
      for (let attempt = 0; user === null && attempt < 3; attempt += 1) {
        const [createdUser] = await transaction
          .insert(users)
          .values({
            id: createId(),
            identityProvider: identity.provider,
            providerSubject: identity.subject,
            email: identity.email,
            displayName: identity.displayName,
            username: await assignUsername(
              transaction,
              identity.displayName,
              identity.username,
            ),
          })
          .onConflictDoNothing()
          .returning();
        user = createdUser ?? (await findUser(transaction, identity));
      }
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
    return this.#database.transaction(async (transaction) => {
      const eventTabs =
        preferences.eventTabs === undefined
          ? undefined
          : await mergeEventTabs(transaction, userId, preferences.eventTabs);
      const [updated] = await transaction
        .update(users)
        .set({
          ...(preferences.locale !== undefined && {
            locale: preferences.locale,
          }),
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
          ...(eventTabs !== undefined && { eventTabs }),
          updatedAt: sql`GREATEST(now(), ${users.createdAt})`,
        })
        .where(eq(users.id, userId))
        .returning();
      if (updated === undefined) throw new Error("The user does not exist.");
      return updated;
    });
  }

  async updateAccount(
    userId: string,
    account: AccountUpdate,
  ): Promise<UserRow> {
    const [updated] = await this.#database
      .update(users)
      .set({
        ...(account.findByName !== undefined && {
          findByName: account.findByName,
        }),
        ...(account.findByEmail !== undefined && {
          findByEmail: account.findByEmail,
        }),
        updatedAt: sql`GREATEST(now(), ${users.createdAt})`,
      })
      .where(eq(users.id, userId))
      .returning();
    if (updated === undefined) throw new UserUnavailableError();
    return updated;
  }

  /**
   * Find people: "@name" matches usernames that start so; an address
   * matches the one account with that email that lets itself be found by
   * it; other text matches, among accounts that let themselves be found
   * by name, names that contain it or come close to it (trigram similarity
   * of 0.45 or more, from four characters), and usernames that start
   * so. Names are folded (accents dropped, lowercased) and served by the
   * trigram indexes. The searcher is left out; at most ten, ranked: the
   * exact username, a username prefix, a name whose word starts with the
   * text, a name that contains it, then by similarity, then by name.
   */
  async searchUsers(
    userId: string,
    query: string,
  ): Promise<readonly UserSummary[]> {
    const q = query.trim();
    if (q.length < 2) return [];
    return withReadAuthorization(this.#database, async (transaction) => {
      const rows = q.startsWith("@")
        ? await transaction
            .select()
            .from(users)
            .where(
              and(
                ne(users.id, userId),
                sql`lower(${users.username}) LIKE ${likePrefix(q.slice(1))}`,
              ),
            )
            .orderBy(
              sql`(lower(${users.username}) = ${q.slice(1).toLowerCase()}) DESC`,
              sql`lower(${users.username})`,
            )
            .limit(searchLimit)
        : q.includes("@")
          ? await transaction
              .select()
              .from(users)
              .where(
                and(
                  ne(users.id, userId),
                  eq(users.findByEmail, true),
                  eq(
                    sql`lower(coalesce(${users.email}, ${users.providerSubject}))`,
                    q.toLowerCase(),
                  ),
                ),
              )
              .limit(searchLimit)
          : await this.#searchByNameOrHandle(transaction, userId, q);
      return Promise.all(
        rows.map(async (row) => ({
          id: row.id,
          displayName: row.displayName,
          username: row.username,
          relation: await relationOf(transaction, userId, row.id),
        })),
      );
    });
  }

  /** The name branch of the search, on the folded name and the trigram indexes, as chronelle_users_search. */
  async #searchByNameOrHandle(
    transaction: Pick<Database, "select" | "execute">,
    userId: string,
    q: string,
  ) {
    // A near miss is a trigram similarity of 0.45 or more: a typo in a
    // full name clears it, a shared word does not.
    await transaction.execute(
      sql`SET LOCAL pg_trgm.similarity_threshold = 0.45`,
    );
    const [folded] = await transaction
      .select({ value: sql<string>`chronelle_search_fold(${q})` })
      .from(sql`(SELECT 1) AS one`);
    const fq = folded?.value ?? q.toLowerCase();
    const pattern = likeEscape(fq);
    const name = sql`chronelle_search_fold(${users.displayName})`;
    const handle = sql`lower(${users.username})`;
    const exact = sql`(${handle} = ${fq})`;
    const handlePrefix = sql`(${handle} LIKE ${`${pattern}%`})`;
    const wordPrefix = sql`(${users.findByName} AND (${name} LIKE ${`${pattern}%`} OR ${name} LIKE ${`% ${pattern}%`}))`;
    const contains = sql`(${users.findByName} AND ${name} LIKE ${`%${pattern}%`})`;
    const score = sql`(CASE WHEN ${users.findByName} THEN similarity(${name}, ${fq}) ELSE 0 END)`;
    const near =
      fq.length >= 4
        ? sql`OR (${users.findByName} AND ${name} % ${fq})`
        : sql``;
    return transaction
      .select()
      .from(users)
      .where(
        and(
          ne(users.id, userId),
          sql`(${handle} LIKE ${`${pattern}%`} OR (${users.findByName} AND ${name} LIKE ${`%${pattern}%`}) ${near})`,
        ),
      )
      .orderBy(
        sql`${exact} DESC`,
        sql`${handlePrefix} DESC`,
        sql`${wordPrefix} DESC`,
        sql`${contains} DESC`,
        sql`${score} DESC`,
        name,
      )
      .limit(searchLimit);
  }

  /** Whether a username is free, for the sign-up screen; false as well for one of the wrong shape. */
  async usernameAvailable(username: string): Promise<boolean> {
    if (!usernameShape.test(username)) return false;
    const [row] = await this.#database
      .select({ id: users.id })
      .from(users)
      .where(eq(sql`lower(${users.username})`, username.toLowerCase()))
      .limit(1);
    return row === undefined;
  }

  async lookupUser(userId: string, username: string): Promise<UserSummary> {
    return withReadAuthorization(this.#database, async (transaction) => {
      const [row] = await transaction
        .select()
        .from(users)
        .where(eq(sql`lower(${users.username})`, username.toLowerCase()))
        .limit(1);
      if (row === undefined) throw new UserUnavailableError();
      return {
        id: row.id,
        displayName: row.displayName,
        username: row.username,
        relation: await relationOf(transaction, userId, row.id),
      };
    });
  }
}

/** A LIKE pattern for the text as typed, its wildcards meaning themselves. */
function likeEscape(value: string): string {
  return value.replace(/[\\%_]/gu, (mark) => `\\${mark}`);
}

function likePrefix(value: string): string {
  return `${likeEscape(value.toLowerCase())}%`;
}

/** Friends, a request the viewer sent, one the viewer received, or nothing. */
async function relationOf(
  transaction: Pick<Database, "select">,
  viewerId: string,
  otherId: string,
): Promise<FriendRelation> {
  const [connection] = await transaction
    .select({
      status: userConnections.status,
      requesterId: userConnections.requesterId,
    })
    .from(userConnections)
    .where(
      and(
        sql`${userConnections.status} IN ('pending', 'accepted')`,
        sql`LEAST(${userConnections.requesterId}, ${userConnections.addresseeId}) = LEAST(${viewerId}::uuid, ${otherId}::uuid)`,
        sql`GREATEST(${userConnections.requesterId}, ${userConnections.addresseeId}) = GREATEST(${viewerId}::uuid, ${otherId}::uuid)`,
      ),
    )
    .limit(1);
  if (connection === undefined) return "none";
  if (connection.status === "accepted") return "friend";
  return connection.requesterId === viewerId ? "requested" : "incoming";
}

/** The stored tabs with the request's events replaced or dropped, locked for the update that follows. */
async function mergeEventTabs(
  transaction: Pick<Database, "select">,
  userId: string,
  changes: Readonly<Record<string, EventTabsPreferenceRow | null>>,
): Promise<EventTabsRow> {
  const [row] = await transaction
    .select({ eventTabs: users.eventTabs })
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  const next: Record<string, EventTabsPreferenceRow> = { ...row?.eventTabs };
  for (const [eventId, tabs] of Object.entries(changes)) {
    if (tabs === null) delete next[eventId];
    else next[eventId] = tabs;
  }
  if (Object.keys(next).length > eventTabsLimit)
    throw new InvalidRequestError();
  return next;
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
