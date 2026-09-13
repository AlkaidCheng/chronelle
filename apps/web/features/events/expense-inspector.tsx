"use client";

import { type ReactNode, useEffect, useState } from "react";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { useExpenseEditorQueries } from "../../lib/queries";
import { useEditorDraftStore } from "../../lib/editor-draft-context";
import { isTemporaryReadError } from "../../lib/query-errors";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { ExpenseForm } from "./expense-form";

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
  const drafts = useEditorDraftStore();
  const [approved, setApproved] = useState(false);
  const queries = [expense, access];
  const failure = queries.find((query) => query.isError);
  const denied =
    (access.data !== undefined && !access.data.actions.includes("edit")) ||
    queries.some(
      (query) => query.isError && !isTemporaryReadError(query.error),
    );
  const verified =
    !denied &&
    !failure &&
    expense.isFetchedAfterMount &&
    access.isFetchedAfterMount;
  if (verified && !approved) setApproved(true);
  useEffect(() => {
    if (denied) drafts.forget(expenseId);
  }, [denied, drafts, expenseId]);

  async function refresh() {
    await Promise.all(
      queries.map((query) => query.refetch({ throwOnError: true })),
    );
  }

  if (!denied && (approved || verified) && expense.data && access.data)
    return (
      <ExpenseForm
        key={expenseId}
        eventId={eventId}
        expense={expense.data}
        onCancel={onClose}
        onRefresh={refresh}
      />
    );

  return (
    <ExpenseInspectorStatus onClose={onClose}>
      {denied ? (
        <p role="alert">This expense is no longer available to edit.</p>
      ) : failure ? (
        <ErrorNotice
          error={failure.error}
          isRefreshing={queries.some((query) => query.isFetching)}
          onRefresh={() => {
            for (const query of queries) void query.refetch();
          }}
        />
      ) : (
        <LoadingState label="Checking expense access" />
      )}
    </ExpenseInspectorStatus>
  );
}

function ExpenseInspectorStatus({
  children,
  onClose,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  const dialog = useSessionDialog(onClose);
  return (
    <dialog
      ref={dialog}
      className="event-create-dialog"
      aria-label="Edit expense"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="event-create-header">
        <h2>Edit expense</h2>
        <button
          className="dialog-close"
          type="button"
          aria-label="Close expense editor"
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body">{children}</div>
    </dialog>
  );
}
