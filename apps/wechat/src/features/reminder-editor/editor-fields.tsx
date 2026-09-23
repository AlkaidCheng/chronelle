import { Input, Picker, Text, View } from "@tarojs/components";

import { EditorFieldLabel } from "../../components/editor";
import type { ReminderEditorFields } from "../../reminders/editor";
import { getMessages, type AppLocale } from "../../i18n/catalog";

const statuses = ["pending", "triggered", "dismissed", "cancelled"] as const;

export function ReminderEditorFieldsForm({
  disabled,
  fields,
  locale,
  onChange,
}: {
  readonly disabled: boolean;
  readonly fields: ReminderEditorFields;
  readonly locale: AppLocale;
  readonly onChange: (fields: Partial<ReminderEditorFields>) => void;
}) {
  const messages = getMessages(locale);
  const statusLabels = [
    messages.reminderPending,
    messages.reminderTriggered,
    messages.reminderDismissed,
    messages.reminderCancelled,
  ];
  const statusIndex = statuses.indexOf(fields.status);
  return (
    <View className="editor-form">
      <View className="editor-field">
        <EditorFieldLabel>{messages.reminderName}</EditorFieldLabel>
        <Input
          className="editor-input editor-input--title"
          disabled={disabled}
          maxlength={240}
          onInput={(event) => onChange({ displayName: event.detail.value })}
          placeholder={messages.reminderNamePlaceholder}
          value={fields.displayName}
        />
      </View>
      <View className="schedule-card">
        <View className="schedule-row">
          <Picker
            disabled={disabled}
            end="2100-12-31"
            mode="date"
            onChange={(event) => onChange({ date: String(event.detail.value) })}
            start="1900-01-01"
            value={fields.date}
          >
            <View className="picker-field">
              <Text className="picker-field__label">
                {messages.reminderDate}
              </Text>
              <Text className="picker-field__value">{fields.date}</Text>
            </View>
          </Picker>
          <Picker
            disabled={disabled}
            mode="time"
            onChange={(event) => onChange({ time: String(event.detail.value) })}
            value={fields.time}
          >
            <View className="picker-field picker-field--time">
              <Text className="picker-field__label">
                {messages.reminderTime}
              </Text>
              <Text className="picker-field__value">{fields.time}</Text>
            </View>
          </Picker>
        </View>
        <View className="timezone-row">
          <Text>{messages.timeZone}</Text>
          <Text>{fields.timeZone}</Text>
        </View>
      </View>
      <View className="editor-field">
        <EditorFieldLabel>{messages.reminderStatus}</EditorFieldLabel>
        <Picker
          disabled={disabled}
          mode="selector"
          onChange={(event) => {
            const status = statuses[Number(event.detail.value)];
            if (status !== undefined) onChange({ status });
          }}
          range={statusLabels}
          value={statusIndex}
        >
          <View className="picker-field editor-picker">
            <Text className="picker-field__value">
              {statusLabels[statusIndex]}
            </Text>
          </View>
        </Picker>
      </View>
    </View>
  );
}
