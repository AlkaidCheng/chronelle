import type {
  GrantMutationContext,
  UserPrincipal,
} from "@livtales/authorization";
import type { Role } from "@livtales/db";
import {
  type EventPlanningObjectService,
  firstPersonEmail,
} from "@livtales/object-model";

import type { FriendService } from "../friends/friend-service.js";
import { InvalidFriendRequestError } from "../friends/friend-store.js";
import type {
  PendingShareStore,
  PendingShareView,
  RevokedPendingShare,
} from "./pending-share-store.js";

export interface QueueForPersonInput {
  readonly resourceId: string;
  readonly personId: string;
  readonly role: Role;
}

/**
 * Shares that wait for a person to join: when a request or invitation the
 * acting account sent already names the person, the share is queued on
 * it; otherwise the person is invited (a request to the account that has
 * their email, an emailed link to an address without one, a link to hand
 * on for a card without an address) and the share queued on what was
 * sent. The share is granted when the request or the link is accepted.
 */
export class PendingShareService {
  readonly #store: PendingShareStore;
  readonly #friends: FriendService;
  readonly #objects: EventPlanningObjectService;
  readonly #clock: () => Date;

  constructor(
    store: PendingShareStore,
    friends: FriendService,
    objects: EventPlanningObjectService,
    clock: () => Date = () => new Date(),
  ) {
    this.#store = store;
    this.#friends = friends;
    this.#objects = objects;
    this.#clock = clock;
  }

  list(
    principal: UserPrincipal,
    resourceId: string,
  ): Promise<readonly PendingShareView[]> {
    return this.#store.list(principal, resourceId);
  }

  async queueForPerson(
    context: GrantMutationContext,
    input: QueueForPersonInput,
  ): Promise<PendingShareView> {
    const { principal } = context;
    const person = await this.#objects.getPerson(principal, input.personId);
    if (person.userId !== null)
      throw new InvalidFriendRequestError(
        "The person has an account here; share with them directly.",
      );
    const snapshot = await this.#friends.list(principal.userId);
    const sent = snapshot.sent.find(
      (item) =>
        item.personId === input.personId &&
        item.workspaceId === principal.workspaceId,
    );
    let itemId = sent?.id;
    if (itemId === undefined) {
      // A card with an email contact is invited by email; one without gets
      // a link the sharer hands on. A person's address is kept as written;
      // an invitation names it the way the account does.
      const address = firstPersonEmail(person.contacts);
      const outcome = await this.#friends.invite(
        { userId: principal.userId, workspaceId: principal.workspaceId },
        {
          channel: address === null ? "link" : "email",
          ...(address !== null && { email: address.trim().toLowerCase() }),
          personId: input.personId,
        },
        context.requestId,
      );
      itemId = outcome.item.id;
    }
    return this.#store.queue(context, {
      resourceId: input.resourceId,
      role: input.role,
      itemId,
      personId: input.personId,
    });
  }

  revoke(
    context: GrantMutationContext,
    pendingId: string,
  ): Promise<RevokedPendingShare> {
    return this.#store.revoke(context, pendingId, this.#clock());
  }
}
