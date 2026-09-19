import { isDeepStrictEqual } from "node:util";

import type { RevisionFieldChange, RevisionSnapshot } from "@chronelle/schemas";

interface ContentField {
  readonly label: string;
  readonly valueType: RevisionFieldChange["valueType"];
  readonly restorable: boolean;
}

const field = (
  label: string,
  valueType: ContentField["valueType"],
  restorable = true,
): ContentField => ({ label, valueType, restorable });

const typedFields: Record<
  RevisionSnapshot["objectType"],
  Record<string, ContentField>
> = {
  event: {
    startsOn: field("Start date", "text"),
    endsOn: field("End date", "text"),
    startsAt: field("Starts", "datetime"),
    endsAt: field("Ends", "datetime"),
    timezone: field("Time zone", "text"),
    isAllDay: field("All day", "boolean"),
    location: field("Location", "text"),
  },
  task: {
    status: field("Status", "text"),
    dueOn: field("Due date", "text"),
    dueAt: field("Due", "datetime"),
    durationMinutes: field("Duration (minutes)", "text"),
    repeatRule: field("Repeat", "text"),
    repeatUntil: field("Repeat until", "text"),
    parentTaskId: field("Parent task", "text", false),
    assigneeId: field("Assignee", "text", false),
    location: field("Location", "text"),
    rank: field("Order", "text", false),
    labelIds: field("Labels", "text", false),
    completedAt: field("Completed", "datetime"),
  },
  expense: {
    amount: field("Amount", "decimal", false),
    currency: field("Currency", "text", false),
    occurredAt: field("Transaction date", "datetime", false),
  },
  reminder: {
    remindAt: field("Reminder time", "datetime"),
    status: field("Delivery status", "text", false),
    rank: field("Order", "text", false),
  },
  document: {
    originalFilename: field("Original filename", "text", false),
    mimeType: field("File type", "text", false),
    sizeBytes: field("Size in bytes", "decimal", false),
    checksumSha256: field("File checksum", "text", false),
  },
  person: {
    nickname: field("Nickname", "text"),
    description: field("Description", "text"),
    contacts: field("Contacts", "json"),
    userId: field("Linked account", "text", false),
    labelIds: field("Labels", "text", false),
  },
};

/** Compare public content only; permission and storage internals are never inspected. */
export function compareRevisionContent(
  before: RevisionSnapshot,
  after: RevisionSnapshot,
): RevisionFieldChange[] {
  if (before.objectType !== after.objectType)
    throw new Error("Revision types must match.");
  const definitions = {
    displayName: field("Name", "text"),
    ...typedFields[before.objectType],
  };
  const first = before as unknown as Record<string, unknown>;
  const second = after as unknown as Record<string, unknown>;
  const changes: RevisionFieldChange[] = [];
  for (const [key, definition] of Object.entries(definitions)) {
    if (!isDeepStrictEqual(first[key], second[key]))
      changes.push({
        field: key,
        ...definition,
        before: first[key],
        after: second[key],
        beforePresent: true,
        afterPresent: true,
      });
  }
  const keys = [
    ...new Set([
      ...Object.keys(before.customProperties),
      ...Object.keys(after.customProperties),
    ]),
  ].sort();
  for (const key of keys) {
    const beforePresent = Object.hasOwn(before.customProperties, key);
    const afterPresent = Object.hasOwn(after.customProperties, key);
    if (
      beforePresent !== afterPresent ||
      !isDeepStrictEqual(
        before.customProperties[key],
        after.customProperties[key],
      )
    ) {
      changes.push({
        field: `customProperties.${key}`,
        ...field(`Custom property: ${key}`, "json"),
        before: before.customProperties[key] ?? null,
        after: after.customProperties[key] ?? null,
        beforePresent,
        afterPresent,
      });
    }
  }
  return changes;
}

/** A value the initial summary names: set, and not an empty text or list. */
function isSet(value: unknown): boolean {
  if (value === null || value === undefined || value === "") return false;
  return !(Array.isArray(value) && value.length === 0);
}

/**
 * The content a first revision starts with, as changes from nothing: the
 * name, the typed fields that are set (a rank is an ordering key, not
 * content), then the custom properties, each with no earlier value.
 */
export function initialRevisionContent(
  snapshot: RevisionSnapshot,
): RevisionFieldChange[] {
  const definitions = {
    displayName: field("Name", "text"),
    ...typedFields[snapshot.objectType],
  };
  const values = snapshot as unknown as Record<string, unknown>;
  const changes: RevisionFieldChange[] = [];
  for (const [key, definition] of Object.entries(definitions)) {
    if (key === "rank" || !isSet(values[key])) continue;
    changes.push({
      field: key,
      ...definition,
      before: null,
      after: values[key],
      beforePresent: false,
      afterPresent: true,
    });
  }
  for (const key of Object.keys(snapshot.customProperties).sort()) {
    changes.push({
      field: `customProperties.${key}`,
      ...field(`Custom property: ${key}`, "json"),
      before: null,
      after: snapshot.customProperties[key] ?? null,
      beforePresent: false,
      afterPresent: true,
    });
  }
  return changes;
}

export function preservedRevisionFields(
  objectType: RevisionSnapshot["objectType"],
): string[] {
  return [
    "Identity, permissions, relationships, lifecycle state, and system metadata",
    ...Object.values(typedFields[objectType])
      .filter((entry) => !entry.restorable)
      .map((entry) => entry.label),
    ...(objectType === "document" ? ["File bytes and storage location"] : []),
  ];
}

/** Select only content eligible for generic restoration. */
export function selectRestorableContent(
  snapshot: RevisionSnapshot,
): Record<string, unknown> {
  const content: Record<string, unknown> = {
    displayName: snapshot.displayName,
    customProperties: snapshot.customProperties,
  };
  const values = snapshot as unknown as Record<string, unknown>;
  for (const [key, definition] of Object.entries(
    typedFields[snapshot.objectType],
  )) {
    if (definition.restorable) content[key] = values[key];
  }
  return content;
}
