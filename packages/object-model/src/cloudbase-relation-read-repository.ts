import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@chronelle/authorization";
import type { CloudBaseRdbFilter, CloudBaseRdbReader } from "@chronelle/db";
import {
  relationListQuerySchema,
  removedRelationQuerySchema,
  type RelationListQueryInput,
  type RemovedRelationQueryInput,
} from "@chronelle/schemas";

import {
  cloudbaseOptionalFilter,
  compareCloudBaseIds,
  readCloudBaseObjectRow,
  readCloudBaseObjectRows,
  readCloudBasePrincipalAccess,
  readCloudBaseScopes,
  readCloudBaseViewableObjects,
  type CloudBasePrincipalAccess,
} from "./cloudbase-object-read-support.js";
import {
  cloudbaseFilters,
  cloudbaseRelationResource,
  cloudbaseText,
  type CloudBaseRelationWriteRow,
} from "./cloudbase-read-support.js";
import {
  readRelationCursor,
  relationCursor,
  relationListContext,
  removedRelationContext,
  type RelationPage,
  type RelationReadRepository,
  type RemovedRelationPage,
} from "./relation-list.js";
import type { ObjectRelationResource } from "./types.js";

const relationColumns =
  "id,workspace_id,source_object_id,relation_type,target_object_id,metadata,created_by,created_at,deleted_at,version";

function newestFirst(
  first: ObjectRelationResource,
  second: ObjectRelationResource,
): number {
  return compareCloudBaseIds(second.id, first.id);
}

/**
 * Read-only CloudBase adapter for relation pages. Endpoint visibility is
 * evaluated in application code from the principal's roles; the cursor
 * envelope and ordering match the PostgreSQL implementation.
 */
export class CloudBaseRelationReadRepository implements RelationReadRepository {
  readonly #client: CloudBaseRdbReader;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseRdbReader,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async listRelations(
    principal: UserPrincipal,
    objectId: string,
    options: RelationListQueryInput = {},
  ): Promise<RelationPage> {
    const input = relationListQuerySchema.parse(options);
    const context = relationListContext(principal, objectId, input);
    const cursor = readRelationCursor(input.cursor, context);
    const access = await this.#assertViewable(principal, objectId);
    const filters = [
      ...cloudbaseFilters(
        ["workspace_id", "eq", principal.workspaceId],
        ["deleted_at", "is", null],
      ),
      ...cloudbaseOptionalFilter("relation_type", "eq", input.relationType),
    ];
    const [outgoing, incoming] = await Promise.all([
      input.direction === "incoming"
        ? []
        : this.#readRelations([
            ...filters,
            ...cloudbaseFilters(["source_object_id", "eq", objectId]),
            ...cloudbaseOptionalFilter(
              "target_object_id",
              "eq",
              input.otherObjectId,
            ),
          ]),
      input.direction === "outgoing"
        ? []
        : this.#readRelations([
            ...filters,
            ...cloudbaseFilters(["target_object_id", "eq", objectId]),
            ...cloudbaseOptionalFilter(
              "source_object_id",
              "eq",
              input.otherObjectId,
            ),
          ]),
    ]);
    const relations = [...outgoing, ...incoming];
    const otherEndpoint = (relation: ObjectRelationResource) =>
      relation.sourceObjectId === objectId
        ? relation.targetObjectId
        : relation.sourceObjectId;
    const visible = await readCloudBaseViewableObjects(
      this.#client,
      principal,
      access,
      relations.map(otherEndpoint),
    );
    const ordered = relations
      .filter((relation) => visible.has(otherEndpoint(relation)))
      .sort(newestFirst)
      .filter(
        (relation) =>
          cursor === undefined ||
          compareCloudBaseIds(relation.id, cursor.id) < 0,
      );
    const items = ordered.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        ordered.length > input.limit && last !== undefined
          ? relationCursor(context, last.id)
          : null,
    };
  }

  async listRemovedRelations(
    principal: UserPrincipal,
    objectId: string,
    options: RemovedRelationQueryInput,
  ): Promise<RemovedRelationPage> {
    const input = removedRelationQuerySchema.parse(options);
    const context = removedRelationContext(principal, objectId, input);
    const cursor = readRelationCursor(input.cursor, context);
    const access = await this.#assertViewable(principal, objectId);
    const filters = [
      ...cloudbaseFilters(["workspace_id", "eq", principal.workspaceId]),
      ...cloudbaseOptionalFilter("relation_type", "eq", input.relationType),
    ];
    // The transport has no "is not null" filter; tombstones are selected here.
    const [outgoing, incoming] = await Promise.all([
      this.#readRelations([
        ...filters,
        ...cloudbaseFilters(["source_object_id", "eq", objectId]),
      ]),
      this.#readRelations([
        ...filters,
        ...cloudbaseFilters(["target_object_id", "eq", objectId]),
      ]),
    ]);
    const removed = [...outgoing, ...incoming].filter(
      (relation) => relation.deletedAt !== null,
    );
    const endpoints = await readCloudBaseObjectRows(
      this.#client,
      principal,
      removed.flatMap((relation) => [
        relation.sourceObjectId,
        relation.targetObjectId,
      ]),
    );
    const scopes = await readCloudBaseScopes(
      this.#client,
      principal,
      endpoints,
    );
    const byId = new Map(
      endpoints.map((row) => [cloudbaseText(row.id, "object id"), row]),
    );
    const ordered = removed
      .flatMap((relation) => {
        const source = byId.get(relation.sourceObjectId);
        const target = byId.get(relation.targetObjectId);
        if (
          source === undefined ||
          target === undefined ||
          !access.allows("edit", source, scopes) ||
          !access.allows("view", target, scopes)
        )
          return [];
        return [
          {
            relation,
            sourceDisplayName: cloudbaseText(
              source.display_name,
              "display name",
            ),
            targetDisplayName: cloudbaseText(
              target.display_name,
              "display name",
            ),
          },
        ];
      })
      .sort((first, second) => newestFirst(first.relation, second.relation))
      .filter(
        (entry) =>
          cursor === undefined ||
          compareCloudBaseIds(entry.relation.id, cursor.id) < 0,
      );
    const items = ordered.slice(0, input.limit);
    const last = items.at(-1);
    return {
      items,
      nextCursor:
        ordered.length > input.limit && last !== undefined
          ? relationCursor(context, last.relation.id)
          : null,
    };
  }

  async #assertViewable(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<CloudBasePrincipalAccess> {
    const [access, object] = await Promise.all([
      readCloudBasePrincipalAccess(this.#client, principal, this.#clock),
      readCloudBaseObjectRow(this.#client, principal, objectId),
    ]);
    const scopes = await readCloudBaseScopes(this.#client, principal, [object]);
    if (!access.allows("view", object, scopes))
      throw new AuthorizationDeniedError();
    return access;
  }

  async #readRelations(
    filters: readonly CloudBaseRdbFilter[],
  ): Promise<ObjectRelationResource[]> {
    const rows = await this.#client.select<CloudBaseRelationWriteRow>(
      "object_relations",
      { columns: relationColumns, filters },
    );
    return rows.map(cloudbaseRelationResource);
  }
}
