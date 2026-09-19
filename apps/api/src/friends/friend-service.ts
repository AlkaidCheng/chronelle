import type { EventPlanningObjectService } from "@chronelle/object-model";
import { messagesFor } from "../authentication/email-messages.js";
import type { EmailSender } from "../authentication/email-sender.js";
import type {
  AcceptOutcome,
  ConnectionView,
  FriendStore,
  FriendsSnapshot,
  InvitationPeek,
  InviteOutcome,
  ItemState,
  SentItem,
} from "./friend-store.js";
import {
  digestInvitationToken,
  generateInvitationToken,
} from "./invitation-token.js";

export interface FriendServiceOptions {
  readonly clock?: (() => Date) | undefined;
  /** The web origin an invitation link points at. */
  readonly webBaseUrl?: string | undefined;
  readonly productName?: string | undefined;
  /** Invitations one account may send in a day; 0 for no cap. */
  readonly dailyLimit?: number | undefined;
  /** How long an invitation link stays valid. */
  readonly invitationTtlMs?: number | undefined;
  /** The least time between two sends of one request or invitation. */
  readonly resendIntervalMs?: number | undefined;
}

/**
 * An invitation: by email (the address is required and the link is
 * emailed), or as a link the caller hands on (an address, when given, is
 * kept so the link can be emailed later).
 */
export interface InviteFriendInput {
  readonly channel: "email" | "link";
  readonly email?: string | undefined;
  readonly message?: string | undefined;
  readonly personId?: string | undefined;
}

/** A sent item with the link its token opens, when it is an invitation. */
export interface SentItemView extends SentItem {
  readonly inviteUrl: string | null;
}

export interface InviteView extends InviteOutcome {
  readonly item: SentItemView;
}

export interface FriendsView extends FriendsSnapshot {
  readonly sent: readonly SentItemView[];
}

/** A request to an account by id, optionally from a person card. */
export interface RequestFriendInput {
  readonly userId: string;
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
 * Friends: the account's connections and requests, invitations (a request
 * to the account that has the address, else a link, emailed or handed on
 * by the sender), answers, withdrawals, removals, sending again, a new
 * link, and the claim page's peek and accept. Every email goes out in the
 * recipient's language (the sender's for an address without an account).
 * Accepting a request or an invitation that came from a person card links
 * that card to the new friend, as the requester, when the card is still
 * unlinked and the friend has no card there yet.
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

  async list(userId: string): Promise<FriendsView> {
    const snapshot = await this.#store.list(userId);
    return { ...snapshot, sent: snapshot.sent.map((item) => this.#view(item)) };
  }

  /** The claim page's address for an invitation token. */
  inviteUrl(token: string): string {
    return `${this.#webBaseUrl}/invite/${encodeURIComponent(token)}`;
  }

  /**
   * Invites by email or as a link: an address one account has makes a
   * request to it either way; otherwise an invitation, emailed when the
   * channel is email.
   */
  async invite(
    actor: FriendActor,
    input: InviteFriendInput,
    requestId: string,
  ): Promise<InviteView> {
    const token = generateInvitationToken();
    const outcome = await this.#store.invite(actor.userId, {
      email: input.email ?? null,
      channel: input.channel,
      message: input.message ?? null,
      personId: input.personId ?? null,
      workspaceId: input.personId === undefined ? null : actor.workspaceId,
      token,
      tokenDigest: digestInvitationToken(token),
      expiresAt: new Date(this.#clock().getTime() + this.#invitationTtlMs),
      dailyLimit: this.#dailyLimit,
      requestId,
    });
    if (outcome.kind === "connection" || input.channel === "email")
      await this.#send(outcome);
    return this.#outcome(outcome);
  }

  /** A request to an account by id; the recipient is emailed as for a request to a known address. */
  async request(
    actor: FriendActor,
    input: RequestFriendInput,
    requestId: string,
  ): Promise<InviteView> {
    const outcome = await this.#store.request(actor.userId, {
      addresseeId: input.userId,
      message: input.message ?? null,
      personId: input.personId ?? null,
      workspaceId: input.personId === undefined ? null : actor.workspaceId,
      dailyLimit: this.#dailyLimit,
      requestId,
    });
    await this.#send(outcome);
    return this.#outcome(outcome);
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

  /** Sends a request or an addressed invitation again; an invitation takes a fresh link. */
  async resend(
    userId: string,
    itemId: string,
    requestId: string,
  ): Promise<InviteView> {
    const outcome = await this.#store.resend(
      userId,
      itemId,
      this.#renewal(requestId),
    );
    await this.#send(outcome);
    return this.#outcome(outcome);
  }

  /** New link: a fresh token for an invitation; emailed again when it has an address. */
  async link(
    userId: string,
    itemId: string,
    requestId: string,
  ): Promise<InviteView> {
    const outcome = await this.#store.link(
      userId,
      itemId,
      this.#renewal(requestId),
    );
    if (outcome.item.email !== null) await this.#send(outcome);
    return this.#outcome(outcome);
  }

  /**
   * The invitations addressed to a new account's email become requests;
   * the link the sign-up carried, if any, stays open for the claim page.
   */
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

  /** What the claim page shows for a link, to anyone who has it. */
  peek(token: string): Promise<InvitationPeek> {
    return this.#store.peek(digestInvitationToken(token));
  }

  /** Accepts the invitation a link opens, then links the card it came from. */
  async accept(
    userId: string,
    token: string,
    requestId: string,
  ): Promise<AcceptOutcome> {
    const outcome = await this.#store.accept(
      userId,
      digestInvitationToken(token),
      requestId,
    );
    // The card is the invitation's, whichever connection stood before.
    await this.#linkCard(
      {
        ...outcome.connection,
        personId: outcome.personId,
        workspaceId: outcome.workspaceId,
      },
      userId,
      requestId,
    );
    return outcome;
  }

  #renewal(requestId: string) {
    const token = generateInvitationToken();
    return {
      token,
      tokenDigest: digestInvitationToken(token),
      expiresAt: new Date(this.#clock().getTime() + this.#invitationTtlMs),
      minIntervalMs: this.#resendIntervalMs,
      requestId,
    };
  }

  #view(item: SentItem): SentItemView {
    return {
      ...item,
      inviteUrl: item.token === null ? null : this.inviteUrl(item.token),
    };
  }

  #outcome(outcome: InviteOutcome): InviteView {
    return { ...outcome, item: this.#view(outcome.item) };
  }

  async #send(outcome: InviteOutcome): Promise<void> {
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
    if (item.email === null || item.token === null) return;
    const message = messagesFor(sender.locale).friendInvitationEmail({
      productName: this.#productName,
      senderName: sender.displayName,
      senderEmail: sender.email,
      message: item.message,
      link: this.inviteUrl(item.token),
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
