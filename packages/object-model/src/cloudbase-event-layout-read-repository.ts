import type { UserPrincipal } from "@livtales/authorization";
import type { CloudBaseRdbReader } from "@livtales/db";
import {
  eventLayoutHistoryResponseSchema,
  eventLayoutResponseSchema,
  type EventLayoutHistoryQuery,
  type EventLayoutHistoryResponse,
  type EventLayoutResponse,
} from "@livtales/schemas";

import { cloudbaseInteger } from "./cloudbase-object-read-support.js";
import { cloudbaseDate, cloudbaseFilters } from "./cloudbase-read-support.js";
import { InvalidObjectStateError } from "./errors.js";
import type { EventLayoutReadRepository } from "./event-layout-reads.js";
import type { ObjectReadRepository } from "./object-reads.js";

type RevisionRow = {
  readonly version: unknown;
  readonly pages: unknown;
  readonly created_at: unknown;
};

/**
 * Layout reads through the gateway's table route. The Event is read
 * through the object read repository (view access, live object, and the
 * Event type check); revisions are read newest first, and the history's
 * position is applied after the read because the transport has no range
 * filter.
 */
export class CloudBaseEventLayoutReadRepository implements EventLayoutReadRepository {
  readonly #client: CloudBaseRdbReader;
  readonly #objects: ObjectReadRepository;

  constructor(client: CloudBaseRdbReader, objects: ObjectReadRepository) {
    this.#client = client;
    this.#objects = objects;
  }

  async get(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<EventLayoutResponse> {
    await this.#assertEvent(principal, eventId);
    const [latest] = await this.#revisions(eventId, 1);
    return eventLayoutResponseSchema.parse({
      eventId,
      version: latest?.version ?? 0,
      updatedAt: latest?.updatedAt ?? null,
      pages: latest?.pages ?? [],
    });
  }

  async history(
    principal: UserPrincipal,
    eventId: string,
    input: EventLayoutHistoryQuery,
  ): Promise<EventLayoutHistoryResponse> {
    await this.#assertEvent(principal, eventId);
    const revisions = (await this.#revisions(eventId)).filter(
      (revision) =>
        input.beforeVersion === undefined ||
        revision.version < input.beforeVersion,
    );
    const items = revisions.slice(0, input.limit);
    return eventLayoutHistoryResponseSchema.parse({
      items,
      nextBeforeVersion:
        revisions.length > input.limit ? (items.at(-1)?.version ?? null) : null,
    });
  }

  async #assertEvent(principal: UserPrincipal, eventId: string): Promise<void> {
    const object = await this.#objects.getObject(principal, eventId);
    if (object.objectType !== "event")
      throw new InvalidObjectStateError("Page layouts belong to Events.");
  }

  async #revisions(eventId: string, limit?: number) {
    const rows = await this.#client.select<RevisionRow>(
      "event_page_revisions",
      {
        columns: "version,pages,created_at",
        filters: cloudbaseFilters(["event_id", "eq", eventId]),
        order: [{ column: "version", ascending: false }],
        ...(limit !== undefined && { limit }),
      },
    );
    return rows.map((row) => ({
      eventId,
      version: cloudbaseInteger(row.version, "layout version"),
      pages: row.pages,
      updatedAt: cloudbaseDate(row.created_at, "created_at").toISOString(),
    }));
  }
}
