"use client";

import type { ExpenseResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { type FormEvent, useMemo, useState } from "react";
import { CountedField } from "../../components/counted-field";
import { EditorForm } from "../../components/editor-form";
import {
  DiscardActions,
  EditorDialogHeader,
} from "../../components/editor-dialog-controls";
import { EditorControls, useConflictSlot } from "./editor-controls";
import {
  readExpenseFields,
  expenseFieldsPayload,
} from "../../lib/expense-fields";
import { shownTimeZone } from "../../i18n/active-preferences";
import {
  eventCreationDraftKeys,
  type ExpenseDraftSnapshot,
} from "../../lib/editor-draft-store";
import { useKeepEditorDraft } from "../../lib/editor-draft-context";
import {
  EditorDraftRecovery,
  EditorDraftStatus,
} from "./editor-draft-recovery";
import { usePlanningEditorDialog } from "../../lib/use-planning-editor-dialog";
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
  const conflictSlot = useConflictSlot();
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
  const t = useTranslations("expenseForm");
  const editor = useTranslations("editor");
  const [timeError, setTimeError] = useState("");
  const openHistory = useOpenHistory();
  const close = () => {
    recovery.discard();
    onCancel?.();
  };
  const {
    headingId,
    nameInput,
    dialog,
    rememberSubmit,
    isConfirming,
    keepEditingButton,
    keepEditing,
    requestClose,
  } = usePlanningEditorDialog({
    isDirty: draft.isDirty,
    mutation,
    onClose: close,
  });

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
      setTimeError(error instanceof Error ? error.message : t("checkTime"));
      return;
    }
    rememberSubmit(formEvent.currentTarget);
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
            ? t("discardTitle")
            : expense
              ? t("editTitle")
              : t("addTitle")
        }
        closeLabel={t("close")}
        isConfirming={isConfirming}
        isPending={mutation.isPending}
        onClose={requestClose}
      >
        {expense && (
          <button
            hidden={isConfirming}
            className="button button-quiet button-small"
            type="button"
            aria-label={t("viewHistory")}
            disabled={mutation.isPending}
            onClick={() =>
              openHistory({
                objectId: expense.id,
                displayName: expense.displayName,
              })
            }
          >
            {editor("history")}
          </button>
        )}
      </EditorDialogHeader>
      {isConfirming && (
        <div className="event-create-body">
          <p>{t("unsaved")}</p>
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
          <div className="editor-conflict-slot" ref={conflictSlot.ref} />
          <CountedField
            className="field-wide"
            disabled={mutation.isPending}
            inputRef={nameInput}
            label={t("name")}
            limit={240}
            onChange={(displayName) => draft.change({ displayName })}
            placeholder={t("namePlaceholder")}
            required
            value={displayName}
          />
          <div className="form-grid money-grid">
            <label className="field">
              <span>{t("amount")}</span>
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
              <span>{t("currency")}</span>
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
            <span>{t("date")}</span>
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
            {t("timeIn", { zone: shownTimeZone().replaceAll("_", " ") })}
          </p>
          {timeError && <p role="alert">{timeError}</p>}
        </div>
        <footer className="event-inspector-footer">
          <EditorControls
            conflict={
              expense === undefined
                ? undefined
                : { objectId: expense.id, slot: conflictSlot.slot }
            }
            disabled={!recovery.isRetained}
            draft={draft}
            mutation={mutation}
            onCancel={requestClose}
            onRefresh={
              expense === undefined ? undefined : (onRefresh ?? refresh)
            }
            submitLabel={expense === undefined ? t("create") : t("save")}
          />
          <EditorDraftStatus
            {...recovery}
            failureMessage={
              expense === undefined
                ? editor("failureRetry")
                : editor("failureRefresh")
            }
          />
        </footer>
      </EditorForm>
    </dialog>
  );
}
