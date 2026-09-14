import { AuthorizationDeniedError } from "@chronelle/authorization";
import { createId, resourceGrants } from "@chronelle/db";
import type { EventPage } from "@chronelle/schemas";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseEventLayoutReadRepository } from "../src/cloudbase-event-layout-read-repository.js";
import { CloudBaseObjectReadRepository } from "../src/cloudbase-object-read-repository.js";
import { InvalidObjectStateError } from "../src/errors.js";
import { EventLayoutService } from "../src/event-layout-service.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import { liveReader } from "./cloudbase-read-double.js";
import {
  createWriteHarness,
  failure,
  mutationContext,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// The layout and its history through the gateway adapter must equal the
// PostgreSQL read for every page position, and refuse the same requests.

let harness: WriteHarness;
let objects: EventPlanningObjectService;
let reference: EventLayoutService;
let cloudbase: EventLayoutService;

beforeAll(async () => {
  harness = await createWriteHarness("Layout reads");
  const db = harness.database.connection.db;
  objects = new EventPlanningObjectService(db);
  reference = new EventLayoutService(db);
  const reader = liveReader(db);
  cloudbase = new EventLayoutService(
    db,
    undefined,
    new CloudBaseEventLayoutReadRepository(
      reader,
      new CloudBaseObjectReadRepository(reader),
    ),
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

const page = (name: string, kind: "calendar" | "todos"): EventPage => ({
  id: createId(),
  name,
  components: [{ id: createId(), kind }],
});

/** The error of each refused read, in order. */
async function refusals(
  service: EventLayoutService,
  ids: { task: string; untouched: string },
) {
  const seen: string[] = [];
  const record = (error: Error) =>
    seen.push(`${error.constructor.name}: ${error.message}`);
  record(await failure(() => service.get(context().principal, ids.task)));
  record(
    await failure(() =>
      service.get(context(harness.viewerId).principal, ids.untouched),
    ),
  );
  record(await failure(() => service.get(context().principal, createId())));
  record(
    await failure(() =>
      service.history(context().principal, ids.task, { limit: 10 }),
    ),
  );
  return seen;
}

describe.sequential("CloudBase Event layout reads", () => {
  it("returns the same layout and history pages", async () => {
    const event = await objects.createEvent(context(), {
      displayName: "Layered",
    });
    const task = await objects.createTask(context(), {
      displayName: "Not an Event",
    });
    const untouched = await objects.createEvent(context(), {
      displayName: "Blank",
    });
    const pages = [
      [page("Overview", "calendar")],
      [page("Overview", "calendar"), page("Work", "todos")],
      [page("Work", "todos")],
    ];
    for (const [index, layout] of pages.entries()) {
      await reference.update(context(), event.id, {
        expectedVersion: index,
        pages: layout,
      });
    }
    await harness.database.connection.db.insert(resourceGrants).values({
      id: createId(),
      workspaceId: harness.workspaceId,
      resourceId: event.id,
      principalId: harness.viewerId,
      role: "viewer",
      grantedBy: harness.ownerId,
    });
    const results = [];
    for (const [, service] of backends()) {
      results.push({
        current: await service.get(context().principal, event.id),
        blank: await service.get(context().principal, untouched.id),
        byViewer: await service.get(
          context(harness.viewerId).principal,
          event.id,
        ),
        history: await service.history(context().principal, event.id, {
          limit: 10,
        }),
        paged: await service.history(context().principal, event.id, {
          limit: 2,
        }),
        before: await service.history(context().principal, event.id, {
          beforeVersion: 2,
          limit: 2,
        }),
        blankHistory: await service.history(context().principal, untouched.id, {
          limit: 10,
        }),
        errors: await refusals(service, {
          task: task.id,
          untouched: untouched.id,
        }),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toMatchObject({
      current: { eventId: event.id, version: 3, pages: pages[2] },
      blank: { eventId: untouched.id, version: 0, pages: [], updatedAt: null },
      byViewer: { version: 3 },
      history: {
        items: [{ version: 3 }, { version: 2 }, { version: 1 }],
        nextBeforeVersion: null,
      },
      paged: { items: [{ version: 3 }, { version: 2 }], nextBeforeVersion: 2 },
      before: { items: [{ version: 1 }], nextBeforeVersion: null },
      blankHistory: { items: [], nextBeforeVersion: null },
    });
    const denied = `${AuthorizationDeniedError.name}: ${new AuthorizationDeniedError().message}`;
    expect(results[0]?.errors).toEqual([
      `${InvalidObjectStateError.name}: Page layouts belong to Events.`,
      denied,
      denied,
      `${InvalidObjectStateError.name}: Page layouts belong to Events.`,
    ]);
  });
});
