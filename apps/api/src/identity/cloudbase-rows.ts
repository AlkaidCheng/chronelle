import type {
  EventTabsRow,
  RailPreferenceRow,
  UserRow,
  UserSessionRow,
  WorkspaceRow,
} from "@chronelle/db";

/** A gateway row: the table's columns as JSON. */
export type CloudBaseRow = Record<string, unknown>;

export function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return value;
}

export function nullableText(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : text(value, field);
}

export function instant(value: unknown, field: string): Date {
  const parsed = new Date(text(value, field));
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return parsed;
}

export function nullableInstant(value: unknown, field: string): Date | null {
  return value === null || value === undefined ? null : instant(value, field);
}

export function flag(value: unknown, field: string): boolean {
  if (typeof value !== "boolean")
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return value;
}

function nullableInteger(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value === "string" && /^-?\d+$/.test(value)) return Number(value);
  throw new Error(`CloudBase returned an invalid ${field}.`);
}

/** The rail preference as stored: an object whose order and hidden lists hold strings. */
function railPreference(value: unknown): RailPreferenceRow {
  const row = record(value, "rail preference");
  const list = (name: "order" | "hidden") => {
    if (row[name] === undefined) return {};
    if (
      !Array.isArray(row[name]) ||
      !row[name].every((key) => typeof key === "string")
    )
      throw new Error(`CloudBase returned an invalid rail ${name}.`);
    return { [name]: row[name] as string[] };
  };
  return { ...list("order"), ...list("hidden") };
}

/** The tab preferences as stored: an object keyed by event id whose lists hold strings. */
function eventTabs(value: unknown): EventTabsRow {
  const rows = record(value, "event tabs");
  return Object.fromEntries(
    Object.entries(rows).map(([eventId, tabs]) => {
      const row = record(tabs, "event tabs entry");
      const list = (name: "order" | "hidden" | "removed") => {
        if (row[name] === undefined) return {};
        if (
          !Array.isArray(row[name]) ||
          !row[name].every((key) => typeof key === "string")
        )
          throw new Error(`CloudBase returned an invalid event tabs ${name}.`);
        return { [name]: row[name] as string[] };
      };
      return [
        eventId,
        { ...list("order"), ...list("hidden"), ...list("removed") },
      ];
    }),
  );
}

export function record(value: unknown, label: string): CloudBaseRow {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error(`CloudBase returned an invalid ${label}.`);
  return value as CloudBaseRow;
}

export function userRow(row: CloudBaseRow): UserRow {
  return {
    id: text(row.id, "user id"),
    identityProvider: text(row.identity_provider, "identity provider"),
    providerSubject: text(row.provider_subject, "provider subject"),
    email: nullableText(row.email, "email"),
    displayName: text(row.display_name, "display name"),
    username: text(row.username, "username"),
    findByName: flag(row.find_by_name, "find_by_name"),
    findByEmail: flag(row.find_by_email, "find_by_email"),
    locale: nullableText(row.locale, "locale"),
    timeZone: nullableText(row.time_zone, "time zone"),
    hourCycle: nullableText(row.hour_cycle, "hour cycle"),
    weekStart: nullableInteger(row.week_start, "week start"),
    rail: railPreference(row.rail),
    eventTabs: eventTabs(row.event_tabs),
    createdAt: instant(row.created_at, "created_at"),
    updatedAt: instant(row.updated_at, "updated_at"),
  };
}

export function workspaceRow(row: CloudBaseRow): WorkspaceRow {
  return {
    id: text(row.id, "workspace id"),
    displayName: text(row.display_name, "workspace name"),
    createdBy: text(row.created_by, "workspace creator"),
    personalOwnerId: nullableText(row.personal_owner_id, "personal owner"),
    createdAt: instant(row.created_at, "created_at"),
    updatedAt: instant(row.updated_at, "updated_at"),
  };
}

export function userSessionRow(row: CloudBaseRow): UserSessionRow {
  return {
    id: text(row.id, "session id"),
    userId: text(row.user_id, "session user"),
    tokenHash: text(row.token_hash, "session token hash"),
    identityProvider: text(row.identity_provider, "session provider"),
    createdAt: instant(row.created_at, "created_at"),
    expiresAt: instant(row.expires_at, "expires_at"),
    lastSeenAt: instant(row.last_seen_at, "last_seen_at"),
    revokedAt: nullableInstant(row.revoked_at, "revoked_at"),
  };
}
