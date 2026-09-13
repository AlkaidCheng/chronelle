"use client";

import { useExpenseEditorQueries } from "../../lib/queries";
import { ExpenseForm } from "./expense-form";
import { ObjectEditorAccess } from "./object-editor-access";

export function ExpenseInspector({
  eventId,
  expenseId,
  onClose,
}: {
  readonly eventId: string;
  readonly expenseId: string;
  readonly onClose: () => void;
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
        />
      )}
    </ObjectEditorAccess>
  );
}
