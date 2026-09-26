import {
  auditEvents,
  createId,
  documents,
  objectRevisions,
  objects,
  workspaceMembers,
  workspaces,
} from "@livtales/db";
import type { EventPage } from "@livtales/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseCommandReadRepository } from "../src/cloudbase-command-read-repository.js";
import { CloudBaseCommandWriteRepository } from "../src/cloudbase-command-write-repository.js";
import { CloudBaseEventLayoutReadRepository } from "../src/cloudbase-event-layout-read-repository.js";
import { CloudBaseEventLayoutWriteRepository } from "../src/cloudbase-event-layout-write-repository.js";
import { CloudBaseNoteReadRepository } from "../src/cloudbase-note-read-repository.js";
import { CloudBaseObjectLifecycleWriteRepository } from "../src/cloudbase-object-lifecycle-write-repository.js";
import { CloudBaseObjectReadRepository } from "../src/cloudbase-object-read-repository.js";
import { CloudBaseRevisionReadRepository } from "../src/cloudbase-revision-read-repository.js";
import { CloudBaseSharingWriteRepository } from "../src/cloudbase-sharing-write-repository.js";
import { CloudBaseStorageInventoryReadRepository } from "../src/cloudbase-storage-inventory-read-repository.js";
import { CloudBaseTaskWriteRepository } from "../src/cloudbase-task-write-repository.js";
import { ReversibleCommandService } from "../src/command-service.js";
import { EventContextService } from "../src/event-context-service.js";
import { EventLayoutService } from "../src/event-layout-service.js";
import {
  PostgresNoteReadRepository,
  type NoteReadRepository,
} from "../src/note-list.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import { ObjectRecoveryService } from "../src/recovery-service.js";
import { ObjectRestorationService } from "../src/restoration-service.js";
import {
  assertRevisionBaseline,
  baselineObjectRevisions,
} from "../src/revision-baseline.js";
import {
  PostgresRevisionReadRepository,
  type RevisionReadRepository,
} from "../src/revision-reads.js";
import {
  PostgresStorageInventoryReadRepository,
  type StorageInventoryReadRepository,
} from "../src/storage-inventory-reads.js";
import type { MutationContext } from "../src/types.js";
import { liveReader } from "./cloudbase-read-double.js";
import {
  createWriteHarness,
  mutationContext,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// History stays in the workspace where it was written. After an Event's
// whole scope changes workspace with the one update a move is made of,
// both backends must read that history as the objects' own, in the new
// workspace: revisions, restoration, the checks each later write makes on
// the version it replaces, an undo back to a version written before, the
// layout and its history, note editors, storage references, and the
// revision baseline; and the ledger rows must stay as they were written.

const provider = "local-filesystem";
const observedAt = new Date("2030-06-01T12:00:00.000Z");

let harness: WriteHarness;
/** The workspace the Events move to, where the harness owner is an Owner. */
let to: string;
let contexts: EventContextService;

interface Backend {
  readonly objects: EventPlanningObjectService;
  readonly recovery: ObjectRecoveryService;
  readonly restoration: ObjectRestorationService;
  readonly revisions: RevisionReadRepository;
  readonly layouts: EventLayoutService;
  readonly commands: ReversibleCommandService;
  readonly notes: NoteReadRepository;
  readonly storage: StorageInventoryReadRepository;
}

let reference: Backend;
let cloudbase: Backend;

beforeAll(async () => {
  harness = await createWriteHarness("Moved history");
  const db = harness.database.connection.db;
  to = createId();
  await db.insert(workspaces).values({
    id: to,
    createdBy: harness.ownerId,
    displayName: "Moved history, new space",
  });
  await db.insert(workspaceMembers).values({
    workspaceId: to,
    userId: harness.ownerId,
    role: "owner",
  });
  contexts = new EventContextService(db);
  reference = {
    objects: new EventPlanningObjectService(db),
    recovery: new ObjectRecoveryService(db),
    restoration: new ObjectRestorationService(db),
    revisions: new PostgresRevisionReadRepository(db),
    layouts: new EventLayoutService(db),
    commands: new ReversibleCommandService(db),
    notes: new PostgresNoteReadRepository(db),
    storage: new PostgresStorageInventoryReadRepository(db),
  };
  const reader = liveReader(db);
  const objectReads = new CloudBaseObjectReadRepository(reader);
  const revisions = new CloudBaseRevisionReadRepository(reader);
  const lifecycle = new CloudBaseObjectLifecycleWriteRepository(harness);
  cloudbase = {
    objects: new EventPlanningObjectService(db, undefined, undefined, {
      task: new CloudBaseTaskWriteRepository(harness),
      objectLifecycle: lifecycle,
      permissionScope: new CloudBaseSharingWriteRepository(harness),
    }),
    recovery: new ObjectRecoveryService(db, undefined, lifecycle),
    restoration: new ObjectRestorationService(db, lifecycle, {
      objects: objectReads,
      revisions,
    }),
    revisions,
    layouts: new EventLayoutService(
      db,
      new CloudBaseEventLayoutWriteRepository(harness),
      new CloudBaseEventLayoutReadRepository(reader, objectReads),
    ),
    commands: new ReversibleCommandService(
      db,
      new CloudBaseCommandWriteRepository(harness),
      new CloudBaseCommandReadRepository(harness),
    ),
    notes: new CloudBaseNoteReadRepository(harness),
    storage: new CloudBaseStorageInventoryReadRepository({
      ...reader,
      rpc: harness.rpc,
    }),
  };
});

afterAll(async () => {
  await harness?.database.close();
});

const backends = () =>
  [
    ["postgres", reference],
    ["cloudbase", cloudbase],
  ] as const;

/** A request of the harness owner in the workspace the history was written in. */
const before = (): MutationContext => mutationContext(harness);

/** A request of the harness owner in the workspace the Events move to. */
const after = (): MutationContext => ({
  principal: { type: "user", userId: harness.ownerId, workspaceId: to },
  requestId: createId(),
});

const overview: EventPage[] = [
  {
    id: "00000000-0000-7000-8000-0000000000a1",
    name: "Overview",
    components: [
      { id: "00000000-0000-7000-8000-0000000000b1", kind: "calendar" },
    ],
  },
];
const logistics: EventPage[] = [
  ...overview,
  {
    id: "00000000-0000-7000-8000-0000000000a2",
    name: "Logistics",
    components: [{ id: "00000000-0000-7000-8000-0000000000b2", kind: "todos" }],
  },
];

/**
 * A document of the Event with its creation revision, inserted directly.
 * Its keys name the new workspace's prefix, which the storage inventory
 * requires of every key it classifies, and its snapshot names an earlier
 * key, so only a read of the revision reports that one.
 */
async function insertDocument(eventId: string) {
  const id = createId();
  const auditEventId = createId();
  const requestId = createId();
  const key = () => `workspaces/${to}/documents/${createId()}`;
  const keys = { current: key(), earlier: key() };
  await harness.database.connection.db.transaction(async (transaction) => {
    await transaction.insert(objects).values({
      id,
      workspaceId: harness.workspaceId,
      objectType: "document",
      displayName: "Floor plan.pdf",
      createdBy: harness.ownerId,
      permissionScopeId: eventId,
    });
    await transaction.insert(documents).values({
      objectId: id,
      workspaceId: harness.workspaceId,
      storageProvider: provider,
      storageKey: keys.current,
      originalFilename: "Floor plan.pdf",
      mimeType: "application/pdf",
      sizeBytes: 12n,
      checksumSha256: "a".repeat(64),
    });
    await transaction.insert(auditEvents).values({
      id: auditEventId,
      workspaceId: harness.workspaceId,
      resourceId: id,
      actorType: "user",
      actorId: harness.ownerId,
      requestId,
      action: "document.created",
      metadata: {},
    });
    await transaction.insert(objectRevisions).values({
      id: createId(),
      workspaceId: harness.workspaceId,
      objectId: id,
      objectVersion: 1,
      mutationKind: "created",
      actorType: "user",
      actorId: harness.ownerId,
      requestId,
      auditEventId,
      snapshotSchemaVersion: 1,
      snapshot: {
        id,
        workspaceId: harness.workspaceId,
        objectType: "document",
        version: 1,
        displayName: "Floor plan.pdf",
        storageProvider: provider,
        storageKey: keys.earlier,
      },
    });
  });
  return { id, keys };
}

/**
 * An Event planned in the first workspace through the PostgreSQL services:
 * edits (the last one a command), tasks created by command with subtasks
 * (one pair in Trash), a note and a reminder created in its context, two
 * layouts, and a document.
 */
async function plannedEvent(name: string) {
  const { objects: service, layouts, commands } = reference;
  const event = await service.createEvent(before(), {
    displayName: name,
    startsOn: "2030-10-16",
    isAllDay: true,
    customProperties: { theme: "gold" },
  });
  await service.updateEvent(before(), event.id, {
    expectedVersion: 1,
    displayName: `${name}, revised`,
    customProperties: { theme: "silver" },
  });
  const stack = await commands.getState(before().principal);
  await commands.execute(before(), {
    operationId: createId(),
    expectedStackVersion: stack.version,
    edits: [
      {
        objectType: "event",
        objectId: event.id,
        patch: { expectedVersion: 2, displayName: `${name}, final` },
      },
    ],
  });
  const task = (label: string, parentTaskId?: string) =>
    service.createTask(before(), {
      displayName: label,
      permissionScopeId: event.id,
      commandId: createId(),
      ...(parentTaskId !== undefined && { parentTaskId }),
    });
  const trashed = await task("Badges");
  const trashedSubtask = await task("Lanyards", trashed.id);
  await service.softDelete(before(), trashed.id, 1);
  const live = await task("Seating");
  const liveSubtask = await task("Place cards", live.id);
  const edited = await task("Catering");
  await service.updateTask(before(), edited.id, {
    expectedVersion: 1,
    status: "in_progress",
  });
  const scoped = await task("Keynote");
  const { resource: note } = await contexts.create(before(), event.id, {
    commandId: createId(),
    resource: { objectType: "note", displayName: "Menu", body: "Dumplings" },
  });
  const { resource: reminder } = await contexts.create(before(), event.id, {
    commandId: createId(),
    resource: {
      objectType: "reminder",
      displayName: "Confirm the hall",
      remindAt: new Date("2030-10-01T09:00:00.000Z"),
    },
  });
  await layouts.update(before(), event.id, {
    expectedVersion: 0,
    pages: overview,
  });
  await layouts.update(before(), event.id, {
    expectedVersion: 1,
    pages: logistics,
  });
  const document = await insertDocument(event.id);
  return {
    event: event.id,
    trashed: trashed.id,
    trashedSubtask: trashedSubtask.id,
    live: live.id,
    liveSubtask: liveSubtask.id,
    edited: edited.id,
    scoped: scoped.id,
    note: note.id,
    reminder: reminder.id,
    document,
  };
}

type PlannedEvent = Awaited<ReturnType<typeof plannedEvent>>;

const scopeIds = (planned: PlannedEvent) => [
  planned.event,
  planned.trashed,
  planned.trashedSubtask,
  planned.live,
  planned.liveSubtask,
  planned.edited,
  planned.scoped,
  planned.note,
  planned.reminder,
  planned.document.id,
];

/** Moves an Event and everything in its scope, trashed records included. */
async function move(eventId: string) {
  await harness.database.connection.sql`
    UPDATE objects SET workspace_id = ${to} WHERE permission_scope_id = ${eventId}
  `;
}

/** Every ledger row that names one of the objects, whole. */
function ledgerRows(ids: readonly string[]) {
  const sql = harness.database.connection.sql;
  const named = sql.array([...ids]);
  return sql<{ ledger: string; workspace_id: string; row: unknown }[]>`
    SELECT ledger, workspace_id, row FROM (
      SELECT 'audit_events' AS ledger, a.workspace_id, to_jsonb(a) AS row
        FROM audit_events a WHERE a.resource_id = ANY(${named}::uuid[])
      UNION ALL SELECT 'object_revisions', r.workspace_id, to_jsonb(r)
        FROM object_revisions r WHERE r.object_id = ANY(${named}::uuid[])
      UNION ALL SELECT 'event_page_revisions', p.workspace_id, to_jsonb(p)
        FROM event_page_revisions p WHERE p.event_id = ANY(${named}::uuid[])
      UNION ALL SELECT 'command_changes', c.workspace_id, to_jsonb(c)
        FROM command_changes c WHERE c.object_id = ANY(${named}::uuid[])
      UNION ALL SELECT 'event_context_commands', c.workspace_id, to_jsonb(c)
        FROM event_context_commands c WHERE c.context_object_id = ANY(${named}::uuid[])
      UNION ALL SELECT 'object_create_commands', c.workspace_id, to_jsonb(c)
        FROM object_create_commands c WHERE c.object_id = ANY(${named}::uuid[])
    ) ledgers
    ORDER BY ledger, row::text
  `;
}

/** Where each revision of an object was written, with its kind and audit action. */
async function history(objectId: string) {
  const rows = await harness.database.connection.sql<
    {
      version: number;
      kind: string;
      action: string;
      direction: string | null;
      workspace_id: string;
    }[]
  >`
    SELECT r.object_version AS version, r.mutation_kind AS kind, a.action,
      a.metadata -> 'command' ->> 'direction' AS direction, r.workspace_id
    FROM object_revisions r JOIN audit_events a ON a.id = r.audit_event_id
    WHERE r.object_id = ${objectId}
    ORDER BY r.object_version
  `;
  return rows.map(({ workspace_id, ...row }) => ({
    ...row,
    space: workspace_id === to ? "new" : "old",
  }));
}

/** Where each layout revision of an Event was written, with its pages. */
async function layoutHistory(eventId: string) {
  const rows = await harness.database.connection.sql<
    { version: number; pages: unknown; workspace_id: string }[]
  >`
    SELECT version, pages, workspace_id FROM event_page_revisions
    WHERE event_id = ${eventId} ORDER BY version
  `;
  return rows.map(({ workspace_id, ...row }) => ({
    ...row,
    space: workspace_id === to ? "new" : "old",
  }));
}

/**
 * Plans an Event, moves it, and makes one of each write whose checks read
 * the version it replaces through one backend: a task edit, a recovery and
 * a deletion that take subtasks along, a scope change, a command and its
 * undo, a restore, and a layout restore. Returns what they leave, without
 * the per-run identifiers.
 */
async function writeAfterMove(backend: Backend) {
  const planned = await plannedEvent("Gala");
  await move(planned.event);
  const edited = await backend.objects.updateTask(after(), planned.edited, {
    expectedVersion: 2,
    displayName: "Catering, confirmed",
  });
  const recovered = await backend.recovery.recover(after(), planned.trashed, {
    expectedVersion: 2,
  });
  const deleted = await backend.objects.softDelete(after(), planned.live, 1);
  const rescoped = await backend.objects.updatePermissionScope(
    after(),
    planned.scoped,
    { expectedVersion: 1, permissionScopeId: planned.scoped },
  );
  // The command's version before is the one written in the old workspace,
  // and its undo restores that revision's content.
  const stack = await backend.commands.getState(after().principal);
  const executed = await backend.commands.execute(after(), {
    operationId: createId(),
    expectedStackVersion: stack.version,
    edits: [
      {
        objectType: "event",
        objectId: planned.event,
        patch: { expectedVersion: 3, displayName: "Gala, moved" },
      },
    ],
  });
  const undone = await backend.commands.undo(after(), {
    operationId: createId(),
    commandId: executed.commandId,
    expectedStackVersion: executed.stackVersion,
  });
  const restored = await backend.restoration.restore(
    after(),
    planned.event,
    1,
    { expectedVersion: 5 },
  );
  const layout = await backend.layouts.restore(after(), planned.event, {
    expectedVersion: 2,
    targetVersion: 1,
  });
  const state = await reference.objects.getEvent(
    after().principal,
    planned.event,
  );
  return {
    versions: {
      edited: edited.version,
      recovered: recovered.version,
      deleted: deleted.version,
      rescoped: rescoped.version,
      executed: executed.objects.map(({ version }) => version),
      undone: undone.objects.map(({ version }) => version),
      restored: restored.version,
      layout: layout.version,
    },
    state: {
      displayName: state.displayName,
      customProperties: state.customProperties,
      startsOn: state.startsOn,
    },
    histories: {
      event: await history(planned.event),
      edited: await history(planned.edited),
      trashed: await history(planned.trashed),
      trashedSubtask: await history(planned.trashedSubtask),
      live: await history(planned.live),
      liveSubtask: await history(planned.liveSubtask),
      scoped: await history(planned.scoped),
    },
    layouts: await layoutHistory(planned.event),
  };
}

describe.sequential("history after an Event changes workspace", () => {
  it("leaves the ledgers where they were written and reads them identically", async () => {
    const planned = await plannedEvent("Launch night");
    const ids = scopeIds(planned);
    const written = await ledgerRows(ids);
    expect(new Set(written.map((row) => row.ledger))).toEqual(
      new Set([
        "audit_events",
        "object_revisions",
        "event_page_revisions",
        "command_changes",
        "event_context_commands",
        "object_create_commands",
      ]),
    );
    await move(planned.event);
    expect(await ledgerRows(ids)).toEqual(written);
    expect(
      written.every(({ workspace_id }) => workspace_id === harness.workspaceId),
    ).toBe(true);

    const principal = after().principal;
    const results = [];
    for (const [, backend] of backends()) {
      results.push({
        list: await backend.revisions.listRevisions(principal, planned.event, {
          limit: 25,
        }),
        firstPage: await backend.revisions.listRevisions(
          principal,
          planned.event,
          { limit: 1, beforeVersion: 3 },
        ),
        first: await backend.revisions.getRevision(principal, planned.event, 1),
        comparison: await backend.restoration.compare(
          principal,
          planned.event,
          { fromVersion: 1, toVersion: 3 },
        ),
        preview: await backend.restoration.preview(principal, planned.event, 1),
        layout: await backend.layouts.get(principal, planned.event),
        layouts: await backend.layouts.history(principal, planned.event, {
          limit: 10,
        }),
        notes: await backend.notes.listNotes(principal, planned.event),
        references: await backend.storage.loadReferences(
          principal,
          provider,
          observedAt,
          100,
        ),
        referencesBefore: await backend.storage.loadReferences(
          before().principal,
          provider,
          observedAt,
          100,
        ),
      });
    }
    expect(results[1]).toEqual(results[0]);
    const [read] = results;
    expect(read?.list.items.map((item) => item.objectVersion)).toEqual([
      3, 2, 1,
    ]);
    expect(read?.firstPage.items).toEqual([read?.list.items[1]]);
    expect(read?.first.snapshot).toMatchObject({
      displayName: "Launch night",
      workspaceId: harness.workspaceId,
    });
    expect(read?.comparison.changes).toContainEqual(
      expect.objectContaining({
        field: "displayName",
        before: "Launch night",
        after: "Launch night, final",
      }),
    );
    expect(read?.preview).toMatchObject({
      sourceVersion: 1,
      currentVersion: 3,
      canRestore: true,
    });
    expect(read?.layout).toMatchObject({ version: 2, pages: logistics });
    expect(read?.layouts.items.map((item) => item.version)).toEqual([2, 1]);
    expect(read?.notes.items).toEqual([
      expect.objectContaining({
        id: planned.note,
        editedBy: "Write principal",
      }),
    ]);
    expect(read?.references).toEqual({
      canonical: new Set([planned.document.keys.current]),
      historical: new Set([planned.document.keys.earlier]),
      uploads: new Map(),
    });
    expect(read?.referencesBefore).toEqual({
      canonical: new Set(),
      historical: new Set(),
      uploads: new Map(),
    });
  });

  it("writes on the versions written before the move identically", async () => {
    const postgres = await writeAfterMove(reference);
    const gateway = await writeAfterMove(cloudbase);
    expect(gateway).toEqual(postgres);
    expect(postgres.versions).toEqual({
      edited: 3,
      recovered: 3,
      deleted: 2,
      rescoped: 2,
      executed: [4],
      undone: [5],
      restored: 6,
      layout: 3,
    });
    expect(postgres.state).toEqual({
      displayName: "Gala",
      customProperties: { theme: "gold" },
      startsOn: "2030-10-16",
    });
    expect(postgres.histories.event).toEqual([
      {
        version: 1,
        kind: "created",
        action: "event.created",
        direction: null,
        space: "old",
      },
      {
        version: 2,
        kind: "updated",
        action: "event.updated",
        direction: null,
        space: "old",
      },
      {
        version: 3,
        kind: "updated",
        action: "event.updated",
        direction: "execute",
        space: "old",
      },
      {
        version: 4,
        kind: "updated",
        action: "event.updated",
        direction: "execute",
        space: "new",
      },
      {
        version: 5,
        kind: "updated",
        action: "event.updated",
        direction: "undo",
        space: "new",
      },
      {
        version: 6,
        kind: "restored",
        action: "event.restored",
        direction: null,
        space: "new",
      },
    ]);
    // A subtask goes to and leaves Trash with its task, on either side of the move.
    for (const subtask of ["trashedSubtask", "liveSubtask"] as const)
      expect(
        postgres.histories[subtask].map(({ kind, space }) => [kind, space]),
      ).toEqual(
        subtask === "trashedSubtask"
          ? [
              ["created", "old"],
              ["deleted", "old"],
              ["recovered", "new"],
            ]
          : [
              ["created", "old"],
              ["deleted", "new"],
            ],
      );
    expect(postgres.histories.scoped.at(-1)).toMatchObject({
      kind: "permission_scope_updated",
      space: "new",
    });
    expect(postgres.layouts).toEqual([
      { version: 1, pages: overview, space: "old" },
      { version: 2, pages: logistics, space: "old" },
      { version: 3, pages: overview, space: "new" },
    ]);
  });

  it("finds the revision of every moved object's current version", async () => {
    const planned = await plannedEvent("Rehearsal");
    await move(planned.event);
    const readiness = await harness.rpc<{ objectsWithoutBaseline: number }>(
      "chronelle_backend_readiness",
    );
    expect(readiness.objectsWithoutBaseline).toBe(0);
    await expect(
      assertRevisionBaseline(harness.database.connection.db),
    ).resolves.toBeUndefined();
    expect(await harness.rpc<number>("chronelle_revision_baseline")).toBe(0);
    expect(await baselineObjectRevisions(harness.database.connection.db)).toBe(
      0,
    );
  });
});
