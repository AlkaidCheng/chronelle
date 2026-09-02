import Fastify, {
  type FastifyInstance,
  type FastifyServerOptions,
} from "fastify";

import { healthStatusSchema } from "@chronelle/schemas";

export function buildApp(options: FastifyServerOptions = {}): FastifyInstance {
  const app = Fastify(options);

  app.get("/api/health", async () =>
    healthStatusSchema.parse({
      service: "chronelle-api",
      status: "ok",
      timestamp: new Date().toISOString(),
    }),
  );

  return app;
}
