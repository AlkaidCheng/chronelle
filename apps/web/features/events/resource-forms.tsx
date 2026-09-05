"use client";

import type {
  EventResponse,
  ExpenseResponse,
  ReminderResponse,
  TaskResponse,
} from "@chronelle/schemas";
import { type FormEvent, useEffect, useId, useState } from "react";

import { DraftNotice, ErrorNotice } from "../../components/feedback";
import { fromDateTimeInput, toDateTimeInput } from "../../lib/format";
import { useEditSource } from "../../lib/use-edit-source";
import {
  useCreateExpense,
  useCreateReminder,
  useCreateScheduledEvent,
  useCreateTask,
  useRefreshEvent,
  useUpdateEvent,
  useUpdateExpense,
  useUpdateReminder,
  useUpdateTask,
} from "../../lib/queries";

interface FormActionsProps {
  readonly disabled?: boolean;
  readonly isPending: boolean;
  readonly onCancel?: (() => void) | undefined;
  readonly submitLabel: string;
}

function FormActions({
  disabled = false,
  isPending,
  onCancel,
  submitLabel,
}: FormActionsProps) {
  return (
    <div className="form-actions">
      {onCancel === undefined ? null : (
        <button
          className="button button-quiet"
          disabled={isPending}
          onClick={onCancel}
          type="button"
        >
          Cancel
        </button>
      )}
      <button
        className="button button-primary"
        disabled={disabled || isPending}
        type="submit"
      >
        {isPending ? "Saving..." : submitLabel}
      </button>
    </div>
  );
}

export function EventEditorForm({
  event: latestEvent,
  onCancel,
}: {
  readonly event: EventResponse;
  readonly onCancel?: (() => void) | undefined;
}) {
  const draft = useEditSource(latestEvent);
  const event = draft.source ?? latestEvent;
  const nameId = useId();
  const update = useUpdateEvent();
  const refresh = useRefreshEvent(event.id);
  const [displayName, setDisplayName] = useState(event.displayName);
  const [startsAt, setStartsAt] = useState(toDateTimeInput(event.startsAt));
  const [endsAt, setEndsAt] = useState(toDateTimeInput(event.endsAt));
  const [isAllDay, setIsAllDay] = useState(event.isAllDay);

  useEffect(() => {
    setDisplayName(event.displayName);
    setStartsAt(toDateTimeInput(event.startsAt));
    setEndsAt(toDateTimeInput(event.endsAt));
    setIsAllDay(event.isAllDay);
  }, [event]);

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (draft.hasNewerVersion || update.isPending) return;
    update.mutate(
      {
        id: event.id,
        input: {
          displayName,
          endsAt: fromDateTimeInput(endsAt),
          expectedVersion: event.version,
          isAllDay,
          startsAt: fromDateTimeInput(startsAt),
          timezone: event.timezone,
        },
      },
      {
        onSuccess: (saved) => {
          draft.accept(saved);
          onCancel?.();
        },
      },
    );
  }

  return (
    <form className="editor-form" onSubmit={handleSubmit}>
      <label className="field field-wide" htmlFor={nameId}>
        <span>Name</span>
        <input
          id={nameId}
          maxLength={240}
          disabled={update.isPending}
          onChange={(input) => setDisplayName(input.target.value)}
          required
          value={displayName}
        />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Starts</span>
          <input
            disabled={update.isPending}
            onChange={(input) => setStartsAt(input.target.value)}
            type="datetime-local"
            value={startsAt}
          />
        </label>
        <label className="field">
          <span>Ends</span>
          <input
            min={startsAt}
            disabled={update.isPending}
            onChange={(input) => setEndsAt(input.target.value)}
            type="datetime-local"
            value={endsAt}
          />
        </label>
      </div>
      <label className="check-field">
        <input
          checked={isAllDay}
          disabled={update.isPending}
          onChange={(input) => setIsAllDay(input.target.checked)}
          type="checkbox"
        />
        <span>All-day event</span>
      </label>
      {update.isError ? (
        <ErrorNotice
          error={update.error}
          onRefresh={() => {
            void refresh().then(() => update.reset());
          }}
        />
      ) : null}
      <FormActions
        disabled={draft.hasNewerVersion}
        isPending={update.isPending}
        onCancel={onCancel}
        submitLabel="Save event"
      />
      {draft.hasNewerVersion ? (
        <DraftNotice
          onLoadLatest={() => {
            draft.loadLatest();
            update.reset();
          }}
        />
      ) : null}
    </form>
  );
}

export function ScheduledEventForm({
  event: latestEvent,
  eventId,
  onCancel,
}: {
  readonly event?: EventResponse | undefined;
  readonly eventId: string;
  readonly onCancel?: (() => void) | undefined;
}) {
  const draft = useEditSource(latestEvent);
  const event = draft.source;
  const create = useCreateScheduledEvent(eventId);
  const update = useUpdateEvent();
  const refresh = useRefreshEvent(eventId);
  const [displayName, setDisplayName] = useState(event?.displayName ?? "");
  const [startsAt, setStartsAt] = useState(
    toDateTimeInput(event?.startsAt ?? null),
  );
  const [endsAt, setEndsAt] = useState(toDateTimeInput(event?.endsAt ?? null));

  useEffect(() => {
    setDisplayName(event?.displayName ?? "");
    setStartsAt(toDateTimeInput(event?.startsAt ?? null));
    setEndsAt(toDateTimeInput(event?.endsAt ?? null));
  }, [event]);

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (draft.hasNewerVersion || mutation.isPending) return;
    const input = {
      displayName,
      endsAt: fromDateTimeInput(endsAt),
      startsAt: fromDateTimeInput(startsAt),
      timezone:
        event === undefined
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : event.timezone,
    };
    if (event === undefined) {
      create.mutate(input, {
        onSuccess: () => {
          setDisplayName("");
          setStartsAt("");
          setEndsAt("");
          onCancel?.();
        },
      });
      return;
    }
    update.mutate(
      {
        id: event.id,
        input: { ...input, expectedVersion: event.version },
      },
      {
        onSuccess: (saved) => {
          draft.accept(saved);
          onCancel?.();
        },
      },
    );
  }

  const mutation = event === undefined ? create : update;
  return (
    <form className="editor-form" onSubmit={handleSubmit}>
      <label className="field field-wide">
        <span>Schedule item</span>
        <input
          maxLength={240}
          disabled={mutation.isPending}
          onChange={(input) => setDisplayName(input.target.value)}
          placeholder="Guest arrival"
          required
          value={displayName}
        />
      </label>
      <div className="form-grid">
        <label className="field">
          <span>Starts</span>
          <input
            disabled={mutation.isPending}
            onChange={(input) => setStartsAt(input.target.value)}
            required
            type="datetime-local"
            value={startsAt}
          />
        </label>
        <label className="field">
          <span>Ends</span>
          <input
            min={startsAt}
            disabled={mutation.isPending}
            onChange={(input) => setEndsAt(input.target.value)}
            type="datetime-local"
            value={endsAt}
          />
        </label>
      </div>
      {mutation.isError ? (
        <ErrorNotice
          error={mutation.error}
          onRefresh={
            event === undefined
              ? undefined
              : () => {
                  void refresh().then(() => mutation.reset());
                }
          }
        />
      ) : null}
      <FormActions
        disabled={draft.hasNewerVersion}
        isPending={mutation.isPending}
        onCancel={onCancel}
        submitLabel={event === undefined ? "Add to schedule" : "Save item"}
      />
      {draft.hasNewerVersion ? (
        <DraftNotice
          onLoadLatest={() => {
            draft.loadLatest();
            mutation.reset();
          }}
        />
      ) : null}
    </form>
  );
}

export function TaskForm({
  eventId,
  onCancel,
  task: latestTask,
}: {
  readonly eventId: string;
  readonly onCancel?: (() => void) | undefined;
  readonly task?: TaskResponse | undefined;
}) {
  const draft = useEditSource(latestTask);
  const task = draft.source;
  const create = useCreateTask(eventId);
  const update = useUpdateTask();
  const refresh = useRefreshEvent(eventId);
  const [displayName, setDisplayName] = useState(task?.displayName ?? "");
  const [dueAt, setDueAt] = useState(toDateTimeInput(task?.dueAt ?? null));

  useEffect(() => {
    setDisplayName(task?.displayName ?? "");
    setDueAt(toDateTimeInput(task?.dueAt ?? null));
  }, [task]);

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (draft.hasNewerVersion || mutation.isPending) return;
    const input = { displayName, dueAt: fromDateTimeInput(dueAt) };
    if (task === undefined) {
      create.mutate(input, {
        onSuccess: () => {
          setDisplayName("");
          setDueAt("");
          onCancel?.();
        },
      });
      return;
    }
    update.mutate(
      {
        id: task.id,
        input: { ...input, expectedVersion: task.version },
      },
      {
        onSuccess: (saved) => {
          draft.accept(saved);
          onCancel?.();
        },
      },
    );
  }

  const mutation = task === undefined ? create : update;
  return (
    <form className="editor-form inline-editor" onSubmit={handleSubmit}>
      <label className="field field-wide">
        <span>Task</span>
        <input
          maxLength={240}
          disabled={mutation.isPending}
          onChange={(input) => setDisplayName(input.target.value)}
          placeholder="Confirm the guest list"
          required
          value={displayName}
        />
      </label>
      <label className="field">
        <span>Due</span>
        <input
          disabled={mutation.isPending}
          onChange={(input) => setDueAt(input.target.value)}
          type="datetime-local"
          value={dueAt}
        />
      </label>
      {mutation.isError ? (
        <ErrorNotice
          error={mutation.error}
          onRefresh={
            task === undefined
              ? undefined
              : () => {
                  void refresh().then(() => mutation.reset());
                }
          }
        />
      ) : null}
      <FormActions
        disabled={draft.hasNewerVersion}
        isPending={mutation.isPending}
        onCancel={onCancel}
        submitLabel={task === undefined ? "Add task" : "Save task"}
      />
      {draft.hasNewerVersion ? (
        <DraftNotice
          onLoadLatest={() => {
            draft.loadLatest();
            mutation.reset();
          }}
        />
      ) : null}
    </form>
  );
}

export function ExpenseForm({
  eventId,
  expense: latestExpense,
  onCancel,
}: {
  readonly eventId: string;
  readonly expense?: ExpenseResponse | undefined;
  readonly onCancel?: (() => void) | undefined;
}) {
  const draft = useEditSource(latestExpense);
  const expense = draft.source;
  const create = useCreateExpense(eventId);
  const update = useUpdateExpense();
  const refresh = useRefreshEvent(eventId);
  const [displayName, setDisplayName] = useState(expense?.displayName ?? "");
  const [amount, setAmount] = useState(expense?.amount ?? "");
  const [currency, setCurrency] = useState(expense?.currency ?? "USD");
  const [occurredAt, setOccurredAt] = useState(
    toDateTimeInput(expense?.occurredAt ?? new Date().toISOString()),
  );

  useEffect(() => {
    setDisplayName(expense?.displayName ?? "");
    setAmount(expense?.amount ?? "");
    setCurrency(expense?.currency ?? "USD");
    setOccurredAt(
      toDateTimeInput(expense?.occurredAt ?? new Date().toISOString()),
    );
  }, [expense]);

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
          setDisplayName("");
          setAmount("");
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
    <form className="editor-form inline-editor" onSubmit={handleSubmit}>
      <label className="field field-wide">
        <span>Expense</span>
        <input
          maxLength={240}
          disabled={mutation.isPending}
          onChange={(input) => setDisplayName(input.target.value)}
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
            onChange={(input) => setAmount(input.target.value)}
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
            onChange={(input) => setCurrency(input.target.value.toUpperCase())}
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
          onChange={(input) => setOccurredAt(input.target.value)}
          required
          type="datetime-local"
          value={occurredAt}
        />
      </label>
      {mutation.isError ? (
        <ErrorNotice
          error={mutation.error}
          onRefresh={
            expense === undefined
              ? undefined
              : () => {
                  void refresh().then(() => mutation.reset());
                }
          }
        />
      ) : null}
      <FormActions
        disabled={draft.hasNewerVersion}
        isPending={mutation.isPending}
        onCancel={onCancel}
        submitLabel={expense === undefined ? "Record expense" : "Save expense"}
      />
      {draft.hasNewerVersion ? (
        <DraftNotice
          onLoadLatest={() => {
            draft.loadLatest();
            mutation.reset();
          }}
        />
      ) : null}
    </form>
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
  const draft = useEditSource(latestReminder);
  const reminder = draft.source;
  const create = useCreateReminder(eventId);
  const update = useUpdateReminder();
  const refresh = useRefreshEvent(eventId);
  const [displayName, setDisplayName] = useState(reminder?.displayName ?? "");
  const [remindAt, setRemindAt] = useState(
    toDateTimeInput(reminder?.remindAt ?? null),
  );

  useEffect(() => {
    setDisplayName(reminder?.displayName ?? "");
    setRemindAt(toDateTimeInput(reminder?.remindAt ?? null));
  }, [reminder]);

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
          setDisplayName("");
          setRemindAt("");
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
    <form className="editor-form inline-editor" onSubmit={handleSubmit}>
      <label className="field field-wide">
        <span>Reminder</span>
        <input
          maxLength={240}
          disabled={mutation.isPending}
          onChange={(input) => setDisplayName(input.target.value)}
          placeholder="Send final headcount"
          required
          value={displayName}
        />
      </label>
      <label className="field">
        <span>Alert at</span>
        <input
          disabled={mutation.isPending}
          onChange={(input) => setRemindAt(input.target.value)}
          required
          type="datetime-local"
          value={remindAt}
        />
      </label>
      {mutation.isError ? (
        <ErrorNotice
          error={mutation.error}
          onRefresh={
            reminder === undefined
              ? undefined
              : () => {
                  void refresh().then(() => mutation.reset());
                }
          }
        />
      ) : null}
      <FormActions
        disabled={draft.hasNewerVersion}
        isPending={mutation.isPending}
        onCancel={onCancel}
        submitLabel={reminder === undefined ? "Add reminder" : "Save reminder"}
      />
      {draft.hasNewerVersion ? (
        <DraftNotice
          onLoadLatest={() => {
            draft.loadLatest();
            mutation.reset();
          }}
        />
      ) : null}
    </form>
  );
}
