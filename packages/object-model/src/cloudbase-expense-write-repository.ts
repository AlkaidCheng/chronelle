import type { CloudBaseRdbClient } from "@livtales/db";

import {
  CloudBaseObjectWriteRepository,
  decodeRows,
} from "./cloudbase-object-write-repository.js";
import {
  type CloudBaseExpenseRow,
  type CloudBaseObjectRow,
  cloudbaseExpenseResource,
} from "./cloudbase-read-support.js";
import type {
  CreateExpenseInput,
  ExpenseResource,
  UpdateExpenseInput,
} from "./types.js";

/** Expense writes through chronelle_expense_create and chronelle_expense_update. */
export class CloudBaseExpenseWriteRepository extends CloudBaseObjectWriteRepository<
  CreateExpenseInput,
  UpdateExpenseInput,
  ExpenseResource
> {
  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    super(client, {
      objectType: "expense",
      decode(rows) {
        const { object, typed } = decodeRows<
          CloudBaseObjectRow,
          CloudBaseExpenseRow
        >(rows, "expense");
        return cloudbaseExpenseResource(object, typed);
      },
    });
  }
}
