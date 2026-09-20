import {
  AuthorizationDeniedError,
  ResourceGrantService,
  type UserPrincipal,
} from "@chronelle/authorization";
import { createId, users } from "@chronelle/db";
import { createCloudBaseLiveReader } from "@chronelle/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseCalendarReadRepository } from "../src/cloudbase-calendar-read-repository.js";
import { CloudBaseGrantReadRepository } from "../src/cloudbase-grant-read-repository.js";
import { CloudBaseObjectReadRepository } from "../src/cloudbase-object-read-repository.js";
import { CloudBaseProjectionReadRepository } from "../src/cloudbase-projection-read-repository.js";
import { CloudBaseSectionRepository } from "../src/cloudbase-section-repository.js";
import { CloudBaseSharingWriteRepository } from "../src/cloudbase-sharing-write-repository.js";
import { EventContextService } from "../src/event-context-service.js";
import { PostgresObjectReadRepository } from "../src/object-reads.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import { EventPlanningProjectionService } from "../src/projection-service.js";
import { PostgresSectionRepository, SectionService } from "../src/sections.js";
import type { EventPlanningResource } from "../src/types.js";
import {
  createWriteHarness,
  mutationContext,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// A grant narrowed to a view or a section must open the same records on
// both backends: the projections, the section listing, the access read,
// and the share write through chronelle_resource_share.

let harness: WriteHarness;
let guest: UserPrincipal;

interface Backend {
  readonly name: "postgres" | "cloudbase";
  readonly projections: EventPlanningProjectionService;
  readonly reads: PostgresObjectReadRepository | CloudBaseObjectReadRepository;
  readonly grants: ResourceGrantService;
  readonly sections: SectionService;
}

let backends: readonly Backend[];

beforeAll(async () => {
  harness = await createWriteHarness("Narrowed shares");
  const db = harness.database.connection.db;
  const guestId = createId();
  await db.insert(users).values({
    id: guestId,
    identityProvider: "test",
    providerSubject: guestId,
    displayName: "Guest",
    email: "guest@example.test",
  });
  guest = { type: "user", userId: guestId, workspaceId: harness.workspaceId };
  const reader = createCloudBaseLiveReader(db);
  const postgresSections = new PostgresSectionRepository(db);
  const cloudbaseSections = new CloudBaseSectionRepository(harness);
  backends = [
    {
      name: "postgres",
      projections: new EventPlanningProjectionService(db),
      reads: new PostgresObjectReadRepository(db),
      grants: new ResourceGrantService(db),
      sections: new SectionService(postgresSections, postgresSections),
    },
    {
      name: "cloudbase",
      projections: new EventPlanningProjectionService(
        db,
        new CloudBaseCalendarReadRepository(reader),
        new CloudBaseProjectionReadRepository(reader),
        undefined,
        cloudbaseSections,
      ),
      reads: new CloudBaseObjectReadRepository(reader),
      grants: new ResourceGrantService(
        db,
        undefined,
        new CloudBaseSharingWriteRepository(harness),
        new CloudBaseGrantReadRepository(reader),
      ),
      sections: new SectionService(cloudbaseSections, cloudbaseSections),
    },
  ];
});

afterAll(async () => {
  await harness?.database.close();
});

const owner = () => ({
  type: "user" as const,
  userId: harness.ownerId,
  workspaceId: harness.workspaceId,
});
const names = (items: readonly EventPlanningResource[]) =>
  items.map((item) => item.displayName).sort();

/** One Event per backend with a sectioned task, a loose task, an expense, and a schedule item. */
async function plan() {
  const db = harness.database.connection.db;
  const objects = new EventPlanningObjectService(db);
  const included = new EventContextService(db);
  const context = mutationContext(harness);
  const event = await objects.createEvent(context, { displayName: "Kyoto" });
  const sections = new SectionService(
    new PostgresSectionRepository(db),
    new PostgresSectionRepository(db),
  );
  const venue = await sections.createSection(owner(), event.id, {
    view: "todos",
    name: "Venue",
  });
  for (const resource of [
    {
      objectType: "task" as const,
      displayName: "Book the hall",
      sectionId: venue.id,
    },
    { objectType: "task" as const, displayName: "Order the cake" },
    {
      objectType: "expense" as const,
      displayName: "Venue deposit",
      amount: "240.0000",
      currency: "USD",
      occurredAt: new Date("2030-11-03T12:00:00.000Z"),
    },
    {
      objectType: "event" as const,
      displayName: "Lunch",
      startsOn: "2030-11-03",
      endsOn: "2030-11-03",
    },
  ])
    await included.create(context, event.id, {
      commandId: createId(),
      resource,
    });
  return { event, venue };
}

describe.sequential("CloudBase narrowed shares", () => {
  it("shares a view and reads the same records, sections, and access on both backends", async () => {
    const outcomes: unknown[] = [];
    for (const backend of backends) {
      const { event } = await plan();
      const context = mutationContext(harness);
      const grant = await backend.grants.share(context, {
        resourceId: event.id,
        principalEmail: "guest@example.test",
        role: "editor",
        scope: { view: "todos", sectionId: null },
      });
      const todos = await backend.projections.getTodos(guest, event.id);
      const expenses = await backend.projections.getExpenses(guest, event.id);
      const calendar = await backend.projections.getCalendar(guest, event.id);
      const access = await backend.reads.getAccess(guest, event.id);
      const listed = await backend.grants.list(owner(), event.id);
      outcomes.push({
        scope: grant.scope,
        todos: names(todos.items),
        sections: todos.sections.map((section) => section.name),
        expenses: names(expenses.items),
        calendar: names(calendar.items),
        access: {
          actions: access.actions,
          narrowing: access.narrowing,
          source: access.source.kind,
        },
        listed: listed.map((item) => [item.role, item.scope]),
      });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual({
      scope: { view: "todos", sectionId: null },
      todos: ["Book the hall", "Order the cake"],
      sections: ["Venue"],
      expenses: [],
      calendar: [],
      access: {
        actions: ["view"],
        narrowing: { views: ["todos"], sections: [] },
        source: "direct",
      },
      listed: [["editor", { view: "todos", sectionId: null }]],
    });
  });

  it("shares a section and reads its records alone; the other views are denied", async () => {
    const outcomes: unknown[] = [];
    for (const backend of backends) {
      const { event, venue } = await plan();
      const context = mutationContext(harness);
      await backend.grants.share(context, {
        resourceId: event.id,
        principalEmail: "guest@example.test",
        role: "viewer",
        scope: { view: "todos", sectionId: venue.id },
      });
      const todos = await backend.projections.getTodos(guest, event.id);
      const listedSections = await backend.sections.listSections(
        guest,
        event.id,
        "todos",
      );
      const targets = await backend.projections.getAttachmentTargets(
        guest,
        event.id,
      );
      expect(targets).toEqual({
        event: { id: event.id, displayName: event.displayName },
        tasks: todos.items.map(({ id, displayName }) => ({ id, displayName })),
        expenses: [],
      });
      const access = await backend.reads.getAccess(guest, event.id);
      let denied = false;
      try {
        // A record the share does not admit reads as unavailable.
        const loose = (
          await backend.projections.getTodos(owner(), event.id)
        ).items.find((item) => item.displayName === "Order the cake");
        await backend.reads.getObject(guest, loose?.id ?? "");
      } catch (error) {
        denied = error instanceof AuthorizationDeniedError;
      }
      outcomes.push({
        todos: names(todos.items),
        sections: listedSections.map((section) => section.name),
        // Each backend has its own Event, so the section id differs.
        narrowing: access.narrowing && {
          views: access.narrowing.views,
          sections: access.narrowing.sections.map((section) => ({
            view: section.view,
            own: section.id === venue.id,
          })),
        },
        denied,
      });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual({
      todos: ["Book the hall"],
      sections: ["Venue"],
      narrowing: { views: [], sections: [{ view: "todos", own: true }] },
      denied: true,
    });
  });

  it("refuses the same narrowed shares with the same errors", async () => {
    const outcomes: string[][] = [];
    for (const backend of backends) {
      const { event, venue } = await plan();
      const context = mutationContext(harness);
      const task = (
        await backend.projections.getTodos(owner(), event.id)
      ).items.find((item) => item.displayName === "Order the cake");
      const refused: string[] = [];
      for (const input of [
        {
          resourceId: task?.id ?? "",
          principalEmail: "guest@example.test",
          role: "viewer" as const,
          scope: { view: "todos" as const, sectionId: null },
        },
        {
          resourceId: event.id,
          principalEmail: "guest@example.test",
          role: "viewer" as const,
          scope: { view: "expenses" as const, sectionId: venue.id },
        },
        {
          resourceId: event.id,
          principalId: harness.viewerId,
          role: "viewer" as const,
        },
      ]) {
        try {
          await backend.grants.share(context, input);
          refused.push("shared");
        } catch (error) {
          refused.push(error instanceof Error ? error.message : "unknown");
        }
      }
      outcomes.push(refused);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      "A share narrowed to a view names an Event.",
      "The section is not a section of that view of the Event.",
      "The requested user is unavailable.",
    ]);
  });
});
