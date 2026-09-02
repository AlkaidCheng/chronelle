import { z } from "zod";

export const healthStatusSchema = z.object({
  service: z.literal("chronelle-api"),
  status: z.literal("ok"),
  timestamp: z.iso.datetime(),
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
