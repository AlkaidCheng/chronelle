import type { CloudBaseRdbClient } from "@chronelle/db";

import {
  CloudBaseObjectWriteRepository,
  decodeRows,
} from "./cloudbase-object-write-repository.js";
import {
  type CloudBaseObjectRow,
  type CloudBasePersonRow,
  cloudbasePersonResource,
} from "./cloudbase-read-support.js";
import type {
  CreatePersonInput,
  PersonResource,
  UpdatePersonInput,
} from "./types.js";

/** Person writes through chronelle_person_create and chronelle_person_update. */
export class CloudBasePersonWriteRepository extends CloudBaseObjectWriteRepository<
  CreatePersonInput,
  UpdatePersonInput,
  PersonResource
> {
  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    super(client, {
      objectType: "person",
      decode(rows) {
        const { object, typed } = decodeRows<
          CloudBaseObjectRow,
          CloudBasePersonRow
        >(rows, "person");
        return cloudbasePersonResource(object, typed);
      },
    });
  }
}
