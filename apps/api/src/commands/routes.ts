import type { ReversibleCommandService } from "@chronelle/object-model";
import {
  commandExecuteRequestSchema,
  commandTransitionRequestSchema,
  commandReceiptSchema,
  commandStateResponseSchema,
} from "@chronelle/schemas";
import type { FastifyInstance } from "fastify";
import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";

export function registerCommandRoutes(
  app: FastifyInstance,
  dependencies: { readonly commands: ReversibleCommandService },
): void {
  app.get("/api/commands", { preHandler: app.authenticate }, async (request) =>
    commandStateResponseSchema.parse(
      await dependencies.commands.getState(requirePrincipal(request)),
    ),
  );
  app.post(
    "/api/commands",
    { preHandler: app.authenticate },
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
      { preHandler: app.authenticate },
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
