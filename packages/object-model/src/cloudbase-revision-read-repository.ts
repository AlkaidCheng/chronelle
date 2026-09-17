import {
  AuthorizationDeniedError,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  actorTypes,
  revisionKinds,
  type ActorType,
  type CloudBaseRdbFilter,
  type CloudBaseRdbReader,
  type RevisionKind,
} from "@chronelle/db";
import type { RevisionListQuery } from "@chronelle/schemas";

import {
  cloudbaseIdBatchSize,
  cloudbaseInteger,
  readCloudBaseObjectRow,
  readCloudBasePrincipalAccess,
  readCloudBaseScopes,
} from "./cloudbase-object-read-support.js";
import {
  cloudbaseDate,
  cloudbaseFilters,
  cloudbaseNullableText,
  cloudbaseText,
} from "./cloudbase-read-support.js";
import {
  decodeRevisionSnapshot,
  type RevisionDetail,
  type RevisionPage,
  type RevisionReadRepository,
  type RevisionSummary,
  summarizeRevisionChanges,
} from "./revision-reads.js";

const summaryColumns =
  "id,object_id,object_version,mutation_kind,actor_type,actor_id,created_at,snapshot_schema_version,source_revision_id";

type RevisionRow = {
  readonly id: unknown;
  readonly object_id: unknown;
  readonly object_version: unknown;
  readonly mutation_kind: unknown;
  readonly actor_type: unknown;
  readonly actor_id: unknown;
  readonly created_at: unknown;
  readonly snapshot_schema_version: unknown;
  readonly source_revision_id: unknown;
  readonly snapshot?: unknown;
};

type UserRow = { readonly id: unknown; readonly display_name: unknown };

type SnapshotRow = {
  readonly object_version: unknown;
  readonly snapshot_schema_version: unknown;
  readonly snapshot: unknown;
};

function cloudbaseSummary(
  row: RevisionRow,
  actorNames: ReadonlyMap<string, string>,
): Omit<RevisionSummary, "changedFields" | "changedFieldCount"> {
  const mutationKind = cloudbaseText(row.mutation_kind, "mutation kind");
  if (!revisionKinds.includes(mutationKind as RevisionKind))
    throw new Error("CloudBase returned an invalid mutation kind.");
  const actorType = cloudbaseText(row.actor_type, "actor type");
  if (!actorTypes.includes(actorType as ActorType))
    throw new Error("CloudBase returned an invalid actor type.");
  const actorId = cloudbaseNullableText(row.actor_id, "actor id");
  return {
    id: cloudbaseText(row.id, "revision id"),
    objectId: cloudbaseText(row.object_id, "revision object"),
    objectVersion: cloudbaseInteger(row.object_version, "object version"),
    mutationKind: mutationKind as RevisionKind,
    actorType: actorType as ActorType,
    actorId,
    actorDisplayName:
      actorType === "user" && actorId !== null
        ? (actorNames.get(actorId) ?? null)
        : null,
    createdAt: cloudbaseDate(row.created_at, "created_at").toISOString(),
    snapshotSchemaVersion: cloudbaseInteger(
      row.snapshot_schema_version,
      "snapshot schema version",
    ),
    sourceRevisionId: cloudbaseNullableText(
      row.source_revision_id,
      "source revision",
    ),
  };
}

/**
 * Read-only CloudBase adapter for revision history. View access to the live
 * object is evaluated in application code; the page is ordered newest
 * version first from the full history because the transport has no range
 * filter on the version column.
 */
export class CloudBaseRevisionReadRepository implements RevisionReadRepository {
  readonly #client: CloudBaseRdbReader;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseRdbReader,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async listRevisions(
    principal: UserPrincipal,
    objectId: string,
    input: RevisionListQuery,
  ): Promise<RevisionPage> {
    await this.#assertViewable(principal, objectId);
    const rows = (
      await this.#readRevisions(summaryColumns, [
        ...this.#objectFilters(principal, objectId),
      ])
    )
      .map((row) => ({
        row,
        version: cloudbaseInteger(row.object_version, "object version"),
      }))
      .filter(
        ({ version }) =>
          input.beforeVersion === undefined || version < input.beforeVersion,
      )
      .sort((first, second) => second.version - first.version)
      .slice(0, input.limit + 2);
    const page = rows.slice(0, input.limit).map(({ row }) => row);
    const actorNames = await this.#readActorNames(page);
    const snapshots = await this.#readSnapshots(
      principal,
      objectId,
      rows.map(({ version }) => version),
    );
    const items = page.map((row, index) => ({
      ...cloudbaseSummary(row, actorNames),
      ...summarizeRevisionChanges(
        snapshots.get(rows[index + 1]?.version ?? -1),
        snapshots.get(rows[index]?.version ?? -1) ?? {
          schemaVersion: 0,
          snapshot: null,
        },
      ),
    }));
    rows.splice(input.limit + 1);
    return {
      items,
      nextBeforeVersion:
        rows.length > input.limit
          ? (items.at(-1)?.objectVersion ?? null)
          : null,
    };
  }

  async getRevision(
    principal: UserPrincipal,
    objectId: string,
    version: number,
  ): Promise<RevisionDetail> {
    await this.#assertViewable(principal, objectId);
    const [row] = await this.#readRevisions(
      `${summaryColumns},snapshot`,
      [
        ...this.#objectFilters(principal, objectId),
        { column: "object_version", operator: "eq", value: version },
      ],
      1,
    );
    if (row === undefined) throw new AuthorizationDeniedError();
    const actorNames = await this.#readActorNames([row]);
    const summary = cloudbaseSummary(row, actorNames);
    const previous = (
      await this.#readRevisions(summaryColumns, [
        ...this.#objectFilters(principal, objectId),
      ])
    )
      .map((candidate) =>
        cloudbaseInteger(candidate.object_version, "object version"),
      )
      .filter((candidate) => candidate < version)
      .sort((first, second) => second - first)[0];
    const snapshots =
      previous === undefined
        ? new Map<number, { schemaVersion: number; snapshot: unknown }>()
        : await this.#readSnapshots(principal, objectId, [previous]);
    return {
      ...summary,
      ...summarizeRevisionChanges(snapshots.get(previous ?? -1), {
        schemaVersion: summary.snapshotSchemaVersion,
        snapshot: row.snapshot,
      }),
      snapshot: decodeRevisionSnapshot(
        summary.snapshotSchemaVersion,
        row.snapshot,
      ),
    };
  }

  /** The snapshots of the given versions, by version, read in id-sized batches. */
  async #readSnapshots(
    principal: UserPrincipal,
    objectId: string,
    versions: readonly number[],
  ): Promise<Map<number, { schemaVersion: number; snapshot: unknown }>> {
    const found = new Map<
      number,
      { schemaVersion: number; snapshot: unknown }
    >();
    for (
      let start = 0;
      start < versions.length;
      start += cloudbaseIdBatchSize
    ) {
      const rows = await this.#client.select<SnapshotRow>("object_revisions", {
        columns: "object_version,snapshot_schema_version,snapshot",
        filters: [
          ...this.#objectFilters(principal, objectId),
          {
            column: "object_version",
            operator: "in",
            value: versions.slice(start, start + cloudbaseIdBatchSize),
          },
        ],
      });
      for (const row of rows)
        found.set(cloudbaseInteger(row.object_version, "object version"), {
          schemaVersion: cloudbaseInteger(
            row.snapshot_schema_version,
            "snapshot schema version",
          ),
          snapshot: row.snapshot,
        });
    }
    return found;
  }

  #objectFilters(
    principal: UserPrincipal,
    objectId: string,
  ): readonly CloudBaseRdbFilter[] {
    return cloudbaseFilters(
      ["workspace_id", "eq", principal.workspaceId],
      ["object_id", "eq", objectId],
    );
  }

  async #readRevisions(
    columns: string,
    filters: readonly CloudBaseRdbFilter[],
    limit?: number,
  ): Promise<readonly RevisionRow[]> {
    return this.#client.select<RevisionRow>("object_revisions", {
      columns,
      filters,
      limit,
    });
  }

  async #assertViewable(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<void> {
    const [access, object] = await Promise.all([
      readCloudBasePrincipalAccess(this.#client, principal, this.#clock),
      readCloudBaseObjectRow(this.#client, principal, objectId),
    ]);
    const scopes = await readCloudBaseScopes(this.#client, principal, [object]);
    if (!access.allows("view", object, scopes))
      throw new AuthorizationDeniedError();
  }

  /** Display names of the user actors on a page; other actor types have none. */
  async #readActorNames(
    rows: readonly RevisionRow[],
  ): Promise<ReadonlyMap<string, string>> {
    const ids = [
      ...new Set(
        rows.flatMap((row) => {
          const actorId = cloudbaseNullableText(row.actor_id, "actor id");
          return cloudbaseText(row.actor_type, "actor type") === "user" &&
            actorId !== null
            ? [actorId]
            : [];
        }),
      ),
    ];
    const names = new Map<string, string>();
    for (let start = 0; start < ids.length; start += cloudbaseIdBatchSize) {
      const users = await this.#client.select<UserRow>("users", {
        columns: "id,display_name",
        filters: cloudbaseFilters([
          "id",
          "in",
          ids.slice(start, start + cloudbaseIdBatchSize),
        ]),
      });
      for (const user of users)
        names.set(
          cloudbaseText(user.id, "user id"),
          cloudbaseText(user.display_name, "display name"),
        );
    }
    return names;
  }
}
