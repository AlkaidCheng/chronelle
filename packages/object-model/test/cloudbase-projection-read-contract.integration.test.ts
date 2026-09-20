import { resolve } from "node:path";

import { AuthorizationDeniedError } from "@chronelle/authorization";
import type { UserPrincipal } from "@chronelle/authorization";
import {
  createId,
  documents,
  events,
  expenses,
  objectRelations,
  objects,
  personContacts,
  personLabels,
  persons,
  reminders,
  resourceGrants,
  labels,
  taskLabels,
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

import { CloudBaseCalendarReadRepository } from "../src/cloudbase-calendar-read-repository.js";
import { CloudBaseProjectionReadRepository } from "../src/cloudbase-projection-read-repository.js";
import { EventPlanningProjectionService } from "../src/projection-service.js";
import type { EventDetailProjection } from "../src/types.js";

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
      default:
        return false;
    }
  });
}

const snapshotTables = {
  documents,
  events,
  expenses,
  object_relations: objectRelations,
  objects,
  person_contacts: personContacts,
  person_labels: personLabels,
  persons,
  reminders,
  resource_grants: resourceGrants,
  tasks,
  task_labels: taskLabels,
  labels,
  workspace_members: workspaceMembers,
} as const;

/** One PostgreSQL row under its SQL column names, instants as ISO text and numeric or bigint columns as their canonical text. */
function canonicalRow(
  table: Table,
  record: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(getTableColumns(table)).map(([property, column]) => {
      const value = record[property];
      return [
        column.name,
        value instanceof Date
          ? value.toISOString()
          : typeof value === "bigint"
            ? value.toString()
            : value,
      ];
    }),
  );
}

const numericColumns = new Set(["amount", "size_bytes"]);

/** Encodes a row the way the gateway serves a column list: numeric and bigint columns become JSON numbers unless the list casts them to text. */
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

/**
 * Serves the workspace rows PostgreSQL holds through the RDB transport
 * boundary, so both backends read one dataset.
 */
async function snapshotClient(
  db: Database,
  workspaceId: string,
): Promise<CloudBaseRdbReader> {
  const rows = new Map<string, Record<string, unknown>[]>();
  for (const [name, table] of Object.entries(snapshotTables)) {
    const records = await db
      .select()
      .from(table)
      .where(eq(table.workspaceId, workspaceId));
    rows.set(
      name,
      records.map((record) =>
        canonicalRow(table, record as Record<string, unknown>),
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
      const matching = tableRows
        .filter((row) => matches(row, query))
        .map((row) => gatewayRow(row, query.columns));
      return (query.limit === undefined
        ? matching
        : matching.slice(0, query.limit)) as unknown as readonly T[];
    },
  };
}

function sortedDetail(detail: EventDetailProjection) {
  const byId = <Item extends { readonly id: string }>(items: readonly Item[]) =>
    [...items].sort((first, second) => first.id.localeCompare(second.id));
  return {
    event: detail.event,
    events: byId(detail.events),
    tasks: byId(detail.tasks),
    expenses: byId(detail.expenses),
    reminders: byId(detail.reminders),
    persons: byId(detail.persons),
    documents: byId(detail.documents),
    lockedRelationCount: detail.lockedRelationCount,
  };
}

describe.sequential("CloudBase projection read contract", () => {
  it("matches PostgreSQL detail, to-do, timeline, itinerary, expense, and reminder projections for members and grantees", async () => {
    const db = database.connection.db;
    const ownerId = createId();
    const viewerId = createId();
    const expiredViewerId = createId();
    const strangerId = createId();
    const workspaceId = createId();
    const rootId = createId();
    const festivalId = createId();
    const retiredScopeId = createId();
    const unrelatedId = createId();
    const datedChildId = createId();
    const timedChildId = createId();
    const privateChildId = createId();
    const festivalChildId = createId();
    const retiredScopedChildId = createId();
    const deletedChildId = createId();
    const unlinkedTaskId = createId();
    const earlyTaskId = createId();
    const lateTaskId = createId();
    const undatedTaskId = createId();
    const privateTaskId = createId();
    const firstExpenseId = createId();
    const secondExpenseId = createId();
    const firstReminderId = createId();
    const secondReminderId = createId();
    // Two people involved, listed by name without regard to case.
    const zoePersonId = createId();
    const adamPersonId = createId();
    const includedDocumentId = createId();
    const attachedDocumentId = createId();
    const privateDocumentId = createId();
    const deletedDocumentId = createId();
    const principal = (userId: string): UserPrincipal => ({
      type: "user",
      userId,
      workspaceId,
    });
    const owner = principal(ownerId);
    const viewer = principal(viewerId);
    const expiredViewer = principal(expiredViewerId);
    const stranger = principal(strangerId);

    await db.insert(users).values(
      [ownerId, viewerId, expiredViewerId, strangerId].map((id) => ({
        id,
        identityProvider: "test",
        providerSubject: id,
        displayName: "Projection principal",
      })),
    );
    await db.insert(workspaces).values({
      id: workspaceId,
      createdBy: ownerId,
      displayName: "CloudBase projection contract",
    });
    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: ownerId,
      role: "owner",
    });
    // Most children inherit the root's scope. The private children own
    // theirs, one child inherits a live foreign scope, one a deleted foreign
    // scope, and deleted objects must never appear or count.
    const at = (iso: string) => new Date(iso);
    await db.insert(objects).values(
      [
        {
          id: rootId,
          objectType: "event",
          scope: rootId,
          name: "Launch night",
        },
        {
          id: festivalId,
          objectType: "event",
          scope: festivalId,
          name: "Festival week",
        },
        {
          id: retiredScopeId,
          objectType: "event",
          scope: retiredScopeId,
          name: "Retired programme",
          deletedAt: at("2030-01-01T00:00:00Z"),
        },
        {
          id: unrelatedId,
          objectType: "event",
          scope: unrelatedId,
          name: "Unrelated planning",
        },
        {
          id: datedChildId,
          objectType: "event",
          scope: rootId,
          name: "Venue walkthrough",
        },
        { id: timedChildId, objectType: "event", scope: rootId, name: "Doors" },
        {
          id: privateChildId,
          objectType: "event",
          scope: privateChildId,
          name: "Private budget review",
        },
        {
          id: festivalChildId,
          objectType: "event",
          scope: festivalId,
          name: "Festival opening",
        },
        {
          id: retiredScopedChildId,
          objectType: "event",
          scope: retiredScopeId,
          name: "Retired opening",
        },
        {
          id: deletedChildId,
          objectType: "event",
          scope: rootId,
          name: "Cancelled rehearsal",
          deletedAt: at("2030-01-01T00:00:00Z"),
        },
        {
          id: unlinkedTaskId,
          objectType: "task",
          scope: rootId,
          name: "Removed link",
        },
        { id: earlyTaskId, objectType: "task", scope: rootId, name: "Book" },
        { id: lateTaskId, objectType: "task", scope: rootId, name: "Confirm" },
        {
          id: undatedTaskId,
          objectType: "task",
          scope: rootId,
          name: "Someday",
        },
        {
          id: privateTaskId,
          objectType: "task",
          scope: privateTaskId,
          name: "Private task",
        },
        {
          id: firstExpenseId,
          objectType: "expense",
          scope: rootId,
          name: "Deposit",
        },
        {
          id: secondExpenseId,
          objectType: "expense",
          scope: rootId,
          name: "Catering",
        },
        {
          id: firstReminderId,
          objectType: "reminder",
          scope: rootId,
          name: "Call venue",
        },
        {
          id: secondReminderId,
          objectType: "reminder",
          scope: rootId,
          name: "Send invites",
        },
        { id: zoePersonId, objectType: "person", scope: rootId, name: "Zoe" },
        {
          id: adamPersonId,
          objectType: "person",
          scope: rootId,
          name: "adam",
        },
        {
          id: includedDocumentId,
          objectType: "document",
          scope: rootId,
          name: "Run sheet",
        },
        {
          id: attachedDocumentId,
          objectType: "document",
          scope: rootId,
          name: "Contract",
        },
        {
          id: privateDocumentId,
          objectType: "document",
          scope: privateDocumentId,
          name: "Private contract",
        },
        {
          id: deletedDocumentId,
          objectType: "document",
          scope: rootId,
          name: "Old contract",
          deletedAt: at("2030-01-01T00:00:00Z"),
        },
      ].map(({ scope, name, ...row }) => ({
        ...row,
        workspaceId,
        displayName: name,
        permissionScopeId: scope,
        createdBy: ownerId,
        objectType: row.objectType as
          "event" | "task" | "expense" | "reminder" | "document",
      })),
    );
    await db.insert(events).values(
      [
        { objectId: rootId, startsAt: at("2030-01-16T18:00:00Z") },
        {
          objectId: festivalId,
          startsOn: "2030-01-05",
          endsOn: "2030-01-12",
        },
        { objectId: retiredScopeId },
        { objectId: unrelatedId, startsOn: "2030-02-01" },
        {
          objectId: datedChildId,
          startsOn: "2030-01-10",
          endsOn: "2030-01-11",
        },
        { objectId: timedChildId, startsAt: at("2030-01-16T17:30:00Z") },
        { objectId: privateChildId, startsAt: at("2030-01-12T09:00:00Z") },
        { objectId: festivalChildId, startsAt: at("2030-01-06T10:00:00Z") },
        {
          objectId: retiredScopedChildId,
          startsAt: at("2030-01-07T10:00:00Z"),
        },
        { objectId: deletedChildId, startsAt: at("2030-01-15T10:00:00Z") },
      ].map((row) => ({ ...row, workspaceId, timezone: "UTC" })),
    );
    await db.insert(tasks).values(
      [
        { objectId: unlinkedTaskId, dueAt: at("2030-01-02T09:00:00Z") },
        { objectId: earlyTaskId, dueAt: at("2030-01-08T09:00:00Z") },
        { objectId: lateTaskId, dueAt: at("2030-01-14T09:00:00Z") },
        { objectId: undatedTaskId, dueAt: null },
        { objectId: privateTaskId, dueAt: at("2030-01-09T09:00:00Z") },
      ].map((row) => ({ ...row, workspaceId, status: "todo" as const })),
    );
    await db.insert(expenses).values(
      [
        { objectId: firstExpenseId, occurredAt: at("2030-01-03T12:00:00Z") },
        { objectId: secondExpenseId, occurredAt: at("2030-01-13T12:00:00Z") },
      ].map((row) => ({
        ...row,
        workspaceId,
        amount: "125.5000",
        currency: "USD",
      })),
    );
    await db.insert(reminders).values(
      [
        { objectId: firstReminderId, remindAt: at("2030-01-04T08:00:00Z") },
        { objectId: secondReminderId, remindAt: at("2030-01-11T08:00:00Z") },
      ].map((row) => ({ ...row, workspaceId, status: "pending" as const })),
    );
    await db.insert(persons).values([
      { objectId: zoePersonId, workspaceId },
      { objectId: adamPersonId, workspaceId },
    ]);
    await db.insert(documents).values(
      [
        includedDocumentId,
        attachedDocumentId,
        privateDocumentId,
        deletedDocumentId,
      ].map((objectId, index) => ({
        objectId,
        workspaceId,
        storageProvider: "local",
        storageKey: `documents/${objectId}`,
        originalFilename: `document-${index}.pdf`,
        mimeType: "application/pdf",
        sizeBytes: BigInt(1024 * (index + 1)),
        checksumSha256: "a".repeat(64),
      })),
    );
    const relation = (
      sourceObjectId: string,
      relationType: "includes" | "attached_to",
      targetObjectId: string,
      deletedAt: Date | null = null,
    ) => ({
      id: createId(),
      workspaceId,
      sourceObjectId,
      relationType,
      targetObjectId,
      createdBy: ownerId,
      deletedAt,
    });
    await db
      .insert(objectRelations)
      .values([
        ...[
          datedChildId,
          timedChildId,
          privateChildId,
          festivalChildId,
          retiredScopedChildId,
          deletedChildId,
          earlyTaskId,
          lateTaskId,
          undatedTaskId,
          privateTaskId,
          firstExpenseId,
          secondExpenseId,
          firstReminderId,
          secondReminderId,
          zoePersonId,
          adamPersonId,
          includedDocumentId,
        ].map((targetObjectId) => relation(rootId, "includes", targetObjectId)),
        relation(
          rootId,
          "includes",
          unlinkedTaskId,
          at("2030-01-02T00:00:00Z"),
        ),
        relation(attachedDocumentId, "attached_to", rootId),
        relation(privateDocumentId, "attached_to", rootId),
        relation(deletedDocumentId, "attached_to", rootId),
        relation(includedDocumentId, "attached_to", rootId),
      ]);
    // The viewer holds live grants on the root, the festival, and the
    // retired scope; the expired viewer's grant on the root has lapsed.
    await db.insert(resourceGrants).values([
      ...[rootId, festivalId, retiredScopeId].map((resourceId) => ({
        id: createId(),
        workspaceId,
        resourceId,
        principalId: viewerId,
        role: "viewer" as const,
        grantedBy: ownerId,
        expiresAt: at("2099-01-01T00:00:00Z"),
      })),
      {
        id: createId(),
        workspaceId,
        resourceId: rootId,
        principalId: expiredViewerId,
        role: "viewer",
        grantedBy: ownerId,
        createdAt: at("1999-01-01T00:00:00Z"),
        expiresAt: at("2000-01-01T00:00:00Z"),
      },
    ]);

    const client = await snapshotClient(db, workspaceId);
    const clock = () => new Date();
    const postgres = new EventPlanningProjectionService(db);
    const cloudbase = new EventPlanningProjectionService(
      db,
      new CloudBaseCalendarReadRepository(client, clock),
      new CloudBaseProjectionReadRepository(client, clock),
    );
    const ids = (resources: readonly { readonly id: string }[]) =>
      resources.map(({ id }) => id);

    const expectations = [
      {
        principal: owner,
        events: [
          datedChildId,
          festivalChildId,
          privateChildId,
          retiredScopedChildId,
          timedChildId,
        ],
        tasks: [earlyTaskId, privateTaskId, lateTaskId, undatedTaskId],
        documents: [includedDocumentId, attachedDocumentId, privateDocumentId],
        lockedRelationCount: 0,
      },
      {
        principal: viewer,
        events: [datedChildId, festivalChildId, timedChildId],
        tasks: [earlyTaskId, lateTaskId, undatedTaskId],
        documents: [includedDocumentId, attachedDocumentId],
        lockedRelationCount: 4,
      },
    ] as const;

    for (const expected of expectations) {
      const postgresDetail = await postgres.getDetail(
        expected.principal,
        rootId,
      );
      const cloudbaseDetail = await cloudbase.getDetail(
        expected.principal,
        rootId,
      );
      expect(postgresDetail.event.id).toBe(rootId);
      expect(new Set(ids(postgresDetail.events))).toEqual(
        new Set(expected.events),
      );
      expect(new Set(ids(postgresDetail.tasks))).toEqual(
        new Set(expected.tasks),
      );
      expect(new Set(ids(postgresDetail.documents))).toEqual(
        new Set(expected.documents),
      );
      expect(postgresDetail.lockedRelationCount).toBe(
        expected.lockedRelationCount,
      );
      expect(sortedDetail(cloudbaseDetail)).toEqual(
        sortedDetail(postgresDetail),
      );
      const summary = ({
        id,
        displayName,
      }: {
        id: string;
        displayName: string;
      }) => ({ id, displayName });
      for (const [service, detail] of [
        [postgres, postgresDetail],
        [cloudbase, cloudbaseDetail],
      ] as const) {
        await expect(
          service.getAttachmentTargets(expected.principal, rootId),
        ).resolves.toEqual({
          event: summary(detail.event),
          tasks: detail.tasks.map(summary),
          expenses: detail.expenses.map(summary),
        });
      }

      const postgresTodos = await postgres.getTodos(expected.principal, rootId);
      expect(ids(postgresTodos.items)).toEqual(expected.tasks);
      await expect(
        cloudbase.getTodos(expected.principal, rootId),
      ).resolves.toEqual(postgresTodos);

      const postgresExpenses = await postgres.getExpenses(
        expected.principal,
        rootId,
      );
      expect(ids(postgresExpenses.items)).toEqual([
        secondExpenseId,
        firstExpenseId,
      ]);
      await expect(
        cloudbase.getExpenses(expected.principal, rootId),
      ).resolves.toEqual(postgresExpenses);

      const postgresReminders = await postgres.getReminders(
        expected.principal,
        rootId,
      );
      expect(ids(postgresReminders.items)).toEqual([
        firstReminderId,
        secondReminderId,
      ]);
      await expect(
        cloudbase.getReminders(expected.principal, rootId),
      ).resolves.toEqual(postgresReminders);

      const postgresPeople = await postgres.getPeople(
        expected.principal,
        rootId,
      );
      expect(ids(postgresPeople.items)).toEqual([adamPersonId, zoePersonId]);
      await expect(
        cloudbase.getPeople(expected.principal, rootId),
      ).resolves.toEqual(postgresPeople);

      const postgresTimeline = await postgres.getTimeline(
        expected.principal,
        rootId,
      );
      expect(
        postgresTimeline.items.map((item) => item.canonicalObjectId),
      ).not.toContain(undatedTaskId);
      expect(postgresTimeline.items.map((item) => item.objectType)).toEqual(
        expect.arrayContaining(["event", "task", "expense", "reminder"]),
      );
      await expect(
        cloudbase.getTimeline(expected.principal, rootId),
      ).resolves.toEqual(postgresTimeline);

      const postgresItinerary = await postgres.getItinerary(
        expected.principal,
        rootId,
      );
      expect(new Set(ids(postgresItinerary.items))).toEqual(
        new Set(expected.events),
      );
      await expect(
        cloudbase.getItinerary(expected.principal, rootId),
      ).resolves.toEqual(postgresItinerary);
    }

    for (const [denied, eventId] of [
      [viewer, unrelatedId],
      [expiredViewer, rootId],
      [stranger, rootId],
      [owner, earlyTaskId],
    ] as const) {
      for (const service of [postgres, cloudbase]) {
        await expect(service.getDetail(denied, eventId)).rejects.toBeInstanceOf(
          AuthorizationDeniedError,
        );
        await expect(service.getTodos(denied, eventId)).rejects.toBeInstanceOf(
          AuthorizationDeniedError,
        );
        await expect(
          service.getAttachmentTargets(denied, eventId),
        ).rejects.toBeInstanceOf(AuthorizationDeniedError);
      }
    }
  });
});
