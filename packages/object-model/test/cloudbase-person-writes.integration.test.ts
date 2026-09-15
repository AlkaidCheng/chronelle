import { AuthorizationDeniedError } from "@chronelle/authorization";
import { createId, users, workspaceMembers } from "@chronelle/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBasePersonWriteRepository } from "../src/cloudbase-person-write-repository.js";
import { InvalidObjectStateError, ObjectConflictError } from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import type { PersonResource } from "../src/types.js";
import {
  backends,
  createWriteHarness,
  failure,
  ledger,
  mutationContext,
  shape,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// The Person write functions must produce what the PostgreSQL service
// produces. Both backends run against one database here.

let harness: WriteHarness;
let reference: EventPlanningObjectService;
let cloudbase: EventPlanningObjectService;
let strangerId: string;

beforeAll(async () => {
  harness = await createWriteHarness("Person writes");
  const db = harness.database.connection.db;
  reference = new EventPlanningObjectService(db);
  cloudbase = new EventPlanningObjectService(db, undefined, undefined, {
    person: new CloudBasePersonWriteRepository(harness),
  });
  // The viewer becomes a member so a person can link to them; a stranger
  // has an account but no membership.
  strangerId = createId();
  await db.insert(users).values({
    id: strangerId,
    identityProvider: "test",
    providerSubject: strangerId,
    displayName: "Stranger",
  });
  await db.insert(workspaceMembers).values({
    workspaceId: harness.workspaceId,
    userId: harness.viewerId,
    role: "viewer",
  });
});

afterAll(async () => {
  await harness?.database.close();
});

const context = (
  userId?: string,
  command?: Parameters<typeof mutationContext>[2],
) => mutationContext(harness, userId, command);

describe.sequential("CloudBase Person writes", () => {
  it("create and update leave the same resource, audit, and revision rows", async () => {
    const created: PersonResource[] = [];
    const updated: PersonResource[] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const bare = await service.createPerson(context(), {
        displayName: "Mira",
      });
      expect(bare.email).toBeNull();
      expect(bare.userId).toBeNull();
      const linked = await service.createPerson(context(), {
        displayName: "Sam Lee",
        email: "sam@example.test",
        userId: harness.viewerId,
        customProperties: { phone: "+1 555 0100", birthday: "1990-04-02" },
        metadata: { source: "test" },
        permissionScopeId: bare.id,
      });
      expect(linked.permissionScopeId).toBe(bare.id);
      expect(linked.userId).toBe(harness.viewerId);
      created.push(bare, linked);
      updated.push(
        await service.updatePerson(
          context(harness.ownerId, {
            id: "command-1",
            operationId: "operation-1",
            direction: "execute",
          }),
          bare.id,
          {
            expectedVersion: 1,
            displayName: "Mira Chen",
            email: "mira@example.test",
            customProperties: { phone: "+1 555 0101" },
            metadata: {},
          },
        ),
        await service.updatePerson(context(), linked.id, {
          expectedVersion: 1,
          email: null,
          userId: null,
        }),
      );
      // The link is free again once cleared.
      const relinked = await service.updatePerson(context(), linked.id, {
        expectedVersion: 2,
        userId: harness.viewerId,
      });
      expect(relinked.userId).toBe(harness.viewerId);
      await service.updatePerson(context(), linked.id, {
        expectedVersion: 3,
        userId: null,
      });
    }

    const [pgBare, pgLinked, cbBare, cbLinked] = created;
    expect(shape(cbBare as PersonResource)).toEqual(
      shape(pgBare as PersonResource),
    );
    expect(shape(cbLinked as PersonResource)).toEqual(
      shape(pgLinked as PersonResource),
    );
    const [pgRenamed, pgCleared, cbRenamed, cbCleared] = updated;
    expect(shape(cbRenamed as PersonResource)).toEqual(
      shape(pgRenamed as PersonResource),
    );
    expect(shape(cbCleared as PersonResource)).toEqual(
      shape(pgCleared as PersonResource),
    );
    expect(cbRenamed?.version).toBe(2);
    expect(cbRenamed?.email).toBe("mira@example.test");
    expect(cbRenamed?.customProperties).toEqual({ phone: "+1 555 0101" });
    expect(cbCleared?.email).toBeNull();
    expect(cbCleared?.userId).toBeNull();

    for (const [pg, cb] of [[pgBare, cbBare]] as const) {
      expect(await ledger(harness, (cb as PersonResource).id)).toEqual(
        await ledger(harness, (pg as PersonResource).id),
      );
      expect(await ledger(harness, (cb as PersonResource).id)).toHaveLength(2);
    }
  });

  it("reject the same inputs with the same errors", async () => {
    const outcomes: string[][] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const seen: string[] = [];
      const owner = await service.createPerson(context(), {
        displayName: "Owner",
        userId: harness.ownerId,
      });
      for (const attempt of [
        () =>
          service.createPerson(context(), {
            displayName: "x",
            userId: strangerId,
          }),
        () =>
          service.createPerson(context(), {
            displayName: "x",
            userId: createId(),
          }),
        () =>
          service.createPerson(context(), {
            displayName: "x",
            userId: harness.ownerId,
          }),
        () =>
          service.createPerson(context(), {
            displayName: "x",
            email: " spaced@example.test",
          }),
        () =>
          service.updatePerson(context(), owner.id, {
            expectedVersion: 1,
            email: "no-at-sign",
          }),
      ]) {
        const error = await failure(attempt);
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      // Sending the same link again is not a conflict with itself.
      const same = await service.updatePerson(context(), owner.id, {
        expectedVersion: 1,
        userId: harness.ownerId,
        email: "owner@example.test",
      });
      expect(same.version).toBe(2);
      expect(
        await failure(() =>
          service.updatePerson(context(), owner.id, {
            expectedVersion: 1,
            displayName: "stale",
          }),
        ),
      ).toBeInstanceOf(ObjectConflictError);
      expect(
        await failure(() =>
          service.updatePerson(context(harness.viewerId), owner.id, {
            expectedVersion: 2,
            displayName: "forbidden",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.createPerson(context(strangerId), { displayName: "denied" }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      await service.updatePerson(context(), owner.id, {
        expectedVersion: 2,
        userId: null,
      });
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      "userId must name a member of this workspace.",
      "userId must name a member of this workspace.",
      "userId is already linked to another person.",
      "email must be a valid address.",
      "email must be a valid address.",
    ]);
  });

  it("refuse an object of another type", async () => {
    for (const [, service] of backends(reference, cloudbase)) {
      const task = await service.createTask(context(), {
        displayName: "Not a person",
      });
      expect(
        await failure(() =>
          service.updatePerson(context(), task.id, {
            expectedVersion: 1,
            displayName: "as a person",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() => service.getPerson(context().principal, task.id)),
      ).toBeInstanceOf(AuthorizationDeniedError);
    }
  });
});
