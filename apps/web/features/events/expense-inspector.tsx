"use client";

import type { SectionResponse } from "@chronelle/schemas";

import { useExpenseEditorQueries } from "../../lib/queries";
import { ExpenseForm } from "./expense-form";
import { ObjectEditorAccess } from "./object-editor-access";

export function ExpenseInspector({
  eventId,
  expenseId,
  onClose,
  sections,
}: {
  readonly eventId: string;
  readonly expenseId: string;
  readonly onClose: () => void;
  /** The sections of the Event's Expenses, offered as the expense's section. */
  readonly sections?: readonly SectionResponse[] | undefined;
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
        />
      )}
    </ObjectEditorAccess>
  );
}
