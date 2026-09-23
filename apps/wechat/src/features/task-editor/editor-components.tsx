import type {
  SectionResponse,
  SessionResponse,
  TaskResponse,
} from "@chronelle/schemas";
import { Button, Picker, Text, View } from "@tarojs/components";

import { EditorFieldLabel } from "../../components/editor";
import { formatCalendarDate, formatInstant } from "../../events/format";
import { getMessages, type AppLocale } from "../../i18n/catalog";
import type { TaskDraftSnapshot } from "../../tasks/draft-store";
import {
  fieldsFromTask,
  sameTaskFields,
  type TaskDueMode,
  type TaskEditorFields,
} from "../../tasks/editor";

const statusValues = ["todo", "in_progress", "done", "cancelled"] as const;

export function TaskMetadataEditor({
  disabled,
  fields,
  locale,
  onChange,
  sections,
}: {
  readonly disabled: boolean;
  readonly fields: TaskEditorFields;
  readonly locale: AppLocale;
  readonly onChange: (change: Partial<TaskEditorFields>) => void;
  readonly sections: readonly SectionResponse[];
}) {
  const messages = getMessages(locale);
  const modes: readonly {
    readonly label: string;
    readonly value: TaskDueMode;
  }[] = [
    { label: messages.dueUndated, value: "undated" },
    { label: messages.dueDateOnly, value: "date" },
    { label: messages.dueTimed, value: "timed" },
  ];
  const statusLabels = [
    messages.taskTodo,
    messages.taskInProgress,
    messages.taskDone,
    messages.taskCancelled,
  ];
  const sectionLabels = [
    messages.noSection,
    ...sections.map((section) => section.name),
  ];
  const sectionIndex = Math.max(
    0,
    sections.findIndex((section) => section.id === fields.sectionId) + 1,
  );
  return (
    <>
      <View className="schedule-card">
        <EditorFieldLabel>{messages.taskDue}</EditorFieldLabel>
        <View className="mode-switch" role="radiogroup">
          {modes.map((mode) => (
            <Button
              aria-checked={fields.mode === mode.value}
              className={
                fields.mode === mode.value
                  ? "mode-switch__item mode-switch__item--active"
                  : "mode-switch__item"
              }
              disabled={disabled}
              key={mode.value}
              onClick={() => onChange({ mode: mode.value })}
            >
              {mode.label}
            </Button>
          ))}
        </View>
        {fields.mode === "undated" ? null : (
          <View className="schedule-fields">
            <View className="schedule-row">
              <Picker
                disabled={disabled}
                end="2100-12-31"
                mode="date"
                onChange={(event) =>
                  onChange({ dueDate: String(event.detail.value) })
                }
                start="1900-01-01"
                value={fields.dueDate}
              >
                <View className="picker-field">
                  <Text className="picker-field__label">
                    {messages.dueDate}
                  </Text>
                  <Text className="picker-field__value">{fields.dueDate}</Text>
                </View>
              </Picker>
              {fields.mode === "timed" ? (
                <Picker
                  disabled={disabled}
                  mode="time"
                  onChange={(event) =>
                    onChange({ dueTime: String(event.detail.value) })
                  }
                  value={fields.dueTime}
                >
                  <View className="picker-field picker-field--time">
                    <Text className="picker-field__label">
                      {messages.dueTime}
                    </Text>
                    <Text className="picker-field__value">
                      {fields.dueTime}
                    </Text>
                  </View>
                </Picker>
              ) : null}
            </View>
            {fields.mode === "timed" ? (
              <View className="timezone-row">
                <Text>{messages.timeZone}</Text>
                <Text>{fields.timeZone}</Text>
              </View>
            ) : null}
          </View>
        )}
      </View>

      <View className="editor-field">
        <EditorFieldLabel>{messages.taskStatus}</EditorFieldLabel>
        <Picker
          disabled={disabled}
          mode="selector"
          onChange={(event) => {
            const status = statusValues[Number(event.detail.value)];
            if (status !== undefined) onChange({ status });
          }}
          range={statusLabels}
          value={Math.max(0, statusValues.indexOf(fields.status))}
        >
          <View className="picker-field editor-picker">
            <Text className="picker-field__value">
              {statusLabels[Math.max(0, statusValues.indexOf(fields.status))]}
            </Text>
          </View>
        </Picker>
      </View>

      <View className="editor-field">
        <EditorFieldLabel>{messages.taskSection}</EditorFieldLabel>
        <Picker
          disabled={disabled}
          mode="selector"
          onChange={(event) => {
            const index = Number(event.detail.value);
            onChange({
              sectionId: index === 0 ? null : (sections[index - 1]?.id ?? null),
            });
          }}
          range={sectionLabels}
          value={sectionIndex}
        >
          <View className="picker-field editor-picker">
            <Text className="picker-field__value">
              {sectionLabels[sectionIndex] ?? messages.noSection}
            </Text>
          </View>
        </Picker>
      </View>
    </>
  );
}

function taskDue(
  task: TaskResponse,
  locale: AppLocale,
  session: SessionResponse,
): string | null {
  if (task.dueOn !== null) return formatCalendarDate(task.dueOn, locale);
  if (task.dueAt === null) return null;
  return formatInstant(task.dueAt, {
    hourCycle: session.user.hourCycle,
    locale,
    timeZone: session.user.timeZone,
  });
}

export function TaskConflictCard({
  draft,
  latest,
  locale,
  onKeepMine,
  onUseLatest,
  pending,
  session,
}: {
  readonly draft: TaskDraftSnapshot;
  readonly latest: TaskResponse;
  readonly locale: AppLocale;
  readonly onKeepMine: () => void;
  readonly onUseLatest: () => void;
  readonly pending: boolean;
  readonly session: SessionResponse;
}) {
  const messages = getMessages(locale);
  const latestFields = fieldsFromTask(latest, draft.fields.timeZone);
  const due = taskDue(latest, locale, session);
  return (
    <View className="conflict-card" role="alert">
      <Text className="conflict-card__title">{messages.taskConflictTitle}</Text>
      <Text className="conflict-card__detail">
        {messages.taskConflictDetail}
      </Text>
      <View className="conflict-current">
        <Text className="conflict-current__label">{messages.currentTask}</Text>
        <Text className="conflict-current__name">{latest.displayName}</Text>
        {due ? <Text className="conflict-current__date">{due}</Text> : null}
      </View>
      <View className="conflict-actions">
        <Button
          className="editor-button editor-button--secondary"
          disabled={pending}
          onClick={onUseLatest}
        >
          {messages.useLatest}
        </Button>
        <Button
          className="editor-button editor-button--primary"
          disabled={pending || sameTaskFields(draft.fields, latestFields)}
          loading={pending}
          onClick={onKeepMine}
        >
          {messages.keepMine}
        </Button>
      </View>
    </View>
  );
}
