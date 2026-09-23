import {
  personContactSchema,
  personCreateRequestSchema,
  personUpdateRequestSchema,
  type PersonCreatePayload,
  type PersonResponse,
  type PersonUpdatePayload,
} from "@chronelle/schemas";

export type ContactKind = "email" | "phone" | "other";

export interface PersonFields {
  readonly displayName: string;
  readonly nickname: string;
  readonly description: string;
  readonly contacts: readonly {
    readonly kind: ContactKind;
    readonly value: string;
  }[];
}

export type PersonIssue =
  "name" | "nickname" | "description" | "contact" | "too-many-contacts";

export class PersonValidationError extends Error {
  constructor(readonly issue: PersonIssue) {
    super(issue);
  }
}

export function emptyPersonFields(): PersonFields {
  return { displayName: "", nickname: "", description: "", contacts: [] };
}

export function fieldsFromPerson(person: PersonResponse): PersonFields {
  return {
    displayName: person.displayName,
    nickname: person.nickname ?? "",
    description: person.description ?? "",
    contacts: person.contacts,
  };
}

function normalized(fields: PersonFields) {
  const displayName = fields.displayName.trim();
  const nickname = fields.nickname.trim();
  const description = fields.description.trim();
  const contacts = fields.contacts
    .map((contact) => ({ kind: contact.kind, value: contact.value.trim() }))
    .filter((contact) => contact.value.length > 0);

  if (displayName.length < 1 || displayName.length > 240)
    throw new PersonValidationError("name");
  if (nickname.length > 240) throw new PersonValidationError("nickname");
  if (description.length > 2000) throw new PersonValidationError("description");
  if (contacts.length > 20)
    throw new PersonValidationError("too-many-contacts");
  if (
    contacts.some((contact) => !personContactSchema.safeParse(contact).success)
  )
    throw new PersonValidationError("contact");

  return {
    displayName,
    nickname: nickname || null,
    description: description || null,
    contacts,
  };
}

export function personCreatePayload(
  fields: PersonFields,
  commandId: string,
): PersonCreatePayload {
  return personCreateRequestSchema.parse({ ...normalized(fields), commandId });
}

export function personUpdatePayload(
  fields: PersonFields,
  expectedVersion: number,
): PersonUpdatePayload {
  return personUpdateRequestSchema.parse({
    ...normalized(fields),
    expectedVersion,
  });
}
