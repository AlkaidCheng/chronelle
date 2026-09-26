import { createId } from "@livtales/db";
import type { ObjectMovePreview, ObjectMoveRequest } from "@livtales/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseObjectMoveRepository } from "../src/cloudbase-object-move-repository.js";
import {
  type ObjectMoveRepository,
  PostgresObjectMoveRepository,
} from "../src/object-move.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import { ObjectRelationService } from "../src/relation-service.js";
import { assertRevisionBaseline } from "../src/revision-baseline.js";
import {
  createWriteHarness,
  failure,
  type WriteHarness,
} from "./cloudbase-write-harness.js";
import {
  buildMoveFixture,
  fixtureLabels,
  type MoveFixture,
  movedRows,
  normalized,
  oldSpaceLedgers,
} from "./object-move-fixture.js";

// Moving an Event through chronelle_object_move and its preview and target
// functions must leave what the PostgreSQL service leaves: the same
// preview, result, rows, audit events, and revisions on the same fixture,
// the same refusals, the same replay, and history in the old space as it
// was written.

const movedAt = new Date("2030-09-01T08:00:00.000Z");
let harness: WriteHarness;
let reference: ObjectMoveRepository;
let cloudbase: ObjectMoveRepository;
/** The functions the CloudBase repository called, in order. */
const called: string[] = [];

beforeAll(async () => {
  harness = await createWriteHarness("Object move");
  reference = new PostgresObjectMoveRepository(
    harness.database.connection.db,
    () => movedAt,
  );
  cloudbase = new CloudBaseObjectMoveRepository(
    {
      rpc: <T>(name: string, args?: Record<string, unknown>) => {
        called.push(name);
        return harness.rpc<T>(name, args);
      },
    },
    () => movedAt,
  );
});

afterAll(async () => {
  await harness?.database.close();
});

const backends = () =>
  [
    ["postgres", reference],
    ["cloudbase", cloudbase],
  ] as const;

const fixture = (label: string) => buildMoveFixture(harness.database, label);

/** An error as the API would tell it apart. */
function described(error: Error) {
  return {
    name: error.name,
    message: error.message,
    reason: (error as { reason?: unknown }).reason,
  };
}

async function eventRow(moving: MoveFixture) {
  const [row] = await harness.database.connection.sql`
    SELECT workspace_id, version FROM objects WHERE id = ${moving.records.event}
  `;
  return row;
}

describe.sequential("moving an Event through CloudBase", () => {
  it("lists the targets and previews the move as PostgreSQL does", async () => {
    const moving = await fixture("preview");
    const principal = moving.context().principal;
    const results = [];
    for (const [, backend] of backends())
      results.push({
        targets: await backend.targets(principal, moving.records.event),
        preview: await backend.preview(
          principal,
          moving.records.event,
          moving.spaces.to,
        ),
        personal: await backend.preview(
          principal,
          moving.records.event,
          moving.spaces.personal,
        ),
      });
    expect(results[1]).toEqual(results[0]);
    expect(results[0]?.preview.expectedDroppedLinks).toBe(5);
    expect(results[0]?.personal).toMatchObject({
      labels: {
        items: [
          { name: "Catering", existing: false },
          { name: "Venue", existing: false },
        ],
      },
      access: {
        targetMembers: { owner: 1, editor: 0, viewer: 0 },
        keepingShares: { total: 2 },
        droppedGrants: { total: 0 },
        lapsingShares: 1,
      },
    });
  });

  it("moves the Event and leaves the rows PostgreSQL leaves", async () => {
    const results = [];
    for (const [, backend] of backends()) {
      // Both fixtures carry the same names, so their normalized rows compare.
      const moving = await fixture("move");
      const written = await oldSpaceLedgers(harness.database, moving);
      const context = moving.context();
      const result = await backend.move(context, moving.records.event, {
        workspaceId: moving.spaces.to,
        expectedDroppedLinks: 5,
        commandId: createId(),
      });
      const after = new Set(
        (await oldSpaceLedgers(harness.database, moving)).map(({ row }) =>
          JSON.stringify(row),
        ),
      );
      results.push({
        result: normalized(
          moving,
          await fixtureLabels(harness.database, moving),
          result,
        ),
        rows: await movedRows(harness.database, moving, context.requestId),
        rewrittenHistory: written.filter(
          ({ row }) => !after.has(JSON.stringify(row)),
        ),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]?.rewrittenHistory).toEqual([]);
    expect(results[0]?.result).toMatchObject({
      event: { id: "event", workspaceId: "to", version: 2 },
      move: {
        from: { id: "from" },
        to: { id: "to" },
        droppedLinks: 4,
        unassignedTasks: 1,
        clearedLinks: 2,
        labelsJoined: 1,
        labelsCreated: 1,
        grantsDropped: 1,
        peopleKept: 1,
      },
    });
    expect(results[0]?.rows.audit).toHaveLength(11);
    expect(results[0]?.rows.revisions).toHaveLength(3);
  });

  it("refuses the moves PostgreSQL refuses, with the same errors", async () => {
    const moving = await fixture("refusals");
    const { records, spaces, users } = moving;
    const unknown = createId();
    const principal = (userId: string) => moving.context(userId).principal;
    const move =
      (userId: string, objectId: string, workspaceId: string, count = 5) =>
      (backend: ObjectMoveRepository) =>
        backend.move(moving.context(userId), objectId, {
          workspaceId,
          expectedDroppedLinks: count,
        });
    const cases: [
      string,
      (backend: ObjectMoveRepository) => Promise<unknown>,
    ][] = [
      ["unseen", move(users.stranger, records.event, spaces.to)],
      ["not an owner", move(users.editor, records.event, spaces.to)],
      ["viewer there", move(users.owner, records.event, spaces.viewing)],
      ["a to-do", move(users.owner, records.assigned, spaces.to)],
      ["a schedule item", move(users.owner, records.scheduleItem, spaces.to)],
      ["same space", move(users.owner, records.event, spaces.from)],
      ["not a member", move(users.owner, records.event, spaces.foreign)],
      ["unknown space", move(users.owner, records.event, unknown)],
      ["unknown record", move(users.owner, unknown, spaces.to)],
      ["changed", move(users.owner, records.event, spaces.to, 4)],
      [
        "preview by an editor",
        (backend) =>
          backend.preview(principal(users.editor), records.event, spaces.to),
      ],
      [
        "preview into a space not joined",
        (backend) =>
          backend.preview(
            principal(users.owner),
            records.event,
            spaces.foreign,
          ),
      ],
      [
        "preview into its space",
        (backend) =>
          backend.preview(principal(users.owner), records.event, spaces.from),
      ],
      [
        "targets of a note",
        (backend) => backend.targets(principal(users.owner), records.note),
      ],
      [
        "targets unseen",
        (backend) => backend.targets(principal(users.stranger), records.event),
      ],
    ];
    const reasons: Record<string, unknown> = {};
    for (const [label, run] of cases) {
      const errors = [];
      for (const [, backend] of backends())
        errors.push(described(await failure(() => run(backend))));
      expect(errors[1], label).toEqual(errors[0]);
      reasons[label] = errors[0]?.reason ?? errors[0]?.name;
    }
    expect(reasons).toEqual({
      unseen: "AuthorizationDeniedError",
      "not an owner": "forbidden",
      "viewer there": "forbidden",
      "a to-do": "not_movable",
      "a schedule item": "not_movable",
      "same space": "same_space",
      "not a member": "target_unavailable",
      "unknown space": "target_unavailable",
      "unknown record": "AuthorizationDeniedError",
      changed: "ObjectMoveChangedError",
      "preview by an editor": "forbidden",
      "preview into a space not joined": "target_unavailable",
      "preview into its space": "same_space",
      "targets of a note": "not_movable",
      "targets unseen": "AuthorizationDeniedError",
    });
    expect(await eventRow(moving)).toEqual({
      workspace_id: spaces.from,
      version: 2,
    });
  });

  it("returns a move's recorded result to a repeat on either backend", async () => {
    const orders: [ObjectMoveRepository, ObjectMoveRepository][] = [
      [reference, cloudbase],
      [cloudbase, reference],
    ];
    for (const [first, second] of orders) {
      const moving = await fixture("replay");
      const { records, spaces } = moving;
      const request: ObjectMoveRequest = {
        workspaceId: spaces.to,
        expectedDroppedLinks: 5,
        commandId: createId(),
      };
      const moved = await first.move(moving.context(), records.event, request);
      for (const backend of [first, second])
        for (const workspaceId of [spaces.from, spaces.to])
          expect(
            await backend.move(
              moving.context(moving.users.owner, workspaceId),
              records.event,
              request,
            ),
          ).toEqual(moved);
      const conflicts = [];
      for (const backend of [first, second])
        conflicts.push(
          described(
            await failure(() =>
              backend.move(
                moving.context(moving.users.owner, spaces.to),
                records.event,
                { ...request, workspaceId: spaces.personal },
              ),
            ),
          ),
        );
      expect(conflicts[1]).toEqual(conflicts[0]);
      expect(conflicts[0]?.name).toBe("CommandConflictError");
    }
  });

  it("refuses a move whose links changed after the preview, as PostgreSQL does", async () => {
    const moving = await fixture("changed");
    const { records, spaces } = moving;
    const previews: ObjectMovePreview[] = [];
    for (const [, backend] of backends())
      previews.push(
        await backend.preview(
          moving.context().principal,
          records.event,
          spaces.to,
        ),
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
    const errors = [];
    for (const [index, [, backend]] of backends().entries())
      errors.push(
        described(
          await failure(() =>
            backend.move(moving.context(), records.event, {
              workspaceId: spaces.to,
              expectedDroppedLinks: previews[index]?.expectedDroppedLinks ?? 0,
            }),
          ),
        ),
      );
    expect(errors[1]).toEqual(errors[0]);
    expect(errors[0]?.name).toBe("ObjectMoveChangedError");
    expect(await eventRow(moving)).toEqual({
      workspace_id: spaces.from,
      version: 2,
    });
  });

  it("leaves every moved object with a revision of its current version", async () => {
    const readiness = await harness.rpc<{ objectsWithoutBaseline: number }>(
      "chronelle_backend_readiness",
    );
    expect(readiness.objectsWithoutBaseline).toBe(0);
    await expect(
      assertRevisionBaseline(harness.database.connection.db),
    ).resolves.toBeUndefined();
    expect(await harness.rpc<number>("chronelle_revision_baseline")).toBe(0);
    expect(new Set(called)).toEqual(
      new Set([
        "chronelle_object_move_targets",
        "chronelle_object_move_preview",
        "chronelle_object_move",
      ]),
    );
  });
});
