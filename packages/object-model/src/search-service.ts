import {
  withReadAuthorization,
  type AuthorizationDatabase,
  type UserPrincipal,
} from "@livtales/authorization";
import { objects, type ObjectType } from "@livtales/db";
import { and, asc, desc, eq, gt, lt, or, sql } from "drizzle-orm";

import {
  decodeSearchCursor,
  encodeSearchCursor,
  type SearchPosition,
} from "./search-cursor.js";
import type {
  ObjectSearchInput,
  ObjectSearchPage,
  ObjectSearchResultResource,
} from "./types.js";

/** A search with its cursor already decoded into the position to continue after. */
export interface SearchReadInput {
  readonly after?: SearchPosition | undefined;
  readonly limit: number;
  readonly objectType?: ObjectType | undefined;
  readonly query: string;
}

/** One page of matches and, when more follow, the position of its last item. */
export interface SearchReadPage {
  readonly items: readonly ObjectSearchResultResource[];
  readonly next: SearchPosition | null;
}

/**
 * Read boundary for object search.
 *
 * Implementations own the full-text query, ranking, authorization filter,
 * and keyset pagination; the service owns the cursor envelope, so a position
 * from one implementation continues a search on the other.
 */
export interface SearchReadRepository {
  search(
    principal: UserPrincipal,
    input: SearchReadInput,
  ): Promise<SearchReadPage>;
}

export class PostgresSearchReadRepository implements SearchReadRepository {
  readonly #database: AuthorizationDatabase;

  constructor(database: AuthorizationDatabase) {
    this.#database = database;
  }

  async search(
    principal: UserPrincipal,
    input: SearchReadInput,
  ): Promise<SearchReadPage> {
    const cursor = input.after;
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
          next:
            rows.length > input.limit && last !== undefined
              ? { id: last.id, rank: last.rank, updatedAt: last.cursorTime }
              : null,
        };
      },
    );
  }
}

export class CanonicalObjectSearchService {
  readonly #reads: SearchReadRepository;

  constructor(database: AuthorizationDatabase, reads?: SearchReadRepository) {
    this.#reads = reads ?? new PostgresSearchReadRepository(database);
  }

  async search(
    principal: UserPrincipal,
    input: ObjectSearchInput,
  ): Promise<ObjectSearchPage> {
    const after = decodeSearchCursor(principal, input);
    const page = await this.#reads.search(principal, {
      after,
      limit: input.limit,
      objectType: input.objectType,
      query: input.query,
    });
    return {
      items: page.items,
      nextCursor:
        page.next === null
          ? null
          : encodeSearchCursor(principal, input, page.next),
    };
  }
}
