"use client";

import type { ExpenseResponse, ReminderResponse } from "@chronelle/schemas";
import type { FormEvent } from "react";

import { EditorForm } from "../../components/editor-form";
import { EditorControls } from "./editor-controls";
import { fromDateTimeInput, toDateTimeInput } from "../../lib/format";
import { useEditorDraft } from "../../lib/use-editor-draft";
import {
  useCreateExpense,
  useCreateReminder,
  useRefreshEvent,
  useUpdateExpense,
  useUpdateReminder,
} from "../../lib/queries";

export function ExpenseForm({
  eventId,
  expense: latestExpense,
  onCancel,
}: {
  readonly eventId: string;
  readonly expense?: ExpenseResponse | undefined;
  readonly onCancel?: (() => void) | undefined;
}) {
  const draft = useEditorDraft(latestExpense, (expense) => ({
    displayName: expense?.displayName ?? "",
    amount: expense?.amount ?? "",
    currency: expense?.currency ?? "USD",
    occurredAt: toDateTimeInput(
      expense?.occurredAt ?? new Date().toISOString(),
    ),
  }));
  const expense = draft.source;
  const create = useCreateExpense(eventId);
  const update = useUpdateExpense();
  const refresh = useRefreshEvent(eventId, { throwOnError: true });
  const { displayName, amount, currency, occurredAt } = draft.fields;

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (draft.hasNewerVersion || mutation.isPending) return;
    const timestamp = fromDateTimeInput(occurredAt);
    if (timestamp === null) {
      return;
    }
    const input = { amount, currency, displayName, occurredAt: timestamp };
    if (expense === undefined) {
      create.mutate(input, {
        onSuccess: () => {
          draft.change({ displayName: "", amount: "" });
          onCancel?.();
        },
      });
      return;
    }
    update.mutate(
      {
        id: expense.id,
        input: { ...input, expectedVersion: expense.version },
      },
      {
        onSuccess: (saved) => {
          draft.accept(saved);
          onCancel?.();
        },
      },
    );
  }

  const mutation = expense === undefined ? create : update;
  return (
    <EditorForm
      aria-busy={mutation.isPending}
      className="editor-form inline-editor"
      onChangeCapture={() => {
        if (mutation.isSuccess) mutation.reset();
      }}
      onSubmit={handleSubmit}
    >
      <label className="field field-wide">
        <span>Expense</span>
        <input
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
            onChange={(input) => draft.change({ amount: input.target.value })}
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
          onChange={(input) => draft.change({ occurredAt: input.target.value })}
          required
          type="datetime-local"
          value={occurredAt}
        />
      </label>
      <EditorControls
        draft={draft}
        mutation={mutation}
        onCancel={onCancel}
        onRefresh={expense === undefined ? undefined : refresh}
        submitLabel={expense === undefined ? "Record expense" : "Save expense"}
      />
    </EditorForm>
  );
}

export function ReminderForm({
  eventId,
  onCancel,
  reminder: latestReminder,
}: {
  readonly eventId: string;
  readonly onCancel?: (() => void) | undefined;
  readonly reminder?: ReminderResponse | undefined;
}) {
  const draft = useEditorDraft(latestReminder, (reminder) => ({
    displayName: reminder?.displayName ?? "",
    remindAt: toDateTimeInput(reminder?.remindAt ?? null),
  }));
  const reminder = draft.source;
  const create = useCreateReminder(eventId);
  const update = useUpdateReminder();
  const refresh = useRefreshEvent(eventId, { throwOnError: true });
  const { displayName, remindAt } = draft.fields;

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (draft.hasNewerVersion || mutation.isPending) return;
    const timestamp = fromDateTimeInput(remindAt);
    if (timestamp === null) {
      return;
    }
    const input = { displayName, remindAt: timestamp };
    if (reminder === undefined) {
      create.mutate(input, {
        onSuccess: () => {
          draft.change({ displayName: "", remindAt: "" });
          onCancel?.();
        },
      });
      return;
    }
    update.mutate(
      {
        id: reminder.id,
        input: { ...input, expectedVersion: reminder.version },
      },
      {
        onSuccess: (saved) => {
          draft.accept(saved);
          onCancel?.();
        },
      },
    );
  }

  const mutation = reminder === undefined ? create : update;
  return (
    <EditorForm
      aria-busy={mutation.isPending}
      className="editor-form inline-editor"
      onChangeCapture={() => {
        if (mutation.isSuccess) mutation.reset();
      }}
      onSubmit={handleSubmit}
    >
      <label className="field field-wide">
        <span>Reminder</span>
        <input
          maxLength={240}
          disabled={mutation.isPending}
          onChange={(input) =>
            draft.change({ displayName: input.target.value })
          }
          placeholder="Send final headcount"
          required
          value={displayName}
        />
      </label>
      <label className="field">
        <span>Alert at</span>
        <input
          disabled={mutation.isPending}
          onChange={(input) => draft.change({ remindAt: input.target.value })}
          required
          type="datetime-local"
          value={remindAt}
        />
      </label>
      <EditorControls
        draft={draft}
        mutation={mutation}
        onCancel={onCancel}
        onRefresh={reminder === undefined ? undefined : refresh}
        submitLabel={reminder === undefined ? "Add reminder" : "Save reminder"}
      />
    </EditorForm>
  );
}
