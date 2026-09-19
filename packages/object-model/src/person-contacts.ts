import {
  createId,
  personContactKinds,
  personContacts,
  type DatabaseTransaction,
} from "@chronelle/db";
import { and, asc, eq } from "drizzle-orm";

import { InvalidObjectStateError } from "./errors.js";
import type { PersonContact } from "./types.js";

/** The most contacts a Person keeps. */
export const personContactLimit = 20;

/** The first email contact, the address an invitation from the card goes to. */
export function firstPersonEmail(
  contacts: readonly PersonContact[],
): string | null {
  return contacts.find((contact) => contact.kind === "email")?.value ?? null;
}

/** A list of at most twenty entries, each value trimmed and non-empty, an email entry a valid address. */
export function assertPersonContacts(contacts: readonly PersonContact[]): void {
  if (contacts.length > personContactLimit)
    throw new InvalidObjectStateError(
      `contacts holds at most ${personContactLimit} entries.`,
    );
  for (const contact of contacts) {
    if (!personContactKinds.includes(contact.kind))
      throw new InvalidObjectStateError(
        "A contact kind is email, phone, or other.",
      );
    if (contact.kind === "email") {
      if (
        contact.value !== contact.value.trim() ||
        contact.value.length < 3 ||
        contact.value.length > 254 ||
        contact.value.indexOf("@") < 1
      )
        throw new InvalidObjectStateError("email must be a valid address.");
    } else if (
      contact.value !== contact.value.trim() ||
      contact.value === "" ||
      contact.value.length > 254
    )
      throw new InvalidObjectStateError(
        "A contact value is 1 to 254 characters without surrounding spaces.",
      );
  }
}

/** A nickname is 1 to 240 characters and a description 1 to 2000, neither with surrounding spaces. */
export function assertPersonText(
  nickname: string | null,
  description: string | null,
): void {
  if (
    nickname !== null &&
    (nickname !== nickname.trim() || nickname === "" || nickname.length > 240)
  )
    throw new InvalidObjectStateError(
      "nickname is 1 to 240 characters without surrounding spaces.",
    );
  if (
    description !== null &&
    (description !== description.trim() ||
      description === "" ||
      description.length > 2000)
  )
    throw new InvalidObjectStateError(
      "description is 1 to 2000 characters without surrounding spaces.",
    );
}

/** A Person's contacts in kept order. */
export async function readPersonContacts(
  transaction: DatabaseTransaction,
  workspaceId: string,
  personId: string,
): Promise<PersonContact[]> {
  const rows = await transaction
    .select({ kind: personContacts.kind, value: personContacts.value })
    .from(personContacts)
    .where(
      and(
        eq(personContacts.workspaceId, workspaceId),
        eq(personContacts.personId, personId),
      ),
    )
    .orderBy(asc(personContacts.position));
  return rows;
}

/** Replaces a Person's contacts. */
export async function setPersonContacts(
  transaction: DatabaseTransaction,
  workspaceId: string,
  personId: string,
  contacts: readonly PersonContact[],
): Promise<void> {
  assertPersonContacts(contacts);
  await transaction
    .delete(personContacts)
    .where(
      and(
        eq(personContacts.workspaceId, workspaceId),
        eq(personContacts.personId, personId),
      ),
    );
  if (contacts.length > 0)
    await transaction.insert(personContacts).values(
      contacts.map((contact, position) => ({
        id: createId(),
        workspaceId,
        personId,
        kind: contact.kind,
        value: contact.value,
        position,
      })),
    );
}
