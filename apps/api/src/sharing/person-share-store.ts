import {
  AuthorizationDeniedError,
  type UserPrincipal,
  withReadAuthorization,
} from "@chronelle/authorization";
import {
  type Database,
  objects,
  type ObjectType,
  pendingShares,
  personAccountId,
  persons,
  resourceGrants,
  type Role,
  workspaceMembers,
} from "@chronelle/db";
import { and, eq, gt, isNull, or, sql } from "drizzle-orm";

/**
 * One thing shared between the acting account and a person: a live grant
 * the account's workspace holds for the person's account (outgoing), a
 * share queued for the person while an invitation waits (outgoing,
 * pending), or a live grant the person's account gave the acting account
 * (incoming).
 */
export interface PersonShareView {
  readonly id: string;
  readonly kind: "grant" | "pending";
  readonly direction: "outgoing" | "incoming";
  readonly resourceId: string;
  readonly objectType: ObjectType;
  readonly displayName: string;
  readonly role: Role;
  readonly createdAt: Date;
}

/**
 * What is shared each way with a person, newest first, for a member of
 * the workspace who can view the person; a guest with a grant on the card
 * is refused, as what the workspace shared is the workspace's to see.
 */
export interface PersonShareStore {
  list(
    principal: UserPrincipal,
    personId: string,
  ): Promise<readonly PersonShareView[]>;
}

/** The PostgreSQL store: one repeatable-read snapshot per listing. */
export class PostgresPersonShareStore implements PersonShareStore {
  readonly #database: Database;
  readonly #clock: () => Date;

  constructor(database: Database, clock: () => Date = () => new Date()) {
    this.#database = database;
    this.#clock = clock;
  }

  async list(
    principal: UserPrincipal,
    personId: string,
  ): Promise<readonly PersonShareView[]> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const [person] = await transaction
          .select({ objectId: persons.objectId })
          .from(persons)
          .where(
            and(
              eq(persons.workspaceId, principal.workspaceId),
              eq(persons.objectId, personId),
            ),
          )
          .limit(1);
        if (person === undefined) throw new AuthorizationDeniedError();
        const [membership] = await transaction
          .select({ role: workspaceMembers.role })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, principal.workspaceId),
              eq(workspaceMembers.userId, principal.userId),
            ),
          )
          .limit(1);
        if (membership === undefined) throw new AuthorizationDeniedError();
        await authorization.assertCan(principal, "view", {
          id: personId,
          workspaceId: principal.workspaceId,
        });
        const account = await personAccountId(
          transaction,
          principal.workspaceId,
          person.objectId,
        );
        const now = this.#clock();
        const live = or(
          isNull(resourceGrants.expiresAt),
          gt(resourceGrants.expiresAt, now),
        );
        const record = {
          resourceId: objects.id,
          objectType: objects.objectType,
          displayName: objects.displayName,
        };
        const grants =
          account === null
            ? []
            : await transaction
                .select({
                  ...record,
                  id: resourceGrants.id,
                  role: resourceGrants.role,
                  createdAt: resourceGrants.createdAt,
                  direction: sql<"outgoing" | "incoming">`CASE
                    WHEN ${resourceGrants.principalId} = ${account}::uuid THEN 'outgoing'
                    ELSE 'incoming' END`,
                })
                .from(resourceGrants)
                .innerJoin(
                  objects,
                  and(
                    eq(objects.workspaceId, resourceGrants.workspaceId),
                    eq(objects.id, resourceGrants.resourceId),
                  ),
                )
                .where(
                  and(
                    eq(resourceGrants.principalType, "user"),
                    or(
                      and(
                        eq(resourceGrants.workspaceId, principal.workspaceId),
                        eq(resourceGrants.principalId, account),
                      ),
                      and(
                        eq(resourceGrants.principalId, principal.userId),
                        eq(resourceGrants.grantedBy, account),
                      ),
                    ),
                    live,
                    isNull(objects.deletedAt),
                  ),
                );
        const queued = await transaction
          .select({
            ...record,
            id: pendingShares.id,
            role: pendingShares.role,
            createdAt: pendingShares.createdAt,
          })
          .from(pendingShares)
          .innerJoin(
            objects,
            and(
              eq(objects.workspaceId, pendingShares.workspaceId),
              eq(objects.id, pendingShares.resourceId),
            ),
          )
          .where(
            and(
              eq(pendingShares.workspaceId, principal.workspaceId),
              eq(pendingShares.personId, personId),
              eq(pendingShares.status, "pending"),
              isNull(objects.deletedAt),
            ),
          );
        const items: PersonShareView[] = [
          ...grants.map((row) => ({ ...row, kind: "grant" as const })),
          ...queued.map((row) => ({
            ...row,
            kind: "pending" as const,
            direction: "outgoing" as const,
          })),
        ];
        return items.sort(
          (a, b) =>
            b.createdAt.getTime() - a.createdAt.getTime() ||
            a.id.localeCompare(b.id),
        );
      },
    );
  }
}
