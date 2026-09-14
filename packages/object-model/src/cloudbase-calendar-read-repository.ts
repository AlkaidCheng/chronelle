import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@chronelle/authorization";
import type { CloudBaseRdbReader } from "@chronelle/db";
import {
  assertCloudBaseRoot,
  cloudbaseEventResource,
  readCloudBaseEvents,
  readCloudBaseIncludes,
  readCloudBaseObjects,
  readCloudBaseVisibility,
} from "./cloudbase-read-support.js";
import type { CalendarReadRepository } from "./projection-service.js";
import type { EventResource } from "./types.js";

/**
 * Read-only CloudBase projection adapter. Authorization is evaluated from the
 * workspace membership and resource grants before any resource is returned.
 * Mutations intentionally remain on the transaction-capable PostgreSQL path.
 */
export class CloudBaseCalendarReadRepository implements CalendarReadRepository {
  readonly #client: CloudBaseRdbReader;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseRdbReader,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async listCalendarEvents(
    principal: UserPrincipal,
    eventId: string,
  ): Promise<readonly EventResource[]> {
    const [roots, targetIds, visibility] = await Promise.all([
      readCloudBaseObjects(this.#client, principal, [eventId]),
      readCloudBaseIncludes(this.#client, principal, eventId),
      readCloudBaseVisibility(this.#client, principal, this.#clock),
    ]);
    const root = assertCloudBaseRoot(roots[0]);
    if (!visibility.canView(root)) throw new AuthorizationDeniedError();
    const targets = await readCloudBaseObjects(
      this.#client,
      principal,
      targetIds,
    );
    const children = targets.filter((target) => visibility.canView(target));
    const ids = children.map((child) => String(child.id));
    const events = await readCloudBaseEvents(this.#client, principal, ids);
    const byId = new Map(
      events.map((event) => [String(event.object_id), event]),
    );
    return children.flatMap((child) => {
      const event = byId.get(String(child.id));
      return event === undefined ? [] : [cloudbaseEventResource(child, event)];
    });
  }
}
