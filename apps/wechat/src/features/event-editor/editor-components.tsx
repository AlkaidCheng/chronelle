import type { EventResponse, SessionResponse } from "@chronelle/schemas";
import { Button, Picker, Text, View } from "@tarojs/components";

import { EditorFieldLabel } from "../../components/editor";
import type { EventDraftSnapshot } from "../../events/draft-store";
import {
  fieldsFromEvent,
  sameEventFields,
  type EventEditorFields,
  type EventScheduleMode,
} from "../../events/editor";
import { formatEventSchedule } from "../../events/format";
import { getMessages, type AppLocale } from "../../i18n/catalog";

export function EventScheduleEditor({
  disabled,
  fields,
  locale,
  onChange,
}: {
  readonly disabled: boolean;
  readonly fields: EventEditorFields;
  readonly locale: AppLocale;
  readonly onChange: (change: Partial<EventEditorFields>) => void;
}) {
  const messages = getMessages(locale);
  const modes: readonly {
    readonly label: string;
    readonly value: EventScheduleMode;
  }[] = [
    { label: messages.scheduleUndated, value: "undated" },
    { label: messages.scheduleDates, value: "dates" },
    { label: messages.scheduleTimed, value: "timed" },
  ];
  const hasEnd = fields.endDate.length > 0;
  return (
    <View className="schedule-card">
      <EditorFieldLabel>{messages.schedule}</EditorFieldLabel>
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
                onChange({ startDate: String(event.detail.value) })
              }
              start="1900-01-01"
              value={fields.startDate}
            >
              <View className="picker-field">
                <Text className="picker-field__label">
                  {messages.startDate}
                </Text>
                <Text className="picker-field__value">{fields.startDate}</Text>
              </View>
            </Picker>
            {fields.mode === "timed" ? (
              <Picker
                disabled={disabled}
                mode="time"
                onChange={(event) =>
                  onChange({ startTime: String(event.detail.value) })
                }
                value={fields.startTime}
              >
                <View className="picker-field picker-field--time">
                  <Text className="picker-field__label">
                    {messages.startTime}
                  </Text>
                  <Text className="picker-field__value">
                    {fields.startTime}
                  </Text>
                </View>
              </Picker>
            ) : null}
          </View>

          {hasEnd ? (
            <View className="schedule-row">
              <Picker
                disabled={disabled}
                end="2100-12-31"
                mode="date"
                onChange={(event) =>
                  onChange({ endDate: String(event.detail.value) })
                }
                start={fields.startDate}
                value={fields.endDate}
              >
                <View className="picker-field">
                  <Text className="picker-field__label">
                    {messages.endDate}
                  </Text>
                  <Text className="picker-field__value">{fields.endDate}</Text>
                </View>
              </Picker>
              {fields.mode === "timed" ? (
                <Picker
                  disabled={disabled}
                  mode="time"
                  onChange={(event) =>
                    onChange({ endTime: String(event.detail.value) })
                  }
                  value={fields.endTime}
                >
                  <View className="picker-field picker-field--time">
                    <Text className="picker-field__label">
                      {messages.endTime}
                    </Text>
                    <Text className="picker-field__value">
                      {fields.endTime || fields.startTime}
                    </Text>
                  </View>
                </Picker>
              ) : null}
            </View>
          ) : null}

          <Button
            className="schedule-link"
            disabled={disabled}
            onClick={() =>
              onChange(
                hasEnd
                  ? { endDate: "", endTime: "" }
                  : {
                      endDate: fields.startDate,
                      endTime: fields.mode === "timed" ? fields.startTime : "",
                    },
              )
            }
          >
            {hasEnd ? messages.removeEnd : messages.addEnd}
          </Button>
          {fields.mode === "timed" ? (
            <View className="timezone-row">
              <Text>{messages.timeZone}</Text>
              <Text>{fields.timeZone}</Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

export function EventConflictCard({
  draft,
  latest,
  locale,
  onKeepMine,
  onUseLatest,
  pending,
  session,
}: {
  readonly draft: EventDraftSnapshot;
  readonly latest: EventResponse;
  readonly locale: AppLocale;
  readonly onKeepMine: () => void;
  readonly onUseLatest: () => void;
  readonly pending: boolean;
  readonly session: SessionResponse;
}) {
  const messages = getMessages(locale);
  const schedule = formatEventSchedule(latest, {
    hourCycle: session.user.hourCycle,
    locale,
    timeZone: session.user.timeZone,
  });
  const latestFields = fieldsFromEvent(latest, draft.fields.timeZone);
  return (
    <View className="conflict-card" role="alert">
      <Text className="conflict-card__title">{messages.conflictTitle}</Text>
      <Text className="conflict-card__detail">{messages.conflictDetail}</Text>
      <View className="conflict-current">
        <Text className="conflict-current__label">
          {messages.currentVersion}
        </Text>
        <Text className="conflict-current__name">{latest.displayName}</Text>
        {schedule ? (
          <Text className="conflict-current__date">{schedule}</Text>
        ) : null}
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
          disabled={pending || sameEventFields(draft.fields, latestFields)}
          loading={pending}
          onClick={onKeepMine}
        >
          {messages.keepMine}
        </Button>
      </View>
    </View>
  );
}
