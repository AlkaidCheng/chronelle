import { AuthorizationDeniedError } from "@chronelle/authorization";
import { createId, objectRelations, resourceGrants } from "@chronelle/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseExpenseWriteRepository } from "../src/cloudbase-expense-write-repository.js";
import { CloudBaseSectionRepository } from "../src/cloudbase-section-repository.js";
import { CloudBaseTaskWriteRepository } from "../src/cloudbase-task-write-repository.js";
import { InvalidObjectStateError } from "../src/errors.js";
import {
  EventPlanningObjectService,
  sectionMemberMessage,
} from "../src/object-service.js";
import { EventPlanningProjectionService } from "../src/projection-service.js";
import {
  PostgresSectionRepository,
  SectionService,
  sectionNameMessage,
  sectionPlacementMessage,
} from "../src/sections.js";
import type { SectionResource } from "../src/types.js";
import {
  createWriteHarness,
  failure,
  mutationContext,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// Sections through the chronelle_section_* functions must behave as the
// PostgreSQL repository does, and a Task or Expense must accept a section
// under the same rule on both backends. Each backend works in its own
// Event, so the ranks it computes are comparable.

let harness: WriteHarness;

interface Backend {
  readonly name: "postgres" | "cloudbase";
  readonly objects: EventPlanningObjectService;
  readonly sections: SectionService;
  readonly projections: EventPlanningProjectionService;
}

let backends: readonly Backend[];

beforeAll(async () => {
  harness = await createWriteHarness("Section writes");
  const db = harness.database.connection.db;
  const postgresSections = new PostgresSectionRepository(db);
  const cloudbaseSections = new CloudBaseSectionRepository(harness);
  backends = [
    {
      name: "postgres",
      objects: new EventPlanningObjectService(db),
      sections: new SectionService(postgresSections, postgresSections),
      projections: new EventPlanningProjectionService(db),
    },
    {
      name: "cloudbase",
      objects: new EventPlanningObjectService(db, undefined, undefined, {
        task: new CloudBaseTaskWriteRepository(harness),
        expense: new CloudBaseExpenseWriteRepository(harness),
      }),
      sections: new SectionService(cloudbaseSections, cloudbaseSections),
      projections: new EventPlanningProjectionService(
        db,
        undefined,
        undefined,
        undefined,
        cloudbaseSections,
      ),
    },
  ];
});

afterAll(async () => {
  await harness?.database.close();
});

const context = (userId?: string) => mutationContext(harness, userId);
const principal = (userId = harness.ownerId) => ({
  type: "user" as const,
  userId,
  workspaceId: harness.workspaceId,
});

/** Everything but identity and clock fields. */
function shape(section: SectionResource) {
  const { id, eventId, createdAt, updatedAt, ...rest } = section;
  return {
    ...rest,
    clockFields: [createdAt, updatedAt].every(
      (value) => value instanceof Date && Number.isFinite(value.getTime()),
    ),
  };
}

const names = (sections: readonly SectionResource[]) =>
  sections.map(({ name }) => name);

describe.sequential("CloudBase section writes", () => {
  it("create between two sections, rename, move, and delete the same way", async () => {
    const outcomes: Record<string, unknown>[][] = [];
    for (const { objects, sections } of backends) {
      const event = await objects.createEvent(context(), {
        displayName: "Launch",
      });
      const first = await sections.createSection(principal(), event.id, {
        view: "todos",
        name: "Before",
      });
      const last = await sections.createSection(principal(), event.id, {
        view: "todos",
        name: "After",
        description: "Once the doors open",
      });
      const between = await sections.createSection(principal(), event.id, {
        view: "todos",
        name: "During",
        afterSectionId: first.id,
      });
      const lead = await sections.createSection(principal(), event.id, {
        view: "todos",
        name: "Lead",
        afterSectionId: null,
      });
      expect(
        names(await sections.listSections(principal(), event.id, "todos")),
      ).toEqual(["Lead", "Before", "During", "After"]);
      expect(between.rank > first.rank && between.rank < last.rank).toBe(true);
      expect(lead.rank < first.rank).toBe(true);
      // Another view of the same Event orders on its own.
      const spend = await sections.createSection(principal(), event.id, {
        view: "expenses",
        name: "Venue",
      });
      expect(spend.rank).toBe(first.rank);
      expect(
        names(await sections.listSections(principal(), event.id, "expenses")),
      ).toEqual(["Venue"]);

      const renamed = await sections.updateSection(principal(), between.id, {
        name: "Meanwhile",
        description: "While it runs",
      });
      expect(renamed.rank).toBe(between.rank);
      const movedLast = await sections.updateSection(principal(), lead.id, {
        afterSectionId: last.id,
      });
      expect(movedLast.rank > last.rank).toBe(true);
      const movedFirst = await sections.updateSection(principal(), last.id, {
        afterSectionId: null,
      });
      expect(movedFirst.rank < first.rank).toBe(true);
      const movedAfter = await sections.updateSection(principal(), first.id, {
        afterSectionId: between.id,
      });
      expect(
        names(await sections.listSections(principal(), event.id, "todos")),
      ).toEqual(["After", "Meanwhile", "Before", "Lead"]);
      const cleared = await sections.updateSection(principal(), between.id, {
        description: null,
      });
      expect(cleared.description).toBeNull();

      const deleted = await sections.deleteSection(principal(), first.id);
      expect(deleted.id).toBe(first.id);
      expect(
        names(await sections.listSections(principal(), event.id, "todos")),
      ).toEqual(["After", "Meanwhile", "Lead"]);
      outcomes.push(
        [
          first,
          last,
          between,
          lead,
          spend,
          renamed,
          movedLast,
          movedFirst,
          movedAfter,
          cleared,
          deleted,
        ].map(shape),
      );
    }
    const [postgres, cloudbase] = outcomes;
    expect(cloudbase).toEqual(postgres);
  });

  it("place a record in a section of its Event's view and refuse any other", async () => {
    for (const { name, objects, sections, projections } of backends) {
      const event = await objects.createEvent(context(), {
        displayName: `Trip ${name}`,
      });
      const other = await objects.createEvent(context(), {
        displayName: `Other ${name}`,
      });
      const packing = await sections.createSection(principal(), event.id, {
        view: "todos",
        name: "Packing",
      });
      const spend = await sections.createSection(principal(), event.id, {
        view: "expenses",
        name: "Transport",
      });
      const elsewhere = await sections.createSection(principal(), other.id, {
        view: "todos",
        name: "Elsewhere",
      });

      const packed = await objects.createTask(context(), {
        displayName: "Pack",
        permissionScopeId: event.id,
        sectionId: packing.id,
      });
      expect(packed.sectionId).toBe(packing.id);
      const loose = await objects.createTask(context(), {
        displayName: "Loose",
        permissionScopeId: event.id,
      });
      expect(loose.sectionId).toBeNull();
      const placed = await objects.updateTask(context(), loose.id, {
        expectedVersion: 1,
        sectionId: packing.id,
      });
      expect(placed.sectionId).toBe(packing.id);
      const unplaced = await objects.updateTask(context(), placed.id, {
        expectedVersion: 2,
        sectionId: null,
      });
      expect(unplaced.sectionId).toBeNull();
      const fare = await objects.createExpense(context(), {
        displayName: "Train",
        amount: "42",
        currency: "EUR",
        occurredAt: new Date("2030-05-01T08:00:00.000Z"),
        permissionScopeId: event.id,
        sectionId: spend.id,
      });
      expect(fare.sectionId).toBe(spend.id);
      // The projections list what the Event includes.
      await harness.database.connection.db.insert(objectRelations).values(
        [packed.id, unplaced.id, fare.id].map((targetObjectId) => ({
          id: createId(),
          workspaceId: harness.workspaceId,
          sourceObjectId: event.id,
          targetObjectId,
          relationType: "includes" as const,
          createdBy: harness.ownerId,
        })),
      );

      const refusals = [
        // Another Event's section.
        () =>
          objects.createTask(context(), {
            displayName: "Wrong event",
            permissionScopeId: event.id,
            sectionId: elsewhere.id,
          }),
        () =>
          objects.updateTask(context(), packed.id, {
            expectedVersion: 1,
            sectionId: elsewhere.id,
          }),
        // The other view of the same Event.
        () =>
          objects.createTask(context(), {
            displayName: "Wrong view",
            permissionScopeId: event.id,
            sectionId: spend.id,
          }),
        () =>
          objects.createExpense(context(), {
            displayName: "Wrong view",
            amount: "1",
            currency: "EUR",
            occurredAt: new Date("2030-05-01T08:00:00.000Z"),
            permissionScopeId: event.id,
            sectionId: packing.id,
          }),
        () =>
          objects.updateExpense(context(), fare.id, {
            expectedVersion: 1,
            sectionId: packing.id,
          }),
        // A standalone record belongs to no Event's view.
        () =>
          objects.createTask(context(), {
            displayName: "Standalone",
            sectionId: packing.id,
          }),
        // A section that does not exist.
        () =>
          objects.createTask(context(), {
            displayName: "Missing",
            permissionScopeId: event.id,
            sectionId: createId(),
          }),
      ];
      for (const refusal of refusals) {
        const error = await failure(refusal);
        expect(error, name).toBeInstanceOf(InvalidObjectStateError);
        expect(error.message, name).toBe(sectionMemberMessage);
      }

      const todos = await projections.getTodos(principal(), event.id);
      expect(todos.sections.map(({ id }) => id)).toEqual([packing.id]);
      expect(todos.items.map(({ id, sectionId }) => [id, sectionId])).toEqual(
        expect.arrayContaining([
          [packed.id, packing.id],
          [unplaced.id, null],
        ]),
      );
      const expenses = await projections.getExpenses(principal(), event.id);
      expect(expenses.sections.map(({ id }) => id)).toEqual([spend.id]);
      expect(expenses.items.map(({ sectionId }) => sectionId)).toEqual([
        spend.id,
      ]);

      // Deleting the section leaves its records in the view without one.
      await sections.deleteSection(principal(), packing.id);
      expect((await objects.getTask(principal(), packed.id)).sectionId).toBe(
        null,
      );
      expect(
        (await projections.getTodos(principal(), event.id)).sections,
      ).toEqual([]);
      // The record's version did not move: a section is not its content.
      expect((await objects.getTask(principal(), packed.id)).version).toBe(1);
    }
  });

  it("reject the same inputs with the same errors", async () => {
    for (const { name, objects, sections } of backends) {
      const event = await objects.createEvent(context(), {
        displayName: `Rules ${name}`,
      });
      const other = await objects.createEvent(context(), {
        displayName: `Rules elsewhere ${name}`,
      });
      const kept = await sections.createSection(principal(), event.id, {
        view: "todos",
        name: "Kept",
      });
      const elsewhere = await sections.createSection(principal(), other.id, {
        view: "todos",
        name: "Elsewhere",
      });
      for (const [run, type, message] of [
        [
          () =>
            sections.createSection(principal(), event.id, {
              view: "todos",
              name: " padded ",
            }),
          InvalidObjectStateError,
          sectionNameMessage,
        ],
        [
          () =>
            sections.createSection(principal(), event.id, {
              view: "todos",
              name: "x".repeat(121),
            }),
          InvalidObjectStateError,
          sectionNameMessage,
        ],
        [
          () =>
            sections.updateSection(principal(), kept.id, {
              name: "",
            }),
          InvalidObjectStateError,
          sectionNameMessage,
        ],
        [
          () =>
            sections.createSection(principal(), event.id, {
              view: "todos",
              name: "Placed",
              afterSectionId: elsewhere.id,
            }),
          InvalidObjectStateError,
          sectionPlacementMessage,
        ],
        [
          () =>
            sections.updateSection(principal(), kept.id, {
              afterSectionId: kept.id,
            }),
          InvalidObjectStateError,
          sectionPlacementMessage,
        ],
        [
          () =>
            sections.createSection(principal(), createId(), {
              view: "todos",
              name: "No event",
            }),
          AuthorizationDeniedError,
          undefined,
        ],
        [
          () =>
            sections.createSection(principal(), kept.id, {
              view: "todos",
              name: "Not an event",
            }),
          AuthorizationDeniedError,
          undefined,
        ],
        [
          () => sections.updateSection(principal(), createId(), { name: "x" }),
          AuthorizationDeniedError,
          undefined,
        ],
        [
          () => sections.deleteSection(principal(), createId()),
          AuthorizationDeniedError,
          undefined,
        ],
        [
          () =>
            sections.createSection(principal(harness.viewerId), event.id, {
              view: "todos",
              name: "Outsider",
            }),
          AuthorizationDeniedError,
          undefined,
        ],
        [
          () =>
            sections.listSections(
              principal(harness.viewerId),
              event.id,
              "todos",
            ),
          AuthorizationDeniedError,
          undefined,
        ],
      ] as const) {
        const error = await failure(run);
        expect(error, name).toBeInstanceOf(type);
        if (message !== undefined) expect(error.message, name).toBe(message);
      }
      expect(
        names(await sections.listSections(principal(), event.id, "todos")),
      ).toEqual(["Kept"]);

      // A viewer of the Event lists its sections but cannot change them.
      await harness.database.connection.db.insert(resourceGrants).values({
        id: createId(),
        workspaceId: harness.workspaceId,
        resourceId: event.id,
        principalId: harness.viewerId,
        role: "viewer",
        grantedBy: harness.ownerId,
      });
      expect(
        names(
          await sections.listSections(
            principal(harness.viewerId),
            event.id,
            "todos",
          ),
        ),
      ).toEqual(["Kept"]);
      for (const run of [
        () =>
          sections.createSection(principal(harness.viewerId), event.id, {
            view: "todos",
            name: "By a viewer",
          }),
        () =>
          sections.updateSection(principal(harness.viewerId), kept.id, {
            name: "By a viewer",
          }),
        () => sections.deleteSection(principal(harness.viewerId), kept.id),
      ]) {
        expect(await failure(run), name).toBeInstanceOf(
          AuthorizationDeniedError,
        );
      }
    }
  });
});
