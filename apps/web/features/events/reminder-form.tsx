"use client";

import type { ReminderResponse } from "@chronelle/schemas";
import type { FormEvent } from "react";

import { EditorForm } from "../../components/editor-form";
import { EditorControls } from "./editor-controls";
import { fromDateTimeInput, toDateTimeInput } from "../../lib/format";
import { useEditorDraft } from "../../lib/use-editor-draft";
import {
  useCreateReminder,
  useRefreshEvent,
  useUpdateReminder,
} from "../../lib/queries";

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
