import { createId, documents, events, objects, tasks } from "@chronelle/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EventPlanningObjectService } from "../src/object-service.js";
import { baselineObjectRevisions } from "../src/revision-baseline.js";
import {
  createWriteHarness,
  failure,
  ledger,
  mutationContext,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// chronelle_revision_baseline must record what baselineObjectRevisions
// records for objects without a revision (the object.baselined audit event
// and the baseline snapshot of the current state, documents included),
// skip objects whose current version already has one, and refuse an
// incomplete chain the same way.

let harness: WriteHarness;
let objectService: EventPlanningObjectService;

beforeAll(async () => {
  harness = await createWriteHarness("Revision baseline");
  objectService = new EventPlanningObjectService(
    harness.database.connection.db,
  );
});

afterAll(async () => {
  await harness?.database.close();
});

/** An Event, a Task on it, and a Document, inserted without revisions. */
async function unbaselined() {
  const db = harness.database.connection.db;
  const eventId = createId();
  const taskId = createId();
  const documentId = createId();
  await db.insert(objects).values([
    {
      id: eventId,
      workspaceId: harness.workspaceId,
      objectType: "event",
      displayName: "Imported event",
      createdBy: harness.ownerId,
      permissionScopeId: eventId,
      version: 3,
    },
    {
      id: taskId,
      workspaceId: harness.workspaceId,
      objectType: "task",
      displayName: "Imported task",
      createdBy: harness.ownerId,
      permissionScopeId: eventId,
    },
    {
      id: documentId,
      workspaceId: harness.workspaceId,
      objectType: "document",
      displayName: "Imported.pdf",
      createdBy: harness.ownerId,
      permissionScopeId: eventId,
    },
  ]);
  await db.insert(events).values({
    objectId: eventId,
    workspaceId: harness.workspaceId,
    startsOn: "2030-10-16",
    isAllDay: true,
  });
  await db.insert(tasks).values({
    objectId: taskId,
    workspaceId: harness.workspaceId,
    status: "in_progress",
  });
  await db.insert(documents).values({
    objectId: documentId,
    workspaceId: harness.workspaceId,
    storageProvider: "local-filesystem",
    storageKey: `workspaces/${harness.workspaceId}/documents/${documentId}`,
    originalFilename: "Imported.pdf",
    mimeType: "application/pdf",
    sizeBytes: 9_007_199_254_740_993n,
    checksumSha256: "a".repeat(64),
  });
  return [eventId, taskId, documentId];
}

/** The ledgers of the objects, with the document's per-run key reduced to a presence flag. */
async function ledgers(ids: string[]) {
  const entries = await Promise.all(ids.map((id) => ledger(harness, id)));
  return entries.map((objectEntries) =>
    objectEntries.map((entry) => {
      const { storageKey, ...snapshot } = entry.snapshot;
      return {
        ...entry,
        snapshot: { ...snapshot, keyPresent: typeof storageKey === "string" },
      };
    }),
  );
}

describe.sequential("CloudBase revision baseline", () => {
  it("captures the same baselines and skips objects that have one", async () => {
    const context = mutationContext(harness);
    const created = await objectService.createEvent(context, {
      displayName: "Already baselined",
    });
    const first = await unbaselined();
    const postgresCount = await baselineObjectRevisions(
      harness.database.connection.db,
    );
    const postgres = await ledgers(first);
    const second = await unbaselined();
    const cloudCount = await harness.rpc<number>("chronelle_revision_baseline");
    const cloud = await ledgers(second);

    expect(postgresCount).toBe(3);
    expect(cloudCount).toBe(3);
    expect(cloud).toEqual(postgres);
    expect(
      postgres.map((entries) =>
        entries.map((entry) => [
          entry.action,
          entry.mutationKind,
          entry.metadata,
        ]),
      ),
    ).toEqual([
      [["object.baselined", "baseline", { version: 3 }]],
      [["object.baselined", "baseline", { version: 1 }]],
      [["object.baselined", "baseline", { version: 1 }]],
    ]);
    expect(postgres[2]?.[0]?.snapshot).toMatchObject({
      objectType: "document",
      sizeBytes: "9007199254740993",
      keyPresent: true,
    });
    expect(
      (await ledger(harness, created.id)).map((entry) => entry.action),
    ).toEqual(["event.created"]);
  });

  it("refuses an incomplete revision chain the same way", async () => {
    const db = harness.database.connection.db;
    const event = await objectService.createEvent(mutationContext(harness), {
      displayName: "Drifted",
    });
    // A version bump without its revision is the chain the baseline cannot repair.
    await db
      .update(objects)
      .set({ version: 2 })
      .where(eq(objects.id, event.id));
    const postgres = await failure(() => baselineObjectRevisions(db));
    const cloud = await failure(() =>
      harness.rpc("chronelle_revision_baseline"),
    );
    expect(postgres.message).toBe(
      "An existing revision chain is incomplete; baseline cannot repair history.",
    );
    expect(cloud.message).toContain(
      "An existing revision chain is incomplete; baseline cannot repair history.",
    );
    await db
      .update(objects)
      .set({ version: 1 })
      .where(eq(objects.id, event.id));
  });
});
