import type { SectionResponse } from "@chronelle/schemas";
import { Input, Picker, Text, View } from "@tarojs/components";

import { EditorFieldLabel } from "../../components/editor";
import type { ExpenseEditorFields } from "../../expenses/editor";
import { getMessages, type AppLocale } from "../../i18n/catalog";

export function ExpenseEditorFieldsForm({
  disabled,
  fields,
  locale,
  onChange,
  sections,
}: {
  readonly disabled: boolean;
  readonly fields: ExpenseEditorFields;
  readonly locale: AppLocale;
  readonly onChange: (fields: Partial<ExpenseEditorFields>) => void;
  readonly sections: readonly SectionResponse[];
}) {
  const messages = getMessages(locale);
  const sectionLabels = [
    messages.noSection,
    ...sections.map((item) => item.name),
  ];
  const sectionIndex = Math.max(
    0,
    sections.findIndex((item) => item.id === fields.sectionId) + 1,
  );
  return (
    <View className="editor-form">
      <View className="editor-field">
        <EditorFieldLabel>{messages.expenseName}</EditorFieldLabel>
        <Input
          className="editor-input editor-input--title"
          disabled={disabled}
          maxlength={240}
          onInput={(event) => onChange({ displayName: event.detail.value })}
          placeholder={messages.expenseNamePlaceholder}
          value={fields.displayName}
        />
      </View>
      <View className="editor-field">
        <EditorFieldLabel>{messages.expenseAmount}</EditorFieldLabel>
        <Input
          className="editor-input"
          disabled={disabled}
          maxlength={24}
          type="text"
          onInput={(event) => onChange({ amount: event.detail.value })}
          placeholder="0.00"
          value={fields.amount}
        />
      </View>
      <View className="editor-field">
        <EditorFieldLabel>{messages.expenseCurrency}</EditorFieldLabel>
        <Input
          className="editor-input"
          disabled={disabled}
          maxlength={3}
          onInput={(event) => onChange({ currency: event.detail.value })}
          placeholder={fields.currency}
          value={fields.currency}
        />
      </View>
      <View className="schedule-card">
        <View className="schedule-row">
          <Picker
            disabled={disabled}
            mode="date"
            start="1900-01-01"
            end="2100-12-31"
            value={fields.date}
            onChange={(event) => onChange({ date: String(event.detail.value) })}
          >
            <View className="picker-field">
              <Text className="picker-field__label">
                {messages.expenseDate}
              </Text>
              <Text className="picker-field__value">{fields.date}</Text>
            </View>
          </Picker>
          <Picker
            disabled={disabled}
            mode="time"
            value={fields.time}
            onChange={(event) => onChange({ time: String(event.detail.value) })}
          >
            <View className="picker-field picker-field--time">
              <Text className="picker-field__label">
                {messages.expenseTime}
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
        <EditorFieldLabel>{messages.expenseSection}</EditorFieldLabel>
        <Picker
          disabled={disabled}
          mode="selector"
          range={sectionLabels}
          value={sectionIndex}
          onChange={(event) => {
            const index = Number(event.detail.value);
            onChange({
              sectionId: index === 0 ? null : (sections[index - 1]?.id ?? null),
            });
          }}
        >
          <View className="picker-field editor-picker">
            <Text className="picker-field__value">
              {sectionLabels[sectionIndex] ?? messages.noSection}
            </Text>
          </View>
        </Picker>
      </View>
    </View>
  );
}
