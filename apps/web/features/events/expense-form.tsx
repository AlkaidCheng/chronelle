"use client";

import type { ExpenseResponse } from "@chronelle/schemas";
import {
  type FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { EditorForm } from "../../components/editor-form";
import {
  DiscardActions,
  EditorDialogHeader,
} from "../../components/editor-dialog-controls";
import { EditorControls } from "./editor-controls";
import {
  readExpenseFields,
  expenseFieldsPayload,
} from "../../lib/expense-fields";
import {
  eventCreationDraftKeys,
  isDraftAccessError,
  type ExpenseDraftSnapshot,
} from "../../lib/editor-draft-store";
import { useKeepEditorDraft } from "../../lib/editor-draft-context";
import {
  EditorDraftRecovery,
  EditorDraftStatus,
} from "./editor-draft-recovery";
import { useDiscardConfirmation } from "../../lib/use-discard-confirmation";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { useOpenHistory } from "../history/history-provider";
import { useEditorDraft } from "../../lib/use-editor-draft";
import {
  useCreateExpense,
  useRefreshEvent,
  useUpdateExpense,
  type ContextCreateAttempt,
} from "../../lib/queries";

interface ExpenseFormProps {
  readonly eventId: string;
  readonly onCancel?: (() => void) | undefined;
  readonly onRefresh?: (() => Promise<void>) | undefined;
  readonly expense?: ExpenseResponse | undefined;
}

export function ExpenseForm(props: ExpenseFormProps) {
  const draftId =
    props.expense?.id ?? eventCreationDraftKeys(props.eventId).expense;
  return (
    <EditorDraftRecovery
      kind="expense"
      id={draftId}
      accessId={props.expense?.id ?? props.eventId}
      onClose={() => props.onCancel?.()}
    >
      {(initialDraft) => (
        <ExpenseEditor
          {...props}
          draftId={draftId}
          initialDraft={initialDraft}
        />
      )}
    </EditorDraftRecovery>
  );
}

function ExpenseEditor({
  eventId,
  draftId,
  initialDraft,
  onCancel,
  onRefresh,
  expense: latestExpense,
}: ExpenseFormProps & {
  readonly draftId: string;
  readonly initialDraft: ExpenseDraftSnapshot | undefined;
}) {
  const draft = useEditorDraft(latestExpense, readExpenseFields, initialDraft);
  const expense = draft.source;
  const [attempt] = useState<ContextCreateAttempt>(
    () => initialDraft?.creationAttempt ?? { current: null },
  );
  const snapshot = useMemo<ExpenseDraftSnapshot>(
    () => ({
      ...draft.snapshot,
      kind: "expense",
      ...(expense === undefined ? { creationAttempt: attempt } : {}),
    }),
    [draft.snapshot, expense, attempt],
  );
  const recovery = useKeepEditorDraft(
    draftId,
    snapshot,
    draft.isDirty,
    () => onCancel?.(),
    expense?.id ?? eventId,
  );
  const create = useCreateExpense(eventId, attempt);
  const update = useUpdateExpense();
  const refresh = useRefreshEvent(eventId, { throwOnError: true });
  const { displayName, amount, currency, occurredAt } = draft.fields;
  const mutation = expense === undefined ? create : update;
  const [timeError, setTimeError] = useState("");
  const headingId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const submittedControl = useRef<HTMLElement | null>(null);
  const openHistory = useOpenHistory();
  const close = () => {
    recovery.discard();
    onCancel?.();
  };
  const dialog = useSessionDialog(close);
  const { isConfirming, keepEditingButton, keepEditing, requestClose } =
    useDiscardConfirmation({
      isDirty: draft.isDirty,
      isPending: mutation.isPending,
      onClose: close,
    });
  useEffect(() => {
    nameInput.current?.focus();
  }, []);
  useEffect(() => {
    if (
      mutation.isError &&
      !mutation.isPending &&
      !isDraftAccessError(mutation.error)
    ) {
      if (
        document.activeElement === document.body ||
        document.activeElement === dialog.current
      )
        submittedControl.current?.focus();
      submittedControl.current = null;
    }
  }, [mutation.error, mutation.isError, mutation.isPending, dialog]);

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (
      isConfirming ||
      draft.hasNewerVersion ||
      mutation.isPending ||
      !recovery.isRetained
    )
      return;
    let input: ReturnType<typeof expenseFieldsPayload>;
    try {
      input = expenseFieldsPayload(draft.fields, expense);
      setTimeError("");
    } catch (error) {
      setTimeError(
        error instanceof Error ? error.message : "Check the transaction time.",
      );
      return;
    }
    submittedControl.current =
      document.activeElement instanceof HTMLElement &&
      formEvent.currentTarget.contains(document.activeElement)
        ? document.activeElement
        : nameInput.current;
    if (expense === undefined) {
      void recovery.save(
        () => create.mutateAsync(input),
        () => {
          draft.change({ displayName: "", amount: "" });
          onCancel?.();
        },
      );
      return;
    }
    void recovery.save(
      () =>
        update.mutateAsync({
          id: expense.id,
          input: { ...input, expectedVersion: expense.version },
        }),
      (saved) => {
        draft.accept(saved);
        onCancel?.();
      },
    );
  }

  return (
    <dialog
      ref={dialog}
      className={`event-create-dialog${expense ? " event-inspector" : ""}`}
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        requestClose();
      }}
    >
      <EditorDialogHeader
        headingId={headingId}
        title={
          isConfirming
            ? "Discard expense changes?"
            : expense
              ? "Edit expense"
              : "Add expense"
        }
        closeLabel="Close expense editor"
        isConfirming={isConfirming}
        isPending={mutation.isPending}
        onClose={requestClose}
      >
        {expense && (
          <button
            hidden={isConfirming}
            className="button button-quiet button-small"
            type="button"
            aria-label="View expense history"
            disabled={mutation.isPending}
            onClick={() =>
              openHistory({
                objectId: expense.id,
                displayName: expense.displayName,
              })
            }
          >
            History
          </button>
        )}
      </EditorDialogHeader>
      {isConfirming && (
        <div className="event-create-body">
          <p>Your expense changes have not been saved.</p>
          <div className="form-actions">
            <DiscardActions
              keepEditingButton={keepEditingButton}
              onKeepEditing={keepEditing}
              onDiscard={close}
            />
          </div>
        </div>
      )}
      <EditorForm
        hidden={isConfirming}
        aria-busy={mutation.isPending}
        className="editor-form event-inspector-form"
        onChangeCapture={() => {
          setTimeError("");
          if (mutation.isSuccess) mutation.reset();
        }}
        onSubmit={handleSubmit}
      >
        <div className="event-create-body event-inspector-fields">
          <label className="field field-wide">
            <span>Expense</span>
            <input
              ref={nameInput}
              maxLength={240}
              disabled={mutation.isPending}
              onChange={(input) =>
                draft.change({ displayName: input.target.value })
              }
              placeholder="Venue deposit"
              required
              value={displayName}
            />
          </label>
          <div className="form-grid money-grid">
            <label className="field">
              <span>Amount</span>
              <input
                inputMode="decimal"
                disabled={mutation.isPending}
                onChange={(input) =>
                  draft.change({ amount: input.target.value })
                }
                pattern="-?\d{1,15}(\.\d{1,4})?"
                placeholder="0.00"
                required
                value={amount}
              />
            </label>
            <label className="field currency-field">
              <span>Currency</span>
              <input
                maxLength={3}
                minLength={3}
                disabled={mutation.isPending}
                onChange={(input) =>
                  draft.change({ currency: input.target.value.toUpperCase() })
                }
                pattern="[A-Za-z]{3}"
                required
                value={currency}
              />
            </label>
          </div>
          <label className="field">
            <span>Date</span>
            <input
              disabled={mutation.isPending}
              onChange={(input) =>
                draft.change({ occurredAt: input.target.value })
              }
              required
              type="datetime-local"
              value={occurredAt}
            />
          </label>
          <p className="field-hint">
            Transaction time in{" "}
            {Intl.DateTimeFormat()
              .resolvedOptions()
              .timeZone.replaceAll("_", " ")}
            .
          </p>
          {timeError && <p role="alert">{timeError}</p>}
        </div>
        <footer className="event-inspector-footer">
          <EditorControls
            disabled={!recovery.isRetained}
            draft={draft}
            mutation={mutation}
            onCancel={requestClose}
            onRefresh={
              expense === undefined ? undefined : (onRefresh ?? refresh)
            }
            submitLabel={
              expense === undefined ? "Record expense" : "Save expense"
            }
          />
          <EditorDraftStatus
            {...recovery}
            failureMessage={
              expense === undefined
                ? "The last save could not be confirmed. Retry unchanged fields to reuse the same save attempt."
                : "The last save could not be confirmed. Refresh latest before trying again."
            }
          />
        </footer>
      </EditorForm>
    </dialog>
  );
}
