import { and, eq, sql } from "drizzle-orm";

import type { Database, DatabaseTransaction } from "./client.js";
import { personContacts, persons, users } from "./schema.js";

/**
 * The account a person card stands for, as chronelle_person_account
 * resolves it: the linked account first, else the one account whose email
 * equals any of the card's email contacts and that lets itself be found
 * by email; null when none or more than one.
 */
export async function personAccountId(
  transaction: Pick<Database | DatabaseTransaction, "select">,
  workspaceId: string,
  personId: string,
): Promise<string | null> {
  const [person] = await transaction
    .select({ userId: persons.userId })
    .from(persons)
    .where(
      and(eq(persons.workspaceId, workspaceId), eq(persons.objectId, personId)),
    )
    .limit(1);
  if (person === undefined) return null;
  if (person.userId !== null) return person.userId;
  const matches = await transaction
    .select({ id: users.id })
    .from(personContacts)
    .innerJoin(
      users,
      and(
        eq(users.email, sql`lower(${personContacts.value})`),
        eq(users.findByEmail, true),
      ),
    )
    .where(
      and(
        eq(personContacts.workspaceId, workspaceId),
        eq(personContacts.personId, personId),
        eq(personContacts.kind, "email"),
      ),
    )
    .groupBy(users.id)
    .limit(2);
  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}
