import type { CloudBaseRdbQuery } from "@chronelle/db";
import type { CloudBaseListClient } from "../src/cloudbase-list-candidates.js";
import { describe, expect, it } from "vitest";

import { CloudBaseEventReadRepository } from "../src/cloudbase-event-read-repository.js";

const workspaceId = "workspace-1";
const principal = { type: "user" as const, userId: "reader-1", workspaceId };
const now = new Date("2030-01-01T00:00:00.000Z");

const firstId = "00000000-0000-7000-8000-000000000001";
const secondId = "00000000-0000-7000-8000-000000000002";
const hiddenId = "00000000-0000-7000-8000-000000000003";
const childId = "00000000-0000-7000-8000-000000000004";

// Roots own their scope; the child inherits the first root's scope; Hidden has no grant.
const objects = [
  [firstId, "First", firstId, "2030-01-02T00:00:00.000Z"],
  [secondId, "Second", secondId, "2030-01-03T00:00:00.000Z"],
  [hiddenId, "Hidden", hiddenId, "2030-01-04T00:00:00.000Z"],
  [childId, "Included child", firstId, "2030-01-05T00:00:00.000Z"],
].map(([id, displayName, permissionScopeId, updatedAt]) => ({
  id,
  workspace_id: workspaceId,
  object_type: "event",
  display_name: displayName,
  created_by: "owner",
  permission_scope_id: permissionScopeId,
  created_at: "2030-01-01T00:00:00.000Z",
  updated_at: updatedAt,
  version: 1,
  archived_at: null,
  deleted_at: null,
  custom_properties: {},
  metadata: {},
}));

const eventRows = objects.map((object, index) => ({
  object_id: object.id,
  workspace_id: workspaceId,
  starts_at: `2030-01-0${index + 2}T09:00:00.000Z`,
  ends_at: `2030-01-0${index + 2}T10:00:00.000Z`,
  starts_on: null,
  ends_on: null,
  timezone: "UTC",
  is_all_day: false,
}));

function matches(row: Record<string, unknown>, query: CloudBaseRdbQuery) {
  return (query.filters ?? []).every((entry) => {
    const actual = row[entry.column];
    if (entry.operator === "is") return actual === entry.value;
    if (entry.operator === "in")
      return (entry.value as readonly unknown[]).includes(actual);
    return actual === entry.value;
  });
}

function client(granted = true): CloudBaseListClient {
  return {
    async rpc<T>() {
      const rows = granted
        ? objects.slice(0, 2).map((object) => ({
            ...object,
            ...eventRows.find((event) => event.object_id === object.id),
            own: false,
          }))
        : [];
      return {
        rows,
        counts: {
          all: rows.length,
          mine: 0,
          shared: rows.length,
          upcoming: rows.length,
          past: 0,
        },
      } as T;
    },
    capabilities: {
      transactions: false,
      nativeTcp: false,
      serverFunctions: false,
    },
    async select<T>(table: string, query: CloudBaseRdbQuery = {}) {
      if (table === "objects")
        return objects.filter((row) =>
          matches(row, query),
        ) as unknown as readonly T[];
      if (table === "events") return eventRows as unknown as readonly T[];
      if (table === "workspace_members") return [] as readonly T[];
      if (table === "users")
        return [
          { id: principal.userId, display_name: "Reader" },
        ] as unknown as readonly T[];
      // The principal's grants, read as the shares of an account that
      // belongs to no workspace: each names its workspace and grantor.
      if (table === "resource_grants")
        return granted
          ? ([
              {
                workspace_id: workspaceId,
                resource_id: firstId,
                principal_type: "user",
                principal_id: principal.userId,
                role: "viewer",
                scope: "all",
                granted_by: principal.userId,
                expires_at: null,
              },
              {
                workspace_id: workspaceId,
                resource_id: secondId,
                principal_type: "user",
                principal_id: principal.userId,
                role: "viewer",
                scope: "all",
                granted_by: principal.userId,
                expires_at: null,
              },
            ].filter((row) => matches(row, query)) as unknown as readonly T[])
          : ([] as readonly T[]);
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("CloudBaseEventReadRepository", () => {
  it("preserves ordering, cursor pagination, and canonical IDs", async () => {
    const repository = new CloudBaseEventReadRepository(client(), () => now);
    const first = await repository.listEvents(principal, {
      limit: 1,
      sort: "date",
    });
    expect(first.items.map((event) => event.id)).toEqual([firstId]);
    expect(first.nextCursor).not.toBeNull();

    const second = await repository.listEvents(principal, {
      cursor: first.nextCursor ?? undefined,
      limit: 1,
      sort: "date",
    });
    expect(second.items.map((event) => event.id)).toEqual([secondId]);
    expect(second.nextCursor).toBeNull();
  });

  it("does not return objects outside the principal grant scope", async () => {
    const repository = new CloudBaseEventReadRepository(client(), () => now);
    const result = await repository.listEvents(principal, { limit: 10 });
    expect(result.items.map((event) => event.id)).toEqual([firstId, secondId]);
  });

  it("lists root Events only, even when an included child is visible", async () => {
    const repository = new CloudBaseEventReadRepository(client(), () => now);
    const result = await repository.listEvents(principal, {
      limit: 10,
      sort: "updated",
    });
    expect(result.items.map((event) => event.id)).not.toContain(childId);
    expect(result.items).toHaveLength(2);
  });

  it("returns an empty page when no permission is available", async () => {
    const repository = new CloudBaseEventReadRepository(
      client(false),
      () => now,
    );
    await expect(
      repository.listEvents(principal, { limit: 10 }),
    ).resolves.toMatchObject({
      items: [],
      nextCursor: null,
    });
  });
});
