import {
  withReadAuthorization,
  withStableAuthorization,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  auditEvents,
  createId,
  eventPageRevisions,
  events,
  type Database,
  type DatabaseTransaction,
} from "@chronelle/db";
import {
  eventLayoutResponseSchema,
  eventLayoutUpdateSchema,
  type EventLayoutUpdate,
  type EventPage,
} from "@chronelle/schemas";
import { and, desc, eq } from "drizzle-orm";

import { InvalidObjectStateError, ObjectConflictError } from "./errors.js";
import type { MutationContext } from "./types.js";

async function readLayout(
  transaction: DatabaseTransaction,
  workspaceId: string,
  eventId: string,
) {
  const [event] = await transaction
    .select({ id: events.objectId })
    .from(events)
    .where(
      and(eq(events.workspaceId, workspaceId), eq(events.objectId, eventId)),
    )
    .limit(1);
  if (event === undefined)
    throw new InvalidObjectStateError("Page layouts belong to Events.");
  const [revision] = await transaction
    .select()
    .from(eventPageRevisions)
    .where(
      and(
        eq(eventPageRevisions.workspaceId, workspaceId),
        eq(eventPageRevisions.eventId, eventId),
      ),
    )
    .orderBy(desc(eventPageRevisions.version))
    .limit(1);
  return eventLayoutResponseSchema.parse({
    eventId,
    version: revision?.version ?? 0,
    updatedAt: revision?.createdAt.toISOString() ?? null,
    pages: revision?.pages ?? [],
  });
}

async function saveLayout(
  transaction: DatabaseTransaction,
  context: MutationContext,
  eventId: string,
  previousVersion: number,
  pages: EventPage[],
) {
  const { principal } = context;
  const version = previousVersion + 1;
  const auditEventId = createId();
  await transaction.insert(auditEvents).values({
    id: auditEventId,
    workspaceId: principal.workspaceId,
    resourceId: eventId,
    actorType: "user",
    actorId: principal.userId,
    requestId: context.requestId,
    action: "event.layout_updated",
    metadata: { previousVersion, version },
  });
  const [revision] = await transaction
    .insert(eventPageRevisions)
    .values({
      workspaceId: principal.workspaceId,
      eventId,
      version,
      pages,
      auditEventId,
    })
    .returning();
  if (revision === undefined)
    throw new Error("The event layout was not saved.");
  return eventLayoutResponseSchema.parse({
    eventId,
    version,
    pages: revision.pages,
    updatedAt: revision.createdAt.toISOString(),
  });
}

/** Versioned presentation configuration, authorized by its owning Event. */
export class EventLayoutService {
  constructor(private readonly database: Database) {}

  async get(principal: UserPrincipal, eventId: string) {
    return withReadAuthorization(
      this.database,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "view", {
          id: eventId,
          workspaceId: principal.workspaceId,
        });
        return readLayout(transaction, principal.workspaceId, eventId);
      },
    );
  }

  async update(
    context: MutationContext,
    eventId: string,
    payload: EventLayoutUpdate,
  ) {
    const input = eventLayoutUpdateSchema.parse(payload);
    const { principal } = context;
    return withStableAuthorization(
      this.database,
      principal.workspaceId,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "edit", {
          id: eventId,
          workspaceId: principal.workspaceId,
        });
        const current = await readLayout(
          transaction,
          principal.workspaceId,
          eventId,
        );
        if (current.version !== input.expectedVersion)
          throw new ObjectConflictError();
        return saveLayout(
          transaction,
          context,
          eventId,
          current.version,
          input.pages,
        );
      },
    );
  }
}
