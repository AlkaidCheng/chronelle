import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  auditEvents,
  createId,
  eventContextCommands,
  objectRelations,
  objects,
  resourceGrants,
} from "@chronelle/db";
import type { EventContextCreateRequest } from "@chronelle/schemas";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseEventContextWriteRepository } from "../src/cloudbase-event-context-write-repository.js";
import {
  CommandConflictError,
  InvalidObjectStateError,
} from "../src/errors.js";
import { EventContextService } from "../src/event-context-service.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import {
  createWriteHarness,
  failure,
  ledger,
  mutationContext,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// chronelle_event_context_create must leave what EventContextService leaves:
// the child object with its ledger, the includes relation with its audit
// row, and the command record; and it must replay and conflict the same way.

let harness: WriteHarness;
let objectsService: EventPlanningObjectService;
let reference: EventContextService;
let cloudbase: EventContextService;

beforeAll(async () => {
  harness = await createWriteHarness("Linked creation");
  const db = harness.database.connection.db;
  objectsService = new EventPlanningObjectService(db);
  reference = new EventContextService(db);
  cloudbase = new EventContextService(
    db,
    new CloudBaseEventContextWriteRepository(harness),
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

const children: EventContextCreateRequest["resource"][] = [
  {
    objectType: "event",
    displayName: "Rehearsal",
    startsOn: "2030-10-15",
    endsOn: "2030-10-15",
    customProperties: { room: "B" },
  },
  {
    objectType: "task",
    displayName: "Print badges",
    status: "in_progress",
    dueAt: new Date("2030-10-10T09:00:00.000Z"),
    metadata: { source: "test" },
  },
  {
    objectType: "expense",
    displayName: "Badges",
    amount: "42.5",
    currency: "USD",
    occurredAt: new Date("2030-10-09T12:00:00.000Z"),
  },
  {
    objectType: "reminder",
    displayName: "Badge pickup",
    remindAt: new Date("2030-10-10T08:00:00.000Z"),
    status: "pending",
  },
];

/** The serialized child without identity and clock fields; the scope is compared to the Event. */
function shape(
  resource: Record<string, unknown>,
  eventId: string,
): Record<string, unknown> {
  // The rank follows creation order, which the two backends share here.
  const {
    id,
    createdAt,
    updatedAt,
    permissionScopeId,
    rank: _rank,
    ...rest
  } = resource;
  return {
    ...rest,
    scopedToEvent: permissionScopeId === eventId,
    clockFields: [createdAt, updatedAt].every(
      (value) => typeof value === "string" && /\.\d{3}Z$/u.test(value),
    ),
    idIsUuid: typeof id === "string" && /^[0-9a-f-]{36}$/u.test(id),
  };
}

async function linkage(eventId: string, relationId: string) {
  const db = harness.database.connection.db;
  const [relation] = await db
    .select()
    .from(objectRelations)
    .where(eq(objectRelations.id, relationId));
  const [command] = await db
    .select()
    .from(eventContextCommands)
    .where(eq(eventContextCommands.relationId, relationId));
  const audits = await db
    .select({ action: auditEvents.action, metadata: auditEvents.metadata })
    .from(auditEvents)
    .where(
      and(
        eq(auditEvents.workspaceId, harness.workspaceId),
        eq(auditEvents.resourceId, eventId),
        eq(auditEvents.action, "relation.created"),
      ),
    );
  const audit = audits.find(
    (entry) =>
      (entry.metadata as Record<string, unknown>).relationId === relationId,
  );
  const {
    relationId: _relationId,
    targetObjectId,
    ...auditMetadata
  } = (audit?.metadata ?? {}) as Record<string, unknown>;
  return {
    relation: relation && {
      sourceIsEvent: relation.sourceObjectId === eventId,
      relationType: relation.relationType,
      targetIsCommandObject: relation.targetObjectId === command?.objectId,
      metadata: relation.metadata,
      version: relation.version,
      deletedAt: relation.deletedAt,
      createdBy: relation.createdBy,
    },
    command: command && {
      userId: command.userId,
      hashIsSha256: /^[0-9a-f]{64}$/u.test(command.requestHash),
      contextIsEvent: command.contextObjectId === eventId,
      targetMatches: command.objectId === relation?.targetObjectId,
    },
    audit: audit && {
      action: audit.action,
      metadata: auditMetadata,
      targetMatches: targetObjectId === relation?.targetObjectId,
    },
  };
}

async function selfScopedEvent(name: string) {
  return objectsService.createEvent(context(), { displayName: name });
}

describe.sequential("CloudBase linked creation", () => {
  it("creates each child type with the same resource, ledger, relation, and command", async () => {
    const results: {
      resource: Record<string, unknown>;
      link: Awaited<ReturnType<typeof linkage>>;
      childLedger: Awaited<ReturnType<typeof ledger>>;
    }[][] = [];
    for (const [, service] of backends()) {
      const event = await selfScopedEvent("Launch night");
      const perBackend = [];
      for (const resource of children) {
        const result = await service.create(context(), event.id, {
          commandId: createId(),
          resource,
          relationMetadata: { order: 1 },
        });
        expect(result.resource.permissionScopeId).toBe(event.id);
        perBackend.push({
          resource: shape(result.resource, event.id),
          link: await linkage(event.id, result.relationId),
          childLedger: await ledger(harness, result.resource.id),
        });
      }
      results.push(perBackend);
    }
    const [postgres, cloud] = results;
    expect(cloud).toEqual(postgres);
    for (const entry of cloud ?? []) {
      expect(entry.link.relation?.relationType).toBe("includes");
      expect(entry.link.relation?.version).toBe(1);
      expect(entry.link.audit?.action).toBe("relation.created");
      expect(entry.childLedger).toHaveLength(1);
    }
  });

  it("replays the same command and rejects a changed one identically", async () => {
    for (const [, service] of backends()) {
      const event = await selfScopedEvent("Replayed");
      const commandId = createId();
      const request: EventContextCreateRequest = {
        commandId,
        resource: { objectType: "task", displayName: "Once" },
      };
      const first = await service.create(context(), event.id, request);
      const before = await linkage(event.id, first.relationId);
      const again = await service.create(context(), event.id, request);
      expect(again).toEqual(first);
      expect(await linkage(event.id, first.relationId)).toEqual(before);
      expect(await ledger(harness, first.resource.id)).toHaveLength(1);

      const changed = await failure(() =>
        service.create(context(), event.id, {
          commandId,
          resource: { objectType: "task", displayName: "Twice" },
        }),
      );
      expect(changed).toBeInstanceOf(CommandConflictError);
      const commands = await harness.database.connection.db
        .select()
        .from(eventContextCommands)
        .where(eq(eventContextCommands.commandId, commandId));
      expect(commands).toHaveLength(1);
    }
  });

  it("enforces the self-scope rule and authorization the same way", async () => {
    const messages: string[] = [];
    for (const [, service] of backends()) {
      const parent = await selfScopedEvent("Parent");
      const nested = await objectsService.createEvent(context(), {
        displayName: "Nested",
        permissionScopeId: parent.id,
      });
      const scoped = await failure(() =>
        service.create(context(), nested.id, {
          commandId: createId(),
          resource: { objectType: "task", displayName: "x" },
        }),
      );
      expect(scoped).toBeInstanceOf(InvalidObjectStateError);
      messages.push(scoped.message);

      expect(
        await failure(() =>
          service.create(context(harness.viewerId), parent.id, {
            commandId: createId(),
            resource: { objectType: "task", displayName: "denied" },
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);
      expect(
        await failure(() =>
          service.create(context(), createId(), {
            commandId: createId(),
            resource: { objectType: "task", displayName: "missing" },
          }),
        ),
      ).toBeInstanceOf(AuthorizationDeniedError);

      await harness.database.connection.db.insert(resourceGrants).values({
        id: createId(),
        workspaceId: harness.workspaceId,
        resourceId: parent.id,
        principalId: harness.viewerId,
        role: "editor",
        grantedBy: harness.ownerId,
      });
      const byGrantee = await service.create(
        context(harness.viewerId),
        parent.id,
        {
          commandId: createId(),
          resource: {
            objectType: "reminder",
            displayName: "by grantee",
            remindAt: new Date("2030-01-01T00:00:00Z"),
          },
        },
      );
      expect(byGrantee.resource.permissionScopeId).toBe(parent.id);
    }
    expect(messages).toEqual([
      "The context must be a self-scoped Event.",
      "The context must be a self-scoped Event.",
    ]);
  });

  it("persists nothing when the function fails after the relation", async () => {
    const event = await selfScopedEvent("Atomic");
    const db = harness.database.connection.db;
    const countRows = async () => ({
      objects: (
        await db
          .select({ id: objects.id })
          .from(objects)
          .where(eq(objects.permissionScopeId, event.id))
      ).length,
      relations: (
        await db
          .select({ id: objectRelations.id })
          .from(objectRelations)
          .where(eq(objectRelations.sourceObjectId, event.id))
      ).length,
      audits: (
        await db
          .select({ id: auditEvents.id })
          .from(auditEvents)
          .where(eq(auditEvents.workspaceId, harness.workspaceId))
      ).length,
    });
    const before = await countRows();
    // The command record's hash check fails after the child, the relation,
    // and both audit rows were written inside the function.
    const error = await failure(() =>
      harness.rpc("chronelle_event_context_create", {
        workspace_id: harness.workspaceId,
        user_id: harness.ownerId,
        request_id: createId(),
        event_id: event.id,
        command_id: createId(),
        request_hash: "not-a-hash",
        resource: { objectType: "task", displayName: "Lost" },
        relation_metadata: {},
      }),
    );
    expect(error.message).toContain("request_hash");
    expect(await countRows()).toEqual(before);
  });
});
