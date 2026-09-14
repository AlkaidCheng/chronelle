import type { CloudBaseRdbClient } from "@chronelle/db";

import {
  CloudBaseObjectWriteRepository,
  decodeRows,
} from "./cloudbase-object-write-repository.js";
import {
  type CloudBaseObjectRow,
  type CloudBaseTaskRow,
  cloudbaseTaskResource,
} from "./cloudbase-read-support.js";
import type {
  CreateTaskInput,
  TaskResource,
  UpdateTaskInput,
} from "./types.js";

/** Task writes through chronelle_task_create and chronelle_task_update. */
export class CloudBaseTaskWriteRepository extends CloudBaseObjectWriteRepository<
  CreateTaskInput,
  UpdateTaskInput,
  TaskResource
> {
  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    super(client, {
      objectType: "task",
      decode(rows) {
        const { object, typed } = decodeRows<
          CloudBaseObjectRow,
          CloudBaseTaskRow
        >(rows, "task");
        return cloudbaseTaskResource(object, typed);
      },
    });
  }
}
