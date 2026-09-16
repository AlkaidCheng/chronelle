import { hashCommand } from "./command-hash.js";
import type { CreateObjectFields } from "./types.js";

/**
 * The hash a standalone creation's command is bound to: the object type and
 * every input field but the command id itself. Both backends compute it here
 * so a command replayed through the other backend still matches.
 */
export function createRequestHash(
  objectType: string,
  input: CreateObjectFields,
): string {
  const { commandId: _commandId, ...fields } = input;
  return hashCommand({ objectType, fields });
}
