import {
  createId,
  objects,
  resourceGrants,
  runAuditedMutation,
  users,
  type Database,
  type Role,
} from "@chronelle/db";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";

import {
  AuthorizationDeniedError,
  type AuthorizationService,
  type UserPrincipal,
} from "./authorization.js";
import { withStableAuthorization } from "./authorization-transaction.js";

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

export interface ShareResourceInput {
  readonly principalEmail: string;
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

export class ResourceGrantService {
  readonly #authorization: AuthorizationService;
  readonly #clock: () => Date;
  readonly #database: Database;

  constructor(
    database: Database,
    authorization: AuthorizationService,
    clock: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#authorization = authorization;
    this.#clock = clock;
  }

  async share(
    context: GrantMutationContext,
    input: ShareResourceInput,
  ): Promise<ResourceGrantResource> {
    return withStableAuthorization(
      this.#database,
      context.principal.workspaceId,
      async (transaction, authorization) => {
        await authorization.assertCan(context.principal, "share", {
          id: input.resourceId,
          workspaceId: context.principal.workspaceId,
        });
        const [principal, duplicatePrincipal] = await transaction
          .select({
            id: users.id,
            displayName: users.displayName,
            email: users.email,
          })
          .from(users)
          .where(eq(users.email, input.principalEmail))
          .limit(2);
        if (principal === undefined || duplicatePrincipal !== undefined) {
          throw new PrincipalUnavailableError();
        }
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
                },
              },
            };
          },
        );

        return { ...grant, principal };
      },
    );
  }

  async list(
    principal: UserPrincipal,
    resourceId: string,
  ): Promise<readonly ResourceGrantResource[]> {
    await this.#assertCanShare(principal, resourceId);
    const grants = await this.#database
      .select({
        id: resourceGrants.id,
        workspaceId: resourceGrants.workspaceId,
        resourceId: resourceGrants.resourceId,
        role: resourceGrants.role,
        grantedBy: resourceGrants.grantedBy,
        createdAt: resourceGrants.createdAt,
        expiresAt: resourceGrants.expiresAt,
        principalId: users.id,
        principalDisplayName: users.displayName,
        principalEmail: users.email,
      })
      .from(resourceGrants)
      .innerJoin(users, eq(users.id, resourceGrants.principalId))
      .where(
        and(
          eq(resourceGrants.workspaceId, principal.workspaceId),
          eq(resourceGrants.resourceId, resourceId),
          or(
            isNull(resourceGrants.expiresAt),
            gt(resourceGrants.expiresAt, this.#clock()),
          ),
        ),
      )
      .orderBy(asc(resourceGrants.createdAt), asc(resourceGrants.id));

    return grants.map((grant) => ({
      id: grant.id,
      workspaceId: grant.workspaceId,
      resourceId: grant.resourceId,
      role: grant.role,
      grantedBy: grant.grantedBy,
      createdAt: grant.createdAt,
      expiresAt: grant.expiresAt,
      principal: {
        id: grant.principalId,
        displayName: grant.principalDisplayName,
        email: grant.principalEmail,
      },
    }));
  }

  async revoke(
    context: GrantMutationContext,
    grantId: string,
  ): Promise<RevokedGrantResource> {
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
              isNull(objects.deletedAt),
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
        await authorization.assertCan(context.principal, "share", {
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

  async #assertCanShare(
    principal: UserPrincipal,
    resourceId: string,
  ): Promise<void> {
    await this.#authorization.assertCan(principal, "share", {
      id: resourceId,
      workspaceId: principal.workspaceId,
    });
  }
}
