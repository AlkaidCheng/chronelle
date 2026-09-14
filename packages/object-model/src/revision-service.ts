import type { UserPrincipal } from "@chronelle/authorization";
import type { Database } from "@chronelle/db";
import type { RevisionListQuery } from "@chronelle/schemas";

import {
  PostgresRevisionReadRepository,
  type RevisionDetail,
  type RevisionPage,
  type RevisionReadRepository,
} from "./revision-reads.js";

export class ObjectRevisionService {
  readonly #reads: RevisionReadRepository;

  constructor(database: Database, reads?: RevisionReadRepository) {
    this.#reads = reads ?? new PostgresRevisionReadRepository(database);
  }

  list(
    principal: UserPrincipal,
    objectId: string,
    input: RevisionListQuery,
  ): Promise<RevisionPage> {
    return this.#reads.listRevisions(principal, objectId, input);
  }

  get(
    principal: UserPrincipal,
    objectId: string,
    version: number,
  ): Promise<RevisionDetail> {
    return this.#reads.getRevision(principal, objectId, version);
  }
}
