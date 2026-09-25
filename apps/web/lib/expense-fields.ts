import type { ExpenseResponse } from "@livtales/schemas";
import { tr } from "../i18n/active-locale";
import { editedInstant } from "./edited-instant";
import { toDateTimeInput } from "./format";
import { sectionPayload } from "./task-fields";

export function readExpenseFields(
  expense?: Pick<
    ExpenseResponse,
    "displayName" | "amount" | "currency" | "occurredAt"
  > & { readonly sectionId?: string | null | undefined },
): ExpenseFields {
  return {
    displayName: expense?.displayName ?? "",
    amount: expense?.amount ?? "",
    currency: expense?.currency ?? "USD",
    occurredAt: toDateTimeInput(
      expense?.occurredAt ?? new Date().toISOString(),
    ),
    // The section's id, empty for a loose expense; a source that names no
    // section (a draft kept before the field existed) leaves it out.
    ...(expense?.sectionId === undefined
      ? {}
      : { section: expense.sectionId ?? "" }),
  };
}

/** The editor's flat fields, every one text. */
export type ExpenseFields = {
  readonly displayName: string;
  readonly amount: string;
  readonly currency: string;
  readonly occurredAt: string;
  readonly section?: string | undefined;
};

/** Keeps decimal text and unchanged transaction instants lossless. */
export function expenseFieldsPayload(
  fields: ExpenseFields,
  source?: Pick<ExpenseResponse, "occurredAt">,
) {
  const occurredAt = editedInstant(
    fields.occurredAt,
    source?.occurredAt,
    "transaction",
  );
  if (occurredAt === null)
    throw new Error(tr("validation")("transactionInstant"));
  const { section, ...rest } = fields;
  return { ...rest, occurredAt, ...sectionPayload(section) };
}
