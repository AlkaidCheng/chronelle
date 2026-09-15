import { AuthorizationDeniedError } from "@chronelle/authorization";
import type { CloudBaseRdbReader, CloudBaseRdbQuery } from "@chronelle/db";
import { describe, expect, it } from "vitest";

import { CloudBaseProjectionReadRepository } from "../src/cloudbase-projection-read-repository.js";

const workspaceId = "workspace-1";
const principal = { type: "user" as const, userId: "reader-1", workspaceId };
const member = { type: "user" as const, userId: "member-1", workspaceId };
const now = new Date("2030-01-01T00:00:00.000Z");
const clock = () => now;

const instant = "2030-01-01T00:00:00.000Z";

function object(
  id: string,
  objectType: string,
  permissionScopeId: string,
  deletedAt: string | null = null,
) {
  return {
    id,
    workspace_id: workspaceId,
    object_type: objectType,
    display_name: `Object ${id}`,
    created_by: "owner",
    permission_scope_id: permissionScopeId,
    created_at: instant,
    updated_at: instant,
    version: 1,
    archived_at: null,
    deleted_at: deletedAt,
    custom_properties: {},
    metadata: {},
  };
}

// The root owns its scope. Most children inherit it; "private" children own
// theirs; "festival-child" inherits a live foreign scope and "retired-child"
// a deleted one. Deleted objects and removed relations must never surface.
const objects = [
  object("root", "event", "root"),
  object("festival", "event", "festival"),
  object("retired", "event", "retired", instant),
  object("child-event", "event", "root"),
  object("festival-child", "event", "festival"),
  object("retired-child", "event", "retired"),
  object("private-event", "event", "private-event"),
  object("deleted-event", "event", "root", instant),
  object("task", "task", "root"),
  object("expense", "expense", "root"),
  object("reminder", "reminder", "root"),
  object("included-document", "document", "root"),
  object("attached-document", "document", "root"),
  object("private-document", "document", "private-document"),
  object("unlinked-task", "task", "root"),
  object("orphan-task", "task", "root"),
];

const typedRows: Record<string, Record<string, unknown>[]> = {
  events: [
    ["root", "2030-01-16T18:00:00.000Z"],
    ["festival", "2030-01-05T09:00:00.000Z"],
    ["retired", null],
    ["child-event", "2030-01-16T17:30:00.000Z"],
    ["festival-child", "2030-01-06T10:00:00.000Z"],
    ["retired-child", "2030-01-07T10:00:00.000Z"],
    ["private-event", "2030-01-12T09:00:00.000Z"],
    ["deleted-event", "2030-01-15T10:00:00.000Z"],
  ].map(([object_id, starts_at]) => ({
    object_id,
    workspace_id: workspaceId,
    starts_at,
    ends_at: null,
    starts_on: null,
    ends_on: null,
    timezone: "UTC",
    is_all_day: false,
  })),
  tasks: ["task", "unlinked-task"].map((object_id) => ({
    object_id,
    workspace_id: workspaceId,
    status: "todo",
    due_at: "2030-01-08T09:00:00.000Z",
    completed_at: null,
  })),
  expenses: [
    {
      object_id: "expense",
      workspace_id: workspaceId,
      amount: "125.5000",
      currency: "USD",
      occurred_at: "2030-01-03T12:00:00.000Z",
    },
  ],
  reminders: [
    {
      object_id: "reminder",
      workspace_id: workspaceId,
      remind_at: "2030-01-04T08:00:00.000Z",
      status: "pending",
    },
  ],
  documents: ["included-document", "attached-document", "private-document"].map(
    (object_id, index) => ({
      object_id,
      workspace_id: workspaceId,
      storage_provider: "local",
      storage_key: `documents/${object_id}`,
      original_filename: `${object_id}.pdf`,
      mime_type: "application/pdf",
      size_bytes: String(1024 * (index + 1)),
      checksum_sha256: "a".repeat(64),
      encryption_mode: "provider",
    }),
  ),
};

// Typed rows hold the column's canonical text; the double encodes it the way
// the gateway does when it serves a column list.
const numericColumns = new Set(["amount", "size_bytes"]);

const relations = [
  ...[
    "child-event",
    "festival-child",
    "retired-child",
    "private-event",
    "deleted-event",
    "task",
    "expense",
    "reminder",
    "included-document",
    "orphan-task",
  ].map((target_object_id) => ({
    source_object_id: "root",
    relation_type: "includes",
    target_object_id,
    deleted_at: null,
  })),
  {
    source_object_id: "root",
    relation_type: "includes",
    target_object_id: "unlinked-task",
    deleted_at: instant,
  },
  ...["attached-document", "private-document", "included-document"].map(
    (source_object_id) => ({
      source_object_id,
      relation_type: "attached_to",
      target_object_id: "root",
      deleted_at: null,
    }),
  ),
].map((relation, index) => ({
  ...relation,
  id: `relation-${index}`,
  workspace_id: workspaceId,
}));

function matches(row: Record<string, unknown>, query: CloudBaseRdbQuery) {
  return (query.filters ?? []).every((entry) => {
    const actual = row[entry.column];
    if (entry.operator === "in")
      return (entry.value as readonly unknown[]).includes(actual);
    return actual === entry.value;
  });
}

/** Numeric and bigint columns arrive as JSON numbers unless the column list casts them to text. */
function gatewayRow(row: Record<string, unknown>, columns = "*") {
  const requested =
    columns === "*"
      ? Object.keys(row).map((column) => [column])
      : columns.split(",").map((entry) => entry.split("::"));
  return Object.fromEntries(
    requested.map(([column = "", cast]) => {
      const value = row[column];
      if (value === null || value === undefined) return [column, value];
      if (cast === "text") return [column, String(value)];
      return [column, numericColumns.has(column) ? Number(value) : value];
    }),
  );
}

interface ClientOptions {
  readonly grants?: readonly {
    readonly resource_id: string;
    readonly expires_at: string | null;
  }[];
  readonly tables?: string[];
  readonly withOrphanTask?: boolean;
}

function client(options: ClientOptions = {}): CloudBaseRdbReader {
  const grants = options.grants ?? [
    { resource_id: "root", expires_at: null },
    { resource_id: "festival", expires_at: null },
    { resource_id: "retired", expires_at: null },
  ];
  const tables: Record<string, Record<string, unknown>[]> = {
    objects: objects.filter(
      (row) => options.withOrphanTask === true || row.id !== "orphan-task",
    ),
    object_relations: relations,
    workspace_members: [
      { workspace_id: workspaceId, user_id: member.userId, role: "viewer" },
    ],
    resource_grants: grants.map((grant) => ({
      ...grant,
      workspace_id: workspaceId,
      principal_type: "user",
      principal_id: principal.userId,
      role: "viewer",
    })),
    task_labels: [],
    labels: [],
    ...typedRows,
  };
  return {
    capabilities: {
      transactions: false,
      nativeTcp: false,
      serverFunctions: false,
    },
    async select<T>(table: string, query: CloudBaseRdbQuery = {}) {
      options.tables?.push(table);
      const rows = tables[table];
      if (rows === undefined) throw new Error(`unexpected table ${table}`);
      return rows
        .filter((row) => matches(row, query))
        .map((row) => gatewayRow(row, query.columns)) as unknown as T[];
    },
  };
}

describe("CloudBaseProjectionReadRepository", () => {
  it("reads the detail rows a grant-only viewer may see, in relation order", async () => {
    const repository = new CloudBaseProjectionReadRepository(client(), clock);
    const detail = await repository.readEventDetail(principal, "root");

    expect(detail.event.id).toBe("root");
    expect(detail.event.startsAt).toEqual(new Date("2030-01-16T18:00:00Z"));
    expect(detail.includedResources.map((resource) => resource.id)).toEqual([
      "child-event",
      "festival-child",
      "task",
      "expense",
      "reminder",
      "included-document",
    ]);
    expect(detail.attachedDocuments.map((document) => document.id)).toEqual([
      "attached-document",
      "included-document",
    ]);
    // Private event, retired-scoped child, private attachment.
    expect(detail.lockedRelationCount).toBe(3);
  });

  it("decodes every typed family, reading amounts and sizes as canonical text", async () => {
    const repository = new CloudBaseProjectionReadRepository(client(), clock);
    const detail = await repository.readEventDetail(member, "root");
    const byId = new Map(
      detail.includedResources.map((resource) => [resource.id, resource]),
    );

    expect(byId.get("task")).toMatchObject({
      objectType: "task",
      status: "todo",
      dueAt: new Date("2030-01-08T09:00:00Z"),
      completedAt: null,
    });
    expect(byId.get("expense")).toMatchObject({
      objectType: "expense",
      amount: "125.5000",
      currency: "USD",
      occurredAt: new Date("2030-01-03T12:00:00Z"),
    });
    expect(byId.get("reminder")).toMatchObject({
      objectType: "reminder",
      status: "pending",
      remindAt: new Date("2030-01-04T08:00:00Z"),
    });
    expect(byId.get("included-document")).toMatchObject({
      objectType: "document",
      originalFilename: "included-document.pdf",
      sizeBytes: 1024n,
    });
    expect(detail.includedResources.map((resource) => resource.id)).toEqual([
      "child-event",
      "festival-child",
      "retired-child",
      "private-event",
      "task",
      "expense",
      "reminder",
      "included-document",
    ]);
    expect(detail.attachedDocuments.map((document) => document.id)).toEqual([
      "attached-document",
      "private-document",
      "included-document",
    ]);
    expect(detail.lockedRelationCount).toBe(0);
  });

  it("lists only the requested families and reads only their tables", async () => {
    const tables: string[] = [];
    const repository = new CloudBaseProjectionReadRepository(
      client({ tables }),
      clock,
    );
    const reminders = await repository.listIncludedResources(
      principal,
      "root",
      ["reminder"],
    );

    expect(reminders.map((resource) => resource.id)).toEqual(["reminder"]);
    expect(tables).not.toContain("tasks");
    expect(tables).not.toContain("documents");
    expect(tables.filter((table) => table === "reminders")).toHaveLength(1);
  });

  it("ignores a grant whose permission scope has been deleted", async () => {
    const repository = new CloudBaseProjectionReadRepository(client(), clock);
    const grantee = await repository.listIncludedResources(principal, "root", [
      "event",
    ]);
    const workspaceMember = await repository.listIncludedResources(
      member,
      "root",
      ["event"],
    );

    expect(grantee.map((event) => event.id)).toEqual([
      "child-event",
      "festival-child",
    ]);
    expect(workspaceMember.map((event) => event.id)).toEqual([
      "child-event",
      "festival-child",
      "retired-child",
      "private-event",
    ]);
  });

  it("rejects expired grants, unknown roots, and roots that are not Events", async () => {
    const expired = new CloudBaseProjectionReadRepository(
      client({
        grants: [{ resource_id: "root", expires_at: "2029-12-31T00:00:00Z" }],
      }),
      clock,
    );
    await expect(
      expired.readEventDetail(principal, "root"),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);

    const repository = new CloudBaseProjectionReadRepository(client(), clock);
    await expect(
      repository.readEventDetail(principal, "missing"),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      repository.listIncludedResources(member, "task", ["task"]),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("reports a canonical row without typed state instead of skipping it", async () => {
    const repository = new CloudBaseProjectionReadRepository(
      client({ withOrphanTask: true }),
      clock,
    );
    await expect(
      repository.listIncludedResources(member, "root", ["task"]),
    ).rejects.toThrow("The canonical object is missing its typed state.");
  });
});
