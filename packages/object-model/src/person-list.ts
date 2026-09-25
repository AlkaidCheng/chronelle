import {
  withReadAuthorization,
  type AuthorizationDatabase,
  type UserPrincipal,
} from "@livtales/authorization";
import { objects } from "@livtales/db";
import {
  personListQuerySchema,
  type PersonListQueryInput,
} from "@livtales/schemas";
import { and, asc, eq, ilike, inArray, isNull, sql } from "drizzle-orm";

import { InvalidObjectStateError } from "./errors.js";
import { readObjectStates } from "./object-state.js";
import type { PersonResource } from "./types.js";

export interface PersonPage {
  readonly items: PersonResource[];
}

/**
 * Read boundary for the workspace's people: every live Person the caller
 * may view, in name order, the first `limit` of them.
 */
export interface PersonReadRepository {
  listPersons(
    principal: UserPrincipal,
    input?: PersonListQueryInput,
  ): Promise<PersonPage>;
}

export function comparePersonNames(
  first: PersonResource,
  second: PersonResource,
): number {
  return (
    first.displayName
      .toLocaleLowerCase()
      .localeCompare(second.displayName.toLocaleLowerCase()) ||
    first.id.localeCompare(second.id)
  );
}

const foldedName = sql`lower(${objects.displayName}) COLLATE "C"`;

export class PostgresPersonReadRepository implements PersonReadRepository {
  readonly #database: AuthorizationDatabase;

  constructor(database: AuthorizationDatabase) {
    this.#database = database;
  }

  listPersons(
    principal: UserPrincipal,
    options: PersonListQueryInput = {},
  ): Promise<PersonPage> {
    const input = personListQuerySchema.parse(options);
    const pattern = `%${input.query.replace(/[\\%_]/g, "\\$&")}%`;
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const rows = await transaction
          .select({ id: objects.id })
          .from(objects)
          .where(
            and(
              eq(objects.workspaceId, principal.workspaceId),
              eq(objects.objectType, "person"),
              isNull(objects.deletedAt),
              authorization.resourcePredicate(principal, "view"),
              input.query === ""
                ? undefined
                : ilike(objects.displayName, pattern),
            ),
          )
          .orderBy(asc(foldedName), asc(objects.id))
          .limit(input.limit);
        if (rows.length === 0) return { items: [] };
        const states = await readObjectStates(
          transaction,
          and(
            eq(objects.workspaceId, principal.workspaceId),
            inArray(
              objects.id,
              rows.map(({ id }) => id),
            ),
          ),
          input.limit,
        );
        const byId = new Map(states.map((state) => [state.id, state]));
        return {
          items: rows.map(({ id }) => {
            const person = byId.get(id);
            if (person?.objectType !== "person")
              throw new InvalidObjectStateError(
                "The canonical Person state is missing.",
              );
            return person;
          }),
        };
      },
    );
  }
}
