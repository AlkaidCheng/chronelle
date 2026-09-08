"use client";

import type {
  EventResponse,
  ExpenseResponse,
  ReminderResponse,
  TaskResponse,
} from "@chronelle/schemas";
import { type FormEvent, useId, useState } from "react";

import { EventScheduleFields } from "./event-schedule-fields";
import {
  readEventSchedule,
  eventSchedulePayload,
} from "../../lib/event-schedule";

import { EditorControls } from "./editor-controls";
import { fromDateTimeInput, toDateTimeInput } from "../../lib/format";
import { useEditorDraft } from "../../lib/use-editor-draft";
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

export function EventEditorForm({
  event: latestEvent,
  onCancel,
}: {
  readonly event: EventResponse;
  readonly onCancel?: (() => void) | undefined;
}) {
  const draft = useEditorDraft(latestEvent, (event) => ({
    displayName: event?.displayName ?? "",
    ...readEventSchedule(event),
  }));
  const event = draft.source ?? latestEvent;
  const nameId = useId();
  const update = useUpdateEvent();
  const refresh = useRefreshEvent(event.id);
  const { displayName } = draft.fields;
  const [scheduleError, setScheduleError] = useState("");

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (draft.hasNewerVersion || update.isPending) return;
    let schedule: ReturnType<typeof eventSchedulePayload>;
    try {
      schedule = eventSchedulePayload(draft.fields);
      setScheduleError("");
    } catch (error) {
      setScheduleError(
        error instanceof Error ? error.message : "Check the schedule.",
      );
      return;
    }
    update.mutate(
      {
        id: event.id,
        input: {
          displayName,
          ...schedule,
          expectedVersion: event.version,
          isAllDay: draft.fields.mode === "timed" && event.isAllDay,
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
          onChange={(input) =>
            draft.change({ displayName: input.target.value })
          }
          required
          value={displayName}
        />
      </label>
      <EventScheduleFields
        value={draft.fields}
        onChange={draft.change}
        disabled={update.isPending}
      />
      {scheduleError && <p role="alert">{scheduleError}</p>}
      <EditorControls
        draft={draft}
        mutation={update}
        onCancel={onCancel}
        onRefresh={refresh}
        submitLabel="Save event"
      />
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
  const draft = useEditorDraft(latestEvent, (event) => ({
    displayName: event?.displayName ?? "",
    ...(event
      ? readEventSchedule(event)
      : {
          ...readEventSchedule(),
          mode: "dates" as const,
        }),
  }));
  const event = draft.source;
  const create = useCreateScheduledEvent(eventId);
  const update = useUpdateEvent();
  const refresh = useRefreshEvent(eventId);
  const { displayName } = draft.fields;
  const [scheduleError, setScheduleError] = useState("");

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (draft.hasNewerVersion || mutation.isPending) return;
    let schedule: ReturnType<typeof eventSchedulePayload>;
    try {
      schedule = eventSchedulePayload(draft.fields);
      setScheduleError("");
    } catch (error) {
      setScheduleError(
        error instanceof Error ? error.message : "Check the schedule.",
      );
      return;
    }
    const input = {
      displayName,
      ...schedule,
      isAllDay: draft.fields.mode === "timed" && (event?.isAllDay ?? false),
      timezone:
        event === undefined
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : event.timezone,
    };
    if (event === undefined) {
      create.mutate(input, {
        onSuccess: () => {
          draft.change({ displayName: "", ...readEventSchedule() });
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
          onChange={(input) =>
            draft.change({ displayName: input.target.value })
          }
          placeholder="Guest arrival"
          required
          value={displayName}
        />
      </label>
      <EventScheduleFields
        value={draft.fields}
        onChange={draft.change}
        disabled={mutation.isPending}
      />
      {scheduleError && <p role="alert">{scheduleError}</p>}
      <EditorControls
        draft={draft}
        mutation={mutation}
        onCancel={onCancel}
        onRefresh={event === undefined ? undefined : refresh}
        submitLabel={event === undefined ? "Add to schedule" : "Save item"}
      />
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
  const draft = useEditorDraft(latestTask, (task) => ({
    displayName: task?.displayName ?? "",
    dueAt: toDateTimeInput(task?.dueAt ?? null),
  }));
  const task = draft.source;
  const create = useCreateTask(eventId);
  const update = useUpdateTask();
  const refresh = useRefreshEvent(eventId);
  const { displayName, dueAt } = draft.fields;

  function handleSubmit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    if (draft.hasNewerVersion || mutation.isPending) return;
    const input = { displayName, dueAt: fromDateTimeInput(dueAt) };
    if (task === undefined) {
      create.mutate(input, {
        onSuccess: () => {
          draft.change({ displayName: "", dueAt: "" });
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
          onChange={(input) =>
            draft.change({ displayName: input.target.value })
          }
          placeholder="Confirm the guest list"
          required
          value={displayName}
        />
      </label>
      <label className="field">
        <span>Due</span>
        <input
          disabled={mutation.isPending}
          onChange={(input) => draft.change({ dueAt: input.target.value })}
          type="datetime-local"
          value={dueAt}
        />
      </label>
      <EditorControls
        draft={draft}
        mutation={mutation}
        onCancel={onCancel}
        onRefresh={task === undefined ? undefined : refresh}
        submitLabel={task === undefined ? "Add task" : "Save task"}
      />
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
  const refresh = useRefreshEvent(eventId);
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
    <form className="editor-form inline-editor" onSubmit={handleSubmit}>
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
  const draft = useEditorDraft(latestReminder, (reminder) => ({
    displayName: reminder?.displayName ?? "",
    remindAt: toDateTimeInput(reminder?.remindAt ?? null),
  }));
  const reminder = draft.source;
  const create = useCreateReminder(eventId);
  const update = useUpdateReminder();
  const refresh = useRefreshEvent(eventId);
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
    <form className="editor-form inline-editor" onSubmit={handleSubmit}>
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
    </form>
  );
}
