import type { EventPlanningObjectService } from "@chronelle/object-model";
import { messagesFor } from "../authentication/email-messages.js";
import type { EmailSender } from "../authentication/email-sender.js";
import type {
  ConnectionView,
  FriendStore,
  FriendsSnapshot,
  InviteOutcome,
  ItemState,
} from "./friend-store.js";
import {
  digestInvitationToken,
  generateInvitationToken,
} from "./invitation-token.js";

export interface FriendServiceOptions {
  readonly clock?: (() => Date) | undefined;
  /** The web origin the sign-up link in an invitation email points at. */
  readonly webBaseUrl?: string | undefined;
  readonly productName?: string | undefined;
  /** Invitations one account may send in a day; 0 for no cap. */
  readonly dailyLimit?: number | undefined;
  /** How long a sign-up link stays valid. */
  readonly invitationTtlMs?: number | undefined;
  /** The least time between two sends of one request or invitation. */
  readonly resendIntervalMs?: number | undefined;
}

export interface InviteFriendInput {
  readonly email: string;
  readonly message?: string | undefined;
  readonly personId?: string | undefined;
}

/** The account and workspace a friend action runs in. */
export interface FriendActor {
  readonly userId: string;
  readonly workspaceId: string;
}

const defaultDailyLimit = 50;
const defaultInvitationTtlMs = 14 * 24 * 60 * 60 * 1000;
const defaultResendIntervalMs = 60_000;

/**
 * Friends: the account's connections and requests, invitations by email
 * (a request to the account that has the address, or a sign-up link to an
 * address without one), answers, withdrawals, removals, and sending again.
 * Every send emails the recipient in their language (the sender's for an
 * address without an account). Accepting a request that came from a
 * person card links that card to the new friend, as the requester, when
 * the card is still unlinked and the friend has no card there yet.
 */
export class FriendService {
  readonly #store: FriendStore;
  readonly #email: EmailSender;
  readonly #objects: EventPlanningObjectService;
  readonly #clock: () => Date;
  readonly #webBaseUrl: string;
  readonly #productName: string;
  readonly #dailyLimit: number;
  readonly #invitationTtlMs: number;
  readonly #resendIntervalMs: number;

  constructor(
    store: FriendStore,
    email: EmailSender,
    objects: EventPlanningObjectService,
    options: FriendServiceOptions = {},
  ) {
    this.#store = store;
    this.#email = email;
    this.#objects = objects;
    this.#clock = options.clock ?? (() => new Date());
    this.#webBaseUrl = (options.webBaseUrl ?? "http://localhost:3000").replace(
      /\/$/u,
      "",
    );
    this.#productName = options.productName ?? "Chronelle";
    this.#dailyLimit = options.dailyLimit ?? defaultDailyLimit;
    this.#invitationTtlMs = options.invitationTtlMs ?? defaultInvitationTtlMs;
    this.#resendIntervalMs =
      options.resendIntervalMs ?? defaultResendIntervalMs;
  }

  list(userId: string): Promise<FriendsSnapshot> {
    return this.#store.list(userId);
  }

  async invite(
    actor: FriendActor,
    input: InviteFriendInput,
    requestId: string,
  ): Promise<InviteOutcome> {
    const token = generateInvitationToken();
    const outcome = await this.#store.invite(actor.userId, {
      email: input.email,
      message: input.message ?? null,
      personId: input.personId ?? null,
      workspaceId: input.personId === undefined ? null : actor.workspaceId,
      tokenDigest: digestInvitationToken(token),
      expiresAt: new Date(this.#clock().getTime() + this.#invitationTtlMs),
      dailyLimit: this.#dailyLimit,
      requestId,
    });
    await this.#send(outcome, token);
    return outcome;
  }

  async respond(
    userId: string,
    connectionId: string,
    accept: boolean,
    requestId: string,
  ): Promise<ConnectionView> {
    const connection = await this.#store.respond(
      userId,
      connectionId,
      accept,
      requestId,
    );
    if (accept) await this.#linkCard(connection, userId, requestId);
    return connection;
  }

  withdraw(
    userId: string,
    itemId: string,
    requestId: string,
  ): Promise<ItemState> {
    return this.#store.withdraw(userId, itemId, requestId);
  }

  remove(
    userId: string,
    connectionId: string,
    requestId: string,
  ): Promise<ItemState> {
    return this.#store.remove(userId, connectionId, requestId);
  }

  async resend(
    userId: string,
    itemId: string,
    requestId: string,
  ): Promise<InviteOutcome> {
    const token = generateInvitationToken();
    const outcome = await this.#store.resend(userId, itemId, {
      tokenDigest: digestInvitationToken(token),
      expiresAt: new Date(this.#clock().getTime() + this.#invitationTtlMs),
      minIntervalMs: this.#resendIntervalMs,
      requestId,
    });
    await this.#send(outcome, token);
    return outcome;
  }

  /** The invitations waiting for a new account become requests; the token is optional. */
  claimInvitations(
    userId: string,
    token: string | null,
    requestId: string,
  ): Promise<number> {
    return this.#store.claimInvitations(
      userId,
      token === null ? null : digestInvitationToken(token),
      requestId,
    );
  }

  async #send(outcome: InviteOutcome, token: string): Promise<void> {
    const { sender, item } = outcome;
    if (outcome.recipient !== null) {
      const message = messagesFor(outcome.recipient.locale).friendRequestEmail({
        productName: this.#productName,
        senderName: sender.displayName,
        senderEmail: sender.email,
        message: item.message,
      });
      await this.#email.send({ to: outcome.recipient.email, ...message });
      return;
    }
    const message = messagesFor(sender.locale).friendInvitationEmail({
      productName: this.#productName,
      senderName: sender.displayName,
      senderEmail: sender.email,
      message: item.message,
      link: `${this.#webBaseUrl}/sign-up?invitation=${encodeURIComponent(token)}`,
      expiresInDays: Math.max(
        1,
        Math.round(this.#invitationTtlMs / 86_400_000),
      ),
    });
    await this.#email.send({ to: item.email, ...message });
  }

  /**
   * Links the requester's card to the friend who just accepted, as the
   * requester in that workspace. A card that was linked or removed
   * meanwhile, or a friend who already has a card there, leaves the card
   * as it is.
   */
  async #linkCard(
    connection: ConnectionView,
    friendUserId: string,
    requestId: string,
  ): Promise<void> {
    if (connection.personId === null || connection.workspaceId === null) return;
    const principal = {
      type: "user" as const,
      userId: connection.userId,
      workspaceId: connection.workspaceId,
    };
    try {
      const card = await this.#objects.getPerson(
        principal,
        connection.personId,
      );
      if (card.userId !== null) return;
      await this.#objects.updatePerson(
        { principal, requestId },
        connection.personId,
        { expectedVersion: card.version, userId: friendUserId },
      );
    } catch {
      // The connection stands; the card can be linked from its editor.
    }
  }
}
