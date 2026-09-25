import type { CloudBaseRdbClient } from "@livtales/db";

import {
  CloudBaseObjectWriteRepository,
  decodeRows,
} from "./cloudbase-object-write-repository.js";
import {
  type CloudBaseEventRow,
  type CloudBaseObjectRow,
  cloudbaseEventResource,
} from "./cloudbase-read-support.js";
import type {
  CreateEventInput,
  EventResource,
  UpdateEventInput,
} from "./types.js";

/** Event writes through chronelle_event_create and chronelle_event_update. */
export class CloudBaseEventWriteRepository extends CloudBaseObjectWriteRepository<
  CreateEventInput,
  UpdateEventInput,
  EventResource
> {
  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    super(client, {
      objectType: "event",
      decode(rows) {
        const { object, typed } = decodeRows<
          CloudBaseObjectRow,
          CloudBaseEventRow
        >(rows, "event");
        return cloudbaseEventResource(object, typed);
      },
    });
  }
}
