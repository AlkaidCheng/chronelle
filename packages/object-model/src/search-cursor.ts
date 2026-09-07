import { Buffer } from "node:buffer";
import type { UserPrincipal } from "@chronelle/authorization";
import {
  objectSearchCursorPayloadSchema,
  objectSearchQuerySchema,
  type ObjectSearchCursorPayload,
} from "@chronelle/schemas";

import { InvalidObjectStateError } from "./errors.js";
import type { ObjectSearchInput } from "./types.js";

type SearchPosition = Pick<
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
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
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
    const bytes = Buffer.from(token, "base64url");
    if (bytes.toString("base64url") !== token)
      throw new Error("Invalid encoding");
    const payload = objectSearchCursorPayloadSchema.parse(
      JSON.parse(bytes.toString("utf8")),
    );
    if (
      payload.userId === principal.userId &&
      payload.workspaceId === principal.workspaceId &&
      payload.query === input.query.trim() &&
      payload.objectType === (input.objectType ?? null)
    )
      return payload;
  } catch {
    // Treat malformed encodings and envelopes as the same invalid position.
  }
  throw new InvalidObjectStateError(
    "The search cursor is invalid for this query.",
  );
}
