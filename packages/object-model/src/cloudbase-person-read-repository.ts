import type { UserPrincipal } from "@chronelle/authorization";
import {
  personListQuerySchema,
  type PersonListQueryInput,
} from "@chronelle/schemas";

import {
  type CloudBasePersonRow,
  cloudbasePersonColumns,
  cloudbasePersonResource,
  cloudbaseText,
  readCloudBasePersonContacts,
  readCloudBasePersonLabels,
  readCloudBaseObjects,
} from "./cloudbase-read-support.js";
import {
  cloudbaseListRows,
  type CloudBaseListClient,
} from "./cloudbase-list-candidates.js";
import type { PersonPage, PersonReadRepository } from "./person-list.js";

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
    const raw = await this.#client.rpc("chronelle_person_list_candidates", {
      workspace_id: principal.workspaceId,
      user_id: principal.userId,
      access_at: this.#clock().toISOString(),
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
    const [objects, rows, contacts, labels] = await Promise.all([
      readCloudBaseObjects(this.#client, principal, ids, "person"),
      this.#client.select<CloudBasePersonRow>("persons", {
        columns: cloudbasePersonColumns,
        filters: [
          {
            column: "workspace_id",
            operator: "eq",
            value: principal.workspaceId,
          },
          {
            column: "object_id",
            operator: "in",
            value: ids,
          },
        ],
      }),
      readCloudBasePersonContacts(this.#client, principal, ids),
      readCloudBasePersonLabels(this.#client, principal, ids),
    ]);
    const byId = new Map(
      rows.map((row) => [cloudbaseText(row.object_id, "person object"), row]),
    );
    const objectsById = new Map(
      objects.map((object) => [cloudbaseText(object.id, "object id"), object]),
    );
    const items = ids.flatMap((id) => {
      const object = objectsById.get(id);
      const row = byId.get(id);
      return row === undefined || object === undefined
        ? []
        : [
            cloudbasePersonResource(
              object,
              row,
              contacts.get(id) ?? [],
              labels.get(id) ?? [],
            ),
          ];
    });
    return { items };
  }
}
