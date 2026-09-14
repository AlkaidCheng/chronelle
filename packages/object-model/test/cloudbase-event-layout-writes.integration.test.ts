import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  auditEvents,
  createId,
  eventPageRevisions,
  resourceGrants,
} from "@chronelle/db";
import type { EventPage } from "@chronelle/schemas";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseEventLayoutWriteRepository } from "../src/cloudbase-event-layout-write-repository.js";
import { InvalidObjectStateError, ObjectConflictError } from "../src/errors.js";
import { EventLayoutService } from "../src/event-layout-service.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import {
  createWriteHarness,
  failure,
  mutationContext,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// chronelle_event_layout_update and chronelle_event_layout_restore must
// leave what EventLayoutService leaves: the layout revisions and their audit
// events; and they must refuse the same requests with the same errors.

let harness: WriteHarness;
let objects: EventPlanningObjectService;
let reference: EventLayoutService;
let cloudbase: EventLayoutService;

beforeAll(async () => {
  harness = await createWriteHarness("Layout writes");
  const db = harness.database.connection.db;
  objects = new EventPlanningObjectService(db);
  reference = new EventLayoutService(db);
  cloudbase = new EventLayoutService(
    db,
    new CloudBaseEventLayoutWriteRepository(harness),
  );
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
    components: [
      { id: "00000000-0000-7000-8000-0000000000b2", kind: "todos" },
      { id: "00000000-0000-7000-8000-0000000000b3", kind: "expenses" },
    ],
  },
];

/** The layout without its clock, plus the revision and audit history. */
async function history(eventId: string) {
  const db = harness.database.connection.db;
  const revisions = await db
    .select({
      version: eventPageRevisions.version,
      pages: eventPageRevisions.pages,
    })
    .from(eventPageRevisions)
    .where(
      and(
        eq(eventPageRevisions.workspaceId, harness.workspaceId),
        eq(eventPageRevisions.eventId, eventId),
      ),
    )
    .orderBy(eventPageRevisions.version);
  const audits = await db
    .select({ action: auditEvents.action, metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, harness.workspaceId),
        eq(auditEvents.resourceId, eventId),
        like(auditEvents.action, "event.layout_%"),
      ),
    );
  // Two saves can land in the same millisecond, so the history is ordered
  // by the version each audit records rather than by identifier.
  audits.sort(
    (a, b) =>
      ((a.metadata as { version: number }).version ?? 0) -
      ((b.metadata as { version: number }).version ?? 0),
  );
  return { revisions, audits };
}

function shape(layout: {
  version: number;
  pages: unknown;
  updatedAt: string | null;
}) {
  return {
    version: layout.version,
    pages: layout.pages,
    clock:
      typeof layout.updatedAt === "string" &&
      /\.\d{3}Z$/u.test(layout.updatedAt),
  };
}

describe.sequential("CloudBase Event layout writes", () => {
  it("updates and restores with the same versions, pages, and audits", async () => {
    const results = [];
    for (const [, service] of backends()) {
      const event = await objects.createEvent(context(), {
        displayName: "Launch",
      });
      const first = await service.update(context(), event.id, {
        expectedVersion: 0,
        pages: overview,
      });
      const second = await service.update(context(), event.id, {
        expectedVersion: 1,
        pages: logistics,
      });
      const restored = await service.restore(context(), event.id, {
        expectedVersion: 2,
        targetVersion: 1,
      });
      const cleared = await service.restore(context(), event.id, {
        expectedVersion: 3,
        targetVersion: 0,
      });
      results.push({
        first: shape(first),
        second: shape(second),
        restored: shape(restored),
        cleared: shape(cleared),
        current: shape(await service.get(context().principal, event.id)),
        history: await history(event.id),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toMatchObject({
      first: { version: 1, pages: overview },
      second: { version: 2, pages: logistics },
      restored: { version: 3, pages: overview },
      cleared: { version: 4, pages: [] },
      current: { version: 4, pages: [] },
    });
    expect(
      results[0]?.history.audits.map((entry) => [entry.action, entry.metadata]),
    ).toEqual([
      ["event.layout_updated", { previousVersion: 0, version: 1 }],
      ["event.layout_updated", { previousVersion: 1, version: 2 }],
      [
        "event.layout_restored",
        { previousVersion: 2, version: 3, restoredFromVersion: 1 },
      ],
      [
        "event.layout_restored",
        { previousVersion: 3, version: 4, restoredFromVersion: 0 },
      ],
    ]);
  });

  it("refuses the same requests with the same errors", async () => {
    const outcomes = [];
    for (const [, service] of backends()) {
      const event = await objects.createEvent(context(), {
        displayName: "Guarded",
      });
      const task = await objects.createTask(context(), {
        displayName: "Not an Event",
      });
      const seen: string[] = [];
      const record = (error: Error) =>
        seen.push(`${error.constructor.name}: ${error.message}`);

      record(
        await failure(() =>
          service.update(context(), event.id, {
            expectedVersion: 1,
            pages: overview,
          }),
        ),
      );
      record(
        await failure(() =>
          service.update(context(), task.id, {
            expectedVersion: 0,
            pages: overview,
          }),
        ),
      );
      record(
        await failure(() =>
          service.update(context(harness.viewerId), event.id, {
            expectedVersion: 0,
            pages: overview,
          }),
        ),
      );
      record(
        await failure(() =>
          service.update(context(), createId(), {
            expectedVersion: 0,
            pages: overview,
          }),
        ),
      );
      record(
        await failure(() =>
          service.restore(context(), event.id, {
            expectedVersion: 0,
            targetVersion: 5,
          }),
        ),
      );
      record(
        await failure(() =>
          service.restore(context(), event.id, {
            expectedVersion: 1,
            targetVersion: 5,
          }),
        ),
      );
      await harness.database.connection.db.insert(resourceGrants).values({
        id: createId(),
        workspaceId: harness.workspaceId,
        resourceId: event.id,
        principalId: harness.viewerId,
        role: "editor",
        grantedBy: harness.ownerId,
      });
      const byGrantee = await service.update(
        context(harness.viewerId),
        event.id,
        {
          expectedVersion: 0,
          pages: overview,
        },
      );
      expect(byGrantee.version).toBe(1);
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      `${ObjectConflictError.name}: ${new ObjectConflictError().message}`,
      `${InvalidObjectStateError.name}: Page layouts belong to Events.`,
      `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`,
      `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`,
      `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`,
      `${ObjectConflictError.name}: ${new ObjectConflictError().message}`,
    ]);
  });
});
