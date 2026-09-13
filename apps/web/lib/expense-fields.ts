import type { ExpenseResponse } from "@chronelle/schemas";
import { editedInstant } from "./edited-instant";
import { toDateTimeInput } from "./format";

export function readExpenseFields(
  expense?: Pick<
    ExpenseResponse,
    "displayName" | "amount" | "currency" | "occurredAt"
  >,
) {
  return {
    displayName: expense?.displayName ?? "",
    amount: expense?.amount ?? "",
    currency: expense?.currency ?? "USD",
    occurredAt: toDateTimeInput(
      expense?.occurredAt ?? new Date().toISOString(),
    ),
  };
}

/** Keeps decimal text and unchanged transaction instants lossless. */
export function expenseFieldsPayload(
  fields: ReturnType<typeof readExpenseFields>,
  source?: Pick<ExpenseResponse, "occurredAt">,
) {
  const occurredAt = editedInstant(
    fields.occurredAt,
    source?.occurredAt,
    "transaction",
  );
  if (occurredAt === null)
    throw new Error("Choose a transaction date and time.");
  return { ...fields, occurredAt };
}
