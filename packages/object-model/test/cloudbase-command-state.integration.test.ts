import { createId, users, workspaceMembers } from "@livtales/db";
import type { CommandStateResponse } from "@livtales/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseCommandReadRepository } from "../src/cloudbase-command-read-repository.js";
import { ReversibleCommandService } from "../src/command-service.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import type { MutationContext } from "../src/types.js";
import {
  createWriteHarness,
  mutationContext,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// chronelle_command_state must report what ReversibleCommandService.getState
// reports after every kind of stack movement: the stack version, the undo
// head (present but unavailable after an untracked edit), the redo head
// (hidden when unavailable), and no head at all once the caller may no
// longer edit one of the command's objects. Each backend acts as its own
// workspace Owner so each has its own stack; commands run through the
// PostgreSQL write path on both.

let harness: WriteHarness;
let objectService: EventPlanningObjectService;
let reference: { actor: string; commands: ReversibleCommandService };
let cloudbase: { actor: string; commands: ReversibleCommandService };

const op = (suffix: string) => `00000000-0000-7000-8000-0000000000${suffix}`;

beforeAll(async () => {
  harness = await createWriteHarness("Command state");
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
      undefined,
      new CloudBaseCommandReadRepository(harness),
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

describe.sequential("CloudBase command state", () => {
  it("reports the same version and heads after every stack movement", async () => {
    const results: Record<string, CommandStateResponse>[] = [];
    for (const [, backend] of backends()) {
      const context = (): MutationContext =>
        mutationContext(harness, backend.actor);
      const principal = context().principal;
      const states: Record<string, CommandStateResponse> = {};
      const capture = async (label: string) => {
        states[label] = await backend.commands.getState(principal);
      };
      const rename = (
        objectType: "event" | "task",
        objectId: string,
        expectedVersion: number,
        displayName: string,
      ) => ({
        objectType,
        objectId,
        patch: { expectedVersion, displayName },
      });

      const event = await objectService.createEvent(context(), {
        displayName: "Event",
      });
      const task = await objectService.createTask(context(), {
        displayName: "Task",
      });
      await capture("empty");
      await backend.commands.execute(context(), {
        operationId: op("01"),
        expectedStackVersion: 0,
        edits: [
          rename("event", event.id, 1, "Event 2"),
          rename("task", task.id, 1, "Task 2"),
        ],
      });
      await capture("executed");
      await backend.commands.undo(context(), {
        operationId: op("02"),
        commandId: op("01"),
        expectedStackVersion: 1,
      });
      await capture("undone");
      // An edit outside the stack hides the redo head.
      await objectService.updateTask(context(), task.id, {
        expectedVersion: 3,
        displayName: "Task edited outside",
      });
      await capture("redoHidden");
      await backend.commands.execute(context(), {
        operationId: op("03"),
        expectedStackVersion: 2,
        edits: [rename("event", event.id, 3, "Event 4")],
      });
      await capture("executedAgain");
      // The same kind of edit leaves the undo head listed but unavailable.
      await objectService.updateEvent(context(), event.id, {
        expectedVersion: 4,
        displayName: "Event edited outside",
      });
      await capture("undoUnavailable");
      // A new command on the edited object starts the undo list over.
      await backend.commands.execute(context(), {
        operationId: op("04"),
        expectedStackVersion: 3,
        edits: [rename("event", event.id, 5, "Event 6")],
      });
      await capture("diverged");
      // Deleting the head's object removes edit access, so the head disappears.
      await objectService.softDelete(context(), event.id, 6);
      await capture("headHidden");
      states.nonMember = await backend.commands.getState(
        mutationContext(harness, harness.viewerId).principal,
      );
      results.push(states);
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toEqual({
      empty: { version: 0, undo: null, redo: null },
      executed: {
        version: 1,
        undo: { commandId: op("01"), available: true },
        redo: null,
      },
      undone: {
        version: 2,
        undo: null,
        redo: { commandId: op("01"), available: true },
      },
      redoHidden: { version: 2, undo: null, redo: null },
      executedAgain: {
        version: 3,
        undo: { commandId: op("03"), available: true },
        redo: null,
      },
      undoUnavailable: {
        version: 3,
        undo: { commandId: op("03"), available: false },
        redo: null,
      },
      diverged: {
        version: 4,
        undo: { commandId: op("04"), available: true },
        redo: null,
      },
      headHidden: { version: 4, undo: null, redo: null },
      nonMember: { version: 0, undo: null, redo: null },
    });
  });
});
