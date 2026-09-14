import type { UserPrincipal } from "@chronelle/authorization";
import type {
  EventLayoutHistoryQuery,
  EventLayoutHistoryResponse,
  EventLayoutResponse,
} from "@chronelle/schemas";

/**
 * Read boundary for an Event's page layout: the current layout (version 0
 * and no pages before the first save) and its history, newest version
 * first. Implementations require view access to the live Event and refuse
 * any other object type.
 */
export interface EventLayoutReadRepository {
  get(principal: UserPrincipal, eventId: string): Promise<EventLayoutResponse>;
  history(
    principal: UserPrincipal,
    eventId: string,
    input: EventLayoutHistoryQuery,
  ): Promise<EventLayoutHistoryResponse>;
}
