import { AuthorizationDeniedError } from "@livtales/authorization";
import { createId } from "@livtales/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CommandConflictError } from "../src/errors.js";
import {
  ObjectMoveChangedError,
  PostgresObjectMoveRepository,
} from "../src/object-move.js";
import { ReversibleCommandService } from "../src/command-service.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import { ObjectRelationService } from "../src/relation-service.js";
import {
  assertRevisionBaseline,
  baselineObjectRevisions,
} from "../src/revision-baseline.js";
import {
  createWriteHarness,
  type WriteHarness,
} from "./cloudbase-write-harness.js";
import {
  buildMoveFixture,
  movedRows,
  oldSpaceLedgers,
} from "./object-move-fixture.js";

// The PostgreSQL move, on the fixture of object-move-fixture.ts: what the
// preview reports, what the move leaves, what it refuses, and its replay.
// cloudbase-object-move.integration.test.ts runs the same fixture through
// both backends and compares them.

const movedAt = new Date("2030-09-01T08:00:00.000Z");
let harness: WriteHarness;
let repository: PostgresObjectMoveRepository;

beforeAll(async () => {
  harness = await createWriteHarness("Object move");
  repository = new PostgresObjectMoveRepository(
    harness.database.connection.db,
    () => movedAt,
  );
});

afterAll(async () => {
  await harness?.database.close();
});

const fixture = (label: string) => buildMoveFixture(harness.database, label);

async function failure(run: () => Promise<unknown>): Promise<Error> {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected the operation to fail");
}

describe.sequential("moving an Event to another space on PostgreSQL", () => {
  it("previews what moves, what stays behind, and who can see it after", async () => {
    const moving = await fixture("preview");
    const { records, users } = moving;
    const preview = await repository.preview(
      moving.context().principal,
      records.event.toUpperCase(),
      moving.spaces.to,
    );
    expect(preview).toEqual({
      eventId: records.event,
      from: {
        id: moving.spaces.from,
        displayName: "Home preview",
        personal: false,
        ownerDisplayName: "Olivia",
        role: "owner",
      },
      to: {
        id: moving.spaces.to,
        displayName: "Our wedding preview",
        personal: false,
        ownerDisplayName: "Olivia",
        role: "owner",
      },
      moves: {
        scheduleItems: 1,
        todos: 1,
        subtasks: 1,
        expenses: 0,
        reminders: 0,
        notes: 1,
        files: 1,
        sections: 1,
        pages: 2,
        inTrash: 1,
        shares: 1,
        pendingShares: 2,
      },
      droppedLinks: {
        items: [
          ["toAna", "includes", records.ana, "person", "Ana"],
          ["toDinner", "related_to", records.dinner, "event", "Dinner out"],
          [
            "fromReminder",
            "reminds_about",
            records.reminder,
            "reminder",
            "Call the hall",
          ],
          ["toBen", "includes", records.ben, "person", "Ben"],
        ].map(([name, relationType, id, objectType, displayName]) => ({
          relationId: [...moving.names].find(
            ([, value]) => value === name,
          )?.[0],
          relationType,
          scoped: {
            id: records.event,
            objectType: "event",
            displayName: "Gala night",
          },
          other: { id, objectType, displayName },
        })),
        total: 4,
      },
      unassignedTasks: {
        items: [
          {
            taskId: records.assigned,
            displayName: "Book the venue",
            person: { id: records.ana, displayName: "Ana" },
          },
        ],
        total: 1,
      },
      labels: {
        items: [
          { name: "Catering", existing: false },
          { name: "Venue", existing: true },
        ],
        total: 2,
      },
      peopleKept: {
        items: [{ id: records.ben, displayName: "Ben" }],
        total: 1,
      },
      clearedLinks: 2,
      access: {
        targetMembers: { owner: 1, editor: 1, viewer: 1 },
        keepingShares: {
          items: [{ userId: users.guest, displayName: "Gus", role: "viewer" }],
          total: 1,
        },
        droppedGrants: {
          items: [
            {
              userId: users.covered,
              displayName: "Cora",
              role: "editor",
              memberRole: "editor",
            },
          ],
          total: 1,
        },
        losingAccess: {
          items: [
            { userId: users.editor, displayName: "Dan" },
            { userId: users.coOwner, displayName: "Jane" },
          ],
          total: 2,
        },
        lapsingShares: 1,
      },
      expectedDroppedLinks: 5,
    });

    const targets = await repository.targets(
      moving.context().principal,
      records.event,
    );
    expect(
      targets.items.map(({ workspace, memberCount, current, allowed }) => [
        moving.names.get(workspace.id),
        workspace.role,
        memberCount,
        current,
        allowed,
      ]),
    ).toEqual([
      ["personal", "owner", 1, false, true],
      ["viewing", "viewer", 2, false, false],
      ["from", "owner", 3, true, false],
      ["to", "owner", 3, false, true],
    ]);
  });

  it("moves the scope, drops the links it named, and leaves the old space's history as written", async () => {
    const moving = await fixture("move");
    const { records, spaces } = moving;
    const written = await oldSpaceLedgers(harness.database, moving);
    const context = moving.context();
    const commandId = createId();
    const result = await repository.move(context, records.event, {
      workspaceId: spaces.to,
      expectedDroppedLinks: 5,
      commandId,
    });
    expect(result.event).toMatchObject({
      id: records.event,
      workspaceId: spaces.to,
      version: 2,
      displayName: "Gala night",
    });
    expect(result.move).toEqual({
      commandId,
      from: { id: spaces.from, displayName: "Home move" },
      to: { id: spaces.to, displayName: "Our wedding move" },
      moves: {
        scheduleItems: 1,
        todos: 1,
        subtasks: 1,
        expenses: 0,
        reminders: 0,
        notes: 1,
        files: 1,
        sections: 1,
        pages: 2,
        inTrash: 1,
        shares: 1,
        pendingShares: 2,
      },
      droppedLinks: 4,
      unassignedTasks: 1,
      clearedLinks: 2,
      labelsJoined: 1,
      labelsCreated: 1,
      grantsDropped: 1,
      peopleKept: 1,
      movedAt: movedAt.toISOString(),
    });

    const rows = await movedRows(harness.database, moving, context.requestId);
    expect(
      Object.fromEntries(
        rows.objects.map((row) => [
          row.id,
          [row.workspace_id, row.version, row.permission_scope_id, row.trashed],
        ]),
      ),
    ).toEqual({
      event: ["to", 2, "event", false],
      scheduleItem: ["to", 1, "event", false],
      assigned: ["to", 2, "event", false],
      subtask: ["to", 1, "event", false],
      trashed: ["to", 3, "event", true],
      note: ["to", 1, "event", false],
      document: ["to", 1, "event", false],
      ana: ["from", 1, "ana", false],
      cleo: ["from", 1, "cleo", false],
      ben: ["from", 2, "ben", false],
      reminder: ["from", 1, "reminder", false],
      dinner: ["from", 2, "dinner", false],
    });
    expect(rows.relations).toEqual([
      {
        workspace_id: "to",
        source_object_id: "event",
        relation_type: "includes",
        target_object_id: "scheduleItem",
        removed: false,
        version: 1,
      },
    ]);
    expect(rows.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          object_id: "assigned",
          workspace_id: "to",
          assignee_person_id: null,
        }),
        expect.objectContaining({
          object_id: "trashed",
          workspace_id: "to",
          assignee_person_id: null,
        }),
        expect.objectContaining({
          object_id: "subtask",
          workspace_id: "to",
          parent_task_id: "assigned",
        }),
      ]),
    );
    expect(
      rows.taskLabels.map(({ workspace_id, label_id }) => [
        workspace_id,
        label_id,
      ]),
    ).toEqual(
      expect.arrayContaining([
        ["to", "label:to:venue"],
        ["to", "label:to:Catering"],
      ]),
    );
    expect(rows.taskLabels).toHaveLength(2);
    expect(rows.labels).toContainEqual({
      workspace_id: "to",
      name: "Catering",
      created_by: "owner",
    });
    expect(rows.grants).toEqual([
      {
        id: "guestGrant",
        workspace_id: "to",
        resource_id: "event",
        principal_id: "guest",
        role: "viewer",
      },
    ]);
    expect(rows.pendingShares).toEqual([
      {
        id: "ownerShare",
        workspace_id: "to",
        resource_id: "event",
        person_id: null,
        status: "pending",
      },
      {
        id: "coOwnerShare",
        workspace_id: "to",
        resource_id: "event",
        person_id: null,
        status: "pending",
      },
    ]);
    expect(rows.sections).toEqual([{ workspace_id: "to", name: "Day one" }]);
    expect(rows.documents).toEqual([{ workspace_id: "to", same_key: true }]);
    expect(rows.transfers).toEqual([{ workspace_id: "to" }]);
    // The Event's undo entry left the owner's stack in the old space; the
    // entry for the Dinner, which stays, is kept.
    expect(rows.stacks).toEqual([
      {
        workspace_id: "from",
        version: 3,
        undo_ids: ["dinnerCommand"],
        redo_ids: [],
        expected_versions: { dinner: 2 },
      },
    ]);
    expect(
      rows.audit.map(({ workspace_id, action, resource_id }) => [
        workspace_id,
        action,
        resource_id,
      ]),
    ).toEqual([
      ["from", "object.moved", "event"],
      ["from", "object.permission_scope_updated", "ben"],
      ["from", "relation.dropped", "event"],
      ["from", "relation.dropped", "event"],
      ["from", "relation.dropped", "event"],
      ["from", "relation.dropped", "event"],
      ["from", "relation.dropped", "reminder"],
      ["to", "object.moved", "event"],
      ["to", "resource.share_revoked", "event"],
      ["to", "task.updated", "assigned"],
      ["to", "task.updated", "trashed"],
    ]);
    expect(
      rows.audit
        .filter(({ action }) => action === "relation.dropped")
        .map(({ metadata }) => metadata),
    ).toContainEqual({
      cause: "object.moved",
      relationId: "toCleo",
      relationType: "includes",
      targetObjectId: "cleo",
      version: 2,
      removed: true,
      toWorkspaceId: "to",
    });
    expect(
      rows.revisions.map(
        ({
          workspace_id,
          object_id,
          object_version,
          mutation_kind,
          action,
        }) => [workspace_id, object_id, object_version, mutation_kind, action],
      ),
    ).toEqual(
      expect.arrayContaining([
        [
          "from",
          "ben",
          2,
          "permission_scope_updated",
          "object.permission_scope_updated",
        ],
        ["to", "assigned", 2, "updated", "task.updated"],
        ["to", "trashed", 3, "updated", "task.updated"],
      ]),
    );
    expect(rows.revisions).toHaveLength(3);
    expect(
      rows.revisions.find(({ object_id }) => object_id === "assigned"),
    ).toMatchObject({
      snapshot: {
        workspaceId: "to",
        assigneeId: null,
        labelIds: expect.arrayContaining([
          "label:to:venue",
          "label:to:Catering",
        ]),
      },
      metadata: { cause: "object.moved", previousVersion: 1, version: 2 },
    });

    // Nothing written in the old space before the move changed.
    const after = await oldSpaceLedgers(harness.database, moving);
    const kept = new Set(after.map(({ row }) => JSON.stringify(row)));
    expect(written.filter(({ row }) => !kept.has(JSON.stringify(row)))).toEqual(
      [],
    );

    // Members of the target read it; the old space's other members do not.
    const objects = new EventPlanningObjectService(
      harness.database.connection.db,
    );
    await expect(
      objects.getEvent(
        {
          type: "user",
          userId: moving.users.targetViewer,
          workspaceId: spaces.to,
        },
        records.event,
      ),
    ).resolves.toMatchObject({ id: records.event });
    await expect(
      objects.getEvent(
        { type: "user", userId: moving.users.editor, workspaceId: spaces.from },
        records.event,
      ),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);
    await expect(
      objects.getEvent(
        { type: "user", userId: moving.users.guest, workspaceId: spaces.to },
        records.event,
      ),
    ).resolves.toMatchObject({ id: records.event });
    // The old space's stack reads without the pruned entry.
    const commands = new ReversibleCommandService(
      harness.database.connection.db,
    );
    expect(await commands.getState(moving.context().principal)).toEqual({
      version: 3,
      undo: { commandId: moving.commands.dinner, available: true },
      redo: null,
    });
  });

  it("refuses a move the caller may not make, before anything changes", async () => {
    const moving = await fixture("refusals");
    const { records, spaces, users } = moving;
    const principal = (userId: string, workspaceId = spaces.from) => ({
      type: "user" as const,
      userId,
      workspaceId,
    });
    const move = (
      userId: string,
      objectId: string,
      workspaceId: string,
      expectedDroppedLinks = 5,
    ) =>
      failure(() =>
        repository.move(moving.context(userId), objectId, {
          workspaceId,
          expectedDroppedLinks,
        }),
      );
    const refused = (reason: string) =>
      expect.objectContaining({ name: "ObjectMoveRefusedError", reason });

    expect(await move(users.stranger, records.event, spaces.to)).toBeInstanceOf(
      AuthorizationDeniedError,
    );
    expect(await move(users.editor, records.event, spaces.to)).toEqual(
      refused("forbidden"),
    );
    expect(await move(users.owner, records.event, spaces.viewing)).toEqual(
      refused("forbidden"),
    );
    for (const objectId of [records.assigned, records.scheduleItem])
      expect(await move(users.owner, objectId, spaces.to)).toEqual(
        refused("not_movable"),
      );
    expect(await move(users.owner, records.event, spaces.from)).toEqual(
      refused("same_space"),
    );
    for (const target of [spaces.foreign, createId()])
      expect(await move(users.owner, records.event, target)).toEqual(
        refused("target_unavailable"),
      );
    expect(await move(users.owner, records.event, spaces.to, 4)).toBeInstanceOf(
      ObjectMoveChangedError,
    );

    await expect(
      repository.preview(principal(users.editor), records.event, spaces.to),
    ).rejects.toEqual(refused("forbidden"));
    await expect(
      repository.preview(principal(users.owner), records.event, spaces.foreign),
    ).rejects.toEqual(refused("target_unavailable"));
    await expect(
      repository.targets(principal(users.owner), records.note),
    ).rejects.toEqual(refused("not_movable"));
    await expect(
      repository.targets(principal(users.stranger), records.event),
    ).rejects.toBeInstanceOf(AuthorizationDeniedError);

    // An Event in Trash does not move.
    const objects = new EventPlanningObjectService(
      harness.database.connection.db,
    );
    const party = await objects.createEvent(moving.context(), {
      displayName: "Party",
      isAllDay: true,
      startsOn: "2030-11-01",
    });
    await objects.softDelete(moving.context(), party.id, 1);
    expect(await move(users.owner, party.id, spaces.to, 0)).toEqual(
      refused("not_movable"),
    );

    const [event] = await harness.database.connection.sql`
      SELECT workspace_id, version FROM objects WHERE id = ${records.event}
    `;
    expect(event).toEqual({ workspace_id: spaces.from, version: 2 });
  });

  it("returns a repeated move's result and refuses its command id for another space", async () => {
    const moving = await fixture("replay");
    const { records, spaces } = moving;
    const commandId = createId();
    const request = {
      workspaceId: spaces.to,
      expectedDroppedLinks: 5,
      commandId,
    };
    const first = await repository.move(
      moving.context(),
      records.event,
      request,
    );
    // A retry that raced the move still names the old space; a later one
    // follows the Event to the new one.
    for (const workspaceId of [spaces.from, spaces.to])
      expect(
        await repository.move(
          moving.context(moving.users.owner, workspaceId),
          records.event,
          { ...request, expectedDroppedLinks: 0 },
        ),
      ).toEqual(first);
    await expect(
      repository.move(
        moving.context(moving.users.owner, spaces.to),
        records.event,
        { ...request, workspaceId: spaces.personal },
      ),
    ).rejects.toBeInstanceOf(CommandConflictError);
    // Without the command id, moving it again into its space is refused.
    await expect(
      repository.move(
        moving.context(moving.users.owner, spaces.to),
        records.event,
        { workspaceId: spaces.to, expectedDroppedLinks: 0 },
      ),
    ).rejects.toEqual(expect.objectContaining({ reason: "same_space" }));
  });

  it("refuses a move when a link was added after the preview", async () => {
    const moving = await fixture("changed");
    const { records, spaces } = moving;
    const preview = await repository.preview(
      moving.context().principal,
      records.event,
      spaces.to,
    );
    const objects = new EventPlanningObjectService(
      harness.database.connection.db,
    );
    const dora = await objects.createPerson(moving.context(), {
      displayName: "Dora",
    });
    await new ObjectRelationService(harness.database.connection.db).create(
      moving.context(),
      {
        sourceObjectId: records.event,
        relationType: "includes",
        targetObjectId: dora.id,
      },
    );
    await expect(
      repository.move(moving.context(), records.event, {
        workspaceId: spaces.to,
        expectedDroppedLinks: preview.expectedDroppedLinks,
      }),
    ).rejects.toBeInstanceOf(ObjectMoveChangedError);
    const [event] = await harness.database.connection.sql`
      SELECT workspace_id FROM objects WHERE id = ${records.event}
    `;
    expect(event).toEqual({ workspace_id: spaces.from });
    await expect(
      repository.move(moving.context(), records.event, {
        workspaceId: spaces.to,
        expectedDroppedLinks: preview.expectedDroppedLinks + 1,
      }),
    ).resolves.toMatchObject({ move: { droppedLinks: 5 } });
  });

  it("leaves every object with a revision of its current version", async () => {
    const readiness = await harness.rpc<{ objectsWithoutBaseline: number }>(
      "chronelle_backend_readiness",
    );
    expect(readiness.objectsWithoutBaseline).toBe(0);
    await expect(
      assertRevisionBaseline(harness.database.connection.db),
    ).resolves.toBeUndefined();
    expect(await baselineObjectRevisions(harness.database.connection.db)).toBe(
      0,
    );
  });
});
