import { Buffer } from "node:buffer";

export function encodeCursor(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

/** Decode a size-validated token; callers validate its envelope and context. */
export function decodeCursor(token: string): unknown {
  const bytes = Buffer.from(token, "base64url");
  if (bytes.toString("base64url") !== token)
    throw new Error("Invalid cursor encoding");
  return JSON.parse(bytes.toString("utf8"));
}
