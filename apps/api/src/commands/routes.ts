import type { ReversibleCommandService } from "@livtales/object-model";
import {
  commandExecuteRequestSchema,
  commandTransitionRequestSchema,
  commandReceiptSchema,
  commandStateResponseSchema,
} from "@livtales/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";

/**
 * A caller's command stack lives in the workspace of the objects its
 * commands change, so an edit to a shared object is saved, undone, and
 * redone where that object lives. A command follows the object its first
 * edit names; the stack and its transitions follow the object named by
 * `objectId`, or stay in the session's workspace without one.
 */
const followsEditedObject = (request: FastifyRequest) =>
  (request.body as { edits?: { objectId?: unknown }[] } | null | undefined)
    ?.edits?.[0]?.objectId;
const followsNamedObject = (request: FastifyRequest) =>
  (request.query as { objectId?: unknown } | null | undefined)?.objectId;

export function registerCommandRoutes(
  app: FastifyInstance,
  dependencies: { readonly commands: ReversibleCommandService },
): void {
  app.get(
    "/api/commands",
    {
      preHandler: app.authenticate,
      config: { followsObject: followsNamedObject },
    },
    async (request) =>
      commandStateResponseSchema.parse(
        await dependencies.commands.getState(requirePrincipal(request)),
      ),
  );
  app.post(
    "/api/commands",
    {
      preHandler: app.authenticate,
      config: { followsObject: followsEditedObject },
    },
    async (request) => {
      const input = parseRequest(commandExecuteRequestSchema, request.body);
      return commandReceiptSchema.parse(
        await dependencies.commands.execute(
          { principal: requirePrincipal(request), requestId: request.id },
          input,
        ),
      );
    },
  );
  for (const direction of ["undo", "redo"] as const) {
    app.post(
      `/api/commands/${direction}`,
      {
        preHandler: app.authenticate,
        config: { followsObject: followsNamedObject },
      },
      async (request) => {
        const input = parseRequest(
          commandTransitionRequestSchema,
          request.body,
        );
        return commandReceiptSchema.parse(
          await dependencies.commands[direction](
            { principal: requirePrincipal(request), requestId: request.id },
            input,
          ),
        );
      },
    );
  }
}
