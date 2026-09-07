import { z } from "zod";

export const cursorTokenSchema = z
  .string()
  .min(1)
  .max(4096)
  .regex(/^[A-Za-z0-9_-]+$/);

// PostgreSQL timestamps have microsecond precision and no year zero.
export const cursorTimestampSchema = z.iso
  .datetime({ precision: 6 })
  .refine((value) => !value.startsWith("0000-"));
