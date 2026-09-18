import { type CloudBaseRdbClient, CloudBaseRpcError } from "@chronelle/db";

import {
  type CloudBaseRow,
  instant,
  nullableInstant,
  nullableText,
  record,
  text,
} from "../identity/cloudbase-rows.js";
import {
  type AccountContact,
  type ConnectionView,
  FriendConflictError,
  FriendLimitError,
  type FriendStore,
  type FriendsSnapshot,
  FriendUnavailableError,
  InvalidFriendRequestError,
  type InviteInput,
  type InviteOutcome,
  type ItemState,
  type RequestInput,
  type ResendInput,
  type Sender,
  type SentItem,
} from "./friend-store.js";

const connectionStatuses = [
  "pending",
  "accepted",
  "declined",
  "withdrawn",
  "removed",
] as const;

function oneOf<const T extends readonly string[]>(
  value: unknown,
  choices: T,
  field: string,
): T[number] {
  if (typeof value !== "string" || !choices.includes(value))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return value;
}

function list(value: unknown, field: string): readonly CloudBaseRow[] {
  if (!Array.isArray(value))
    throw new Error(`CloudBase returned an invalid ${field}.`);
  return value.map((item) => record(item, field));
}

function connectionView(row: CloudBaseRow): ConnectionView {
  return {
    id: text(row.id, "connection id"),
    status: oneOf(row.status, connectionStatuses, "connection status"),
    direction: oneOf(row.direction, ["sent", "received"], "direction"),
    userId: text(row.userId, "connection user"),
    displayName: text(row.displayName, "display name"),
    email: nullableText(row.email, "email"),
    message: nullableText(row.message, "message"),
    personId: nullableText(row.personId, "personId"),
    workspaceId: nullableText(row.workspaceId, "workspaceId"),
    createdAt: instant(row.createdAt, "createdAt"),
    respondedAt: nullableInstant(row.respondedAt, "respondedAt"),
  };
}

function sentItem(row: CloudBaseRow): SentItem {
  return {
    id: text(row.id, "item id"),
    kind: oneOf(row.kind, ["connection", "invitation"], "kind"),
    email: text(row.email, "email"),
    message: nullableText(row.message, "message"),
    personId: nullableText(row.personId, "personId"),
    workspaceId: nullableText(row.workspaceId, "workspaceId"),
    createdAt: instant(row.createdAt, "createdAt"),
    expiresAt: nullableInstant(row.expiresAt, "expiresAt"),
  };
}

function contact(row: CloudBaseRow): AccountContact {
  return {
    userId: text(row.userId, "recipient user"),
    email: text(row.email, "recipient email"),
    displayName: text(row.displayName, "recipient name"),
    locale: nullableText(row.locale, "recipient locale"),
  };
}

function sender(row: CloudBaseRow): Sender {
  return {
    displayName: text(row.displayName, "sender name"),
    email: text(row.email, "sender email"),
    locale: nullableText(row.locale, "sender locale"),
  };
}

function inviteOutcome(value: unknown): InviteOutcome {
  const row = record(value, "invitation outcome");
  return {
    kind: oneOf(row.kind, ["connection", "invitation"], "kind"),
    item: sentItem(record(row.item, "item")),
    recipient:
      row.recipient === null || row.recipient === undefined
        ? null
        : contact(record(row.recipient, "recipient")),
    sender: sender(record(row.sender, "sender")),
  };
}

function itemState(value: unknown): ItemState {
  const row = record(value, "item state");
  return {
    id: text(row.id, "item id"),
    kind: oneOf(row.kind, ["connection", "invitation"], "kind"),
    status: oneOf(row.status, ["withdrawn", "removed"], "status"),
  };
}

/** The store's errors for the statuses the functions raise; anything else is a transport failure. */
function failure(error: unknown): Error {
  if (error instanceof CloudBaseRpcError) {
    switch (error.status) {
      case 404:
        return new FriendUnavailableError(error.message);
      case 409:
        return new FriendConflictError(error.message);
      case 422:
        return new InvalidFriendRequestError(error.message);
      case 429:
        return new FriendLimitError(error.message);
      default:
        return new Error(`Friend persistence failed: ${error.message}`);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Friend persistence through the gateway: the chronelle_friend_* functions
 * (migrations 0051 and 0055), with the PostgreSQL store's semantics and
 * messages.
 */
export class CloudBaseFriendStore implements FriendStore {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async #call(name: string, input: Record<string, unknown>): Promise<unknown> {
    try {
      return await this.#client.rpc(name, input);
    } catch (error) {
      throw failure(error);
    }
  }

  async list(userId: string): Promise<FriendsSnapshot> {
    const snapshot = record(
      await this.#call("chronelle_friend_list", { user_id: userId }),
      "friends",
    );
    return {
      friends: list(snapshot.friends, "friends").map(connectionView),
      incoming: list(snapshot.incoming, "incoming").map(connectionView),
      sent: list(snapshot.sent, "sent").map(sentItem),
    };
  }

  async invite(userId: string, input: InviteInput): Promise<InviteOutcome> {
    return inviteOutcome(
      await this.#call("chronelle_friend_invite", {
        user_id: userId,
        email: input.email,
        message: input.message,
        person_id: input.personId,
        workspace_id: input.workspaceId,
        token_digest: input.tokenDigest,
        expires_at: input.expiresAt.toISOString(),
        daily_limit: input.dailyLimit,
        request_id: input.requestId,
      }),
    );
  }

  async request(userId: string, input: RequestInput): Promise<InviteOutcome> {
    return inviteOutcome(
      await this.#call("chronelle_friend_request", {
        user_id: userId,
        addressee_id: input.addresseeId,
        message: input.message,
        person_id: input.personId,
        workspace_id: input.workspaceId,
        daily_limit: input.dailyLimit,
        request_id: input.requestId,
      }),
    );
  }

  async respond(
    userId: string,
    connectionId: string,
    accept: boolean,
    requestId: string,
  ): Promise<ConnectionView> {
    return connectionView(
      record(
        await this.#call("chronelle_friend_respond", {
          user_id: userId,
          connection_id: connectionId,
          accept,
          request_id: requestId,
        }),
        "connection",
      ),
    );
  }

  async withdraw(
    userId: string,
    itemId: string,
    requestId: string,
  ): Promise<ItemState> {
    return itemState(
      await this.#call("chronelle_friend_withdraw", {
        user_id: userId,
        item_id: itemId,
        request_id: requestId,
      }),
    );
  }

  async remove(
    userId: string,
    connectionId: string,
    requestId: string,
  ): Promise<ItemState> {
    return itemState(
      await this.#call("chronelle_friend_remove", {
        user_id: userId,
        connection_id: connectionId,
        request_id: requestId,
      }),
    );
  }

  async resend(
    userId: string,
    itemId: string,
    input: ResendInput,
  ): Promise<InviteOutcome> {
    return inviteOutcome(
      await this.#call("chronelle_friend_resend", {
        user_id: userId,
        item_id: itemId,
        token_digest: input.tokenDigest,
        expires_at: input.expiresAt.toISOString(),
        min_interval_seconds: Math.ceil(input.minIntervalMs / 1000),
        request_id: input.requestId,
      }),
    );
  }

  async claimInvitations(
    userId: string,
    tokenDigest: string | null,
    requestId: string,
  ): Promise<number> {
    const outcome = record(
      await this.#call("chronelle_friend_invitations_claim", {
        user_id: userId,
        token_digest: tokenDigest,
        request_id: requestId,
      }),
      "claim outcome",
    );
    if (typeof outcome.claimed !== "number")
      throw new Error("CloudBase returned an invalid claim count.");
    return outcome.claimed;
  }
}
