import type { z } from "zod";

import { InvalidRequestError } from "./errors.js";

export function parseRequest<Output>(
  schema: z.ZodType<Output>,
  value: unknown,
): Output {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new InvalidRequestError();
  }
  return parsed.data;
}
