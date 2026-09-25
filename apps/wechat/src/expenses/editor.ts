import type {
  EventContextCreatePayload,
  ExpenseResponse,
  ExpenseUpdatePayload,
} from "@livtales/schemas";

import {
  clockPattern,
  localParts,
  supportedTimeZone,
  WallClockError,
  zonedInstant,
} from "../events/wall-clock";

export interface ExpenseEditorFields {
  readonly amount: string;
  readonly currency: string;
  readonly date: string;
  readonly displayName: string;
  readonly sectionId: string | null;
  readonly time: string;
  readonly timeZone: string;
}

export type ExpenseEditorIssue =
  | "name-required"
  | "name-too-long"
  | "amount-invalid"
  | "currency-invalid"
  | "date-invalid"
  | "time-invalid"
  | "invalid-local-time"
  | "invalid-time-zone";

export class ExpenseEditorValidationError extends Error {
  constructor(readonly issue: ExpenseEditorIssue) {
    super(issue);
    this.name = "ExpenseEditorValidationError";
  }
}

export function emptyExpenseFields(
  timeZone: string,
  sectionId: string | null = null,
  now: Date = new Date(),
  currency = "CNY",
): ExpenseEditorFields {
  const zone = supportedTimeZone(timeZone);
  const moment = localParts(now.toISOString(), zone);
  return {
    amount: "",
    currency,
    date: moment.date,
    displayName: "",
    sectionId,
    time: moment.time,
    timeZone: zone,
  };
}

export function fieldsFromExpense(
  expense: ExpenseResponse,
  timeZone: string,
): ExpenseEditorFields {
  const zone = supportedTimeZone(timeZone);
  const moment = localParts(expense.occurredAt, zone);
  return {
    amount: expense.amount,
    currency: expense.currency,
    date: moment.date,
    displayName: expense.displayName,
    sectionId: expense.sectionId,
    time: moment.time,
    timeZone: zone,
  };
}

function expenseFieldsPayload(
  fields: ExpenseEditorFields,
  source?: ExpenseResponse,
) {
  const displayName = fields.displayName.trim();
  const amount = fields.amount.trim();
  const currency = fields.currency.trim().toUpperCase();
  if (displayName.length === 0)
    throw new ExpenseEditorValidationError("name-required");
  if (displayName.length > 240)
    throw new ExpenseEditorValidationError("name-too-long");
  if (!/^-?\d{1,15}(?:\.\d{1,4})?$/u.test(amount))
    throw new ExpenseEditorValidationError("amount-invalid");
  if (!/^[A-Z]{3}$/u.test(currency))
    throw new ExpenseEditorValidationError("currency-invalid");
  if (!clockPattern.test(fields.time))
    throw new ExpenseEditorValidationError("time-invalid");
  let occurredAt: string;
  try {
    const previous = source && localParts(source.occurredAt, fields.timeZone);
    occurredAt =
      source !== undefined &&
      previous?.date === fields.date &&
      previous.time === fields.time
        ? source.occurredAt
        : zonedInstant(fields.date, fields.time, fields.timeZone);
  } catch (error) {
    if (error instanceof WallClockError)
      throw new ExpenseEditorValidationError(
        error.issue === "invalid-date" ? "date-invalid" : error.issue,
      );
    throw error;
  }
  return {
    amount,
    currency,
    displayName,
    occurredAt,
    sectionId: fields.sectionId,
  };
}

export function expenseCreatePayload(
  fields: ExpenseEditorFields,
  commandId: string,
): EventContextCreatePayload {
  return {
    commandId,
    resource: { objectType: "expense", ...expenseFieldsPayload(fields) },
  };
}

export function expenseUpdatePayload(
  fields: ExpenseEditorFields,
  source: ExpenseResponse,
): ExpenseUpdatePayload {
  return {
    ...expenseFieldsPayload(fields, source),
    expectedVersion: source.version,
  };
}

export function sameExpenseFields(
  first: ExpenseEditorFields,
  second: ExpenseEditorFields,
): boolean {
  return (Object.keys(first) as (keyof ExpenseEditorFields)[]).every(
    (key) => first[key] === second[key],
  );
}
