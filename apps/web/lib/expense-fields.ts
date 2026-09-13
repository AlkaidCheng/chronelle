import type { ExpenseResponse } from "@chronelle/schemas";
import { fromDateTimeInput, toDateTimeInput } from "./format";

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
  if (source && fields.occurredAt === toDateTimeInput(source.occurredAt))
    return { ...fields, occurredAt: source.occurredAt };
  let occurredAt: string | null;
  try {
    occurredAt = fromDateTimeInput(fields.occurredAt);
  } catch {
    throw new Error("Choose a valid transaction date and time.");
  }
  if (occurredAt === null)
    throw new Error("Choose a transaction date and time.");
  if (toDateTimeInput(occurredAt) !== fields.occurredAt)
    throw new Error(
      "This local time is unavailable. Choose another transaction time.",
    );
  return { ...fields, occurredAt };
}
