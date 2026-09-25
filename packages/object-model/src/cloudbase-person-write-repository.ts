import type { CloudBaseRdbClient } from "@livtales/db";

import { CloudBaseObjectWriteRepository } from "./cloudbase-object-write-repository.js";
import { cloudbaseResourceFromRows } from "./cloudbase-read-support.js";
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
        const resource = cloudbaseResourceFromRows(rows);
        if (resource.objectType !== "person")
          throw new Error("CloudBase returned an invalid person.");
        return resource;
      },
    });
  }
}
