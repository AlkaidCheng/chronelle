import type { UserPrincipal } from "@chronelle/authorization";
import type { CloudBaseRdbReader } from "@chronelle/db";
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
  readCloudBaseVisibility,
  readCloudBaseVisibleObjects,
} from "./cloudbase-read-support.js";
import {
  comparePersonNames,
  type PersonPage,
  type PersonReadRepository,
} from "./person-list.js";

/**
 * The workspace's people through the table route: the visible Person
 * objects and their typed rows, filtered, ordered, and bounded in the
 * application as the PostgreSQL repository does in SQL.
 */
export class CloudBasePersonReadRepository implements PersonReadRepository {
  readonly #client: CloudBaseRdbReader;
  readonly #clock: () => Date;

  constructor(
    client: CloudBaseRdbReader,
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
    const visibility = await readCloudBaseVisibility(
      this.#client,
      principal,
      this.#clock,
    );
    const objects = await readCloudBaseVisibleObjects(
      this.#client,
      principal,
      visibility,
      "person",
    );
    if (objects.length === 0) return { items: [] };
    const rows = await this.#client.select<CloudBasePersonRow>("persons", {
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
          value: objects.map((object) => cloudbaseText(object.id, "object id")),
        },
      ],
    });
    const byId = new Map(
      rows.map((row) => [cloudbaseText(row.object_id, "person object"), row]),
    );
    const ids = [...byId.keys()];
    const contacts = await readCloudBasePersonContacts(
      this.#client,
      principal,
      ids,
    );
    const labels = await readCloudBasePersonLabels(
      this.#client,
      principal,
      ids,
    );
    const query = input.query.toLocaleLowerCase();
    const items = objects
      .flatMap((object) => {
        const id = cloudbaseText(object.id, "object id");
        const row = byId.get(id);
        return row === undefined
          ? []
          : [
              cloudbasePersonResource(
                object,
                row,
                contacts.get(id) ?? [],
                labels.get(id) ?? [],
              ),
            ];
      })
      .filter(
        (person) =>
          query === "" ||
          person.displayName.toLocaleLowerCase().includes(query),
      )
      .sort(comparePersonNames)
      .slice(0, input.limit);
    return { items };
  }
}
