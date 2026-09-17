import type { PersonContactKind, PersonResponse } from "@chronelle/schemas";

import { joinLabelIds, splitLabelIds } from "./task-fields";

/** One custom field as the editor holds it: the key and the value's text. */
export interface PersonField {
  readonly key: string;
  readonly value: string;
}

/** One contact row as the editor holds it. */
export interface PersonContactField {
  readonly kind: PersonContactKind;
  readonly value: string;
}

/** The name a person is shown by: the nickname when there is one. */
export function personDisplayName(
  person: Pick<PersonResponse, "displayName" | "nickname">,
): string {
  return person.nickname ?? person.displayName;
}

/**
 * The editor's person fields: the name, the nickname, the description, the
 * linked account, the contacts and the custom properties each as one JSON
 * string of rows, and the labels as joined ids, so an unchanged set
 * compares equal and rows keep their order.
 */
export function readPersonFields(
  person?: Pick<
    PersonResponse,
    | "displayName"
    | "nickname"
    | "description"
    | "userId"
    | "contacts"
    | "labelIds"
    | "customProperties"
  >,
) {
  return {
    displayName: person?.displayName ?? "",
    nickname: person?.nickname ?? "",
    description: person?.description ?? "",
    userId: person?.userId ?? "",
    contacts: joinPersonContacts(person?.contacts ?? []),
    labels: joinLabelIds(person?.labelIds ?? []),
    properties: joinPersonFields(
      Object.entries(person?.customProperties ?? {}).map(([key, value]) => ({
        key,
        value: propertyText(value),
      })),
    ),
  };
}

/** A property value as the editor shows it: text as is, anything else as JSON. */
export function propertyText(value: unknown): string {
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function joinPersonFields(fields: readonly PersonField[]): string {
  return JSON.stringify(fields.map(({ key, value }) => [key, value]));
}

export function splitPersonFields(properties: string): PersonField[] {
  if (properties === "") return [];
  const entries = JSON.parse(properties) as [string, string][];
  return entries.map(([key, value]) => ({ key, value }));
}

export function joinPersonContacts(
  contacts: readonly PersonContactField[],
): string {
  return JSON.stringify(contacts.map(({ kind, value }) => [kind, value]));
}

export function splitPersonContacts(contacts = ""): PersonContactField[] {
  if (contacts === "") return [];
  const entries = JSON.parse(contacts) as [PersonContactKind, string][];
  return entries.map(([kind, value]) => ({ kind, value }));
}

/**
 * The request from the fields: a trimmed name, the nickname and description
 * (null when empty), the linked account (null when none), the contacts with
 * a value, the labels, and the custom properties from the rows with a key;
 * a value that still reads as the source's JSON keeps its original type,
 * any other value is text.
 */
export function personFieldsPayload(
  fields: ReturnType<typeof readPersonFields>,
  source: Pick<PersonResponse, "customProperties"> | undefined,
  te: (key: "fieldRepeats", values: { name: string }) => string,
) {
  const nickname = fields.nickname.trim();
  const description = fields.description.trim();
  const customProperties: Record<string, unknown> = {};
  for (const { key, value } of splitPersonFields(fields.properties)) {
    const name = key.trim();
    if (name === "") continue;
    if (name in customProperties) throw new Error(te("fieldRepeats", { name }));
    const original = source?.customProperties[name];
    customProperties[name] =
      original !== undefined && propertyText(original) === value
        ? original
        : value;
  }
  return {
    displayName: fields.displayName,
    nickname: nickname === "" ? null : nickname,
    description: description === "" ? null : description,
    userId: fields.userId === "" ? null : fields.userId,
    contacts: splitPersonContacts(fields.contacts)
      .map(({ kind, value }) => ({ kind, value: value.trim() }))
      .filter(({ value }) => value !== ""),
    labelIds: splitLabelIds(fields.labels),
    customProperties,
  };
}
