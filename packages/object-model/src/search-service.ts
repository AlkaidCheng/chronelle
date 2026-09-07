import {
  withReadAuthorization,
  type AuthorizationDatabase,
  type UserPrincipal,
} from "@chronelle/authorization";
import { objects } from "@chronelle/db";
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";

import { decodeSearchCursor, encodeSearchCursor } from "./search-cursor.js";
import type { ObjectSearchInput, ObjectSearchPage } from "./types.js";

export class CanonicalObjectSearchService {
  readonly #database: AuthorizationDatabase;

  constructor(database: AuthorizationDatabase) {
    this.#database = database;
  }

  async search(
    principal: UserPrincipal,
    input: ObjectSearchInput,
  ): Promise<ObjectSearchPage> {
    const cursor = decodeSearchCursor(principal, input);
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const searchDocument = sql`to_tsvector('simple', ${objects.displayName})`;
        const searchQuery = sql`websearch_to_tsquery('simple', ${input.query})`;
        const rank = sql<number>`ts_rank(${searchDocument}, ${searchQuery})`;
        // Dates exposed by the API use milliseconds; keyset positions retain database precision.
        const cursorTime = sql<string>`to_char(${objects.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
        const cursorRank = sql`${cursor?.rank}::real`;
        const cursorUpdatedAt = sql`${cursor?.updatedAt}::timestamptz`;
        const rows = await transaction
          .select({
            displayName: objects.displayName,
            id: objects.id,
            objectType: objects.objectType,
            permissionScopeId: objects.permissionScopeId,
            rank,
            cursorTime,
            updatedAt: objects.updatedAt,
            version: objects.version,
          })
          .from(objects)
          .where(
            and(
              input.objectType === undefined
                ? undefined
                : eq(objects.objectType, input.objectType),
              sql`${searchDocument} @@ ${searchQuery}`,
              authorization.resourcePredicate(principal, "view"),
              cursor === undefined
                ? undefined
                : or(
                    lt(rank, cursorRank),
                    and(
                      eq(rank, cursorRank),
                      or(
                        lt(objects.updatedAt, cursorUpdatedAt),
                        and(
                          eq(objects.updatedAt, cursorUpdatedAt),
                          gt(objects.id, cursor.id),
                        ),
                      ),
                    ),
                  ),
            ),
          )
          .orderBy(desc(rank), desc(objects.updatedAt), asc(objects.id))
          .limit(input.limit + 1);

        const page = rows.slice(0, input.limit);
        const last = page.at(-1);
        return {
          items: page.map(
            ({ rank: _rank, cursorTime: _time, ...item }) => item,
          ),
          nextCursor:
            rows.length > input.limit && last !== undefined
              ? encodeSearchCursor(principal, input, {
                  id: last.id,
                  rank: last.rank,
                  updatedAt: last.cursorTime,
                })
              : null,
        };
      },
    );
  }
}
