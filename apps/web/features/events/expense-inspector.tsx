"use client";

import type { SectionResponse } from "@livtales/schemas";

import type { ExpenseFields } from "../../lib/expense-fields";
import { useExpenseEditorQueries } from "../../lib/queries";
import { ExpenseForm } from "./expense-form";
import { ObjectEditorAccess } from "./object-editor-access";

export function ExpenseInspector({
  eventId,
  expenseId,
  onClose,
  sections,
  start,
}: {
  readonly eventId: string;
  readonly expenseId: string;
  readonly onClose: () => void;
  /** The sections of the Event's Expenses, offered as the expense's section. */
  readonly sections?: readonly SectionResponse[] | undefined;
  /** The fields the expense's composer held when it handed over to the editor. */
  readonly start?: Partial<ExpenseFields> | undefined;
}) {
  const { expense, access } = useExpenseEditorQueries(expenseId);
  return (
    <ObjectEditorAccess
      id={expenseId}
      kind="expense"
      resource={expense}
      access={access}
      onClose={onClose}
    >
      {(resource, refresh) => (
        <ExpenseForm
          key={expenseId}
          eventId={eventId}
          expense={resource}
          onCancel={onClose}
          onRefresh={refresh}
          sections={sections}
          start={start}
        />
      )}
    </ObjectEditorAccess>
  );
}
