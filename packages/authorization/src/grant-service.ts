import {
  createId,
  objects,
  personAccountId,
  persons,
  resourceGrants,
  runAuditedMutation,
  sections,
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
  type ShareScope,
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

/**
 * The grantee is an account email, a Person, a friend, or the id of an
 * account that already holds a grant on the resource; exactly one is
 * named. A `scope` narrows the share to one view of an Event, and to one
 * of the view's sections when it names one.
 */
export interface ShareResourceInput {
  readonly principalEmail?: string | undefined;
  readonly personId?: string | undefined;
  /** An accepted connection of the acting account; the other side receives the role. */
  readonly friendId?: string | undefined;
  /** An account already granted on the resource, as the share sheet changes its role. */
  readonly principalId?: string | undefined;
  readonly resourceId: string;
  readonly role: Role;
  readonly scope?: ShareScope | undefined;
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
  /** The view and section the grant is narrowed to; null for the whole resource. */
  readonly scope: ShareScope | null;
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
  "Name exactly one of principalEmail, personId, friendId, and principalId.";

/** The grant's narrowing as the API reads it. */
export function grantScopeOf(grant: {
  readonly scope: string;
  readonly sectionId: string | null;
}): ShareScope | null {
  return grant.scope === "all"
    ? null
    : { view: grant.scope as ShareScope["view"], sectionId: grant.sectionId };
}

/**
 * A narrowed share names an Event, and its section belongs to that
 * Event's view of the same name.
 */
async function assertScope(
  transaction: DatabaseTransaction,
  principal: UserPrincipal,
  input: ShareResourceInput,
): Promise<void> {
  if (input.scope === undefined) return;
  const [event] = await transaction
    .select({ id: objects.id })
    .from(objects)
    .where(
      and(
        eq(objects.workspaceId, principal.workspaceId),
        eq(objects.id, input.resourceId),
        eq(objects.objectType, "event"),
      ),
    )
    .limit(1);
  if (event === undefined)
    throw new InvalidShareError("A share narrowed to a view names an Event.");
  if (input.scope.sectionId === null) return;
  const [section] = await transaction
    .select({ id: sections.id })
    .from(sections)
    .where(
      and(
        eq(sections.id, input.scope.sectionId),
        eq(sections.workspaceId, principal.workspaceId),
        eq(sections.eventId, input.resourceId),
        eq(sections.view, input.scope.view as "todos" | "expenses"),
      ),
    )
    .limit(1);
  if (section === undefined)
    throw new InvalidShareError(
      "The section is not a section of that view of the Event.",
    );
}

/**
 * The account a share goes to: the one user with the named email, the
 * account the named Person stands for (its link, else the one account one
 * of its email contacts reaches that can be found by email), or the other
 * side of the caller's accepted connection. A person the caller cannot
 * view, or with no reachable account, and a connection that is not the
 * caller's and accepted, are as unavailable as an unknown email.
 */
async function resolvePrincipal(
  transaction: DatabaseTransaction,
  authorization: AuthorizationService,
  principal: UserPrincipal,
  input: ShareResourceInput,
): Promise<{ id: string; displayName: string; email: string | null }> {
  const named = [
    input.principalEmail,
    input.personId,
    input.friendId,
    input.principalId,
  ].filter((grantee) => grantee !== undefined).length;
  if (named !== 1) throw new InvalidShareError(granteeRule);
  if (input.principalId !== undefined) {
    const [account] = await transaction
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .innerJoin(
        resourceGrants,
        and(
          eq(resourceGrants.workspaceId, principal.workspaceId),
          eq(resourceGrants.resourceId, input.resourceId),
          eq(resourceGrants.principalType, "user"),
          eq(resourceGrants.principalId, users.id),
        ),
      )
      .where(eq(users.id, input.principalId))
      .limit(1);
    if (account === undefined) throw new PrincipalUnavailableError();
    return account;
  }
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
      .select({ objectId: persons.objectId })
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
    const accountId = await personAccountId(
      transaction,
      principal.workspaceId,
      person.objectId,
    );
    if (accountId === null) throw new PrincipalUnavailableError();
    const [account] = await transaction
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
      })
      .from(users)
      .where(eq(users.id, accountId))
      .limit(1);
    if (account === undefined) throw new PrincipalUnavailableError();
    return account;
  }
  if (input.principalEmail === undefined)
    throw new InvalidShareError(granteeRule);
  const [found, duplicate] = await transaction
    .select({
      id: users.id,
      displayName: users.displayName,
      email: users.email,
    })
    .from(users)
    .where(eq(users.email, input.principalEmail))
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
        await assertScope(transaction, context.principal, input);
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
                scope: input.scope?.view ?? "all",
                sectionId: input.scope?.sectionId ?? null,
              })
              .onConflictDoUpdate({
                target: [
                  resourceGrants.workspaceId,
                  resourceGrants.resourceId,
                  resourceGrants.principalType,
                  resourceGrants.principalId,
                  resourceGrants.scopeKey,
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
                  ...(input.scope === undefined ? {} : { scope: input.scope }),
                },
              },
            };
          },
        );

        return { ...grant, scope: grantScopeOf(grant), principal };
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
