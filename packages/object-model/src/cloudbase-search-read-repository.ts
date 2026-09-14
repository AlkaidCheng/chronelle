import type { UserPrincipal } from "@chronelle/authorization";
import { CloudBaseRpcError, type CloudBaseRdbClient } from "@chronelle/db";
import {
  objectSearchCursorPayloadSchema,
  objectSearchResultSchema,
} from "@chronelle/schemas";

import { mapRpcError } from "./cloudbase-rpc-errors.js";
import type {
  SearchReadInput,
  SearchReadPage,
  SearchReadRepository,
} from "./search-service.js";

const itemsSchema = objectSearchResultSchema.array();
const nextSchema = objectSearchCursorPayloadSchema
  .pick({ id: true, rank: true, updatedAt: true })
  .nullable();

/**
 * Object search through chronelle_object_search. The function applies the
 * service's full-text query, ranking, authorization, type filter, and keyset
 * position; this adapter passes the decoded position down and decodes the
 * page it returns, so the cursor envelope stays with the service.
 */
export class CloudBaseSearchReadRepository implements SearchReadRepository {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async search(
    principal: UserPrincipal,
    input: SearchReadInput,
  ): Promise<SearchReadPage> {
    let page: unknown;
    try {
      page = await this.#client.rpc("chronelle_object_search", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        query: input.query,
        object_type: input.objectType ?? null,
        page_limit: input.limit,
        after_rank: input.after?.rank ?? null,
        after_updated_at: input.after?.updatedAt ?? null,
        after_id: input.after?.id ?? null,
      });
    } catch (error) {
      if (error instanceof CloudBaseRpcError) throw mapRpcError(error);
      throw error;
    }
    if (page === null || typeof page !== "object")
      throw new Error("CloudBase returned an invalid search page.");
    const items = itemsSchema.safeParse((page as { items?: unknown }).items);
    const next = nextSchema.safeParse((page as { next?: unknown }).next);
    if (!items.success || !next.success)
      throw new Error("CloudBase returned an invalid search page.");
    return {
      items: items.data.map((item) => ({
        ...item,
        updatedAt: new Date(item.updatedAt),
      })),
      next: next.data,
    };
  }
}
