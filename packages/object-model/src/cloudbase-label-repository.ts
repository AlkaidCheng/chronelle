import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@livtales/authorization";
import {
  CloudBaseRpcError,
  type CloudBaseRdbClient,
  type CloudBaseRdbReader,
} from "@livtales/db";

import {
  cloudbaseDate,
  cloudbaseInteger,
  cloudbaseText,
  readCloudBaseVisibility,
} from "./cloudbase-read-support.js";
import { mapRpcError } from "./cloudbase-rpc-errors.js";
import { InvalidObjectStateError } from "./errors.js";
import type {
  LabelReadRepository,
  LabelResource,
  LabelWriteRepository,
} from "./labels.js";

type CloudBaseLabelRow = {
  readonly id: unknown;
  readonly workspace_id: unknown;
  readonly name: unknown;
  readonly version: unknown;
  readonly created_at: unknown;
  readonly updated_at: unknown;
};

function labelFromRow(row: CloudBaseLabelRow): LabelResource {
  return {
    id: cloudbaseText(row.id, "label id"),
    workspaceId: cloudbaseText(row.workspace_id, "workspace id"),
    name: cloudbaseText(row.name, "label name"),
    version: cloudbaseInteger(row.version, "label version"),
    createdAt: cloudbaseDate(row.created_at, "created_at"),
    updatedAt: cloudbaseDate(row.updated_at, "updated_at"),
  };
}

function labelFromSerialized(value: unknown): LabelResource {
  if (value === null || typeof value !== "object")
    throw new Error("CloudBase returned an invalid label.");
  const label = value as Record<string, unknown>;
  return {
    id: cloudbaseText(label.id, "label id"),
    workspaceId: cloudbaseText(label.workspaceId, "workspace id"),
    name: cloudbaseText(label.name, "label name"),
    version: cloudbaseInteger(label.version, "label version"),
    createdAt: cloudbaseDate(label.createdAt, "createdAt"),
    updatedAt: cloudbaseDate(label.updatedAt, "updatedAt"),
  };
}

/** Labels read through the table route and written through the chronelle_label_* functions. */
export class CloudBaseLabelRepository
  implements LabelReadRepository, LabelWriteRepository
{
  readonly #client: CloudBaseRdbReader & Pick<CloudBaseRdbClient, "rpc">;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseRdbReader & Pick<CloudBaseRdbClient, "rpc">,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async listLabels(
    principal: UserPrincipal,
  ): Promise<readonly LabelResource[]> {
    const visibility = await readCloudBaseVisibility(
      this.#client,
      principal,
      this.#clock,
    );
    if (
      visibility.workspaceRole === null &&
      visibility.resourceIds.length === 0
    )
      throw new AuthorizationDeniedError();
    const rows = await this.#client.select<CloudBaseLabelRow>("labels", {
      columns: "id,workspace_id,name,version,created_at,updated_at",
      filters: [
        {
          column: "workspace_id",
          operator: "eq",
          value: principal.workspaceId,
        },
      ],
    });
    return rows
      .map(labelFromRow)
      .sort(
        (first, second) =>
          first.name.toLowerCase().localeCompare(second.name.toLowerCase()) ||
          first.id.localeCompare(second.id),
      );
  }

  createLabel(principal: UserPrincipal, name: string): Promise<LabelResource> {
    return this.#call("chronelle_label_create", {
      workspace_id: principal.workspaceId,
      user_id: principal.userId,
      name,
    });
  }

  updateLabel(
    principal: UserPrincipal,
    labelId: string,
    expectedVersion: number,
    name: string,
  ): Promise<LabelResource> {
    return this.#call("chronelle_label_update", {
      workspace_id: principal.workspaceId,
      user_id: principal.userId,
      label_id: labelId,
      expected_version: expectedVersion,
      name,
    });
  }

  deleteLabel(
    principal: UserPrincipal,
    labelId: string,
    expectedVersion: number,
  ): Promise<LabelResource> {
    return this.#call("chronelle_label_delete", {
      workspace_id: principal.workspaceId,
      user_id: principal.userId,
      label_id: labelId,
      expected_version: expectedVersion,
    });
  }

  async #call(
    functionName: string,
    args: Record<string, unknown>,
  ): Promise<LabelResource> {
    try {
      return labelFromSerialized(await this.#client.rpc(functionName, args));
    } catch (error) {
      if (error instanceof CloudBaseRpcError)
        throw mapRpcError(error, {
          invalidRequest: (message) => new InvalidObjectStateError(message),
          notFound: () => new AuthorizationDeniedError(),
        });
      throw error;
    }
  }
}
