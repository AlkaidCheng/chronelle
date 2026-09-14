import { createHash, randomInt } from "node:crypto";

import type { VerificationPurpose } from "@chronelle/db";

/** Six decimal digits, typed by the user; the attempt limit bounds guessing. */
export function generateVerificationCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

/** The digest a code is stored and compared under, bound to its user and purpose. */
export function hashVerificationCode(
  userId: string,
  purpose: VerificationPurpose,
  code: string,
): string {
  return createHash("sha256")
    .update(`${userId}:${purpose}:${code.trim()}`)
    .digest("hex");
}
