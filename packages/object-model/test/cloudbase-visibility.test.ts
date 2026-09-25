import type { CloudBaseRdbQuery, CloudBaseRdbReader } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";

import {
  type CloudBaseObjectRow,
  readCloudBaseSectionMembers,
  readCloudBaseVisibility,
  readCloudBaseVisibleObjects,
} from "../src/cloudbase-read-support.js";

const principal = {
  type: "user" as const,
  userId: "reader",
  workspaceId: "workspace",
};
const now = new Date("2030-01-01T00:00:00Z");
const capabilities = {
  nativeTcp: false,
  transactions: false,
  serverFunctions: false,
} as const;

function object(id: string, scope = id, type = "task"): CloudBaseObjectRow {
  return {
    id,
    workspace_id: principal.workspaceId,
    object_type: type,
    display_name: id,
    permission_scope_id: scope,
    created_by: "owner",
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
    version: 1,
    archived_at: null,
    deleted_at: null,
    custom_properties: {},
    metadata: {},
  };
}

function fixture(
  tables: Record<string, readonly unknown[]>,
): CloudBaseRdbReader {
  return {
    capabilities,
    async select<T>(table: string) {
      return (tables[table] ?? []) as readonly T[];
    },
  };
}

describe("CloudBase visibility", () => {
  it("preserves direct grants, inherited view and section unions, and expiry", async () => {
    const grant = (
      resource: string,
      scope = "all",
      section: string | null = null,
    ) => ({
      resource_id: resource,
      role: "viewer",
      scope,
      section_id: section,
      expires_at: null,
    });
    const visibility = await readCloudBaseVisibility(
      fixture({
        resource_grants: [
          grant("event", "todos", "section"),
          grant("event", "expenses"),
          grant("private", "notes"),
          grant("whole"),
          { ...grant("expired"), expires_at: now.toISOString() },
          { ...grant("refused"), role: "unknown" },
        ],
        tasks: [{ object_id: "included-task", section_id: "section" }],
      }),
      principal,
      () => now,
    );

    expect(visibility.resourceIds).toEqual([
      "event",
      "private",
      "whole",
      "refused",
    ]);
    expect(visibility.canView(object("event", "event", "event"))).toBe(true);
    expect(visibility.canView(object("included-task", "event"))).toBe(true);
    expect(visibility.canView(object("excluded-task", "event"))).toBe(false);
    expect(visibility.canView(object("expense", "event", "expense"))).toBe(
      true,
    );
    expect(visibility.canView(object("note", "event", "note"))).toBe(false);
    expect(visibility.canView(object("private", "stopped"))).toBe(true);
    expect(visibility.canView(object("unrelated", "stopped"))).toBe(false);
    expect(visibility.canView(object("child", "whole"))).toBe(true);
    expect(visibility.canView(object("expired"))).toBe(false);
    expect(visibility.canView(object("refused"))).toBe(false);
    expect(visibility.narrowing("event")).toEqual({
      views: ["expenses"],
      sections: [{ id: "section", view: "todos" }],
    });
    expect(visibility.narrowing("whole")).toBeNull();
    expect(visibility.narrowing("unrelated")).toEqual({
      views: [],
      sections: [],
    });
  });

  it.each(["owner", "editor", "viewer"])(
    "keeps %s workspace access",
    async (role) => {
      const visibility = await readCloudBaseVisibility(
        fixture({
          workspace_members: [{ role }],
        }),
        principal,
        () => now,
      );
      expect(visibility.canView(object("unshared"))).toBe(true);
      expect(visibility.narrowing("unshared")).toBeNull();
    },
  );

  it("preserves first-row order and checks each canonical id once", async () => {
    const first = object("first");
    const hidden = object("hidden");
    const second = object("second");
    const canView = vi.fn((row: CloudBaseObjectRow) => row.id !== "hidden");
    const client: CloudBaseRdbReader = {
      capabilities,
      async select<T>(_table: string, query?: CloudBaseRdbQuery) {
        const direct = query?.filters?.some((filter) => filter.column === "id");
        return (direct
          ? [first, hidden]
          : [
              object("first"),
              object("hidden"),
              second,
            ]) as unknown as readonly T[];
      },
    };
    const rows = await readCloudBaseVisibleObjects(client, principal, {
      workspaceRole: null,
      resourceIds: ["scope"],
      canView,
      narrowing: () => null,
    });
    expect(rows).toEqual([first, second]);
    expect(rows[0]).toBe(first);
    expect(canView).toHaveBeenCalledTimes(3);
  });

  it("deduplicates overlapping large result sets with linear id reads", async () => {
    let idReads = 0;
    const rows = Array.from({ length: 5_000 }, (_, index) => ({
      ...object(String(index)),
      get id() {
        idReads++;
        return String(index);
      },
    }));
    const result = await readCloudBaseVisibleObjects(
      fixture({ objects: rows }),
      principal,
      {
        workspaceRole: null,
        resourceIds: ["scope"],
        canView: () => true,
        narrowing: () => null,
      },
    );
    expect(result).toHaveLength(rows.length);
    expect(idReads).toBeLessThanOrEqual(rows.length * 4);
  });

  it("starts independent section lookups together and combines their memberships", async () => {
    let finishTasks: ((rows: readonly unknown[]) => void) | undefined;
    const tasks = new Promise<readonly unknown[]>((resolve) => {
      finishTasks = resolve;
    });
    const called: string[] = [];
    const client: CloudBaseRdbReader = {
      capabilities,
      async select<T>(table: string) {
        called.push(table);
        return (
          table === "tasks"
            ? await tasks
            : [{ object_id: "expense", section_id: "section" }]
        ) as readonly T[];
      },
    };
    const pending = readCloudBaseSectionMembers(client, principal, [
      {
        resourceId: "event",
        role: "viewer",
        scope: "todos",
        sectionId: "section",
        grantedBy: null,
      },
    ]);
    expect(called).toEqual(["tasks", "expenses"]);
    finishTasks?.([{ object_id: "task", section_id: "section" }]);
    expect((await pending).get("section")).toEqual(
      new Set(["task", "expense"]),
    );
  });
});
