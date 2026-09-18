import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  auditEvents,
  createId,
  objectRevisions,
  objects as objects_,
  resourceGrants,
} from "@chronelle/db";
import { desc, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseObjectReadRepository } from "../src/cloudbase-object-read-repository.js";
import { CloudBaseRevisionReadRepository } from "../src/cloudbase-revision-read-repository.js";
import { InvalidObjectStateError } from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import { ObjectRecoveryService } from "../src/recovery-service.js";
import { ObjectRestorationService } from "../src/restoration-service.js";
import { PostgresRevisionReadRepository } from "../src/revision-reads.js";
import { liveReader } from "./cloudbase-read-double.js";
import {
  createWriteHarness,
  failure,
  mutationContext,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// The revision comparison and the restoration preview read through the
// object and revision read repositories when they are injected; with the
// CloudBase adapters they must return what the PostgreSQL read returns and
// refuse the same requests with the same errors.

let harness: WriteHarness;
let objects: EventPlanningObjectService;
let recovery: ObjectRecoveryService;
let reference: ObjectRestorationService;
let cloudbase: ObjectRestorationService;
let referenceRevisions: PostgresRevisionReadRepository;
let cloudbaseRevisions: CloudBaseRevisionReadRepository;

beforeAll(async () => {
  harness = await createWriteHarness("Restoration reads");
  const db = harness.database.connection.db;
  objects = new EventPlanningObjectService(db);
  recovery = new ObjectRecoveryService(db);
  reference = new ObjectRestorationService(db);
  const reader = liveReader(db);
  referenceRevisions = new PostgresRevisionReadRepository(db);
  cloudbaseRevisions = new CloudBaseRevisionReadRepository(reader);
  cloudbase = new ObjectRestorationService(db, undefined, {
    objects: new CloudBaseObjectReadRepository(reader),
    revisions: cloudbaseRevisions,
  });
});

afterAll(async () => {
  await harness?.database.close();
});

const context = (userId?: string) => mutationContext(harness, userId);

const backends = () =>
  [
    ["postgres", reference],
    ["cloudbase", cloudbase],
  ] as const;

/** An Event at version 3 shared with the viewer, and a Task deleted and recovered. */
async function fixtures() {
  const event = await objects.createEvent(context(), {
    displayName: "Launch night",
    startsAt: new Date("2030-10-16T18:00:00.000Z"),
    endsAt: new Date("2030-10-16T23:00:00.000Z"),
    timezone: "Asia/Shanghai",
    customProperties: { theme: "gold", seats: 40 },
  });
  await objects.updateEvent(context(), event.id, {
    expectedVersion: 1,
    displayName: "Launch night, moved",
    startsAt: null,
    endsAt: null,
    timezone: null,
    startsOn: "2030-10-17",
    isAllDay: true,
    customProperties: { theme: "silver" },
  });
  await objects.updateEvent(context(), event.id, {
    expectedVersion: 2,
    metadata: { note: "internal" },
  });
  await harness.database.connection.db.insert(resourceGrants).values({
    id: createId(),
    workspaceId: harness.workspaceId,
    resourceId: event.id,
    principalId: harness.viewerId,
    role: "viewer",
    grantedBy: harness.ownerId,
  });
  const task = await objects.createTask(context(), {
    displayName: "Badges",
  });
  await objects.softDelete(context(), task.id, 1);
  await recovery.recover(context(), task.id, { expectedVersion: 2 });
  return { event, task };
}

/** A revision with a snapshot schema the application does not decode, at the next version. */
async function appendUnsupportedRevision(objectId: string) {
  await harness.database.connection.db.transaction(async (transaction) => {
    const [previous] = await transaction
      .select()
      .from(objectRevisions)
      .where(eq(objectRevisions.objectId, objectId))
      .orderBy(desc(objectRevisions.objectVersion))
      .limit(1);
    if (previous === undefined) throw new Error("Missing revision fixture");
    const version = previous.objectVersion + 1;
    const requestId = createId();
    const auditEventId = createId();
    await transaction
      .update(objects_)
      .set({ version })
      .where(eq(objects_.id, objectId));
    await transaction.insert(auditEvents).values({
      id: auditEventId,
      workspaceId: previous.workspaceId,
      resourceId: objectId,
      actorType: previous.actorType,
      actorId: previous.actorId,
      requestId,
      action: "event.updated",
      metadata: {},
    });
    await transaction.insert(objectRevisions).values({
      ...previous,
      id: createId(),
      objectVersion: version,
      mutationKind: "updated",
      auditEventId,
      requestId,
      snapshotSchemaVersion: 2,
      snapshot: { ...previous.snapshot, version },
    });
  });
}

/** Preview and comparison results without their per-run identifiers. */
function shape(result: {
  objectId: string;
  sourceRevisionId?: string;
  [key: string]: unknown;
}) {
  const { objectId: _, sourceRevisionId, ...rest } = result;
  return {
    ...rest,
    ...(sourceRevisionId !== undefined && {
      sourceRevisionPresent: typeof sourceRevisionId === "string",
    }),
  };
}

describe.sequential("CloudBase restoration reads", () => {
  it("compares and previews revisions identically", async () => {
    const results = [];
    for (const [, service] of backends()) {
      const { event, task } = await fixtures();
      results.push({
        comparison: shape(
          await service.compare(context().principal, event.id, {
            fromVersion: 1,
            toVersion: 3,
          }),
        ),
        reversed: shape(
          await service.compare(context().principal, event.id, {
            fromVersion: 3,
            toVersion: 1,
          }),
        ),
        byViewer: shape(
          await service.compare(context(harness.viewerId).principal, event.id, {
            fromVersion: 2,
            toVersion: 3,
          }),
        ),
        preview: shape(await service.preview(context().principal, event.id, 1)),
        previewCurrent: shape(
          await service.preview(context().principal, event.id, 3),
        ),
        previewByViewer: shape(
          await service.preview(
            context(harness.viewerId).principal,
            event.id,
            1,
          ),
        ),
        previewDeleted: shape(
          await service.preview(context().principal, task.id, 2),
        ),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]?.comparison).toMatchObject({
      fromVersion: 1,
      toVersion: 3,
      changes: expect.arrayContaining([
        expect.objectContaining({
          field: "displayName",
          before: "Launch night",
          after: "Launch night, moved",
        }),
        expect.objectContaining({ field: "startsOn", after: "2030-10-17" }),
        expect.objectContaining({
          field: "customProperties.seats",
          beforePresent: true,
          afterPresent: false,
        }),
      ]),
    });
    expect(results[0]?.byViewer).toMatchObject({ changes: [] });
    expect(results[0]?.preview).toMatchObject({
      sourceVersion: 1,
      currentVersion: 3,
      canRestore: true,
      sourceRevisionPresent: true,
    });
    expect(results[0]?.previewCurrent).toMatchObject({
      changes: [],
      canRestore: false,
    });
    expect(results[0]?.previewByViewer).toMatchObject({ canRestore: false });
    expect(results[0]?.previewDeleted).toMatchObject({
      sourceVersion: 2,
      currentVersion: 3,
      canRestore: false,
    });
  });

  it("summarizes each revision's changes identically on the list", async () => {
    const results = [];
    for (const revisions of [referenceRevisions, cloudbaseRevisions]) {
      const { event, task } = await fixtures();
      const list = (objectId: string, limit: number, beforeVersion?: number) =>
        revisions.listRevisions(context().principal, objectId, {
          limit,
          ...(beforeVersion === undefined ? {} : { beforeVersion }),
        });
      const strip = (page: { items: readonly object[] }) =>
        page.items.map((item) => {
          const { changedFields, changedFieldCount, mutationKind } =
            item as Record<string, unknown>;
          return { changedFields, changedFieldCount, mutationKind };
        });
      const [full, firstPage, secondPage, single] = await Promise.all([
        list(event.id, 25),
        list(event.id, 1),
        list(event.id, 1, 3),
        revisions.getRevision(context().principal, event.id, 2),
      ]);
      results.push({
        full: strip(full),
        firstPage: strip(firstPage),
        secondPage: strip(secondPage),
        single: {
          changedFields: single.changedFields,
          changedFieldCount: single.changedFieldCount,
        },
        task: strip(await list(task.id, 25)),
      });
    }
    expect(results[1]).toEqual(results[0]);
    // Newest first: the metadata-only version changed no content; version 2
    // changed eight fields, of which three are named; the first lists the
    // content it started with, as changes from nothing.
    expect(results[0]?.full).toEqual([
      { mutationKind: "updated", changedFields: [], changedFieldCount: 0 },
      expect.objectContaining({
        mutationKind: "updated",
        changedFieldCount: 8,
      }),
      expect.objectContaining({
        mutationKind: "created",
        changedFieldCount: 7,
        changedFields: [
          expect.objectContaining({
            field: "displayName",
            after: "Launch night",
            beforePresent: false,
            afterPresent: true,
          }),
          expect.objectContaining({ field: "startsAt", beforePresent: false }),
          expect.objectContaining({ field: "endsAt", beforePresent: false }),
        ],
      }),
    ]);
    expect(results[0]?.full[1]?.changedFields).toEqual([
      expect.objectContaining({
        field: "displayName",
        before: "Launch night",
        after: "Launch night, moved",
      }),
      expect.objectContaining({ field: "startsOn", after: "2030-10-17" }),
      expect.objectContaining({ field: "startsAt" }),
    ]);
    // A page's last row still compares with the version before the page.
    expect(results[0]?.firstPage).toEqual([results[0]?.full[0]]);
    expect(results[0]?.secondPage).toEqual([results[0]?.full[1]]);
    expect(results[0]?.single).toEqual({
      changedFields: results[0]?.full[1]?.changedFields,
      changedFieldCount: 8,
    });
    expect(results[0]?.task.map((row) => row.changedFieldCount)).toEqual([
      0, 0, 2,
    ]);
  });

  it("refuses the same reads with the same errors", async () => {
    const outcomes = [];
    for (const [, service] of backends()) {
      const { event, task } = await fixtures();
      const seen: string[] = [];
      const record = (error: Error) =>
        seen.push(`${error.constructor.name}: ${error.message}`);
      const refuse = async (run: () => Promise<unknown>) =>
        record(await failure(run));

      await refuse(() =>
        service.compare(context().principal, event.id, {
          fromVersion: 1,
          toVersion: 9,
        }),
      );
      await refuse(() =>
        service.compare(context(harness.viewerId).principal, task.id, {
          fromVersion: 1,
          toVersion: 3,
        }),
      );
      await refuse(() =>
        service.compare(context().principal, createId(), {
          fromVersion: 1,
          toVersion: 2,
        }),
      );
      await refuse(() => service.preview(context().principal, event.id, 9));
      await refuse(() =>
        service.preview(context(harness.viewerId).principal, task.id, 1),
      );
      await objects.softDelete(context(), task.id, 3);
      await refuse(() => service.preview(context().principal, task.id, 1));
      await appendUnsupportedRevision(event.id);
      await refuse(() => service.preview(context().principal, event.id, 4));
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    const denied = `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`;
    expect(outcomes[0]).toEqual([
      denied,
      denied,
      denied,
      denied,
      denied,
      denied,
      `${InvalidObjectStateError.name}: The revision snapshot schema is not supported.`,
    ]);
  });
});
