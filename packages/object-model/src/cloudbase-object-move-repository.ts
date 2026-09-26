import type { UserPrincipal } from "@livtales/authorization";
import { CloudBaseRpcError, type CloudBaseRdbClient } from "@livtales/db";
import {
  type ObjectMovePreview,
  type ObjectMoveRequest,
  type ObjectMoveTargetsResponse,
  objectMovePreviewSchema,
  objectMoveSummarySchema,
  objectMoveTargetsResponseSchema,
} from "@livtales/schemas";

import { cloudbaseResourceFromRows } from "./cloudbase-read-support.js";
import { mapRpcError } from "./cloudbase-rpc-errors.js";
import {
  ObjectMoveChangedError,
  ObjectMoveRefusedError,
  type ObjectMoveRepository,
  type ObjectMoveResult,
} from "./object-move.js";
import type { MutationContext } from "./types.js";

const changedMessage = new ObjectMoveChangedError().message;

/**
 * Moving an Event through chronelle_object_move_targets,
 * chronelle_object_move_preview, and chronelle_object_move (migration
 * 0077). The move is one call and one transaction that takes both spaces'
 * fences in id order and applies the checks, the dropped-link count, the
 * audit in both spaces, and the revisions of the records it changes.
 */
export class CloudBaseObjectMoveRepository implements ObjectMoveRepository {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;
  readonly #clock: () => Date;

  constructor(
    client: Pick<CloudBaseRdbClient, "rpc">,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async targets(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<ObjectMoveTargetsResponse> {
    return objectMoveTargetsResponseSchema.parse(
      await this.#call("chronelle_object_move_targets", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        object_id: objectId,
      }),
    );
  }

  async preview(
    principal: UserPrincipal,
    objectId: string,
    targetWorkspaceId: string,
  ): Promise<ObjectMovePreview> {
    return objectMovePreviewSchema.parse(
      await this.#call("chronelle_object_move_preview", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        object_id: objectId,
        target_workspace_id: targetWorkspaceId,
      }),
    );
  }

  async move(
    context: MutationContext,
    objectId: string,
    request: ObjectMoveRequest,
  ): Promise<ObjectMoveResult> {
    const result = await this.#call("chronelle_object_move", {
      workspace_id: context.principal.workspaceId,
      user_id: context.principal.userId,
      request_id: context.requestId,
      object_id: objectId,
      target_workspace_id: request.workspaceId,
      expected_dropped_links: request.expectedDroppedLinks,
      moved_at: this.#clock().toISOString(),
      ...(request.commandId === undefined
        ? {}
        : { command_id: request.commandId }),
    });
    const record =
      result !== null && typeof result === "object"
        ? (result as { event?: unknown; move?: unknown })
        : {};
    const event = cloudbaseResourceFromRows(record.event);
    if (event.objectType !== "event")
      throw new Error("CloudBase returned an invalid move.");
    return { event, move: objectMoveSummarySchema.parse(record.move) };
  }

  async #call(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    try {
      return await this.#client.rpc(functionName, args);
    } catch (error) {
      if (error instanceof CloudBaseRpcError) throw mapMoveError(error);
      throw error;
    }
  }
}

/**
 * The service error for a move function's failure. A refusal and a
 * changed move are told apart from other errors of their code by the
 * function's fixed messages; a key violation or deadlock that escaped the
 * function is a changed move too.
 */
function mapMoveError(error: CloudBaseRpcError): Error {
  const refusal = ObjectMoveRefusedError.fromMessage(error.message);
  if (
    refusal !== undefined &&
    ["PT403", "PT404", "PT422"].some((code) => error.code.endsWith(code))
  )
    return refusal;
  if (
    (error.code.endsWith("PT409") && error.message === changedMessage) ||
    error.code.endsWith("23503") ||
    error.code.endsWith("40P01")
  )
    return new ObjectMoveChangedError();
  return mapRpcError(error);
}
