import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  auditEvents,
  commandChanges,
  commandReceipts,
  commandStacks,
  createId,
  objectRevisions,
  objects,
  reversibleCommands,
  users,
  workspaceMembers,
} from "@chronelle/db";
import type { CommandExecuteRequest, CommandReceipt } from "@chronelle/schemas";
import { and, eq, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseCommandWriteRepository } from "../src/cloudbase-command-write-repository.js";
import { ReversibleCommandService } from "../src/command-service.js";
import {
  CommandConflictError,
  CommandStackConflictError,
  InvalidObjectStateError,
  ObjectConflictError,
} from "../src/errors.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import type { MutationContext } from "../src/types.js";
import {
  createWriteHarness,
  failure,
  ledger,
  mutationContext,
  shape,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// chronelle_command_execute and chronelle_command_transition must leave
// what ReversibleCommandService leaves: the object ledgers, the command
// record and its changes, the caller's stack, the receipts, and the command
// audits; and they must refuse the same requests with the same errors. Each
// backend acts as its own workspace Owner, so each starts from an empty
// stack, and the same operation ids are reused for both.

let harness: WriteHarness;
let objectService: EventPlanningObjectService;
let reference: { actor: string; commands: ReversibleCommandService };
let cloudbase: { actor: string; commands: ReversibleCommandService };

const op = (suffix: string) => `00000000-0000-7000-8000-0000000000${suffix}`;
const at = (iso: string) => new Date(iso);

beforeAll(async () => {
  harness = await createWriteHarness("Command writes");
  const db = harness.database.connection.db;
  const secondOwner = createId();
  await db.insert(users).values({
    id: secondOwner,
    identityProvider: "test",
    providerSubject: secondOwner,
    displayName: "Second owner",
  });
  await db.insert(workspaceMembers).values({
    workspaceId: harness.workspaceId,
    userId: secondOwner,
    role: "owner",
  });
  objectService = new EventPlanningObjectService(db);
  reference = {
    actor: harness.ownerId,
    commands: new ReversibleCommandService(db),
  };
  cloudbase = {
    actor: secondOwner,
    commands: new ReversibleCommandService(
      db,
      new CloudBaseCommandWriteRepository(harness),
    ),
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

/** Replace per-run identifiers by names so both runs compare as equal. */
function resolve(value: unknown, names: Record<string, string>): unknown {
  if (typeof value === "string") return names[value] ?? value;
  if (Array.isArray(value)) return value.map((entry) => resolve(entry, names));
  if (value instanceof Date) return value;
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        names[key] ?? key,
        resolve(entry, names),
      ]),
    );
  return value;
}

type Ledger = Awaited<ReturnType<typeof ledger>>;

function namedLedger(entries: Ledger, names: Record<string, string>) {
  return resolve(entries, names) as Ledger;
}

/** A receipt with names for ids; objects are ordered by name. */
function receiptShape(receipt: CommandReceipt, names: Record<string, string>) {
  const resolved = resolve(receipt, names) as CommandReceipt;
  return {
    ...resolved,
    objects: [...resolved.objects].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

/** The command tables and audits of one actor. */
async function commandState(actor: string, names: Record<string, string>) {
  const db = harness.database.connection.db;
  const [stack] = await db
    .select()
    .from(commandStacks)
    .where(
      and(
        eq(commandStacks.workspaceId, harness.workspaceId),
        eq(commandStacks.userId, actor),
      ),
    );
  const commands = await db
    .select({ id: reversibleCommands.id })
    .from(reversibleCommands)
    .where(
      and(
        eq(reversibleCommands.workspaceId, harness.workspaceId),
        eq(reversibleCommands.userId, actor),
      ),
    )
    .orderBy(reversibleCommands.id);
  const changes = await db
    .select({
      commandId: commandChanges.commandId,
      objectId: commandChanges.objectId,
      beforeVersion: commandChanges.beforeVersion,
      afterVersion: commandChanges.afterVersion,
    })
    .from(commandChanges)
    .where(
      and(
        eq(commandChanges.workspaceId, harness.workspaceId),
        eq(commandChanges.userId, actor),
      ),
    );
  const receipts = await db
    .select({
      operationId: commandReceipts.operationId,
      commandId: commandReceipts.commandId,
      requestHash: commandReceipts.requestHash,
      receipt: commandReceipts.receipt,
    })
    .from(commandReceipts)
    .where(
      and(
        eq(commandReceipts.workspaceId, harness.workspaceId),
        eq(commandReceipts.userId, actor),
      ),
    )
    .orderBy(commandReceipts.operationId);
  const audits = await db
    .select({ action: auditEvents.action, metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, harness.workspaceId),
        eq(auditEvents.actorId, actor),
        like(auditEvents.action, "command.%"),
      ),
    );
  audits.sort(
    (a, b) =>
      (a.metadata as CommandReceipt).stackVersion -
      (b.metadata as CommandReceipt).stackVersion,
  );
  return {
    stack: stack && {
      version: stack.version,
      undoIds: stack.undoIds,
      redoIds: stack.redoIds,
      expectedVersions: resolve(stack.expectedVersions, names),
    },
    commands: commands.map((row) => row.id),
    changes: changes
      .map((row) => ({
        ...row,
        objectId: names[row.objectId] ?? row.objectId,
      }))
      .sort((a, b) =>
        `${a.commandId} ${a.objectId}`.localeCompare(
          `${b.commandId} ${b.objectId}`,
        ),
      ),
    receipts: receipts.map(({ requestHash, receipt, ...row }) => ({
      ...row,
      hashed: /^[0-9a-f]{64}$/u.test(requestHash),
      receipt: receiptShape(receipt as CommandReceipt, names),
    })),
    audits: audits.map((row) => ({
      action: row.action,
      metadata: receiptShape(row.metadata as CommandReceipt, names),
    })),
  };
}

async function current(objectId: string) {
  const db = harness.database.connection.db;
  const [row] = await db
    .select({ version: objects.version, displayName: objects.displayName })
    .from(objects)
    .where(eq(objects.id, objectId));
  return row;
}

async function revisionCount(objectId: string) {
  return (
    await harness.database.connection.db
      .select({ id: objectRevisions.id })
      .from(objectRevisions)
      .where(eq(objectRevisions.objectId, objectId))
  ).length;
}

describe.sequential("CloudBase command writes", () => {
  it("executes, replays, undoes, and redoes with the same receipts, ledgers, and stacks", async () => {
    const results = [];
    for (const [, backend] of backends()) {
      const context = (): MutationContext =>
        mutationContext(harness, backend.actor);
      const event = await objectService.createEvent(context(), {
        displayName: "Initial",
        startsAt: at("2030-01-01T09:00:00.000Z"),
        endsAt: at("2030-01-01T10:00:00.000Z"),
        timezone: "UTC",
        customProperties: { room: "A", keep: true },
      });
      const task = await objectService.createTask(context(), {
        displayName: "Prepare",
      });
      const names = {
        [event.id]: "<event>",
        [task.id]: "<task>",
        [backend.actor]: "<actor>",
      };
      const request: CommandExecuteRequest = {
        operationId: op("01"),
        expectedStackVersion: 0,
        edits: [
          {
            objectType: "task",
            objectId: task.id,
            patch: {
              expectedVersion: 1,
              status: "done",
              completedAt: at("2030-01-02T08:00:00.000Z"),
            },
          },
          {
            objectType: "event",
            objectId: event.id,
            patch: {
              expectedVersion: 1,
              displayName: "Renamed",
              startsAt: null,
              endsAt: null,
              customProperties: { keep: true },
            },
          },
        ],
      };
      const executed = await backend.commands.execute(context(), request);
      const replayed = await backend.commands.execute(context(), request);
      const undone = await backend.commands.undo(context(), {
        operationId: op("02"),
        commandId: op("01"),
        expectedStackVersion: 1,
      });
      const afterUndo = {
        event: shape(
          await objectService.getEvent(context().principal, event.id),
        ),
        task: shape(await objectService.getTask(context().principal, task.id)),
      };
      const redone = await backend.commands.redo(context(), {
        operationId: op("03"),
        commandId: op("01"),
        expectedStackVersion: 2,
      });
      // An edit outside the stack, then a new command on that object: the
      // older inverse must not cross it, so the undo list starts over.
      await objectService.updateEvent(context(), event.id, {
        expectedVersion: 4,
        timezone: "Europe/Paris",
      });
      const diverged = await backend.commands.execute(context(), {
        operationId: op("04"),
        expectedStackVersion: 3,
        edits: [
          {
            objectType: "event",
            objectId: event.id,
            patch: { expectedVersion: 5, displayName: "Again" },
          },
        ],
      });
      const undoneAgain = await backend.commands.undo(context(), {
        operationId: op("05"),
        commandId: op("04"),
        expectedStackVersion: 4,
      });
      results.push({
        executed: receiptShape(executed, names),
        replayed: receiptShape(replayed, names),
        undone: receiptShape(undone, names),
        afterUndo: resolve(afterUndo, names),
        redone: receiptShape(redone, names),
        diverged: receiptShape(diverged, names),
        undoneAgain: receiptShape(undoneAgain, names),
        final: resolve(
          {
            event: shape(
              await objectService.getEvent(context().principal, event.id),
            ),
            task: shape(
              await objectService.getTask(context().principal, task.id),
            ),
          },
          names,
        ),
        ledgers: {
          event: namedLedger(await ledger(harness, event.id), names),
          task: namedLedger(await ledger(harness, task.id), names),
        },
        state: await commandState(backend.actor, names),
      });
    }
    expect(results[1]).toEqual(results[0]);
    const [postgres] = results;
    const objectsAt = (version: number) => [
      { id: "<event>", version },
      { id: "<task>", version },
    ];
    expect(postgres?.executed).toEqual({
      operationId: op("01"),
      commandId: op("01"),
      direction: "execute",
      stackVersion: 1,
      objects: objectsAt(2),
    });
    expect(postgres?.replayed).toEqual(postgres?.executed);
    expect(postgres?.undone).toMatchObject({
      commandId: op("01"),
      direction: "undo",
      stackVersion: 2,
      objects: objectsAt(3),
    });
    expect(postgres?.afterUndo).toMatchObject({
      event: {
        version: 3,
        displayName: "Initial",
        startsAt: at("2030-01-01T09:00:00.000Z"),
        customProperties: { room: "A", keep: true },
      },
      task: { version: 3, status: "todo", completedAt: null },
    });
    expect(postgres?.redone).toMatchObject({
      direction: "redo",
      stackVersion: 3,
      objects: objectsAt(4),
    });
    expect(postgres?.diverged).toMatchObject({
      commandId: op("04"),
      direction: "execute",
      stackVersion: 4,
      objects: [{ id: "<event>", version: 6 }],
    });
    expect(postgres?.final).toMatchObject({
      event: {
        version: 7,
        displayName: "Renamed",
        timezone: "Europe/Paris",
        startsAt: null,
        customProperties: { keep: true },
      },
      task: { version: 4, status: "done" },
    });
    expect(postgres?.state.stack).toEqual({
      version: 5,
      undoIds: [],
      redoIds: [op("04")],
      expectedVersions: { "<event>": 7 },
    });
    expect(postgres?.state.commands).toEqual([op("01"), op("04")]);
    expect(postgres?.state.changes).toEqual([
      {
        commandId: op("01"),
        objectId: "<event>",
        beforeVersion: 1,
        afterVersion: 2,
      },
      {
        commandId: op("01"),
        objectId: "<task>",
        beforeVersion: 1,
        afterVersion: 2,
      },
      {
        commandId: op("04"),
        objectId: "<event>",
        beforeVersion: 5,
        afterVersion: 6,
      },
    ]);
    expect(
      postgres?.state.audits.map((entry) => [
        entry.action,
        entry.metadata.stackVersion,
      ]),
    ).toEqual([
      ["command.execute", 1],
      ["command.undo", 2],
      ["command.redo", 3],
      ["command.execute", 4],
      ["command.undo", 5],
    ]);
    expect(postgres?.state.receipts.map((entry) => entry.hashed)).toEqual([
      true,
      true,
      true,
      true,
      true,
    ]);
    expect(
      postgres?.ledgers.event.map((entry) => [entry.action, entry.metadata]),
    ).toEqual([
      ["event.created", { version: 1 }],
      [
        "event.updated",
        {
          previousVersion: 1,
          version: 2,
          command: {
            id: op("01"),
            operationId: op("01"),
            direction: "execute",
          },
        },
      ],
      [
        "event.updated",
        {
          previousVersion: 2,
          version: 3,
          command: { id: op("01"), operationId: op("02"), direction: "undo" },
        },
      ],
      [
        "event.updated",
        {
          previousVersion: 3,
          version: 4,
          command: { id: op("01"), operationId: op("03"), direction: "redo" },
        },
      ],
      ["event.updated", { previousVersion: 4, version: 5 }],
      [
        "event.updated",
        {
          previousVersion: 5,
          version: 6,
          command: {
            id: op("04"),
            operationId: op("04"),
            direction: "execute",
          },
        },
      ],
      [
        "event.updated",
        {
          previousVersion: 6,
          version: 7,
          command: { id: op("04"), operationId: op("05"), direction: "undo" },
        },
      ],
    ]);
  });

  it("refuses the same requests with the same errors", async () => {
    const outcomes = [];
    for (const [, backend] of backends()) {
      const context = (userId = backend.actor): MutationContext =>
        mutationContext(harness, userId);
      const stackVersion = (await commandState(backend.actor, {})).stack
        ?.version;
      if (stackVersion === undefined) throw new Error("stack missing");
      const event = await objectService.createEvent(context(), {
        displayName: "Guarded",
      });
      const task = await objectService.createTask(context(), {
        displayName: "Guarded task",
      });
      const deleted = await objectService.createTask(context(), {
        displayName: "Gone",
      });
      await objectService.softDelete(context(), deleted.id, 1);
      const rename = (
        objectId: string,
        expectedVersion: number,
        objectType: "event" | "task" = "event",
      ): CommandExecuteRequest["edits"][number] => ({
        objectType,
        objectId,
        patch: { expectedVersion, displayName: "Changed" },
      });
      const seen: string[] = [];
      const record = (error: Error) =>
        seen.push(`${error.constructor.name}: ${error.message}`);
      const refuse = async (run: () => Promise<unknown>) =>
        record(await failure(run));

      await refuse(() =>
        backend.commands.execute(context(), {
          operationId: op("11"),
          expectedStackVersion: stackVersion + 1,
          edits: [rename(event.id, 1)],
        }),
      );
      await refuse(() =>
        backend.commands.execute(context(), {
          operationId: op("12"),
          expectedStackVersion: stackVersion,
          edits: [rename(event.id, 2)],
        }),
      );
      await refuse(() =>
        backend.commands.execute(context(), {
          operationId: op("13"),
          expectedStackVersion: stackVersion,
          edits: [rename(task.id, 1, "event")],
        }),
      );
      await refuse(() =>
        backend.commands.execute(context(), {
          operationId: op("14"),
          expectedStackVersion: stackVersion,
          edits: [rename(deleted.id, 2, "task")],
        }),
      );
      await refuse(() =>
        backend.commands.execute(context(), {
          operationId: op("15"),
          expectedStackVersion: stackVersion,
          edits: [rename(createId(), 1)],
        }),
      );
      await refuse(() =>
        backend.commands.execute(context(harness.viewerId), {
          operationId: op("16"),
          expectedStackVersion: 0,
          edits: [rename(event.id, 1)],
        }),
      );
      await refuse(() =>
        backend.commands.execute(context(), {
          operationId: op("17"),
          expectedStackVersion: stackVersion,
          edits: [
            {
              objectType: "task",
              objectId: task.id,
              patch: { expectedVersion: 1, status: "done" },
            },
          ],
        }),
      );
      const executed = await backend.commands.execute(context(), {
        operationId: op("19"),
        expectedStackVersion: stackVersion,
        edits: [rename(event.id, 1), rename(task.id, 1, "task")],
      });
      expect(executed.stackVersion).toBe(stackVersion + 1);
      await refuse(() =>
        backend.commands.execute(context(), {
          operationId: op("19"),
          expectedStackVersion: stackVersion,
          edits: [rename(event.id, 1)],
        }),
      );
      await refuse(() =>
        backend.commands.undo(context(), {
          operationId: op("1a"),
          commandId: op("19"),
          expectedStackVersion: stackVersion,
        }),
      );
      await refuse(() =>
        backend.commands.undo(context(), {
          operationId: op("1b"),
          commandId: op("11"),
          expectedStackVersion: stackVersion + 1,
        }),
      );
      await refuse(() =>
        backend.commands.redo(context(), {
          operationId: op("1c"),
          commandId: op("19"),
          expectedStackVersion: stackVersion + 1,
        }),
      );
      await objectService.updateTask(context(), task.id, {
        expectedVersion: 2,
        displayName: "Edited outside the stack",
      });
      await refuse(() =>
        backend.commands.undo(context(), {
          operationId: op("1d"),
          commandId: op("19"),
          expectedStackVersion: stackVersion + 1,
        }),
      );
      // A refused undo changes nothing: the stack still expects the same head.
      const state = await commandState(backend.actor, {});
      expect(state.stack?.version).toBe(stackVersion + 1);
      expect(state.stack?.undoIds.at(-1)).toBe(op("19"));
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    const denied = `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`;
    const stackConflict = `${CommandStackConflictError.name}: ${new CommandStackConflictError().message}`;
    const objectConflict = `${ObjectConflictError.name}: ${new ObjectConflictError().message}`;
    expect(outcomes[0]).toEqual([
      stackConflict,
      objectConflict,
      denied,
      denied,
      denied,
      denied,
      `${InvalidObjectStateError.name}: completedAt must be set exactly when status is done.`,
      `${CommandConflictError.name}: ${new CommandConflictError().message}`,
      stackConflict,
      stackConflict,
      stackConflict,
      objectConflict,
    ]);
  });

  it("persists nothing when the function fails after the edits", async () => {
    const context = mutationContext(harness, cloudbase.actor);
    const event = await objectService.createEvent(context, {
      displayName: "Atomic",
    });
    const before = {
      event: await current(event.id),
      revisions: await revisionCount(event.id),
      state: await commandState(cloudbase.actor, {}),
    };
    // The receipt's hash check fails after the edit, the command record,
    // and the stack advance were written inside the function.
    const error = await failure(() =>
      harness.rpc("chronelle_command_execute", {
        workspace_id: harness.workspaceId,
        user_id: cloudbase.actor,
        request_id: createId(),
        operation_id: op("21"),
        expected_stack_version: before.state.stack?.version,
        edits: [
          {
            objectType: "event",
            objectId: event.id,
            patch: { expectedVersion: 1, displayName: "Lost" },
          },
        ],
        request_hash: "not-a-hash",
      }),
    );
    expect(error.message).toContain("request_hash");
    expect({
      event: await current(event.id),
      revisions: await revisionCount(event.id),
      state: await commandState(cloudbase.actor, {}),
    }).toEqual(before);
  });
});
