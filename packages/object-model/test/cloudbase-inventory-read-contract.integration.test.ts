import { resolve } from "node:path";

import {
  AuthorizationDeniedError,
  ResourceGrantService,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  createId,
  documents,
  events,
  expenses,
  objectRelations,
  objectRevisions,
  objects,
  reminders,
  resourceGrants,
  tasks,
  users,
  workspaceMembers,
  workspaces,
} from "@chronelle/db";
import type {
  CloudBaseRdbReader,
  CloudBaseRdbQuery,
  Database,
} from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { eq, getTableColumns, type Table } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseGrantReadRepository } from "../src/cloudbase-grant-read-repository.js";
import { CloudBaseObjectReadRepository } from "../src/cloudbase-object-read-repository.js";
import { CloudBaseRecoveryReadRepository } from "../src/cloudbase-recovery-read-repository.js";
import { CloudBaseRelationReadRepository } from "../src/cloudbase-relation-read-repository.js";
import { CloudBaseRevisionReadRepository } from "../src/cloudbase-revision-read-repository.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import { ObjectRecoveryService } from "../src/recovery-service.js";
import { ObjectRelationService } from "../src/relation-service.js";
import { ObjectRevisionService } from "../src/revision-service.js";
import type { MutationContext } from "../src/types.js";

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
});

afterAll(async () => {
  await database?.close();
});

const snapshotTables = {
  documents,
  events,
  expenses,
  object_relations: objectRelations,
  object_revisions: objectRevisions,
  objects,
  reminders,
  resource_grants: resourceGrants,
  tasks,
  users,
  workspace_members: workspaceMembers,
} as const;

/** One PostgreSQL row keyed by SQL column name, holding the driver's values. */
interface SnapshotRow {
  readonly raw: Record<string, unknown>;
  readonly encoded: Record<string, unknown>;
}

/**
 * Encodes one value the way the gateway serializes it: ISO instants, and JSON
 * numbers for numeric and bigint columns (which rounds a bigint beyond 2^53
 * and drops the numeric scale) unless the select list casts the column with
 * `::text`, in which case PostgreSQL's text representation is returned.
 */
function gatewayValue(value: unknown, cast: string | undefined): unknown {
  if (cast === "text")
    return value === null || value instanceof Date ? value : String(value);
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && /^-?\d+(?:\.\d+)?$/.test(value))
    return Number(value);
  return value;
}

function snapshotRow(table: Table, record: Record<string, unknown>) {
  const raw = Object.fromEntries(
    Object.entries(getTableColumns(table)).map(([property, column]) => [
      column.name,
      record[property],
    ]),
  );
  return {
    raw,
    encoded: Object.fromEntries(
      Object.entries(raw).map(([name, value]) => [
        name,
        gatewayValue(value, undefined),
      ]),
    ),
  } satisfies SnapshotRow;
}

/** Applies a select list with optional `column::cast` entries to one row. */
function project(
  row: SnapshotRow,
  columns: string | undefined,
): Record<string, unknown> {
  if (columns === undefined || columns === "*") return row.encoded;
  return Object.fromEntries(
    columns.split(",").map((entry) => {
      const [name, cast] = entry.split("::") as [string, string | undefined];
      return [name, gatewayValue(row.raw[name], cast)];
    }),
  );
}

function matches(
  row: Record<string, unknown>,
  query: CloudBaseRdbQuery,
): boolean {
  return (query.filters ?? []).every((filter) => {
    const value = row[filter.column];
    switch (filter.operator) {
      case "eq":
      case "is":
        return value === filter.value;
      case "in":
        return (filter.value as readonly unknown[]).includes(value);
      case "ilike":
        return String(value)
          .toLocaleLowerCase()
          .includes(
            String(filter.value).replaceAll("%", "").toLocaleLowerCase(),
          );
      default:
        return false;
    }
  });
}

function compareValues(first: unknown, second: unknown): number {
  if (first === second) return 0;
  if (first === null || first === undefined) return 1;
  if (second === null || second === undefined) return -1;
  return first < second ? -1 : 1;
}

/**
 * Serves the rows PostgreSQL holds through the RDB transport boundary, with
 * the filter, order, and limit semantics of the gateway, so both backends
 * read one dataset.
 */
async function snapshotClient(db: Database): Promise<CloudBaseRdbReader> {
  const rows = new Map<string, SnapshotRow[]>();
  for (const [name, table] of Object.entries(snapshotTables)) {
    const records = await db.select().from(table);
    rows.set(
      name,
      records.map((record) =>
        snapshotRow(table, record as Record<string, unknown>),
      ),
    );
  }
  return {
    capabilities: {
      transactions: false,
      nativeTcp: false,
      serverFunctions: false,
    },
    async select<T>(table: string, query: CloudBaseRdbQuery = {}) {
      const tableRows = rows.get(table);
      if (tableRows === undefined) throw new Error(`unexpected table ${table}`);
      const matching = tableRows.filter((row) => matches(row.encoded, query));
      for (const order of [...(query.order ?? [])].reverse()) {
        matching.sort((first, second) => {
          const comparison = compareValues(
            first.encoded[order.column],
            second.encoded[order.column],
          );
          return order.ascending === false ? -comparison : comparison;
        });
      }
      const offset = query.offset ?? 0;
      const page =
        query.limit === undefined
          ? matching.slice(offset)
          : matching.slice(offset, offset + query.limit);
      return page.map((row) =>
        project(row, query.columns),
      ) as unknown as readonly T[];
    },
  };
}

interface Fixture {
  readonly principals: {
    readonly owner: UserPrincipal;
    readonly viewer: UserPrincipal;
    readonly delegate: UserPrincipal;
  };
  readonly ids: {
    readonly root: string;
    readonly taskA: string;
    readonly taskB: string;
    readonly taskC: string;
    readonly expense: string;
    readonly reminder: string;
    readonly document: string;
    readonly privateEvent: string;
    readonly deletedTask: string;
    readonly deletedRoot: string;
    readonly orphanLive: string;
    readonly orphanDeleted: string;
    readonly removedRelation: string;
    readonly missing: string;
  };
  readonly backends: readonly (readonly [
    "postgres" | "cloudbase",
    {
      readonly objects: EventPlanningObjectService;
      readonly relations: ObjectRelationService;
      readonly shares: ResourceGrantService;
      readonly revisions: ObjectRevisionService;
      readonly recovery: ObjectRecoveryService;
    },
  ])[];
}

const clock = () => new Date("2030-01-01T00:00:00.000Z");

async function fixture(): Promise<Fixture> {
  const db = database.connection.db;
  const workspaceId = createId();
  const ownerId = createId();
  const viewerId = createId();
  const delegateId = createId();
  const expiredId = createId();
  const owner: UserPrincipal = { type: "user", userId: ownerId, workspaceId };
  const viewer: UserPrincipal = { type: "user", userId: viewerId, workspaceId };
  const delegate: UserPrincipal = {
    type: "user",
    userId: delegateId,
    workspaceId,
  };
  const context = (principal: UserPrincipal): MutationContext => ({
    principal,
    requestId: createId(),
  });

  await db.insert(users).values(
    (
      [
        [ownerId, "Workspace owner"],
        [viewerId, "Grant viewer"],
        [delegateId, "Grant delegate"],
        [expiredId, "Expired viewer"],
      ] as const
    ).map(([id, displayName]) => ({
      id,
      identityProvider: "test",
      providerSubject: id,
      displayName,
      email: `${id}@example.test`,
    })),
  );
  await db.insert(workspaces).values({
    id: workspaceId,
    createdBy: ownerId,
    displayName: "Inventory contract",
  });
  await db
    .insert(workspaceMembers)
    .values({ workspaceId, userId: ownerId, role: "owner" });

  const objectService = new EventPlanningObjectService(db, clock);
  const relationService = new ObjectRelationService(db, clock);
  const shareService = new ResourceGrantService(db, clock);
  const recoveryService = new ObjectRecoveryService(db);

  // The root Event is edited three times so its history spans two pages.
  let root = await objectService.createEvent(context(owner), {
    displayName: "Launch night",
    startsAt: new Date("2030-02-01T18:00:00Z"),
    timezone: "UTC",
  });
  for (const displayName of ["Launch night v2", "Launch night v3", "Launch"]) {
    root = await objectService.updateEvent(context(owner), root.id, {
      displayName,
      expectedVersion: root.version,
    });
  }
  const child = async (displayName: string, permissionScopeId = root.id) => {
    const task = await objectService.createTask(context(owner), {
      displayName,
      permissionScopeId,
      dueAt: new Date("2030-02-02T09:00:00Z"),
    });
    return task.id;
  };
  const taskA = await child("Book the venue");
  const taskB = await child("Print badges");
  const taskC = await child("Order catering");
  const expense = (
    await objectService.createExpense(context(owner), {
      displayName: "Deposit",
      permissionScopeId: root.id,
      amount: "250.0000",
      currency: "USD",
      occurredAt: new Date("2030-01-15T12:00:00Z"),
    })
  ).id;
  const reminder = (
    await objectService.createReminder(context(owner), {
      displayName: "Confirm headcount",
      permissionScopeId: root.id,
      remindAt: new Date("2030-01-30T09:00:00Z"),
    })
  ).id;
  const documentId = createId();
  await db.insert(objects).values({
    id: documentId,
    workspaceId,
    objectType: "document",
    displayName: "Floor plan.pdf",
    createdBy: ownerId,
    permissionScopeId: root.id,
  });
  await db.insert(documents).values({
    objectId: documentId,
    workspaceId,
    storageProvider: "local-filesystem",
    storageKey: `${workspaceId}/${documentId}`,
    originalFilename: "Floor plan.pdf",
    mimeType: "application/pdf",
    sizeBytes: 9_007_199_254_740_993n,
    checksumSha256: "a".repeat(64),
  });
  const privateEvent = (
    await objectService.createEvent(context(owner), {
      displayName: "Private budget review",
    })
  ).id;
  const deletedTask = await child("Cancelled rehearsal");
  const deletedRoot = (
    await objectService.createEvent(context(owner), {
      displayName: "Abandoned plan",
    })
  ).id;
  const orphanLive = await child(
    "Still live under a deleted scope",
    deletedRoot,
  );
  const orphanDeleted = await child(
    "Deleted under a deleted scope",
    deletedRoot,
  );

  const link = (
    sourceObjectId: string,
    relationType: "includes" | "related_to" | "reminds_about",
    targetObjectId: string,
  ) =>
    relationService.create(context(owner), {
      sourceObjectId,
      relationType,
      targetObjectId,
    });
  for (const targetObjectId of [taskA, taskB, expense, reminder, documentId])
    await link(root.id, "includes", targetObjectId);
  const removable = await link(root.id, "includes", taskC);
  await link(root.id, "related_to", privateEvent);
  await link(reminder, "reminds_about", root.id);
  await relationService.softDelete(context(owner), removable.id, 1);

  await shareService.share(context(owner), {
    principalEmail: `${viewerId}@example.test`,
    resourceId: root.id,
    role: "viewer",
  });
  await shareService.share(context(owner), {
    principalEmail: `${delegateId}@example.test`,
    resourceId: root.id,
    role: "owner",
  });
  await db.insert(resourceGrants).values([
    {
      id: createId(),
      workspaceId,
      resourceId: root.id,
      principalId: expiredId,
      role: "viewer",
      grantedBy: ownerId,
      createdAt: new Date("2019-06-01T00:00:00Z"),
      expiresAt: new Date("2020-01-01T00:00:00Z"),
    },
    {
      id: createId(),
      workspaceId,
      resourceId: deletedRoot,
      principalId: viewerId,
      role: "viewer",
      grantedBy: ownerId,
    },
  ]);
  // The delegate's grant carries a future expiry that both backends must keep active.
  await db
    .update(resourceGrants)
    .set({ expiresAt: new Date("2040-01-01T00:00:00Z") })
    .where(eq(resourceGrants.principalId, delegateId));

  for (const [objectId, version] of [
    [deletedTask, 1],
    [orphanDeleted, 1],
    [deletedRoot, 1],
  ] as const)
    await objectService.softDelete(context(owner), objectId, version);

  const client = await snapshotClient(db);
  return {
    principals: { owner, viewer, delegate },
    ids: {
      root: root.id,
      taskA,
      taskB,
      taskC,
      expense,
      reminder,
      document: documentId,
      privateEvent,
      deletedTask,
      deletedRoot,
      orphanLive,
      orphanDeleted,
      removedRelation: removable.id,
      missing: createId(),
    },
    backends: [
      [
        "postgres",
        {
          objects: objectService,
          relations: relationService,
          shares: shareService,
          revisions: new ObjectRevisionService(db),
          recovery: recoveryService,
        },
      ],
      [
        "cloudbase",
        {
          objects: new EventPlanningObjectService(db, clock, {
            objects: new CloudBaseObjectReadRepository(client, clock),
          }),
          relations: new ObjectRelationService(
            db,
            clock,
            undefined,
            new CloudBaseRelationReadRepository(client, clock),
          ),
          shares: new ResourceGrantService(
            db,
            clock,
            undefined,
            new CloudBaseGrantReadRepository(client, clock),
          ),
          revisions: new ObjectRevisionService(
            db,
            new CloudBaseRevisionReadRepository(client, clock),
          ),
          recovery: new ObjectRecoveryService(
            db,
            new CloudBaseRecoveryReadRepository(client, clock),
          ),
        },
      ],
    ],
  };
}

/** Runs one read on both backends, checks the PostgreSQL result, and requires the CloudBase result to match. */
async function differential<Value>(
  backends: Fixture["backends"],
  read: (backend: Fixture["backends"][number][1]) => Promise<Value>,
  check: (value: Value) => void = () => {},
): Promise<Value> {
  const results = new Map<string, Value>();
  for (const [name, backend] of backends)
    results.set(name, await read(backend));
  const postgres = results.get("postgres") as Value;
  check(postgres);
  expect(results.get("cloudbase")).toEqual(postgres);
  return postgres;
}

async function bothDeny(
  backends: Fixture["backends"],
  read: (backend: Fixture["backends"][number][1]) => Promise<unknown>,
): Promise<void> {
  for (const [, backend] of backends)
    await expect(read(backend)).rejects.toBeInstanceOf(
      AuthorizationDeniedError,
    );
}

const ids = (items: readonly { readonly id: string }[]) =>
  items.map(({ id }) => id);

describe.sequential("CloudBase inventory read contract", () => {
  it("matches PostgreSQL single-object reads, allowed actions, and visible lists", async () => {
    const { backends, ids: fixtureIds, principals } = await fixture();
    const { owner, viewer, delegate } = principals;

    for (const [principal, objectId] of [
      [owner, fixtureIds.root],
      [owner, fixtureIds.document],
      [owner, fixtureIds.orphanLive],
      [viewer, fixtureIds.taskA],
      [viewer, fixtureIds.expense],
      [delegate, fixtureIds.reminder],
    ] as const) {
      await differential(
        backends,
        (backend) => backend.objects.getObject(principal, objectId),
        (resource) => {
          expect(resource.id).toBe(objectId);
          expect(resource.deletedAt).toBeNull();
        },
      );
    }
    await differential(
      backends,
      (backend) => backend.objects.getEvent(viewer, fixtureIds.root),
      (event) => expect(event.displayName).toBe("Launch"),
    );
    await differential(backends, (backend) =>
      backend.objects.getTask(viewer, fixtureIds.taskB),
    );
    await differential(backends, (backend) =>
      backend.objects.getExpense(owner, fixtureIds.expense),
    );
    await differential(backends, (backend) =>
      backend.objects.getReminder(owner, fixtureIds.reminder),
    );
    await differential(
      backends,
      (backend) => backend.objects.getDocument(viewer, fixtureIds.document),
      (document) => expect(document.sizeBytes).toBe(9_007_199_254_740_993n),
    );

    // Denials: unauthorized, missing, tombstoned, wrong type, and an
    // inherited grant whose canonical scope is in Trash.
    await bothDeny(backends, (backend) =>
      backend.objects.getObject(viewer, fixtureIds.privateEvent),
    );
    await bothDeny(backends, (backend) =>
      backend.objects.getObject(owner, fixtureIds.missing),
    );
    await bothDeny(backends, (backend) =>
      backend.objects.getObject(owner, fixtureIds.deletedTask),
    );
    await bothDeny(backends, (backend) =>
      backend.objects.getTask(owner, fixtureIds.root),
    );
    await bothDeny(backends, (backend) =>
      backend.objects.getObject(viewer, fixtureIds.orphanLive),
    );

    await differential(
      backends,
      (backend) => backend.objects.getAllowedActions(viewer, fixtureIds.taskA),
      (actions) => expect(actions).toEqual(["view"]),
    );
    await differential(
      backends,
      (backend) =>
        backend.objects.getAllowedActions(delegate, fixtureIds.taskA),
      (actions) =>
        expect(actions).toEqual([
          "view",
          "comment",
          "edit",
          "share",
          "delete",
          "recover",
        ]),
    );
    await differential(
      backends,
      (backend) => backend.objects.getAllowedActions(owner, fixtureIds.root),
      (actions) => expect(actions).toHaveLength(6),
    );
    await bothDeny(backends, (backend) =>
      backend.objects.getAllowedActions(viewer, fixtureIds.privateEvent),
    );
    await bothDeny(backends, (backend) =>
      backend.objects.getAllowedActions(owner, fixtureIds.deletedTask),
    );

    const requested = [
      fixtureIds.taskA,
      fixtureIds.privateEvent,
      fixtureIds.deletedTask,
      fixtureIds.missing,
      fixtureIds.taskB,
      fixtureIds.taskA,
      fixtureIds.orphanLive,
    ];
    await differential(
      backends,
      (backend) => backend.objects.listVisibleObjects(viewer, requested),
      (resources) =>
        expect(ids(resources)).toEqual([
          fixtureIds.taskA,
          fixtureIds.taskB,
          fixtureIds.taskA,
        ]),
    );
    await differential(
      backends,
      (backend) => backend.objects.listVisibleObjects(owner, requested),
      (resources) =>
        expect(ids(resources)).toEqual([
          fixtureIds.taskA,
          fixtureIds.privateEvent,
          fixtureIds.taskB,
          fixtureIds.taskA,
          fixtureIds.orphanLive,
        ]),
    );
    await differential(
      backends,
      (backend) => backend.objects.listVisibleObjects(viewer, []),
      (resources) => expect(resources).toEqual([]),
    );
  });

  it("matches PostgreSQL relation pages and removed relations, including cursors", async () => {
    const { backends, ids: fixtureIds, principals } = await fixture();
    const { owner, viewer, delegate } = principals;

    const walk = async (
      principal: UserPrincipal,
      options: {
        readonly direction?: "both" | "incoming" | "outgoing";
        readonly relationType?: "includes" | "related_to" | "reminds_about";
        readonly otherObjectId?: string;
      } = {},
    ) =>
      differential(backends, async (backend) => {
        const pages = [];
        let cursor: string | undefined;
        do {
          const page = await backend.relations.listForObject(
            principal,
            fixtureIds.root,
            { ...options, limit: 3, cursor },
          );
          pages.push(page);
          cursor = page.nextCursor ?? undefined;
        } while (cursor !== undefined && pages.length < 5);
        return pages;
      });

    const viewerPages = await walk(viewer);
    expect(viewerPages.map((page) => page.items.length)).toEqual([3, 3]);
    expect(viewerPages[0]?.nextCursor).toEqual(expect.any(String));
    const viewerRelations = viewerPages.flatMap((page) => page.items);
    expect(
      new Set(
        viewerRelations.map((relation) =>
          relation.sourceObjectId === fixtureIds.root
            ? relation.targetObjectId
            : relation.sourceObjectId,
        ),
      ),
    ).toEqual(
      new Set([
        fixtureIds.taskA,
        fixtureIds.taskB,
        fixtureIds.expense,
        fixtureIds.reminder,
        fixtureIds.document,
      ]),
    );
    expect(viewerRelations.every((relation) => relation.version === 1)).toBe(
      true,
    );
    const ownerPages = await walk(owner);
    expect(ownerPages.flatMap((page) => page.items)).toHaveLength(7);
    expect(ownerPages.map((page) => page.items.length)).toEqual([3, 3, 1]);

    // The delegate's Owner grant on the root does not reach the self-scoped private Event.
    const outgoing = await walk(delegate, { direction: "outgoing" });
    expect(outgoing.flatMap((page) => page.items)).toHaveLength(5);
    const ownerOutgoing = await walk(owner, { direction: "outgoing" });
    expect(ownerOutgoing.flatMap((page) => page.items)).toHaveLength(6);
    const incoming = await walk(owner, { direction: "incoming" });
    expect(
      incoming.flatMap((page) => page.items).map((r) => r.sourceObjectId),
    ).toEqual([fixtureIds.reminder]);
    const includes = await walk(viewer, { relationType: "includes" });
    expect(includes.flatMap((page) => page.items)).toHaveLength(5);
    const single = await walk(owner, { otherObjectId: fixtureIds.taskA });
    expect(single.flatMap((page) => page.items)).toHaveLength(1);
    const hidden = await walk(viewer, {
      otherObjectId: fixtureIds.privateEvent,
    });
    expect(hidden.flatMap((page) => page.items)).toHaveLength(0);

    // The cursor of one backend is valid on the other; a cursor from another
    // query fails identically.
    const first = viewerPages[0]?.nextCursor as string;
    await differential(backends, (backend) =>
      backend.relations.listForObject(viewer, fixtureIds.root, {
        limit: 3,
        cursor: first,
      }),
    );
    for (const [, backend] of backends)
      await expect(
        backend.relations.listForObject(owner, fixtureIds.root, {
          limit: 3,
          cursor: first,
        }),
      ).rejects.toThrow("The relation cursor is invalid for this query.");

    await bothDeny(backends, (backend) =>
      backend.relations.listForObject(viewer, fixtureIds.privateEvent),
    );
    await bothDeny(backends, (backend) =>
      backend.relations.listForObject(owner, fixtureIds.deletedTask),
    );

    for (const principal of [owner, delegate]) {
      await differential(
        backends,
        (backend) =>
          backend.relations.listRemoved(principal, fixtureIds.root, {
            limit: 20,
          }),
        (page) => {
          expect(page.items).toHaveLength(1);
          expect(page.items[0]).toMatchObject({
            relation: {
              id: fixtureIds.removedRelation,
              version: 2,
              targetObjectId: fixtureIds.taskC,
            },
            sourceDisplayName: "Launch",
            targetDisplayName: "Order catering",
          });
          expect(page.items[0]?.relation.deletedAt).toBeInstanceOf(Date);
          expect(page.nextCursor).toBeNull();
        },
      );
    }
    // A viewer cannot edit the source, so the removed link is not listed.
    await differential(
      backends,
      (backend) =>
        backend.relations.listRemoved(viewer, fixtureIds.root, { limit: 20 }),
      (page) => expect(page.items).toEqual([]),
    );
    await differential(
      backends,
      (backend) =>
        backend.relations.listRemoved(owner, fixtureIds.taskC, {
          limit: 20,
          relationType: "related_to",
        }),
      (page) => expect(page.items).toEqual([]),
    );
    await bothDeny(backends, (backend) =>
      backend.relations.listRemoved(viewer, fixtureIds.privateEvent, {
        limit: 20,
      }),
    );
  });

  it("matches PostgreSQL grant lists with expiry and recovery-level authorization", async () => {
    const { backends, ids: fixtureIds, principals } = await fixture();
    const { owner, viewer, delegate } = principals;

    for (const principal of [owner, delegate]) {
      await differential(
        backends,
        (backend) => backend.shares.list(principal, fixtureIds.root),
        (grants) => {
          expect(grants.map((grant) => grant.role)).toEqual([
            "viewer",
            "owner",
          ]);
          expect(grants.map((grant) => grant.principal.displayName)).toEqual([
            "Grant viewer",
            "Grant delegate",
          ]);
          expect(grants[0]?.expiresAt).toBeNull();
          expect(grants[1]?.expiresAt).toEqual(
            new Date("2040-01-01T00:00:00Z"),
          );
          expect(grants[0]?.createdAt).toBeInstanceOf(Date);
        },
      );
    }
    await differential(
      backends,
      (backend) => backend.shares.list(owner, fixtureIds.taskA),
      (grants) => expect(grants).toEqual([]),
    );
    await differential(
      backends,
      (backend) => backend.shares.list(owner, fixtureIds.deletedRoot),
      (grants) => expect(grants.map((grant) => grant.role)).toEqual(["viewer"]),
    );
    await bothDeny(backends, (backend) =>
      backend.shares.list(viewer, fixtureIds.root),
    );
    await bothDeny(backends, (backend) =>
      backend.shares.list(delegate, fixtureIds.privateEvent),
    );
    await bothDeny(backends, (backend) =>
      backend.shares.list(owner, fixtureIds.missing),
    );
  });

  it("matches PostgreSQL revision pages and single revisions", async () => {
    const { backends, ids: fixtureIds, principals } = await fixture();
    const { owner, viewer } = principals;

    const firstPage = await differential(
      backends,
      (backend) =>
        backend.revisions.list(viewer, fixtureIds.root, { limit: 2 }),
      (page) => {
        expect(page.items.map((item) => item.objectVersion)).toEqual([4, 3]);
        expect(page.items.map((item) => item.mutationKind)).toEqual([
          "updated",
          "updated",
        ]);
        expect(page.items[0]?.actorDisplayName).toBe("Workspace owner");
        expect(page.nextBeforeVersion).toBe(3);
      },
    );
    await differential(
      backends,
      (backend) =>
        backend.revisions.list(viewer, fixtureIds.root, {
          limit: 2,
          beforeVersion: firstPage.nextBeforeVersion as number,
        }),
      (page) => {
        expect(page.items.map((item) => item.objectVersion)).toEqual([2, 1]);
        expect(page.items[1]?.mutationKind).toBe("created");
        expect(page.nextBeforeVersion).toBeNull();
      },
    );
    await differential(
      backends,
      (backend) =>
        backend.revisions.list(owner, fixtureIds.taskA, { limit: 25 }),
      (page) => expect(page.items).toHaveLength(1),
    );
    await differential(
      backends,
      (backend) => backend.revisions.get(viewer, fixtureIds.root, 2),
      (revision) => {
        expect(revision.objectVersion).toBe(2);
        expect(revision.snapshot).toMatchObject({
          objectType: "event",
          displayName: "Launch night v2",
        });
      },
    );
    await differential(backends, (backend) =>
      backend.revisions.get(owner, fixtureIds.expense, 1),
    );
    await bothDeny(backends, (backend) =>
      backend.revisions.get(viewer, fixtureIds.root, 9),
    );
    await bothDeny(backends, (backend) =>
      backend.revisions.list(viewer, fixtureIds.privateEvent, { limit: 25 }),
    );
    await bothDeny(backends, (backend) =>
      backend.revisions.get(owner, fixtureIds.deletedTask, 1),
    );
    await bothDeny(backends, (backend) =>
      backend.revisions.list(owner, fixtureIds.missing, { limit: 25 }),
    );
  });

  it("matches PostgreSQL Trash pages and recovery previews", async () => {
    const { backends, ids: fixtureIds, principals } = await fixture();
    const { owner, viewer, delegate } = principals;

    const walk = (
      principal: UserPrincipal,
      options: {
        readonly objectType?: "event" | "task";
        readonly scopeId?: string;
      } = {},
    ) =>
      differential(backends, async (backend) => {
        const pages = [];
        let cursor: string | undefined;
        do {
          const page = await backend.recovery.list(principal, {
            ...options,
            limit: 2,
            cursor,
          });
          pages.push(page);
          cursor = page.nextCursor ?? undefined;
        } while (cursor !== undefined && pages.length < 5);
        return pages;
      });

    const ownerPages = await walk(owner);
    expect(ownerPages.map((page) => page.items.length)).toEqual([2, 1]);
    expect(ownerPages[0]?.nextCursor).toEqual(expect.any(String));
    // Newest id first; ids are time-ordered by creation, not by deletion.
    expect(ids(ownerPages.flatMap((page) => page.items))).toEqual([
      fixtureIds.orphanDeleted,
      fixtureIds.deletedRoot,
      fixtureIds.deletedTask,
    ]);
    expect(ownerPages[0]?.items[1]).toMatchObject({
      objectType: "event",
      displayName: "Abandoned plan",
      version: 2,
      deletedAt: expect.stringMatching(/Z$/),
    });
    const delegatePages = await walk(delegate);
    expect(ids(delegatePages.flatMap((page) => page.items))).toEqual([
      fixtureIds.deletedTask,
    ]);
    const viewerPages = await walk(viewer);
    expect(viewerPages.flatMap((page) => page.items)).toEqual([]);
    const tasks = await walk(owner, { objectType: "task" });
    expect(ids(tasks.flatMap((page) => page.items))).toEqual([
      fixtureIds.orphanDeleted,
      fixtureIds.deletedTask,
    ]);
    // A scope filter matches the self-scoped root as well as its children.
    const scoped = await walk(owner, { scopeId: fixtureIds.deletedRoot });
    expect(ids(scoped.flatMap((page) => page.items))).toEqual([
      fixtureIds.orphanDeleted,
      fixtureIds.deletedRoot,
    ]);
    for (const [, backend] of backends)
      await expect(
        backend.recovery.list(delegate, {
          limit: 2,
          cursor: ownerPages[0]?.nextCursor as string,
        }),
      ).rejects.toThrow("The Trash cursor is invalid for this query.");

    await differential(
      backends,
      (backend) => backend.recovery.preview(owner, fixtureIds.deletedTask),
      (preview) =>
        expect(preview).toEqual({
          object: {
            id: fixtureIds.deletedTask,
            objectType: "task",
            displayName: "Cancelled rehearsal",
            version: 2,
            deletedAt: expect.any(String),
          },
          canRecover: true,
          blockedReason: null,
        }),
    );
    await differential(
      backends,
      (backend) => backend.recovery.preview(delegate, fixtureIds.deletedTask),
      (preview) => expect(preview.canRecover).toBe(true),
    );
    await differential(
      backends,
      (backend) => backend.recovery.preview(owner, fixtureIds.orphanDeleted),
      (preview) =>
        expect(preview).toMatchObject({
          canRecover: false,
          blockedReason:
            "Restore the canonical permission scope first. Recovery does not change permissions.",
        }),
    );
    await differential(
      backends,
      (backend) => backend.recovery.preview(owner, fixtureIds.deletedRoot),
      (preview) => expect(preview.canRecover).toBe(true),
    );
    await bothDeny(backends, (backend) =>
      backend.recovery.preview(owner, fixtureIds.taskA),
    );
    await bothDeny(backends, (backend) =>
      backend.recovery.preview(delegate, fixtureIds.deletedRoot),
    );
    await bothDeny(backends, (backend) =>
      backend.recovery.preview(viewer, fixtureIds.deletedTask),
    );
    await bothDeny(backends, (backend) =>
      backend.recovery.preview(owner, fixtureIds.missing),
    );
  });
});
