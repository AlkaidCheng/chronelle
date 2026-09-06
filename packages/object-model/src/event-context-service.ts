import { withStableAuthorization } from "@chronelle/authorization";
import {
  eventContextCommands,
  objectRevisions,
  type Database,
} from "@chronelle/db";
import {
  eventPlanningResourceResponseSchema,
  type EventContextCreateRequest,
} from "@chronelle/schemas";
import { and, eq } from "drizzle-orm";

import { CommandConflictError, InvalidObjectStateError } from "./errors.js";
import { EventPlanningObjectService } from "./object-service.js";
import { ObjectRelationService } from "./relation-service.js";
import { serializeResource } from "./serialization.js";
import type { MutationContext } from "./types.js";
import { hashCommand } from "./command-hash.js";

export class EventContextService {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  /** Create and include one resource once per user/workspace command, without replaying later changes. */
  async create(
    context: MutationContext,
    eventId: string,
    input: EventContextCreateRequest,
  ) {
    const { principal } = context;
    const requestHash = hashCommand({
      eventId,
      resource: input.resource,
      relationMetadata: input.relationMetadata ?? {},
    });
    return withStableAuthorization(
      this.#database,
      principal.workspaceId,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "edit", {
          id: eventId,
          workspaceId: principal.workspaceId,
        });
        const objects = new EventPlanningObjectService(
          transaction,
          authorization,
        );
        const event = await objects.getEvent(principal, eventId);
        if (event.permissionScopeId !== event.id)
          throw new InvalidObjectStateError(
            "The context must be a self-scoped Event.",
          );

        const [existing] = await transaction
          .select()
          .from(eventContextCommands)
          .where(
            and(
              eq(eventContextCommands.workspaceId, principal.workspaceId),
              eq(eventContextCommands.userId, principal.userId),
              eq(eventContextCommands.commandId, input.commandId),
            ),
          )
          .limit(1);
        if (existing !== undefined) {
          if (existing.requestHash !== requestHash)
            throw new CommandConflictError();
          await authorization.assertCan(principal, "view", {
            id: existing.objectId,
            workspaceId: principal.workspaceId,
          });
          const [revision] = await transaction
            .select()
            .from(objectRevisions)
            .where(
              and(
                eq(objectRevisions.workspaceId, principal.workspaceId),
                eq(objectRevisions.objectId, existing.objectId),
                eq(objectRevisions.objectVersion, 1),
              ),
            )
            .limit(1);
          if (revision === undefined || revision.snapshotSchemaVersion !== 1)
            throw new Error("The command result revision is unavailable.");
          return {
            resource: eventPlanningResourceResponseSchema.parse(
              revision.snapshot,
            ),
            relationId: existing.relationId,
          };
        }

        const fields = { ...input.resource, permissionScopeId: event.id };
        const resource = await (async () => {
          switch (fields.objectType) {
            case "event":
              return objects.createEvent(context, fields);
            case "task":
              return objects.createTask(context, fields);
            case "expense":
              return objects.createExpense(context, fields);
            case "reminder":
              return objects.createReminder(context, fields);
          }
        })();
        const relation = await new ObjectRelationService(
          transaction,
          authorization,
        ).create(context, {
          sourceObjectId: eventId,
          targetObjectId: resource.id,
          relationType: "includes",
          metadata: input.relationMetadata,
        });
        await transaction.insert(eventContextCommands).values({
          workspaceId: principal.workspaceId,
          userId: principal.userId,
          commandId: input.commandId,
          requestId: context.requestId,
          requestHash,
          contextObjectId: eventId,
          objectId: resource.id,
          relationId: relation.id,
        });
        return {
          resource: serializeResource(resource),
          relationId: relation.id,
        };
      },
    );
  }
}
