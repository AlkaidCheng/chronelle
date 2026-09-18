import { users, type Database } from "@chronelle/db";
import { eq, sql } from "drizzle-orm";

import { InvalidRequestError, UsernameTakenError } from "../errors.js";

/** The shape a username takes: 3 to 30 letters, digits, hyphens or underscores, starting with a letter. */
export const usernameShape = /^[A-Za-z][A-Za-z0-9_-]{2,29}$/u;

/**
 * A username from a name: its letters and digits, lowercased, with runs of
 * anything else as one hyphen; started with a letter and at least three
 * characters long, "user" when the name gives nothing usable. The same
 * rule as chronelle_username_slug.
 */
export function usernameSlug(displayName: string): string {
  let base = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!/^[a-z]/u.test(base)) base = `u${base}`.replace(/^-+|-+$/gu, "");
  if (base.length < 3) base = "user";
  return base.slice(0, 30);
}

/**
 * The username an account gets: the one it asked for when free and well
 * formed, else the one its name gives, numbered until free. The same rule
 * as chronelle_username_assign.
 */
export async function assignUsername(
  transaction: Pick<Database, "select">,
  displayName: string,
  wanted: string | undefined,
): Promise<string> {
  if (wanted !== undefined) {
    if (!usernameShape.test(wanted)) throw new InvalidRequestError();
    if (await taken(transaction, wanted)) throw new UsernameTakenError();
    return wanted;
  }
  const base = usernameSlug(displayName);
  let candidate = base;
  for (let n = 2; await taken(transaction, candidate); n += 1)
    candidate = `${base.slice(0, 30 - String(n).length)}${n}`;
  return candidate;
}

async function taken(
  transaction: Pick<Database, "select">,
  candidate: string,
): Promise<boolean> {
  const [row] = await transaction
    .select({ id: users.id })
    .from(users)
    .where(eq(sql`lower(${users.username})`, candidate.toLowerCase()))
    .limit(1);
  return row !== undefined;
}
