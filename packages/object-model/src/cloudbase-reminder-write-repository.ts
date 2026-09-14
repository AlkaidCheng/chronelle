import type { CloudBaseRdbClient } from "@chronelle/db";

import {
  CloudBaseObjectWriteRepository,
  decodeRows,
} from "./cloudbase-object-write-repository.js";
import {
  type CloudBaseObjectRow,
  type CloudBaseReminderRow,
  cloudbaseReminderResource,
} from "./cloudbase-read-support.js";
import type {
  CreateReminderInput,
  ReminderResource,
  UpdateReminderInput,
} from "./types.js";

/** Reminder writes through chronelle_reminder_create and chronelle_reminder_update. */
export class CloudBaseReminderWriteRepository extends CloudBaseObjectWriteRepository<
  CreateReminderInput,
  UpdateReminderInput,
  ReminderResource
> {
  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    super(client, {
      objectType: "reminder",
      decode(rows) {
        const { object, typed } = decodeRows<
          CloudBaseObjectRow,
          CloudBaseReminderRow
        >(rows, "reminder");
        return cloudbaseReminderResource(object, typed);
      },
    });
  }
}
