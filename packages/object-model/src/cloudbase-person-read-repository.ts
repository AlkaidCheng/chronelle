import type { UserPrincipal } from "@livtales/authorization";
import {
  personListQuerySchema,
  type PersonListQueryInput,
} from "@livtales/schemas";

import {
  type CloudBaseObjectRow,
  type CloudBasePersonRow,
  cloudbasePersonContacts,
  cloudbasePersonResource,
  cloudbaseText,
} from "./cloudbase-read-support.js";
import {
  cloudbaseListRows,
  type CloudBaseListClient,
} from "./cloudbase-list-candidates.js";
import type { PersonPage, PersonReadRepository } from "./person-list.js";

function hydrationRecord<T>(
  row: Record<string, unknown>,
  field: "object" | "person",
): T {
  const value = row[field];
  if (value === null || typeof value !== "object" || Array.isArray(value))
    throw new Error("CloudBase returned invalid person hydration.");
  return value as T;
}

function hydratedPeople(
  value: unknown,
): ReturnType<typeof cloudbasePersonResource>[] {
  return cloudbaseListRows(value).map((row) => {
    const labels = cloudbaseListRows(row.labels)
      .map((label) => ({
        id: cloudbaseText(label.id, "label id"),
        name: cloudbaseText(label.name, "label name").toLowerCase(),
      }))
      .sort(
        (first, second) =>
          first.name.localeCompare(second.name) ||
          first.id.localeCompare(second.id),
      )
      .map(({ id }) => id);
    return cloudbasePersonResource(
      hydrationRecord<CloudBaseObjectRow>(row, "object"),
      hydrationRecord<CloudBasePersonRow>(row, "person"),
      cloudbasePersonContacts(row.contacts),
      labels,
    );
  });
}

/**
 * Locale-sensitive matching orders lightweight, authorized names before
 * hydrating only the selected people and their contacts and labels.
 */
export class CloudBasePersonReadRepository implements PersonReadRepository {
  readonly #client: CloudBaseListClient;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseListClient,
    clock: () => Date = () => new Date(),
  ) {
    this.#client = client;
    this.#clock = clock;
  }

  async listPersons(
    principal: UserPrincipal,
    options: PersonListQueryInput = {},
  ): Promise<PersonPage> {
    const input = personListQuerySchema.parse(options);
    const now = this.#clock();
    const raw = await this.#client.rpc("chronelle_person_list_candidates", {
      workspace_id: principal.workspaceId,
      user_id: principal.userId,
      access_at: now.toISOString(),
    });
    const query = input.query.toLocaleLowerCase();
    const ids = cloudbaseListRows(raw)
      .map((row) => ({
        id: cloudbaseText(row.id, "person id"),
        name: cloudbaseText(
          row.display_name,
          "display name",
        ).toLocaleLowerCase(),
      }))
      .filter((row) => query === "" || row.name.includes(query))
      .sort(
        (first, second) =>
          first.name.localeCompare(second.name) ||
          first.id.localeCompare(second.id),
      )
      .slice(0, input.limit)
      .map((row) => row.id);
    if (ids.length === 0) return { items: [] };
    const people = hydratedPeople(
      await this.#client.rpc("chronelle_person_list_hydrate", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        person_ids: ids,
        access_at: now.toISOString(),
      }),
    );
    const byId = new Map(people.map((person) => [person.id, person]));
    return { items: ids.flatMap((id) => byId.get(id) ?? []) };
  }
}
