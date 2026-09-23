import type {
  EventComponent,
  EventResponse,
  ExpenseResponse,
  HourCycle,
  ReminderResponse,
  SectionResponse,
  TimelineResponse,
  WeekStart,
} from "@chronelle/schemas";
import { Button, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState } from "react";

import {
  formatCalendarDate,
  formatEventSchedule,
  formatInstant,
} from "../../events/format";
import {
  getMessages,
  type AppLocale,
  type MessageKey,
} from "../../i18n/catalog";
import { taskViewOf, type TaskView } from "../../tasks/presentations";
import {
  componentLabel,
  isPlanningComponentKind,
  type PlanningComponentKind,
} from "./catalog";
import { usePlanningProjection } from "./queries";
import { TaskPresentation } from "./task-presentation";

interface DisplayPreferences {
  readonly hourCycle: HourCycle | null;
  readonly locale: AppLocale;
  readonly timeZone: string | null;
  readonly weekStart: WeekStart | null;
}

interface CardControls {
  readonly canArrange: boolean;
  readonly canMoveEarlier: boolean;
  readonly canMoveLater: boolean;
  readonly disabled: boolean;
  readonly onMoveEarlier: () => void;
  readonly onMoveLater: () => void;
  readonly onRemove: () => void;
}

interface ProjectionCardProps extends CardControls {
  readonly canEditResources: boolean;
  readonly component: EventComponent;
  readonly eventId: string;
  readonly preferences: DisplayPreferences;
  readonly workspaceId: string;
  readonly onChangeView: (view: TaskView) => void;
}

const reminderStatusKeys = {
  pending: "reminderPending",
  triggered: "reminderTriggered",
  dismissed: "reminderDismissed",
  cancelled: "reminderCancelled",
} as const satisfies Record<ReminderResponse["status"], MessageKey>;

function sectionName(
  sectionId: string | null,
  sections: readonly SectionResponse[],
): string | null {
  if (sectionId === null) return null;
  return sections.find((section) => section.id === sectionId)?.name ?? null;
}

function Row({
  detail,
  eyebrow,
  title,
}: {
  readonly detail?: string | null | undefined;
  readonly eyebrow?: string | null | undefined;
  readonly title: string;
}) {
  return (
    <View className="projection-row">
      {eyebrow ? (
        <Text className="projection-row__eyebrow">{eyebrow}</Text>
      ) : null}
      <Text className="projection-row__title">{title}</Text>
      {detail ? <Text className="projection-row__detail">{detail}</Text> : null}
    </View>
  );
}

function EmptyRows({ locale }: { readonly locale: AppLocale }) {
  return (
    <Text className="projection-empty">{getMessages(locale).noItems}</Text>
  );
}

function EventRows({
  items,
  preferences,
}: {
  readonly items: readonly EventResponse[];
  readonly preferences: DisplayPreferences;
}) {
  if (items.length === 0) return <EmptyRows locale={preferences.locale} />;
  return items.map((event) => (
    <Row
      detail={
        formatEventSchedule(event, preferences) ??
        getMessages(preferences.locale).unscheduled
      }
      key={event.id}
      title={event.displayName}
    />
  ));
}

function ExpenseRows({
  canEdit,
  eventId,
  items,
  preferences,
  sections,
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly items: readonly ExpenseResponse[];
  readonly preferences: DisplayPreferences;
  readonly sections: readonly SectionResponse[];
}) {
  const messages = getMessages(preferences.locale);
  const editorUrl = (id?: string) =>
    `/features/expense-editor/index?eventId=${encodeURIComponent(eventId)}${id ? `&expenseId=${encodeURIComponent(id)}` : ""}`;
  return (
    <>
      {items.length === 0 ? <EmptyRows locale={preferences.locale} /> : null}
      {items.map((expense) => {
        const row = (
          <Row
            detail={`${expense.currency} ${expense.amount} · ${formatInstant(expense.occurredAt, preferences)}`}
            eyebrow={sectionName(expense.sectionId, sections)}
            key={expense.id}
            title={expense.displayName}
          />
        );
        return canEdit ? (
          <Button
            className="projection-row-button"
            key={expense.id}
            onClick={() => void Taro.navigateTo({ url: editorUrl(expense.id) })}
          >
            {row}
          </Button>
        ) : (
          <View key={expense.id}>{row}</View>
        );
      })}
      {canEdit ? (
        <Button
          className="text-button"
          onClick={() => void Taro.navigateTo({ url: editorUrl() })}
        >
          {messages.addExpense}
        </Button>
      ) : null}
    </>
  );
}

function ReminderRows({
  canEdit,
  eventId,
  items,
  preferences,
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly items: readonly ReminderResponse[];
  readonly preferences: DisplayPreferences;
}) {
  const messages = getMessages(preferences.locale);
  const editorUrl = (id?: string) =>
    `/features/reminder-editor/index?eventId=${encodeURIComponent(eventId)}${id ? `&reminderId=${encodeURIComponent(id)}` : ""}`;
  return (
    <>
      {items.length === 0 ? <EmptyRows locale={preferences.locale} /> : null}
      {items.map((reminder) => {
        const row = (
          <Row
            detail={`${messages[reminderStatusKeys[reminder.status]]} · ${formatInstant(
              reminder.remindAt,
              preferences,
            )}`}
            key={reminder.id}
            title={reminder.displayName}
          />
        );
        return canEdit ? (
          <Button
            className="projection-row-button"
            key={reminder.id}
            onClick={() =>
              void Taro.navigateTo({ url: editorUrl(reminder.id) })
            }
          >
            {row}
          </Button>
        ) : (
          <View key={reminder.id}>{row}</View>
        );
      })}
      {canEdit ? (
        <Button
          className="text-button"
          onClick={() => void Taro.navigateTo({ url: editorUrl() })}
        >
          {messages.addReminder}
        </Button>
      ) : null}
    </>
  );
}

function TimelineRows({
  items,
  preferences,
}: {
  readonly items: TimelineResponse["items"];
  readonly preferences: DisplayPreferences;
}) {
  if (items.length === 0) return <EmptyRows locale={preferences.locale} />;
  return items.map((item) => (
    <Row
      detail={
        item.occursOn !== null
          ? formatCalendarDate(item.occursOn, preferences.locale)
          : item.occursAt !== null
            ? formatInstant(item.occursAt, preferences)
            : getMessages(preferences.locale).unscheduled
      }
      eyebrow={componentLabel(
        item.objectType === "task"
          ? "todos"
          : item.objectType === "expense"
            ? "expenses"
            : item.objectType === "reminder"
              ? "reminders"
              : "calendar",
        preferences.locale,
      )}
      key={`${item.objectType}:${item.canonicalObjectId}`}
      title={item.displayName}
    />
  ));
}

function CardActions({
  canArrange,
  canMoveEarlier,
  canMoveLater,
  disabled,
  locale,
  onMoveEarlier,
  onMoveLater,
  onRemove,
}: CardControls & { readonly locale: AppLocale }) {
  if (!canArrange) return null;
  const messages = getMessages(locale);
  return (
    <View className="component-actions">
      <Button
        aria-label={messages.moveEarlier}
        className="icon-button"
        disabled={disabled || !canMoveEarlier}
        onClick={onMoveEarlier}
      >
        ↑
      </Button>
      <Button
        aria-label={messages.moveLater}
        className="icon-button"
        disabled={disabled || !canMoveLater}
        onClick={onMoveLater}
      >
        ↓
      </Button>
      <Button
        aria-label={messages.removeComponent}
        className="icon-button icon-button--danger"
        disabled={disabled}
        onClick={onRemove}
      >
        ×
      </Button>
    </View>
  );
}

function ProjectionBody({
  canEditResources,
  eventId,
  kind,
  onChangeView,
  preferences,
  view,
  viewSaving,
  workspaceId,
}: {
  readonly canEditResources: boolean;
  readonly eventId: string;
  readonly kind: PlanningComponentKind;
  readonly onChangeView: (view: TaskView) => void;
  readonly preferences: DisplayPreferences;
  readonly view: TaskView;
  readonly viewSaving: boolean;
  readonly workspaceId: string;
}) {
  const messages = getMessages(preferences.locale);
  const projection = usePlanningProjection(workspaceId, eventId, kind);
  if (projection.isPending)
    return <Text className="projection-empty">{messages.loading}</Text>;
  if (projection.isError || projection.data === undefined) {
    return (
      <View className="projection-error">
        <Text>{messages.errorDetail}</Text>
        <Button
          className="text-button"
          onClick={() => void projection.refetch()}
        >
          {messages.retry}
        </Button>
      </View>
    );
  }
  switch (projection.data.kind) {
    case "todos":
      return (
        <TaskPresentation
          canEdit={canEditResources}
          eventId={eventId}
          items={projection.data.value.items}
          onChangeView={onChangeView}
          preferences={preferences}
          sections={projection.data.value.sections}
          view={view}
          viewSaving={viewSaving}
          workspaceId={workspaceId}
        />
      );
    case "calendar":
    case "itinerary":
      return (
        <EventRows
          items={projection.data.value.items}
          preferences={preferences}
        />
      );
    case "timeline":
      return (
        <TimelineRows
          items={projection.data.value.items}
          preferences={preferences}
        />
      );
    case "expenses":
      return (
        <ExpenseRows
          canEdit={canEditResources}
          eventId={eventId}
          items={projection.data.value.items}
          preferences={preferences}
          sections={projection.data.value.sections}
        />
      );
    case "reminders":
      return (
        <ReminderRows
          canEdit={canEditResources}
          eventId={eventId}
          items={projection.data.value.items}
          preferences={preferences}
        />
      );
  }
}

export function ProjectionCard(props: ProjectionCardProps) {
  const messages = getMessages(props.preferences.locale);
  const [localView, setLocalView] = useState<TaskView | null>(null);
  const view = props.canEditResources
    ? taskViewOf(props.component)
    : (localView ?? taskViewOf(props.component));
  return (
    <View className="component-card">
      <View className="component-card__header">
        <Text className="component-card__title">
          {componentLabel(props.component.kind, props.preferences.locale)}
        </Text>
        <CardActions {...props} locale={props.preferences.locale} />
      </View>
      <View className="component-card__body">
        {isPlanningComponentKind(props.component.kind) ? (
          <ProjectionBody
            canEditResources={props.canEditResources}
            eventId={props.eventId}
            kind={props.component.kind}
            onChangeView={(next) =>
              props.canEditResources
                ? props.onChangeView(next)
                : setLocalView(next)
            }
            preferences={props.preferences}
            view={view}
            viewSaving={props.disabled}
            workspaceId={props.workspaceId}
          />
        ) : (
          <Text className="projection-empty">
            {messages.componentUnavailable}
          </Text>
        )}
      </View>
    </View>
  );
}
