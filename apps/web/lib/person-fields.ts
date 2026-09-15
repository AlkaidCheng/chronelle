import type { PersonResponse } from "@chronelle/schemas";

/** One custom field as the editor holds it: the key and the value's text. */
export interface PersonField {
  readonly key: string;
  readonly value: string;
}

/**
 * The editor's person fields: the name, the email, the linked account, and
 * the custom properties as one JSON string of `[key, value]` entries, so an
 * unchanged set compares equal and rows keep their order.
 */
export function readPersonFields(
  person?: Pick<
    PersonResponse,
    "displayName" | "email" | "userId" | "customProperties"
  >,
) {
  return {
    displayName: person?.displayName ?? "",
    email: person?.email ?? "",
    userId: person?.userId ?? "",
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

/**
 * The request from the fields: a trimmed name and email (null when empty),
 * the linked account (null when none), and the custom properties from the
 * rows with a key; a value that still reads as the source's JSON keeps its
 * original type, any other value is text.
 */
export function personFieldsPayload(
  fields: ReturnType<typeof readPersonFields>,
  source?: Pick<PersonResponse, "customProperties">,
) {
  const email = fields.email.trim();
  const customProperties: Record<string, unknown> = {};
  for (const { key, value } of splitPersonFields(fields.properties)) {
    const name = key.trim();
    if (name === "") continue;
    if (name in customProperties) throw new Error(`Field ${name} repeats.`);
    const original = source?.customProperties[name];
    customProperties[name] =
      original !== undefined && propertyText(original) === value
        ? original
        : value;
  }
  return {
    displayName: fields.displayName,
    email: email === "" ? null : email,
    userId: fields.userId === "" ? null : fields.userId,
    customProperties,
  };
}
