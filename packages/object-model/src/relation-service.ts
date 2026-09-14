import {
  AuthorizationDeniedError,
  withStableAuthorization,
  type AuthorizationDatabase,
  type AuthorizationService,
  type AuthorizationAction,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  createId,
  objectRelations,
  objects,
  runAuditedMutation,
  type DatabaseTransaction,
  type ObjectType,
  type RelationType,
} from "@chronelle/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import type {
  RelationListQueryInput,
  RemovedRelationQuery,
} from "@chronelle/schemas";
import {
  PostgresRelationReadRepository,
  type RelationPage,
  type RelationReadRepository,
  type RemovedRelationPage,
} from "./relation-list.js";

import {
  InvalidRelationError,
  RelationConflictError,
  ObjectConflictError,
} from "./errors.js";
import type { RelationWriteRepository } from "./object-writes.js";
import type {
  CreateObjectRelationInput,
  MutationContext,
  ObjectRelationResource,
  RelationDeletionResource,
} from "./types.js";

function isCompatibleRelation(
  sourceType: ObjectType,
  relationType: RelationType,
  targetType: ObjectType,
): boolean {
  switch (relationType) {
    case "includes":
      return (
        sourceType === "event" &&
        ["event", "task", "expense", "reminder", "document"].includes(
          targetType,
        )
      );
    case "reminds_about":
      return (
        sourceType === "reminder" &&
        (targetType === "event" || targetType === "task")
      );
    case "attached_to":
      return (
        sourceType === "document" &&
        (targetType === "event" ||
          targetType === "task" ||
          targetType === "expense")
      );
    case "related_to":
      return true;
  }
}

export class ObjectRelationService {
  readonly #clock: () => Date;
  readonly #database: AuthorizationDatabase;
  readonly #reads: RelationReadRepository;
  readonly #writes: RelationWriteRepository | undefined;

  constructor(
    database: AuthorizationDatabase,
    clock: () => Date = () => new Date(),
    writes?: RelationWriteRepository,
    reads?: RelationReadRepository,
  ) {
    this.#database = database;
    this.#clock = clock;
    this.#writes = writes;
    this.#reads = reads ?? new PostgresRelationReadRepository(database);
  }

  async create(
    context: MutationContext,
    input: CreateObjectRelationInput,
  ): Promise<ObjectRelationResource> {
    if (input.sourceObjectId === input.targetObjectId) {
      throw new InvalidRelationError(
        "A relationship must connect two distinct objects.",
      );
    }
    if (this.#writes !== undefined) return this.#writes.create(context, input);

    return withStableAuthorization(
      this.#database,
      context.principal.workspaceId,
      async (transaction, authorization) => {
        const sourceType = await this.#getObjectType(
          transaction,
          authorization,
          context.principal,
          input.sourceObjectId,
          "edit",
        );
        const targetType = await this.#getObjectType(
          transaction,
          authorization,
          context.principal,
          input.targetObjectId,
          "view",
        );
        if (!isCompatibleRelation(sourceType, input.relationType, targetType)) {
          throw new InvalidRelationError(
            "The relationship is not valid for these object types.",
          );
        }

        const relationId = createId();
        return runAuditedMutation(transaction, async (transaction) => {
          const [relation] = await transaction
            .insert(objectRelations)
            .values({
              id: relationId,
              workspaceId: context.principal.workspaceId,
              sourceObjectId: input.sourceObjectId,
              relationType: input.relationType,
              targetObjectId: input.targetObjectId,
              metadata: input.metadata ?? {},
              createdBy: context.principal.userId,
            })
            .onConflictDoNothing()
            .returning();
          if (relation === undefined) {
            throw new RelationConflictError();
          }

          return {
            value: relation,
            audit: {
              workspaceId: context.principal.workspaceId,
              actorType: "user",
              actorId: context.principal.userId,
              action: "relation.created",
              resourceId: input.sourceObjectId,
              requestId: context.requestId,
              metadata: {
                relationId,
                relationType: input.relationType,
                targetObjectId: input.targetObjectId,
              },
            },
          };
        });
      },
    );
  }

  listForObject(
    principal: UserPrincipal,
    objectId: string,
    input: RelationListQueryInput = {},
  ): Promise<RelationPage> {
    return this.#reads.listRelations(principal, objectId, input);
  }

  async softDelete(
    context: MutationContext,
    relationId: string,
    expectedVersion: number,
  ): Promise<RelationDeletionResource> {
    const deletedAt = this.#clock();
    const relation =
      this.#writes === undefined
        ? await this.#changeLifecycle(
            context,
            relationId,
            expectedVersion,
            deletedAt,
          )
        : await this.#writes.remove(
            context,
            relationId,
            expectedVersion,
            deletedAt,
          );
    return { id: relation.id, version: relation.version, deletedAt };
  }

  async recover(
    context: MutationContext,
    relationId: string,
    expectedVersion: number,
  ) {
    if (this.#writes !== undefined)
      return this.#writes.recover(context, relationId, expectedVersion);
    return this.#changeLifecycle(context, relationId, expectedVersion, null);
  }

  listRemoved(
    principal: UserPrincipal,
    objectId: string,
    input: RemovedRelationQuery,
  ): Promise<RemovedRelationPage> {
    return this.#reads.listRemovedRelations(principal, objectId, input);
  }

  async #changeLifecycle(
    context: MutationContext,
    relationId: string,
    expectedVersion: number,
    deletedAt: Date | null,
  ) {
    try {
      return await withStableAuthorization(
        this.#database,
        context.principal.workspaceId,
        async (transaction, authorization) => {
          const [relation] = await transaction
            .select()
            .from(objectRelations)
            .where(
              and(
                eq(objectRelations.workspaceId, context.principal.workspaceId),
                eq(objectRelations.id, relationId),
              ),
            )
            .limit(1);
          if (relation === undefined) throw new AuthorizationDeniedError();
          await authorization.assertCan(context.principal, "edit", {
            id: relation.sourceObjectId,
            workspaceId: context.principal.workspaceId,
          });
          if (deletedAt === null) {
            await authorization.assertCan(context.principal, "view", {
              id: relation.targetObjectId,
              workspaceId: context.principal.workspaceId,
            });
          }
          if (relation.version !== expectedVersion)
            throw new ObjectConflictError();
          if ((relation.deletedAt === null) === (deletedAt === null)) {
            throw new InvalidRelationError(
              "The relationship is already in the requested state.",
            );
          }
          return runAuditedMutation(transaction, async (transaction) => {
            const [saved] = await transaction
              .update(objectRelations)
              .set({
                deletedAt,
                version: sql`${objectRelations.version} + 1`,
              })
              .where(
                and(
                  eq(
                    objectRelations.workspaceId,
                    context.principal.workspaceId,
                  ),
                  eq(objectRelations.id, relationId),
                  eq(objectRelations.version, expectedVersion),
                ),
              )
              .returning();
            if (saved === undefined) throw new ObjectConflictError();
            return {
              value: saved,
              audit: {
                workspaceId: context.principal.workspaceId,
                actorType: "user",
                actorId: context.principal.userId,
                action:
                  deletedAt === null
                    ? "relation.recovered"
                    : "relation.deleted",
                resourceId: relation.sourceObjectId,
                requestId: context.requestId,
                metadata: {
                  relationId,
                  relationType: relation.relationType,
                  targetObjectId: relation.targetObjectId,
                  previousVersion: expectedVersion,
                  version: saved.version,
                },
              },
            };
          });
        },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        typeof error.cause === "object" &&
        error.cause !== null &&
        "code" in error.cause &&
        error.cause.code === "23505"
      )
        throw new RelationConflictError();
      throw error;
    }
  }

  async #getObjectType(
    transaction: DatabaseTransaction,
    authorization: AuthorizationService,
    principal: UserPrincipal,
    objectId: string,
    action: AuthorizationAction,
  ): Promise<ObjectType> {
    await authorization.assertCan(principal, action, {
      id: objectId,
      workspaceId: principal.workspaceId,
    });
    const [object] = await transaction
      .select({ objectType: objects.objectType })
      .from(objects)
      .where(
        and(
          eq(objects.workspaceId, principal.workspaceId),
          eq(objects.id, objectId),
          isNull(objects.deletedAt),
        ),
      )
      .limit(1);
    if (object === undefined) {
      throw new AuthorizationDeniedError();
    }
    return object.objectType;
  }
}

export { isCompatibleRelation };
