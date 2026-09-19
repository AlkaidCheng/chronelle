import { createHash, randomBytes } from "node:crypto";

/** A fresh invitation token for an invitation link: 32 random bytes, URL-safe. */
export function generateInvitationToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The digest the database keeps in place of the token. */
export function digestInvitationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}
