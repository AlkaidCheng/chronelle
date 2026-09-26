import {
  AuthorizationDeniedError,
  withReadAuthorization,
  withStableAuthorization,
  type UserPrincipal,
} from "@livtales/authorization";
import {
  auditEvents,
  createId,
  eventPageRevisions,
  events,
  type Database,
  type DatabaseTransaction,
} from "@livtales/db";
import {
  eventLayoutResponseSchema,
  eventLayoutUpdateSchema,
  eventLayoutRestoreSchema,
  eventLayoutHistoryQuerySchema,
  eventLayoutHistoryResponseSchema,
  type EventLayoutRestore,
  type EventLayoutHistoryQuery,
  type EventLayoutUpdate,
  type EventPage,
} from "@livtales/schemas";
import { and, desc, eq, lt } from "drizzle-orm";

import { InvalidObjectStateError, ObjectConflictError } from "./errors.js";
import type { EventLayoutReadRepository } from "./event-layout-reads.js";
import type { EventLayoutWriteRepository } from "./object-writes.js";
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
    .where(eq(eventPageRevisions.eventId, eventId))
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
  restoredFromVersion?: number,
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
    action:
      restoredFromVersion === undefined
        ? "event.layout_updated"
        : "event.layout_restored",
    metadata: {
      previousVersion,
      version,
      ...(restoredFromVersion === undefined ? {} : { restoredFromVersion }),
    },
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
  readonly #writes: EventLayoutWriteRepository | undefined;
  readonly #reads: EventLayoutReadRepository | undefined;

  constructor(
    private readonly database: Database,
    writes?: EventLayoutWriteRepository,
    reads?: EventLayoutReadRepository,
  ) {
    this.#writes = writes;
    this.#reads = reads;
  }

  async history(
    principal: UserPrincipal,
    eventId: string,
    payload: EventLayoutHistoryQuery,
  ) {
    const input = eventLayoutHistoryQuerySchema.parse(payload);
    if (this.#reads !== undefined)
      return this.#reads.history(principal, eventId, input);
    return withReadAuthorization(
      this.database,
      async (transaction, authorization) => {
        await authorization.assertCan(principal, "view", {
          id: eventId,
          workspaceId: principal.workspaceId,
        });
        await readLayout(transaction, principal.workspaceId, eventId);
        const rows = await transaction
          .select()
          .from(eventPageRevisions)
          .where(
            and(
              eq(eventPageRevisions.eventId, eventId),
              input.beforeVersion === undefined
                ? undefined
                : lt(eventPageRevisions.version, input.beforeVersion),
            ),
          )
          .orderBy(desc(eventPageRevisions.version))
          .limit(input.limit + 1);
        const items = rows.slice(0, input.limit).map((row) => ({
          eventId,
          version: row.version,
          pages: row.pages,
          updatedAt: row.createdAt.toISOString(),
        }));
        return eventLayoutHistoryResponseSchema.parse({
          items,
          nextBeforeVersion:
            rows.length > input.limit ? items.at(-1)?.version : null,
        });
      },
    );
  }

  async restore(
    context: MutationContext,
    eventId: string,
    payload: EventLayoutRestore,
  ) {
    const input = eventLayoutRestoreSchema.parse(payload);
    const { principal } = context;
    if (this.#writes !== undefined)
      return this.#writes.restore(
        context,
        eventId,
        input.expectedVersion,
        input.targetVersion,
      );
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
        let pages: EventPage[] = [];
        if (input.targetVersion > 0) {
          const [revision] = await transaction
            .select()
            .from(eventPageRevisions)
            .where(
              and(
                eq(eventPageRevisions.eventId, eventId),
                eq(eventPageRevisions.version, input.targetVersion),
              ),
            )
            .limit(1);
          if (!revision) throw new AuthorizationDeniedError();
          pages = eventLayoutResponseSchema.parse({
            eventId,
            version: revision.version,
            pages: revision.pages,
            updatedAt: revision.createdAt.toISOString(),
          }).pages;
        }
        return saveLayout(
          transaction,
          context,
          eventId,
          current.version,
          pages,
          input.targetVersion,
        );
      },
    );
  }

  async get(principal: UserPrincipal, eventId: string) {
    if (this.#reads !== undefined) return this.#reads.get(principal, eventId);
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
    if (this.#writes !== undefined)
      return this.#writes.update(
        context,
        eventId,
        input.expectedVersion,
        input.pages,
      );
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
