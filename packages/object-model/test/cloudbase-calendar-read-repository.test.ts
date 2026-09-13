import { AuthorizationDeniedError } from "@chronelle/authorization";

import type { CloudBaseRdbClient, CloudBaseRdbQuery } from "@chronelle/db";
import { describe, expect, it } from "vitest";

import { CloudBaseCalendarReadRepository } from "../src/cloudbase-calendar-read-repository.js";

const workspaceId = "workspace-1";
const principal = { type: "user" as const, userId: "reader-1", workspaceId };

const objects = [
  {
    id: "root",
    workspace_id: workspaceId,
    object_type: "event",
    display_name: "Root",
    created_by: "owner",
    permission_scope_id: "root",
    created_at: "2030-01-01T00:00:00.000Z",
    updated_at: "2030-01-01T00:00:00.000Z",
    version: 1,
    archived_at: null,
    deleted_at: null,
    custom_properties: {},
    metadata: {},
  },
  {
    id: "child",
    workspace_id: workspaceId,
    object_type: "event",
    display_name: "Child",
    created_by: "owner",
    permission_scope_id: "root",
    created_at: "2030-01-01T00:00:00.000Z",
    updated_at: "2030-01-01T00:00:00.000Z",
    version: 2,
    archived_at: null,
    deleted_at: null,
    custom_properties: {},
    metadata: {},
  },
];

const eventRows = [
  {
    object_id: "root",
    workspace_id: workspaceId,
    starts_at: null,
    ends_at: null,
    starts_on: "2030-02-01",
    ends_on: "2030-02-03",
    timezone: "UTC",
    is_all_day: true,
  },
  {
    object_id: "child",
    workspace_id: workspaceId,
    starts_at: "2030-02-02T10:00:00.000Z",
    ends_at: "2030-02-02T11:00:00.000Z",
    starts_on: null,
    ends_on: null,
    timezone: "UTC",
    is_all_day: false,
  },
];

function matches(
  row: Record<string, unknown>,
  query: CloudBaseRdbQuery,
): boolean {
  return (query.filters ?? []).every((entry) => {
    const actual = row[entry.column];
    if (entry.operator === "is") return actual === entry.value;
    if (entry.operator === "in")
      return (entry.value as readonly unknown[]).includes(actual);
    return actual === entry.value;
  });
}

function client(granted = true): CloudBaseRdbClient {
  return {
    capabilities: { transactions: false, nativeTcp: false },
    async select<T>(table: string, query: CloudBaseRdbQuery = {}) {
      if (table === "objects")
        return objects.filter((row) =>
          matches(row, query),
        ) as unknown as readonly T[];
      if (table === "events") return eventRows as unknown as readonly T[];
      if (table === "object_relations")
        return [{ target_object_id: "child" }] as unknown as readonly T[];
      if (table === "workspace_members") return [] as readonly T[];
      if (table === "resource_grants")
        return granted
          ? ([
              { resource_id: "root", role: "viewer", expires_at: null },
            ] as unknown as readonly T[])
          : ([] as readonly T[]);
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe("CloudBaseCalendarReadRepository", () => {
  it("returns canonical child events through inherited grants", async () => {
    const result = await new CloudBaseCalendarReadRepository(
      client(),
      () => new Date("2030-01-01T00:00:00.000Z"),
    ).listCalendarEvents(principal, "root");

    expect(result.map((event) => event.id)).toEqual(["child"]);
    expect(result[0]?.version).toBe(2);
  });

  it("rejects a root with no workspace or resource access", async () => {
    await expect(
      new CloudBaseCalendarReadRepository(client(false)).listCalendarEvents(
        principal,
        "root",
      ),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });
});
