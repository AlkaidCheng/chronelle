import { z } from "zod";

import { buildApp } from "./app.js";

const runtimeEnvironmentSchema = z.object({
  API_HOST: z.string().min(1).default("0.0.0.0"),
  API_PORT: z.coerce.number().int().positive().max(65_535).default(4000),
});

const runtimeEnvironment = runtimeEnvironmentSchema.parse(process.env);
const app = buildApp({ logger: true });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void app.close();
  });
}

try {
  await app.listen({
    host: runtimeEnvironment.API_HOST,
    port: runtimeEnvironment.API_PORT,
  });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
