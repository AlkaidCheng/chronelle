import { AuthorizationDeniedError } from "@chronelle/authorization";
import { createId, events, objects, resourceGrants } from "@chronelle/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseEventWriteRepository } from "../src/cloudbase-event-write-repository.js";
import { InvalidObjectStateError, ObjectConflictError } from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import type {
  CreateEventInput,
  EventResource,
  UpdateEventInput,
} from "../src/types.js";
import {
  backends,
  createWriteHarness,
  failure,
  ledger,
  mutationContext,
  shape,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// The Event write functions must produce what the PostgreSQL service
// produces. Both backends run against one database here.

let harness: WriteHarness;
let reference: EventPlanningObjectService;
let cloudbase: EventPlanningObjectService;

beforeAll(async () => {
  harness = await createWriteHarness("Event writes");
  const db = harness.database.connection.db;
  reference = new EventPlanningObjectService(db);
  cloudbase = new EventPlanningObjectService(db, undefined, undefined, {
    event: new CloudBaseEventWriteRepository(harness),
  });
});

afterAll(async () => {
  await harness?.database.close();
});

const context = (
  userId?: string,
  command?: Parameters<typeof mutationContext>[2],
) => mutationContext(harness, userId, command);

describe.sequential("CloudBase Event writes", () => {
  it("create and update leave the same resource, audit, and revision rows", async () => {
    const created: EventResource[] = [];
    const updated: EventResource[] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const parent = await service.createEvent(context(), {
        displayName: "Launch night",
        startsAt: new Date("2030-10-16T18:00:00.000Z"),
        endsAt: new Date("2030-10-16T23:00:00.000Z"),
        timezone: "Asia/Shanghai",
        isAllDay: false,
        customProperties: { theme: "gold", capacity: 120 },
        metadata: { source: "test" },
      });
      const child = await service.createEvent(context(), {
        displayName: "Venue walkthrough",
        startsOn: "2030-10-10",
        endsOn: "2030-10-11",
        permissionScopeId: parent.id,
      });
      expect(child.permissionScopeId).toBe(parent.id);
      created.push(parent, child);
      updated.push(
        await service.updateEvent(
          context(harness.ownerId, {
            id: "command-1",
            operationId: "operation-1",
            direction: "execute",
          }),
          parent.id,
          {
            expectedVersion: 1,
            displayName: "Launch night, moved",
            startsAt: null,
            endsAt: null,
            timezone: null,
            startsOn: "2030-10-17",
            isAllDay: true,
            customProperties: { theme: "silver" },
            metadata: {},
          },
        ),
      );
    }

    const [pgParent, pgChild, cbParent, cbChild] = created;
    expect(shape(cbParent as EventResource)).toEqual(
      shape(pgParent as EventResource),
    );
    expect(shape(cbChild as EventResource)).toEqual(
      shape(pgChild as EventResource),
    );
    const [pgUpdated, cbUpdated] = updated;
    expect(shape(cbUpdated as EventResource)).toEqual(
      shape(pgUpdated as EventResource),
    );
    expect(cbUpdated?.version).toBe(2);
    expect(cbUpdated?.startsOn).toBe("2030-10-17");
    expect(cbUpdated?.startsAt).toBeNull();

    expect(await ledger(harness, (cbParent as EventResource).id)).toEqual(
      await ledger(harness, (pgParent as EventResource).id),
    );
    expect(await ledger(harness, (cbChild as EventResource).id)).toEqual(
      await ledger(harness, (pgChild as EventResource).id),
    );
    expect(await ledger(harness, (cbParent as EventResource).id)).toHaveLength(
      2,
    );
  });

  it("reject the same inputs with the same errors", async () => {
    const invalidCreates: CreateEventInput[] = [
      { displayName: "x", endsOn: "2030-01-01" },
      {
        displayName: "x",
        startsOn: "2030-01-01",
        startsAt: new Date("2030-01-01T00:00:00Z"),
      },
      { displayName: "x", endsAt: new Date("2030-01-01T00:00:00Z") },
      {
        displayName: "x",
        startsAt: new Date("2030-01-02T00:00:00Z"),
        endsAt: new Date("2030-01-01T00:00:00Z"),
      },
      { displayName: "x", timezone: "Mars/Olympus" },
    ];
    const invalidUpdates: Omit<UpdateEventInput, "expectedVersion">[] = [
      { endsAt: new Date("2030-01-01T00:00:00Z") },
      { startsOn: "2030-01-01" },
      { endsOn: "2030-01-01" },
      { timezone: "Not/AZone" },
    ];

    const outcomes: string[][] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const seen: string[] = [];
      for (const input of invalidCreates) {
        const error = await failure(() =>
          service.createEvent(context(), input),
        );
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      const timed = await service.createEvent(context(), {
        displayName: "Guarded",
        startsAt: new Date("2030-03-01T09:00:00Z"),
        timezone: "UTC",
      });
      for (const changes of invalidUpdates) {
        const error = await failure(() =>
          service.updateEvent(context(), timed.id, {
            expectedVersion: 1,
            ...changes,
          }),
        );
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      expect(
        await failure(() =>
          service.updateEvent(context(), timed.id, {
            expectedVersion: 2,
            displayName: "stale",
          }),
        ),
      ).toBeInstanceOf(ObjectConflictError);
      expect(
        await failure(() =>
          service.updateEvent(context(harness.viewerId), timed.id, {
            expectedVersion: 1,
            displayName: "forbidden",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.updateEvent(context(), createId(), {
            expectedVersion: 1,
            displayName: "missing",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.createEvent(context(harness.viewerId), {
            displayName: "denied",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(await ledger(harness, timed.id)).toHaveLength(1);

      await harness.database.connection.db.insert(resourceGrants).values({
        id: createId(),
        workspaceId: harness.workspaceId,
        resourceId: timed.id,
        principalId: harness.viewerId,
        role: "editor",
        grantedBy: harness.ownerId,
      });
      const byGrantee = await service.updateEvent(
        context(harness.viewerId),
        timed.id,
        { expectedVersion: 1, displayName: "by grantee" },
      );
      expect(byGrantee.version).toBe(2);
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toHaveLength(
      invalidCreates.length + invalidUpdates.length,
    );
  });

  it("refuse to update an object without a revision baseline", async () => {
    const messages: string[] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const legacyId = createId();
      await harness.database.connection.db.insert(objects).values({
        id: legacyId,
        workspaceId: harness.workspaceId,
        permissionScopeId: legacyId,
        objectType: "event",
        displayName: "Legacy",
        createdBy: harness.ownerId,
      });
      await harness.database.connection.db.insert(events).values({
        objectId: legacyId,
        workspaceId: harness.workspaceId,
      });
      const error = await failure(() =>
        service.updateEvent(context(), legacyId, {
          expectedVersion: 1,
          displayName: "Legacy v2",
        }),
      );
      messages.push(error.message);
    }
    expect(messages[1]).toBe(messages[0]);
    expect(messages[0]).toContain("Object revision baseline is missing");
  });
});
