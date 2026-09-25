import { AuthorizationDeniedError } from "@livtales/authorization";
import {
  type CloudBaseRdbClient,
  CloudBaseRpcError,
  roles,
} from "@livtales/db";

import {
  FriendUnavailableError,
  InvalidFriendRequestError,
} from "../friends/friend-store.js";
import {
  type CloudBaseRow,
  instant,
  nullableText,
  record,
  text,
} from "../identity/cloudbase-rows.js";
import {
  type MembershipActor,
  type MembershipStore,
  WorkspaceMemberConflictError,
  type WorkspaceMemberView,
} from "./membership-store.js";

function memberView(row: CloudBaseRow): WorkspaceMemberView {
  const role = text(row.role, "role");
  if (!roles.includes(role as never))
    throw new Error("CloudBase returned an invalid role.");
  return {
    userId: text(row.userId, "member id"),
    displayName: text(row.displayName, "member name"),
    email: nullableText(row.email, "member email"),
    role: role as WorkspaceMemberView["role"],
    personal: row.personal === true,
    friendId: nullableText(row.friendId, "friendId"),
    joinedAt: instant(row.joinedAt, "joinedAt"),
  };
}

/** The store's errors for the statuses the functions raise; anything else is a transport failure. */
function failure(error: unknown): Error {
  if (error instanceof CloudBaseRpcError) {
    switch (error.status) {
      case 403:
        return new AuthorizationDeniedError();
      case 404:
        return new FriendUnavailableError(error.message);
      case 409:
        return new WorkspaceMemberConflictError(error.message);
      case 422:
        return new InvalidFriendRequestError(error.message);
      default:
        return new Error(`Membership persistence failed: ${error.message}`);
    }
  }
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Membership through the gateway: chronelle_workspace_member_list, _add,
 * and _remove (migration 0052), with the PostgreSQL store's rules and
 * messages.
 */
export class CloudBaseMembershipStore implements MembershipStore {
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

  async list(actor: MembershipActor): Promise<readonly WorkspaceMemberView[]> {
    const outcome = record(
      await this.#call("chronelle_workspace_member_list", {
        workspace_id: actor.workspaceId,
        user_id: actor.userId,
      }),
      "members",
    );
    if (!Array.isArray(outcome.items))
      throw new Error("CloudBase returned an invalid member list.");
    return outcome.items.map((item) => memberView(record(item, "member")));
  }

  async add(
    actor: MembershipActor,
    friendId: string,
    role: "editor" | "viewer",
    requestId: string,
  ): Promise<WorkspaceMemberView> {
    return memberView(
      record(
        await this.#call("chronelle_workspace_member_add", {
          workspace_id: actor.workspaceId,
          user_id: actor.userId,
          request_id: requestId,
          friend_id: friendId,
          role,
        }),
        "member",
      ),
    );
  }

  async remove(
    actor: MembershipActor,
    memberId: string,
    requestId: string,
  ): Promise<void> {
    await this.#call("chronelle_workspace_member_remove", {
      workspace_id: actor.workspaceId,
      user_id: actor.userId,
      request_id: requestId,
      member_id: memberId,
    });
  }
}
