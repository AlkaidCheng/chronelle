import type { UserPrincipal } from "@livtales/authorization";
import type { CloudBaseRdbReader } from "@livtales/db";

import { CloudBaseProjectionReadRepository } from "./cloudbase-projection-read-repository.js";
import type { CalendarReadRepository } from "./projection-service.js";
import type { EventResource } from "./types.js";

/**
 * Read-only CloudBase calendar adapter: the Events an Event includes, read
 * through the projection adapter so the calendar applies the same workspace,
 * grant, expiry, inherited-scope, and deletion rules as every other
 * projection. Mutations intentionally remain on the transaction-capable
 * PostgreSQL path.
 */
export class CloudBaseCalendarReadRepository implements CalendarReadRepository {
  readonly #projections: CloudBaseProjectionReadRepository;

  constructor(
    client: CloudBaseRdbReader,
    clock: () => Date = () => new Date(),
  ) {
    this.#projections = new CloudBaseProjectionReadRepository(client, clock);
  }

  listCalendarEvents(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<readonly EventResource[]> {
    return this.#projections.listIncludedResources(principal, eventId, [
      "event",
    ]);
  }
}
