import {
  AuthorizationDeniedError,
  type AuthorizationAction,
  type AuthorizationService,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  createId,
  objectRelations,
  objects,
  runAuditedMutation,
  type Database,
  type DatabaseTransaction,
  type ObjectType,
  type RelationType,
} from "@chronelle/db";
import { and, eq, isNull, or } from "drizzle-orm";

import { InvalidRelationError, RelationConflictError } from "./errors.js";
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
  readonly #authorization: AuthorizationService;
  readonly #clock: () => Date;
  readonly #database: Database | DatabaseTransaction;

  constructor(
    database: Database | DatabaseTransaction,
    authorization: AuthorizationService,
    clock: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#authorization = authorization;
    this.#clock = clock;
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

    const sourceType = await this.#getObjectType(
      context.principal,
      input.sourceObjectId,
      "edit",
    );
    const targetType = await this.#getObjectType(
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
    return runAuditedMutation(this.#database, async (transaction) => {
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
  }

  async listForObject(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<readonly ObjectRelationResource[]> {
    await this.#authorization.assertCan(principal, "view", {
      id: objectId,
      workspaceId: principal.workspaceId,
    });
    const relations = await this.#database
      .select()
      .from(objectRelations)
      .where(
        and(
          eq(objectRelations.workspaceId, principal.workspaceId),
          isNull(objectRelations.deletedAt),
          or(
            eq(objectRelations.sourceObjectId, objectId),
            eq(objectRelations.targetObjectId, objectId),
          ),
        ),
      );

    const visibility = await Promise.all(
      relations.map((relation) => {
        const otherObjectId =
          relation.sourceObjectId === objectId
            ? relation.targetObjectId
            : relation.sourceObjectId;
        return this.#authorization.can(principal, "view", {
          id: otherObjectId,
          workspaceId: principal.workspaceId,
        });
      }),
    );
    return relations.filter((_, index) => visibility[index]);
  }

  async softDelete(
    context: MutationContext,
    relationId: string,
  ): Promise<RelationDeletionResource> {
    const [relation] = await this.#database
      .select()
      .from(objectRelations)
      .where(
        and(
          eq(objectRelations.workspaceId, context.principal.workspaceId),
          eq(objectRelations.id, relationId),
          isNull(objectRelations.deletedAt),
        ),
      )
      .limit(1);
    if (relation === undefined) {
      throw new AuthorizationDeniedError();
    }
    await this.#authorization.assertCan(context.principal, "edit", {
      id: relation.sourceObjectId,
      workspaceId: context.principal.workspaceId,
    });

    const deletedAt = this.#clock();
    return runAuditedMutation(this.#database, async (transaction) => {
      const [deleted] = await transaction
        .update(objectRelations)
        .set({ deletedAt })
        .where(
          and(
            eq(objectRelations.workspaceId, context.principal.workspaceId),
            eq(objectRelations.id, relationId),
            isNull(objectRelations.deletedAt),
          ),
        )
        .returning({ id: objectRelations.id });
      if (deleted === undefined) {
        throw new AuthorizationDeniedError();
      }

      return {
        value: { id: deleted.id, deletedAt },
        audit: {
          workspaceId: context.principal.workspaceId,
          actorType: "user",
          actorId: context.principal.userId,
          action: "relation.deleted",
          resourceId: relation.sourceObjectId,
          requestId: context.requestId,
          metadata: {
            relationId,
            relationType: relation.relationType,
            targetObjectId: relation.targetObjectId,
          },
        },
      };
    });
  }

  async #getObjectType(
    principal: UserPrincipal,
    objectId: string,
    action: AuthorizationAction,
  ): Promise<ObjectType> {
    await this.#authorization.assertCan(principal, action, {
      id: objectId,
      workspaceId: principal.workspaceId,
    });
    const [object] = await this.#database
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
