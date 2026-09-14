import type { UserRow, UserSessionRow, WorkspaceRow } from "@chronelle/db";

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
