import { AuthorizationDeniedError } from "@livtales/authorization";
import { auditEvents, createId, resourceGrants } from "@livtales/db";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseRelationWriteRepository } from "../src/cloudbase-relation-write-repository.js";
import {
  InvalidRelationError,
  ObjectConflictError,
  RelationConflictError,
} from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import { ObjectRelationService } from "../src/relation-service.js";
import type { ObjectRelationResource } from "../src/types.js";
import {
  createWriteHarness,
  failure,
  mutationContext,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// chronelle_relation_create and chronelle_relation_lifecycle must leave what
// ObjectRelationService leaves: the relation row and one audit row per
// change, and they must reject the same inputs with the same errors.

let harness: WriteHarness;
let objects: EventPlanningObjectService;
let reference: ObjectRelationService;
let cloudbase: ObjectRelationService;

const clock = () => new Date("2030-06-01T12:00:00.000Z");

beforeAll(async () => {
  harness = await createWriteHarness("Relation writes");
  const db = harness.database.connection.db;
  objects = new EventPlanningObjectService(db);
  reference = new ObjectRelationService(db, clock);
  cloudbase = new ObjectRelationService(
    db,
    clock,
    new CloudBaseRelationWriteRepository(harness),
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

/** The relation without identity and clock fields; endpoints are compared by role. */
function shape(
  relation: ObjectRelationResource,
  sourceId: string,
  targetId: string,
) {
  const { id, createdAt, sourceObjectId, targetObjectId, ...rest } = relation;
  return {
    ...rest,
    sourceMatches: sourceObjectId === sourceId,
    targetMatches: targetObjectId === targetId,
    clock: createdAt instanceof Date && Number.isFinite(createdAt.getTime()),
    idIsUuid: /^[0-9a-f-]{36}$/u.test(id),
  };
}

/** relation.* audit rows for a source object, with identifiers normalised. */
async function relationAudits(sourceId: string) {
  const rows = await harness.database.connection.db
    .select({ action: auditEvents.action, metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, harness.workspaceId),
        eq(auditEvents.resourceId, sourceId),
        like(auditEvents.action, "relation.%"),
      ),
    )
    .orderBy(auditEvents.createdAt, auditEvents.action, auditEvents.id);
  return rows.map(({ action, metadata }) => {
    const { relationId, targetObjectId, ...rest } = metadata as Record<
      string,
      unknown
    >;
    return {
      action,
      metadata: rest,
      idsPresent:
        typeof relationId === "string" && typeof targetObjectId === "string",
    };
  });
}

async function fixtures() {
  const event = await objects.createEvent(context(), { displayName: "Event" });
  const task = await objects.createTask(context(), { displayName: "Task" });
  const reminder = await objects.createReminder(context(), {
    displayName: "Reminder",
    remindAt: new Date("2030-05-01T09:00:00.000Z"),
  });
  return { event, task, reminder };
}

describe.sequential("CloudBase relation writes", () => {
  it("creates relations with the same row and audit", async () => {
    const results = [];
    for (const [, service] of backends()) {
      const { event, task, reminder } = await fixtures();
      const includes = await service.create(context(), {
        sourceObjectId: event.id,
        relationType: "includes",
        targetObjectId: task.id,
        metadata: { order: 2 },
      });
      const remindsAbout = await service.create(context(), {
        sourceObjectId: reminder.id,
        relationType: "reminds_about",
        targetObjectId: task.id,
      });
      results.push({
        includes: shape(includes, event.id, task.id),
        remindsAbout: shape(remindsAbout, reminder.id, task.id),
        eventAudits: await relationAudits(event.id),
        reminderAudits: await relationAudits(reminder.id),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]?.includes).toMatchObject({
      relationType: "includes",
      metadata: { order: 2 },
      version: 1,
      deletedAt: null,
      createdBy: harness.ownerId,
    });
    expect(results[0]?.eventAudits).toEqual([
      {
        action: "relation.created",
        metadata: { relationType: "includes" },
        idsPresent: true,
      },
    ]);
  });

  it("rejects the same relations with the same errors", async () => {
    const messages: string[][] = [];
    for (const [, service] of backends()) {
      const { event, task, reminder } = await fixtures();
      const seen: string[] = [];
      for (const input of [
        {
          sourceObjectId: event.id,
          relationType: "includes" as const,
          targetObjectId: event.id,
        },
        {
          sourceObjectId: task.id,
          relationType: "includes" as const,
          targetObjectId: event.id,
        },
        {
          sourceObjectId: event.id,
          relationType: "reminds_about" as const,
          targetObjectId: reminder.id,
        },
      ]) {
        const error = await failure(() => service.create(context(), input));
        expect(error).toBeInstanceOf(InvalidRelationError);
        seen.push(error.message);
      }
      await service.create(context(), {
        sourceObjectId: event.id,
        relationType: "includes",
        targetObjectId: task.id,
      });
      expect(
        await failure(() =>
          service.create(context(), {
            sourceObjectId: event.id,
            relationType: "includes",
            targetObjectId: task.id,
          }),
        ),
      ).toBeInstanceOf(RelationConflictError);
      expect(
        await failure(() =>
          service.create(context(harness.viewerId), {
            sourceObjectId: event.id,
            relationType: "includes",
            targetObjectId: reminder.id,
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.create(context(), {
            sourceObjectId: event.id,
            relationType: "includes",
            targetObjectId: createId(),
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      messages.push(seen);
    }
    expect(messages[1]).toEqual(messages[0]);
    expect(messages[0]).toEqual([
      "A relationship must connect two distinct objects.",
      "The relationship is not valid for these object types.",
      "The relationship is not valid for these object types.",
    ]);
  });

  it("removes and recovers with the same versions, instants, and audits", async () => {
    const results = [];
    for (const [, service] of backends()) {
      const { event, task } = await fixtures();
      const relation = await service.create(context(), {
        sourceObjectId: event.id,
        relationType: "includes",
        targetObjectId: task.id,
      });
      const removed = await service.softDelete(context(), relation.id, 1);
      const stale = await failure(() =>
        service.softDelete(context(), relation.id, 1),
      );
      const again = await failure(() =>
        service.softDelete(context(), relation.id, 2),
      );
      const recovered = await service.recover(context(), relation.id, 2);
      const missing = await failure(() =>
        service.recover(context(), createId(), 1),
      );
      const forbidden = await failure(() =>
        service.softDelete(context(harness.viewerId), relation.id, 3),
      );
      results.push({
        removed: { ...removed, id: removed.id === relation.id },
        stale: stale.constructor.name,
        again: [again.constructor.name, again.message],
        recovered: shape(recovered, event.id, task.id),
        missing: missing.constructor.name,
        forbidden: forbidden.constructor.name,
        audits: await relationAudits(event.id),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toMatchObject({
      removed: { id: true, version: 2, deletedAt: clock() },
      stale: ObjectConflictError.name,
      again: [
        InvalidRelationError.name,
        "The relationship is already in the requested state.",
      ],
      recovered: { version: 3, deletedAt: null },
      missing: AuthorizationDeniedError.name,
      forbidden: AuthorizationDeniedError.name,
    });
    expect(results[0]?.audits.map((entry) => entry.action)).toEqual([
      "relation.created",
      "relation.deleted",
      "relation.recovered",
    ]);
    expect(results[0]?.audits[2]?.metadata).toEqual({
      relationType: "includes",
      previousVersion: 2,
      version: 3,
    });
  });

  it("refuses to recover into an occupied triple and lets a grantee edit", async () => {
    for (const [, service] of backends()) {
      const { event, task } = await fixtures();
      const first = await service.create(context(), {
        sourceObjectId: event.id,
        relationType: "includes",
        targetObjectId: task.id,
      });
      await service.softDelete(context(), first.id, 1);
      await service.create(context(), {
        sourceObjectId: event.id,
        relationType: "includes",
        targetObjectId: task.id,
      });
      expect(
        await failure(() => service.recover(context(), first.id, 2)),
      ).toBeInstanceOf(RelationConflictError);

      await harness.database.connection.db.insert(resourceGrants).values({
        id: createId(),
        workspaceId: harness.workspaceId,
        resourceId: event.id,
        principalId: harness.viewerId,
        role: "editor",
        grantedBy: harness.ownerId,
      });
      // The grant on the Event covers a child on its scope, not the Task.
      expect(
        await failure(() =>
          service.create(context(harness.viewerId), {
            sourceObjectId: event.id,
            relationType: "related_to",
            targetObjectId: task.id,
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      const child = await objects.createTask(context(), {
        displayName: "Child",
        permissionScopeId: event.id,
      });
      const byGrantee = await service.create(context(harness.viewerId), {
        sourceObjectId: event.id,
        relationType: "related_to",
        targetObjectId: child.id,
      });
      expect(byGrantee.createdBy).toBe(harness.viewerId);
    }
  });
});
