import type { UserPrincipal } from "@chronelle/authorization";
import {
  objectSearchCursorPayloadSchema,
  objectSearchQuerySchema,
  type ObjectSearchCursorPayload,
} from "@chronelle/schemas";

import { InvalidObjectStateError } from "./errors.js";
import { decodeCursor, encodeCursor } from "./cursor.js";
import type { ObjectSearchInput } from "./types.js";

/** The keyset position of one match: rank, then updated_at at microsecond precision, then id. */
export type SearchPosition = Pick<
  ObjectSearchCursorPayload,
  "id" | "rank" | "updatedAt"
>;

export function encodeSearchCursor(
  principal: UserPrincipal,
  input: ObjectSearchInput,
  position: SearchPosition,
): string {
  const payload: ObjectSearchCursorPayload = {
    formatVersion: 1,
    userId: principal.userId,
    workspaceId: principal.workspaceId,
    query: input.query.trim(),
    objectType: input.objectType ?? null,
    ...position,
  };
  return encodeCursor(payload);
}

export function decodeSearchCursor(
  principal: UserPrincipal,
  input: ObjectSearchInput,
): SearchPosition | undefined {
  if (input.cursor === undefined) return undefined;
  try {
    const token = objectSearchQuerySchema.shape.cursor
      .unwrap()
      .parse(input.cursor);
    const payload = objectSearchCursorPayloadSchema.parse(decodeCursor(token));
    if (
      payload.userId === principal.userId &&
      payload.workspaceId === principal.workspaceId &&
      payload.query === input.query.trim() &&
      payload.objectType === (input.objectType ?? null)
    )
      return {
        id: payload.id,
        rank: payload.rank,
        updatedAt: payload.updatedAt,
      };
  } catch {
    // Treat malformed encodings and envelopes as the same invalid position.
  }
  throw new InvalidObjectStateError(
    "The search cursor is invalid for this query.",
  );
}
