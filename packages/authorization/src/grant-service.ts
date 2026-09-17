import {
  createId,
  objects,
  persons,
  resourceGrants,
  runAuditedMutation,
  userConnections,
  users,
  type Database,
  type DatabaseTransaction,
  type Role,
} from "@chronelle/db";
import { and, eq, isNull, or } from "drizzle-orm";

import {
  AuthorizationDeniedError,
  type AuthorizationService,
  type UserPrincipal,
} from "./authorization.js";
import { withStableAuthorization } from "./authorization-transaction.js";
import {
  PostgresGrantReadRepository,
  type GrantReadRepository,
} from "./grant-reads.js";

export class PrincipalUnavailableError extends Error {
  constructor() {
    super("The requested user is unavailable.");
    this.name = "PrincipalUnavailableError";
  }
}

export class InvalidShareError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidShareError";
  }
}

export interface GrantMutationContext {
  readonly principal: UserPrincipal;
  readonly requestId: string;
}

/** The grantee is an account email, a Person, or a friend; exactly one is named. */
export interface ShareResourceInput {
  readonly principalEmail?: string | undefined;
  readonly personId?: string | undefined;
  /** An accepted connection of the acting account; the other side receives the role. */
  readonly friendId?: string | undefined;
  readonly resourceId: string;
  readonly role: Role;
}

export interface ResourceGrantResource {
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly grantedBy: string;
  readonly id: string;
  readonly principal: {
    readonly displayName: string;
    readonly email: string | null;
    readonly id: string;
  };
  readonly resourceId: string;
  readonly role: Role;
  readonly workspaceId: string;
}

export interface RevokedGrantResource {
  readonly id: string;
  readonly revokedAt: Date;
}

/**
 * Share writes: granting a role to a user and revoking a grant, each with
 * its audit event. Implementations own the transaction; the service keeps
 * its clock for the revocation instant.
 */
export interface ShareWriteRepository {
  share(
    context: GrantMutationContext,
    input: ShareResourceInput,
  ): Promise<ResourceGrantResource>;
  revoke(
    context: GrantMutationContext,
    grantId: string,
    revokedAt: Date,
  ): Promise<RevokedGrantResource>;
}

const granteeRule =
  "Name exactly one of principalEmail, personId, and friendId.";

/**
 * The account a share goes to: the one user with the named email, the
 * named Person's linked account (else the one user with the person's
 * email), or the other side of the caller's accepted connection. A person
 * the caller cannot view, or with no reachable account, and a connection
 * that is not the caller's and accepted, are as unavailable as an unknown
 * email.
 */
async function resolvePrincipal(
  transaction: DatabaseTransaction,
  authorization: AuthorizationService,
  principal: UserPrincipal,
  input: ShareResourceInput,
): Promise<{ id: string; displayName: string; email: string | null }> {
  const named = [input.principalEmail, input.personId, input.friendId].filter(
    (grantee) => grantee !== undefined,
  ).length;
  if (named !== 1) throw new InvalidShareError(granteeRule);
  let email = input.principalEmail;
  if (input.friendId !== undefined) {
    const [connection] = await transaction
      .select({
        requesterId: userConnections.requesterId,
        addresseeId: userConnections.addresseeId,
      })
      .from(userConnections)
      .where(
        and(
          eq(userConnections.id, input.friendId),
          eq(userConnections.status, "accepted"),
          or(
            eq(userConnections.requesterId, principal.userId),
            eq(userConnections.addresseeId, principal.userId),
          ),
        ),
      )
      .limit(1);
    if (connection === undefined) throw new PrincipalUnavailableError();
    const [friend] = await transaction
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .where(
        eq(
          users.id,
          connection.requesterId === principal.userId
            ? connection.addresseeId
            : connection.requesterId,
        ),
      )
      .limit(1);
    if (friend === undefined) throw new PrincipalUnavailableError();
    return friend;
  }
  if (input.personId !== undefined) {
    const [person] = await transaction
      .select({ userId: persons.userId, email: persons.email })
      .from(persons)
      .innerJoin(
        objects,
        and(
          eq(objects.id, persons.objectId),
          eq(objects.workspaceId, persons.workspaceId),
        ),
      )
      .where(
        and(
          eq(persons.workspaceId, principal.workspaceId),
          eq(persons.objectId, input.personId),
          isNull(objects.deletedAt),
          authorization.resourcePredicate(principal, "view"),
        ),
      )
      .limit(1);
    if (person === undefined) throw new PrincipalUnavailableError();
    if (person.userId !== null) {
      const [linked] = await transaction
        .select({
          id: users.id,
          displayName: users.displayName,
          email: users.email,
        })
        .from(users)
        .where(eq(users.id, person.userId))
        .limit(1);
      if (linked === undefined) throw new PrincipalUnavailableError();
      return linked;
    }
    if (person.email === null) throw new PrincipalUnavailableError();
    email = person.email.toLowerCase();
  }
  if (email === undefined) throw new InvalidShareError(granteeRule);
  const [found, duplicate] = await transaction
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
    })
    .from(users)
    .where(eq(users.email, email))
    .limit(2);
  if (found === undefined || duplicate !== undefined)
    throw new PrincipalUnavailableError();
  return found;
}

export class ResourceGrantService {
  readonly #clock: () => Date;
  readonly #database: Database;
  readonly #writes: ShareWriteRepository | undefined;
  readonly #reads: GrantReadRepository;

  constructor(
    database: Database,
    clock: () => Date = () => new Date(),
    writes?: ShareWriteRepository,
    reads?: GrantReadRepository,
  ) {
    this.#database = database;
    this.#clock = clock;
    this.#writes = writes;
    this.#reads = reads ?? new PostgresGrantReadRepository(database, clock);
  }

  async share(
    context: GrantMutationContext,
    input: ShareResourceInput,
  ): Promise<ResourceGrantResource> {
    if (this.#writes !== undefined) return this.#writes.share(context, input);
    return withStableAuthorization(
      this.#database,
      context.principal.workspaceId,
      async (transaction, authorization) => {
        await authorization.assertCan(context.principal, "share", {
          id: input.resourceId,
          workspaceId: context.principal.workspaceId,
        });
        const principal = await resolvePrincipal(
          transaction,
          authorization,
          context.principal,
          input,
        );
        if (principal.id === context.principal.userId) {
          throw new InvalidShareError(
            "A resource cannot be shared with the acting user.",
          );
        }

        const grant = await runAuditedMutation(
          transaction,
          async (transaction) => {
            const [persisted] = await transaction
              .insert(resourceGrants)
              .values({
                id: createId(),
                workspaceId: context.principal.workspaceId,
                resourceId: input.resourceId,
                principalId: principal.id,
                role: input.role,
                grantedBy: context.principal.userId,
              })
              .onConflictDoUpdate({
                target: [
                  resourceGrants.workspaceId,
                  resourceGrants.resourceId,
                  resourceGrants.principalType,
                  resourceGrants.principalId,
                ],
                set: {
                  role: input.role,
                  grantedBy: context.principal.userId,
                  expiresAt: null,
                },
              })
              .returning();
            if (persisted === undefined) {
              throw new Error("Grant persistence did not return a resource.");
            }

            return {
              value: persisted,
              audit: {
                workspaceId: context.principal.workspaceId,
                actorType: "user",
                actorId: context.principal.userId,
                action: "resource.shared",
                resourceId: input.resourceId,
                requestId: context.requestId,
                metadata: {
                  grantId: persisted.id,
                  principalId: principal.id,
                  role: persisted.role,
                  ...(input.personId === undefined
                    ? {}
                    : { personId: input.personId }),
                  ...(input.friendId === undefined
                    ? {}
                    : { friendId: input.friendId }),
                },
              },
            };
          },
        );

        return { ...grant, principal };
      },
    );
  }

  list(
    principal: UserPrincipal,
    resourceId: string,
  ): Promise<readonly ResourceGrantResource[]> {
    return this.#reads.listGrants(principal, resourceId);
  }

  async revoke(
    context: GrantMutationContext,
    grantId: string,
  ): Promise<RevokedGrantResource> {
    if (this.#writes !== undefined)
      return this.#writes.revoke(context, grantId, this.#clock());
    return withStableAuthorization(
      this.#database,
      context.principal.workspaceId,
      async (transaction, authorization) => {
        const [grant] = await transaction
          .select({
            id: resourceGrants.id,
            resourceId: resourceGrants.resourceId,
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
              eq(resourceGrants.workspaceId, context.principal.workspaceId),
              eq(resourceGrants.id, grantId),
            ),
          )
          .limit(1);
        if (grant === undefined) {
          throw new AuthorizationDeniedError();
        }
        await authorization.assertCan(context.principal, "recover", {
          id: grant.resourceId,
          workspaceId: context.principal.workspaceId,
        });

        const revokedAt = this.#clock();
        return runAuditedMutation(transaction, async (transaction) => {
          const [deleted] = await transaction
            .delete(resourceGrants)
            .where(
              and(
                eq(resourceGrants.workspaceId, context.principal.workspaceId),
                eq(resourceGrants.id, grantId),
              ),
            )
            .returning({ id: resourceGrants.id });
          if (deleted === undefined) {
            throw new AuthorizationDeniedError();
          }

          return {
            value: { id: deleted.id, revokedAt },
            audit: {
              workspaceId: context.principal.workspaceId,
              actorType: "user",
              actorId: context.principal.userId,
              action: "resource.share_revoked",
              resourceId: grant.resourceId,
              requestId: context.requestId,
              metadata: { grantId: deleted.id },
            },
          };
        });
      },
    );
  }
}
