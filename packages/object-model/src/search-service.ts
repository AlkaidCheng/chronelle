import {
  withReadAuthorization,
  type UserPrincipal,
} from "@chronelle/authorization";
import { objects, type Database } from "@chronelle/db";
import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";

import type { ObjectSearchInput, ObjectSearchResultResource } from "./types.js";

const maximumCandidateCount = 500;

export class CanonicalObjectSearchService {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  async search(
    principal: UserPrincipal,
    input: ObjectSearchInput,
  ): Promise<readonly ObjectSearchResultResource[]> {
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const searchDocument = sql`to_tsvector('simple', ${objects.displayName})`;
        const searchQuery = sql`websearch_to_tsquery('simple', ${input.query})`;
        const rank = sql<number>`ts_rank(${searchDocument}, ${searchQuery})`;
        const candidates = await transaction
          .select({
            displayName: objects.displayName,
            id: objects.id,
            objectType: objects.objectType,
            permissionScopeId: objects.permissionScopeId,
            rank,
            updatedAt: objects.updatedAt,
            version: objects.version,
          })
          .from(objects)
          .where(
            and(
              eq(objects.workspaceId, principal.workspaceId),
              input.objectType === undefined
                ? undefined
                : eq(objects.objectType, input.objectType),
              isNull(objects.deletedAt),
              sql`${searchDocument} @@ ${searchQuery}`,
            ),
          )
          .orderBy(desc(rank), desc(objects.updatedAt), asc(objects.id))
          .limit(maximumCandidateCount);

        const visibility = await Promise.all(
          candidates.map(({ id }) =>
            authorization.can(principal, "view", {
              id,
              workspaceId: principal.workspaceId,
            }),
          ),
        );

        return candidates
          .filter((_, index) => visibility[index])
          .slice(0, input.limit)
          .map(({ rank: _rank, ...candidate }) => candidate);
      },
    );
  }
}
