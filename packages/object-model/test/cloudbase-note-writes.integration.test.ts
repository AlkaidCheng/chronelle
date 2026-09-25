import { AuthorizationDeniedError } from "@livtales/authorization";
import {
  createId,
  objectRelations,
  objects,
  resourceGrants,
  users,
} from "@livtales/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseNoteReadRepository } from "../src/cloudbase-note-read-repository.js";
import { CloudBaseNoteWriteRepository } from "../src/cloudbase-note-write-repository.js";
import { InvalidObjectStateError, ObjectConflictError } from "../src/errors.js";
import { PostgresNoteReadRepository } from "../src/note-list.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import type { NoteResource } from "../src/types.js";
import {
  backends,
  createWriteHarness,
  failure,
  ledger,
  mutationContext,
  shape,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// The Note write functions and the Notes projection must produce what the
// PostgreSQL service produces. Both backends run against one database here.

let harness: WriteHarness;
let reference: EventPlanningObjectService;
let cloudbase: EventPlanningObjectService;

beforeAll(async () => {
  harness = await createWriteHarness("Note writes");
  const db = harness.database.connection.db;
  reference = new EventPlanningObjectService(db);
  cloudbase = new EventPlanningObjectService(db, undefined, undefined, {
    note: new CloudBaseNoteWriteRepository(harness),
  });
  await db
    .update(users)
    .set({ displayName: "Mei Lin" })
    .where(eq(users.id, harness.ownerId));
});

afterAll(async () => {
  await harness?.database.close();
});

const context = (
  userId?: string,
  command?: Parameters<typeof mutationContext>[2],
) => mutationContext(harness, userId, command);

describe.sequential("CloudBase Note writes", () => {
  it("create and update leave the same resource, audit, and revision rows", async () => {
    const created: NoteResource[] = [];
    const updated: NoteResource[] = [];
    for (const [, service] of backends(reference, cloudbase)) {
      const empty = await service.createNote(context(), {
        displayName: "Packing list",
      });
      expect(empty.body).toBe("");
      const written = await service.createNote(context(), {
        displayName: "Dinner",
        body: "Kikunoi, 18:30\nAsk for the counter.\n",
        customProperties: { pinned: true },
        metadata: { source: "test" },
        permissionScopeId: empty.id,
      });
      expect(written.permissionScopeId).toBe(empty.id);
      expect(written.body).toBe("Kikunoi, 18:30\nAsk for the counter.\n");
      created.push(empty, written);
      updated.push(
        await service.updateNote(
          context(harness.ownerId, {
            id: "command-1",
            operationId: "operation-1",
            direction: "execute",
          }),
          empty.id,
          {
            expectedVersion: 1,
            displayName: "Packing list (final)",
            body: "- passport\n- charger",
            customProperties: { pinned: false },
            metadata: {},
          },
        ),
        await service.updateNote(context(), written.id, {
          expectedVersion: 1,
          body: "",
        }),
      );
    }

    const [pgEmpty, pgWritten, cbEmpty, cbWritten] = created;
    expect(shape(cbEmpty as NoteResource)).toEqual(
      shape(pgEmpty as NoteResource),
    );
    expect(shape(cbWritten as NoteResource)).toEqual(
      shape(pgWritten as NoteResource),
    );
    const [pgRenamed, pgCleared, cbRenamed, cbCleared] = updated;
    expect(shape(cbRenamed as NoteResource)).toEqual(
      shape(pgRenamed as NoteResource),
    );
    expect(shape(cbCleared as NoteResource)).toEqual(
      shape(pgCleared as NoteResource),
    );
    expect(cbRenamed?.version).toBe(2);
    expect(cbRenamed?.body).toBe("- passport\n- charger");
    expect(cbCleared?.body).toBe("");

    for (const [pg, cb] of [
      [pgEmpty, cbEmpty],
      [pgWritten, cbWritten],
    ] as const) {
      expect(await ledger(harness, (cb as NoteResource).id)).toEqual(
        await ledger(harness, (pg as NoteResource).id),
      );
      expect(await ledger(harness, (cb as NoteResource).id)).toHaveLength(2);
    }
  });

  it("reject the same inputs with the same errors", async () => {
    const outcomes: string[][] = [];
    const tooLong = "x".repeat(20_001);
    for (const [, service] of backends(reference, cloudbase)) {
      const seen: string[] = [];
      const note = await service.createNote(context(), {
        displayName: "Limits",
        body: "y".repeat(20_000),
      });
      for (const attempt of [
        () =>
          service.createNote(context(), { displayName: "x", body: tooLong }),
        () =>
          service.updateNote(context(), note.id, {
            expectedVersion: 1,
            body: tooLong,
          }),
      ]) {
        const error = await failure(attempt);
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        seen.push(error.message);
      }
      const same = await service.updateNote(context(), note.id, {
        expectedVersion: 1,
        displayName: "Limits, kept",
      });
      expect(same.version).toBe(2);
      expect(
        await failure(() =>
          service.updateNote(context(), note.id, {
            expectedVersion: 1,
            displayName: "stale",
          }),
        ),
      ).toBeInstanceOf(ObjectConflictError);
      expect(
        await failure(() =>
          service.updateNote(context(harness.viewerId), note.id, {
            expectedVersion: 2,
            displayName: "forbidden",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.createNote(context(harness.viewerId), {
            displayName: "denied",
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      "body must be text of at most 20000 characters.",
      "body must be text of at most 20000 characters.",
    ]);
  });

  it("list the same notes in the same order, with who wrote each current version", async () => {
    const db = harness.database.connection.db;
    const event = await reference.createEvent(context(), {
      displayName: "Kyoto in November",
    });
    const notes = [];
    for (const [displayName, body] of [
      ["Where we eat", "Kikunoi on Tuesday."],
      ["addresses", "Ryokan: 1-2 Higashiyama."],
      ["Packing", ""],
    ] as const)
      notes.push(
        await reference.createNote(context(), {
          displayName,
          body,
          permissionScopeId: event.id,
        }),
      );
    const [eating, addresses, packing] = notes as [
      NoteResource,
      NoteResource,
      NoteResource,
    ];
    // A note the caller cannot see, one in Trash, and one outside the event
    // are left out; a note edited by another account names that account.
    const hidden = await reference.createNote(context(), {
      displayName: "Private",
      body: "Not for the viewer.",
    });
    const trashed = await reference.createNote(context(), {
      displayName: "Old plan",
      permissionScopeId: event.id,
    });
    await reference.createNote(context(), {
      displayName: "Elsewhere",
      permissionScopeId: event.id,
    });
    await db
      .update(objects)
      .set({ deletedAt: new Date() })
      .where(eq(objects.id, trashed.id));
    await db.insert(objectRelations).values(
      [eating.id, addresses.id, packing.id, hidden.id, trashed.id].map(
        (targetObjectId) => ({
          id: createId(),
          workspaceId: harness.workspaceId,
          sourceObjectId: event.id,
          relationType: "includes" as const,
          targetObjectId,
          createdBy: harness.ownerId,
        }),
      ),
    );
    await db.insert(resourceGrants).values({
      id: createId(),
      workspaceId: harness.workspaceId,
      resourceId: event.id,
      principalId: harness.viewerId,
      role: "editor",
      grantedBy: harness.ownerId,
    });
    await db
      .update(users)
      .set({ displayName: "Sam Reader" })
      .where(eq(users.id, harness.viewerId));
    await reference.updateNote(context(harness.viewerId), packing.id, {
      expectedVersion: 1,
      body: "- passport",
    });

    const postgres = new PostgresNoteReadRepository(db);
    const gateway = new CloudBaseNoteReadRepository(harness);
    for (const userId of [harness.ownerId, harness.viewerId]) {
      const principal = {
        type: "user" as const,
        userId,
        workspaceId: harness.workspaceId,
      };
      for (const sort of ["edited", "title"] as const) {
        const [pg, cb] = await Promise.all([
          postgres.listNotes(principal, event.id, { sort }),
          gateway.listNotes(principal, event.id, { sort }),
        ]);
        expect(cb).toEqual(pg);
        expect(pg.sourceEventId).toBe(event.id);
        const expected =
          sort === "edited"
            ? [packing.id, addresses.id, eating.id]
            : [addresses.id, packing.id, eating.id];
        expect(pg.items.map((item) => item.id)).toEqual(
          userId === harness.ownerId
            ? sort === "edited"
              ? [packing.id, hidden.id, addresses.id, eating.id]
              : [addresses.id, packing.id, hidden.id, eating.id]
            : expected,
        );
        const byId = new Map(pg.items.map((item) => [item.id, item]));
        expect(byId.get(packing.id)).toMatchObject({
          body: "- passport",
          version: 2,
          editedBy: "Sam Reader",
        });
        expect(byId.get(eating.id)).toMatchObject({
          body: "Kikunoi on Tuesday.",
          editedBy: "Mei Lin",
        });
      }
    }
    await expect(
      postgres.listNotes(
        { type: "user", userId: createId(), workspaceId: harness.workspaceId },
        event.id,
      ),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      gateway.listNotes(
        { type: "user", userId: createId(), workspaceId: harness.workspaceId },
        event.id,
      ),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      gateway.listNotes(
        {
          type: "user",
          userId: harness.ownerId,
          workspaceId: harness.workspaceId,
        },
        eating.id,
      ),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
  });
});
