import { AuthorizationDeniedError } from "@chronelle/authorization";
import type { CloudBaseRdbQuery, CloudBaseRdbReader } from "@chronelle/db";
import { describe, expect, it } from "vitest";

import { CloudBaseGrantReadRepository } from "../src/cloudbase-grant-read-repository.js";
import { CloudBaseObjectReadRepository } from "../src/cloudbase-object-read-repository.js";
import { CloudBaseRecoveryReadRepository } from "../src/cloudbase-recovery-read-repository.js";
import { CloudBaseRelationReadRepository } from "../src/cloudbase-relation-read-repository.js";
import { CloudBaseRevisionReadRepository } from "../src/cloudbase-revision-read-repository.js";
import { InvalidObjectStateError } from "../src/errors.js";

const workspaceId = "00000000-0000-7000-8000-0000000000ff";
const ownerId = "00000000-0000-7000-8000-0000000000a1";
const readerId = "00000000-0000-7000-8000-0000000000a2";
const owner = { type: "user" as const, userId: ownerId, workspaceId };
const reader = { type: "user" as const, userId: readerId, workspaceId };
const now = new Date("2030-01-01T00:00:00.000Z");
const clock = () => now;

const rootId = "00000000-0000-7000-8000-000000000001";
const childId = "00000000-0000-7000-8000-000000000002";
const privateId = "00000000-0000-7000-8000-000000000003";
const deletedId = "00000000-0000-7000-8000-000000000004";
const deadScopeId = "00000000-0000-7000-8000-000000000005";
const orphanId = "00000000-0000-7000-8000-000000000006";
const documentId = "00000000-0000-7000-8000-000000000007";
const expenseId = "00000000-0000-7000-8000-000000000008";

function object(
  id: string,
  objectType: string,
  displayName: string,
  permissionScopeId: string,
  deletedAt: string | null = null,
) {
  return {
    id,
    workspace_id: workspaceId,
    object_type: objectType,
    display_name: displayName,
    created_by: ownerId,
    permission_scope_id: permissionScopeId,
    created_at: "2029-12-01T00:00:00.000Z",
    updated_at: "2029-12-02T00:00:00.000Z",
    version: 3,
    archived_at: null,
    deleted_at: deletedAt,
    custom_properties: { colour: "teal" },
    metadata: {},
  };
}

const objects = [
  object(rootId, "event", "Root", rootId),
  object(childId, "task", "Child", rootId),
  object(privateId, "event", "Private", privateId),
  object(deletedId, "task", "Deleted child", rootId, "2029-12-24T00:00:00Z"),
  object(
    deadScopeId,
    "event",
    "Dead scope",
    deadScopeId,
    "2029-12-20T00:00:00Z",
  ),
  object(orphanId, "task", "Orphan", deadScopeId),
  object(documentId, "document", "Plan.pdf", rootId),
  object(expenseId, "expense", "Deposit", rootId),
];

const typed = {
  events: [rootId, privateId, deadScopeId].map((object_id) => ({
    object_id,
    workspace_id: workspaceId,
    starts_at: "2030-02-01T18:00:00.000Z",
    ends_at: null,
    starts_on: null,
    ends_on: null,
    timezone: "UTC",
    is_all_day: false,
  })),
  tasks: [childId, deletedId, orphanId].map((object_id) => ({
    object_id,
    workspace_id: workspaceId,
    status: "todo",
    due_at: null,
    completed_at: null,
  })),
  // Numeric and bigint values are held as PostgreSQL returns them as text.
  documents: [
    {
      object_id: documentId,
      workspace_id: workspaceId,
      storage_provider: "local-filesystem",
      storage_key: "key",
      original_filename: "Plan.pdf",
      mime_type: "application/pdf",
      size_bytes: 9007199254740993n,
      checksum_sha256: "a".repeat(64),
      encryption_mode: "provider",
    },
  ],
  expenses: [
    {
      object_id: expenseId,
      workspace_id: workspaceId,
      amount: "12.5000",
      currency: "USD",
      occurred_at: "2030-01-15T12:00:00.000Z",
    },
  ],
};

const relationIds = [
  "00000000-0000-7000-8000-000000000011",
  "00000000-0000-7000-8000-000000000012",
  "00000000-0000-7000-8000-000000000013",
  "00000000-0000-7000-8000-000000000014",
];

function relation(
  id: string,
  source: string,
  relationType: string,
  target: string,
  deletedAt: string | null = null,
  version = 1,
) {
  return {
    id,
    workspace_id: workspaceId,
    source_object_id: source,
    relation_type: relationType,
    target_object_id: target,
    metadata: {},
    created_by: ownerId,
    created_at: "2029-12-03T00:00:00.000Z",
    deleted_at: deletedAt,
    version,
  };
}

const relations = [
  relation(relationIds[0] as string, rootId, "includes", childId),
  relation(relationIds[1] as string, rootId, "related_to", privateId),
  relation(relationIds[2] as string, rootId, "includes", documentId),
  relation(
    relationIds[3] as string,
    rootId,
    "includes",
    deletedId,
    "2029-12-25T00:00:00.000Z",
    2,
  ),
];

type Rows = Readonly<Record<string, readonly Record<string, unknown>[]>>;

function matches(row: Record<string, unknown>, query: CloudBaseRdbQuery) {
  return (query.filters ?? []).every((entry) => {
    const actual = row[entry.column];
    if (entry.operator === "in")
      return (entry.value as readonly unknown[]).includes(actual);
    return actual === entry.value;
  });
}

/**
 * Applies a select list to one row the way the gateway does: a `column::text`
 * entry returns the text representation, any other column its JSON value.
 */
function project(
  row: Record<string, unknown>,
  columns: string | undefined,
): Record<string, unknown> {
  if (columns === undefined || columns === "*") return row;
  return Object.fromEntries(
    columns.split(",").map((entry) => {
      const [name, cast] = entry.split("::") as [string, string | undefined];
      const value = row[name];
      return [name, cast === "text" && value !== null ? String(value) : value];
    }),
  );
}

/** An RDB reader over literal rows that honors filters, order, limit, and select casts and records every query. */
function client(rows: Rows) {
  const queries: { table: string; query: CloudBaseRdbQuery }[] = [];
  const reader: CloudBaseRdbReader = {
    capabilities: {
      transactions: false,
      nativeTcp: false,
      serverFunctions: false,
    },
    async select<T>(table: string, query: CloudBaseRdbQuery = {}) {
      queries.push({ table, query });
      const tableRows = rows[table];
      if (tableRows === undefined) throw new Error(`unexpected table ${table}`);
      const matching = tableRows.filter((row) => matches(row, query));
      for (const order of [...(query.order ?? [])].reverse())
        matching.sort((first, second) => {
          const [left, right] = [first[order.column], second[order.column]];
          const comparison =
            left === right ? 0 : (left as string) < (right as string) ? -1 : 1;
          return order.ascending === false ? -comparison : comparison;
        });
      const page =
        query.limit === undefined ? matching : matching.slice(0, query.limit);
      return page.map((row) =>
        project(row, query.columns),
      ) as unknown as readonly T[];
    },
  };
  return { reader, queries };
}

function workspace(
  grants: readonly { resource_id: string; role: string; expires_at?: string }[],
  members: readonly { user_id: string; role: string }[] = [
    { user_id: ownerId, role: "owner" },
  ],
): Rows {
  return {
    objects,
    ...typed,
    reminders: [],
    task_labels: [],
    labels: [],
    object_relations: relations,
    workspace_members: members.map((member) => ({
      ...member,
      workspace_id: workspaceId,
    })),
    resource_grants: grants.map((grant) => ({
      id: `grant-${grant.resource_id}`,
      workspace_id: workspaceId,
      principal_type: "user",
      principal_id: readerId,
      granted_by: ownerId,
      created_at: "2029-12-01T00:00:00.000Z",
      expires_at: grant.expires_at ?? null,
      ...grant,
    })),
    users: [
      { id: ownerId, display_name: "Owner", email: "owner@example.test" },
      { id: readerId, display_name: "Reader", email: null },
    ],
    object_revisions: [],
  };
}

describe("CloudBaseObjectReadRepository", () => {
  it("returns typed state through an inherited grant and denies the private sibling", async () => {
    const { reader: rdb, queries } = client(
      workspace([{ resource_id: rootId, role: "viewer" }]),
    );
    const repository = new CloudBaseObjectReadRepository(rdb, clock);

    const child = await repository.getObject(reader, childId);
    expect(child).toMatchObject({
      id: childId,
      objectType: "task",
      status: "todo",
      version: 3,
      customProperties: { colour: "teal" },
    });
    const document = await repository.getObject(reader, documentId);
    expect(document).toMatchObject({
      objectType: "document",
      sizeBytes: 9_007_199_254_740_993n,
    });
    const expense = await repository.getObject(reader, expenseId);
    expect(expense).toMatchObject({ objectType: "expense", amount: "12.5000" });
    // Numeric and bigint columns are requested as text so the gateway does not round them.
    expect(
      queries
        .filter(({ table }) => table === "documents" || table === "expenses")
        .map(({ table, query }) => [table, query.columns]),
    ).toEqual([
      [
        "documents",
        "object_id,workspace_id,storage_provider,storage_key,original_filename,mime_type,size_bytes::text,checksum_sha256,encryption_mode",
      ],
      ["expenses", "object_id,workspace_id,amount::text,currency,occurred_at"],
    ]);
    await expect(
      repository.getObject(reader, privateId),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      repository.getObject(reader, deletedId),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      repository.getObject(reader, "00000000-0000-7000-8000-0000000000ee"),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("ignores expired grants and grants whose canonical scope is in Trash", async () => {
    const expired = new CloudBaseObjectReadRepository(
      client(
        workspace([
          {
            resource_id: rootId,
            role: "viewer",
            expires_at: "2029-12-31T23:59:59.000Z",
          },
        ]),
      ).reader,
      clock,
    );
    await expect(expired.getObject(reader, childId)).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );

    const dead = new CloudBaseObjectReadRepository(
      client(workspace([{ resource_id: deadScopeId, role: "owner" }])).reader,
      clock,
    );
    await expect(dead.getObject(reader, orphanId)).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
    // The member reads the same orphan: membership does not depend on the scope.
    await expect(dead.getObject(owner, orphanId)).resolves.toMatchObject({
      id: orphanId,
    });
  });

  it("derives allowed actions from membership, direct, and inherited roles", async () => {
    const repository = new CloudBaseObjectReadRepository(
      client(
        workspace([
          { resource_id: rootId, role: "viewer" },
          { resource_id: childId, role: "editor" },
        ]),
      ).reader,
      clock,
    );
    expect(await repository.getAllowedActions(reader, rootId)).toEqual([
      "view",
    ]);
    expect(await repository.getAllowedActions(reader, childId)).toEqual([
      "view",
      "comment",
      "edit",
    ]);
    expect(await repository.getAllowedActions(owner, childId)).toEqual([
      "view",
      "comment",
      "edit",
      "share",
      "delete",
      "recover",
    ]);
    await expect(
      repository.getAllowedActions(reader, privateId),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("lists visible objects in input order, keeping duplicates and dropping the rest", async () => {
    const { reader: rdb, queries } = client(
      workspace([{ resource_id: rootId, role: "viewer" }]),
    );
    const repository = new CloudBaseObjectReadRepository(rdb, clock);
    const resources = await repository.listVisibleObjects(reader, [
      childId,
      privateId,
      deletedId,
      documentId,
      childId,
      orphanId,
    ]);
    expect(resources.map((resource) => resource.id)).toEqual([
      childId,
      documentId,
      childId,
    ]);
    // Typed rows are fetched once per canonical type actually present.
    expect(
      queries.filter(({ table }) => ["tasks", "documents"].includes(table)),
    ).toHaveLength(2);
    expect(queries.some(({ table }) => table === "events")).toBe(false);
    await expect(repository.listVisibleObjects(reader, [])).resolves.toEqual(
      [],
    );
  });
});

describe("CloudBaseRelationReadRepository", () => {
  it("hides relations whose other endpoint is not viewable and pages newest first", async () => {
    const repository = new CloudBaseRelationReadRepository(
      client(workspace([{ resource_id: rootId, role: "viewer" }])).reader,
      clock,
    );
    const page = await repository.listRelations(reader, rootId, { limit: 1 });
    expect(page.items.map((item) => item.id)).toEqual([relationIds[2]]);
    expect(page.nextCursor).toEqual(expect.any(String));
    const rest = await repository.listRelations(reader, rootId, {
      limit: 1,
      cursor: page.nextCursor as string,
    });
    expect(rest.items.map((item) => item.id)).toEqual([relationIds[0]]);
    expect(rest.nextCursor).toBeNull();

    const all = await repository.listRelations(owner, rootId);
    expect(all.items.map((item) => item.id)).toEqual([
      relationIds[2],
      relationIds[1],
      relationIds[0],
    ]);
    await expect(
      repository.listRelations(reader, rootId, {
        limit: 1,
        cursor: "not-a-cursor",
      }),
    ).rejects.toBeInstanceOf(InvalidObjectStateError);
    await expect(
      repository.listRelations(reader, privateId),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("pushes direction, type, and other-endpoint filters to the gateway", async () => {
    const { reader: rdb, queries } = client(
      workspace([{ resource_id: rootId, role: "viewer" }]),
    );
    const repository = new CloudBaseRelationReadRepository(rdb, clock);
    const page = await repository.listRelations(reader, rootId, {
      direction: "outgoing",
      relationType: "includes",
      otherObjectId: childId,
    });
    expect(page.items.map((item) => item.id)).toEqual([relationIds[0]]);
    const relationQueries = queries.filter(
      ({ table }) => table === "object_relations",
    );
    expect(relationQueries).toHaveLength(1);
    expect(relationQueries[0]?.query.filters).toEqual(
      expect.arrayContaining([
        { column: "deleted_at", operator: "is", value: null },
        { column: "relation_type", operator: "eq", value: "includes" },
        { column: "source_object_id", operator: "eq", value: rootId },
        { column: "target_object_id", operator: "eq", value: childId },
      ]),
    );
  });

  it("lists removed links only for an editable source and a viewable target", async () => {
    const editor = new CloudBaseRelationReadRepository(
      client(workspace([{ resource_id: rootId, role: "editor" }])).reader,
      clock,
    );
    // The removed link targets a tombstone, which nobody can view.
    expect(
      (await editor.listRemovedRelations(reader, rootId, { limit: 20 })).items,
    ).toEqual([]);

    const revived = workspace([{ resource_id: rootId, role: "editor" }]);
    const repository = new CloudBaseRelationReadRepository(
      client({
        ...revived,
        objects: objects.map((row) =>
          row.id === deletedId ? { ...row, deleted_at: null } : row,
        ),
      }).reader,
      clock,
    );
    const page = await repository.listRemovedRelations(reader, rootId, {
      limit: 20,
    });
    expect(page.items).toEqual([
      {
        relation: expect.objectContaining({
          id: relationIds[3],
          version: 2,
          deletedAt: new Date("2029-12-25T00:00:00.000Z"),
        }),
        sourceDisplayName: "Root",
        targetDisplayName: "Deleted child",
      },
    ]);
    const viewer = new CloudBaseRelationReadRepository(
      client({
        ...workspace([{ resource_id: rootId, role: "viewer" }]),
        objects: objects.map((row) =>
          row.id === deletedId ? { ...row, deleted_at: null } : row,
        ),
      }).reader,
      clock,
    );
    expect(
      (await viewer.listRemovedRelations(reader, rootId, { limit: 20 })).items,
    ).toEqual([]);
  });
});

describe("CloudBaseGrantReadRepository", () => {
  const grants = [
    {
      id: "00000000-0000-7000-8000-000000000021",
      resource_id: rootId,
      principal_id: readerId,
      role: "viewer",
      created_at: "2029-12-02T00:00:00.000Z",
      expires_at: null,
    },
    {
      id: "00000000-0000-7000-8000-000000000022",
      resource_id: rootId,
      principal_id: ownerId,
      role: "editor",
      created_at: "2029-12-01T00:00:00.000Z",
      expires_at: "2031-01-01T00:00:00.000Z",
    },
    {
      id: "00000000-0000-7000-8000-000000000023",
      resource_id: rootId,
      principal_id: readerId,
      role: "owner",
      created_at: "2029-11-01T00:00:00.000Z",
      expires_at: "2029-12-31T00:00:00.000Z",
    },
    {
      id: "00000000-0000-7000-8000-000000000024",
      resource_id: rootId,
      principal_id: "00000000-0000-7000-8000-0000000000a9",
      role: "viewer",
      created_at: "2029-12-03T00:00:00.000Z",
      expires_at: null,
    },
  ].map((grant) => ({
    ...grant,
    workspace_id: workspaceId,
    principal_type: "user",
    granted_by: ownerId,
  }));

  it("keeps the gateway order, drops expired grants and unknown users, and requires recovery access", async () => {
    const base = workspace([]);
    const { reader: rdb, queries } = client({
      ...base,
      resource_grants: grants,
    });
    const repository = new CloudBaseGrantReadRepository(rdb, clock);
    // Creation order wins; the expired grant and the grant of an unknown user are dropped.
    expect(await repository.listGrants(owner, rootId)).toEqual([
      expect.objectContaining({
        id: grants[1]?.id,
        role: "editor",
        expiresAt: new Date("2031-01-01T00:00:00.000Z"),
        principal: {
          id: ownerId,
          displayName: "Owner",
          email: "owner@example.test",
        },
      }),
      {
        id: grants[0]?.id,
        workspaceId,
        resourceId: rootId,
        role: "viewer",
        grantedBy: ownerId,
        createdAt: new Date("2029-12-02T00:00:00.000Z"),
        expiresAt: null,
        principal: { id: readerId, displayName: "Reader", email: null },
      },
    ]);
    expect(
      queries.find(
        ({ table, query }) =>
          table === "resource_grants" && query.order !== undefined,
      )?.query.order,
    ).toEqual([
      { column: "created_at", ascending: true },
      { column: "id", ascending: true },
    ]);
  });

  it("denies a reader without an Owner grant and allows an Owner grant on a tombstone", async () => {
    const denied = new CloudBaseGrantReadRepository(
      client({ ...workspace([]), resource_grants: grants }).reader,
      clock,
    );
    await expect(denied.listGrants(reader, rootId)).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
    const allowed = new CloudBaseGrantReadRepository(
      client(workspace([{ resource_id: deadScopeId, role: "owner" }])).reader,
      clock,
    );
    expect(
      (await allowed.listGrants(reader, deadScopeId)).map(
        (grant) => grant.principal.id,
      ),
    ).toEqual([readerId]);
    await expect(
      allowed.listGrants(reader, "00000000-0000-7000-8000-0000000000ee"),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });
});

describe("CloudBaseRevisionReadRepository", () => {
  const revisions = [4, 2, 3, 1].map((version) => ({
    id: `00000000-0000-7000-8000-00000000003${version}`,
    workspace_id: workspaceId,
    object_id: rootId,
    object_version: version,
    mutation_kind: version === 1 ? "created" : "updated",
    actor_type: version === 3 ? "system" : "user",
    actor_id: version === 3 ? null : ownerId,
    request_id: "00000000-0000-7000-8000-000000000099",
    audit_event_id: "00000000-0000-7000-8000-000000000098",
    snapshot_schema_version: version === 4 ? 2 : 1,
    snapshot: {
      id: rootId,
      workspaceId,
      objectType: "event",
      displayName: `Root v${version}`,
      createdBy: ownerId,
      createdAt: "2029-12-01T00:00:00.000Z",
      updatedAt: "2029-12-02T00:00:00.000Z",
      version,
      archivedAt: null,
      deletedAt: null,
      customProperties: {},
      startsAt: null,
      startsOn: null,
      endsOn: null,
      endsAt: null,
      timezone: null,
      isAllDay: false,
    },
    created_at: "2029-12-02T00:00:00.000Z",
    source_revision_id: null,
  }));

  it("pages newest version first with beforeVersion and resolves user actor names", async () => {
    const repository = new CloudBaseRevisionReadRepository(
      client({
        ...workspace([{ resource_id: rootId, role: "viewer" }]),
        object_revisions: revisions,
      }).reader,
      clock,
    );
    const first = await repository.listRevisions(reader, rootId, {
      limit: 2,
    });
    expect(first.items.map((item) => item.objectVersion)).toEqual([4, 3]);
    expect(first.items.map((item) => item.actorDisplayName)).toEqual([
      "Owner",
      null,
    ]);
    expect(first.items[0]?.createdAt).toBe("2029-12-02T00:00:00.000Z");
    expect(first.nextBeforeVersion).toBe(3);
    const second = await repository.listRevisions(reader, rootId, {
      limit: 2,
      beforeVersion: 3,
    });
    expect(second.items.map((item) => item.objectVersion)).toEqual([2, 1]);
    expect(second.nextBeforeVersion).toBeNull();
    await expect(
      repository.listRevisions(reader, privateId, { limit: 2 }),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });

  it("decodes a single revision snapshot and rejects unknown schema versions", async () => {
    const repository = new CloudBaseRevisionReadRepository(
      client({
        ...workspace([{ resource_id: rootId, role: "viewer" }]),
        object_revisions: revisions,
      }).reader,
      clock,
    );
    const revision = await repository.getRevision(reader, rootId, 2);
    expect(revision).toMatchObject({
      objectVersion: 2,
      mutationKind: "updated",
      snapshot: { objectType: "event", displayName: "Root v2" },
    });
    await expect(repository.getRevision(reader, rootId, 4)).rejects.toThrow(
      new InvalidObjectStateError(
        "The revision snapshot schema is not supported.",
      ),
    );
    await expect(
      repository.getRevision(reader, rootId, 9),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      repository.getRevision(reader, deletedId, 1),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });
});

describe("CloudBaseRecoveryReadRepository", () => {
  it("lists every tombstone for a workspace Owner and only scoped ones for an Owner grant", async () => {
    const member = new CloudBaseRecoveryReadRepository(
      client(workspace([])).reader,
      clock,
    );
    const page = await member.listTrash(owner, { limit: 1 });
    expect(page.items).toEqual([
      {
        id: deadScopeId,
        objectType: "event",
        displayName: "Dead scope",
        version: 3,
        deletedAt: "2029-12-20T00:00:00.000Z",
      },
    ]);
    const rest = await member.listTrash(owner, {
      limit: 5,
      cursor: page.nextCursor as string,
    });
    expect(rest.items.map((item) => item.id)).toEqual([deletedId]);
    expect(rest.nextCursor).toBeNull();
    expect(
      (await member.listTrash(owner, { objectType: "event" })).items.map(
        (item) => item.id,
      ),
    ).toEqual([deadScopeId]);

    const { reader: rdb, queries } = client(
      workspace([{ resource_id: rootId, role: "owner" }]),
    );
    const grantee = new CloudBaseRecoveryReadRepository(rdb, clock);
    expect(
      (await grantee.listTrash(reader)).items.map((item) => item.id),
    ).toEqual([deletedId]);
    // A grant holder's read is bounded to the granted ids and scopes.
    expect(
      queries
        .filter(({ table }) => table === "objects")
        .map(({ query }) => query.filters?.at(-1)?.column),
    ).toEqual(["id", "permission_scope_id"]);

    const viewer = new CloudBaseRecoveryReadRepository(
      client(workspace([{ resource_id: rootId, role: "viewer" }])).reader,
      clock,
    );
    expect((await viewer.listTrash(reader)).items).toEqual([]);
    await expect(
      viewer.listTrash(reader, { cursor: page.nextCursor as string }),
    ).rejects.toBeInstanceOf(InvalidObjectStateError);
  });

  it("previews a tombstone and reports a scope that is itself in Trash", async () => {
    const repository = new CloudBaseRecoveryReadRepository(
      client(
        workspace(
          [{ resource_id: deadScopeId, role: "owner" }],
          [{ user_id: ownerId, role: "owner" }],
        ),
      ).reader,
      clock,
    );
    expect(await repository.previewRecovery(owner, deletedId)).toEqual({
      object: {
        id: deletedId,
        objectType: "task",
        displayName: "Deleted child",
        version: 3,
        deletedAt: "2029-12-24T00:00:00.000Z",
      },
      canRecover: true,
      blockedReason: null,
    });
    expect(await repository.previewRecovery(owner, deadScopeId)).toMatchObject({
      canRecover: true,
      blockedReason: null,
    });
    const orphanRows = {
      ...workspace([{ resource_id: deadScopeId, role: "owner" }]),
      objects: objects.map((row) =>
        row.id === orphanId
          ? { ...row, deleted_at: "2029-12-26T00:00:00.000Z" }
          : row,
      ),
    };
    const orphaned = new CloudBaseRecoveryReadRepository(
      client(orphanRows).reader,
      clock,
    );
    expect(await orphaned.previewRecovery(reader, orphanId)).toMatchObject({
      object: { id: orphanId },
      canRecover: false,
      blockedReason:
        "Restore the canonical permission scope first. Recovery does not change permissions.",
    });
    await expect(
      orphaned.previewRecovery(reader, deletedId),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      repository.previewRecovery(owner, childId),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      repository.previewRecovery(owner, "00000000-0000-7000-8000-0000000000ee"),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });
});
