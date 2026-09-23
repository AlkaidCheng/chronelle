import type {
  EventComponent,
  EventResponse,
  ExpenseResponse,
  HourCycle,
  ReminderResponse,
  SectionResponse,
  TaskResponse,
  TimelineResponse,
} from "@chronelle/schemas";
import { Button, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";

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
import { useUpdateEventTask } from "../../tasks/queries";
import {
  componentLabel,
  isPlanningComponentKind,
  type PlanningComponentKind,
} from "./catalog";
import { usePlanningProjection } from "./queries";

interface DisplayPreferences {
  readonly hourCycle: HourCycle | null;
  readonly locale: AppLocale;
  readonly timeZone: string | null;
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
}

const taskStatusKeys = {
  todo: "taskTodo",
  in_progress: "taskInProgress",
  done: "taskDone",
  cancelled: "taskCancelled",
} as const satisfies Record<TaskResponse["status"], MessageKey>;

const reminderStatusKeys = {
  pending: "reminderPending",
  triggered: "reminderTriggered",
  dismissed: "reminderDismissed",
  cancelled: "reminderCancelled",
} as const satisfies Record<ReminderResponse["status"], MessageKey>;

function taskWhen(
  task: TaskResponse,
  preferences: DisplayPreferences,
): string | null {
  if (task.dueOn !== null)
    return formatCalendarDate(task.dueOn, preferences.locale);
  if (task.dueAt !== null) return formatInstant(task.dueAt, preferences);
  return null;
}

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

function TaskRows({
  canEdit,
  eventId,
  items,
  preferences,
  sections,
  workspaceId,
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly items: readonly TaskResponse[];
  readonly preferences: DisplayPreferences;
  readonly sections: readonly SectionResponse[];
  readonly workspaceId: string;
}) {
  const messages = getMessages(preferences.locale);
  const update = useUpdateEventTask(workspaceId, eventId);
  const editorUrl = (taskId?: string) =>
    `/features/task-editor/index?eventId=${encodeURIComponent(eventId)}${
      taskId === undefined ? "" : `&taskId=${encodeURIComponent(taskId)}`
    }`;
  async function toggle(task: TaskResponse): Promise<void> {
    if (update.isPending) return;
    try {
      const done = task.status === "done";
      await update.mutateAsync({
        id: task.id,
        input: {
          completedAt: done ? null : new Date().toISOString(),
          expectedVersion: task.version,
          status: done ? "todo" : "done",
        },
      });
    } catch {
      await Taro.showToast({ icon: "none", title: messages.taskSaveFailed });
    }
  }
  return (
    <View className="task-projection">
      {canEdit ? (
        <View className="task-projection__toolbar">
          <Button
            className="text-button text-button--primary"
            disabled={update.isPending}
            onClick={() => void Taro.navigateTo({ url: editorUrl() })}
          >
            {messages.addTask}
          </Button>
        </View>
      ) : null}
      {items.length === 0 ? <EmptyRows locale={preferences.locale} /> : null}
      {items.map((task) => {
        const section = sectionName(task.sectionId, sections);
        const status = messages[taskStatusKeys[task.status]];
        const when = taskWhen(task, preferences);
        return (
          <View className="task-row" key={task.id}>
            {canEdit ? (
              <Button
                aria-label={
                  task.status === "done"
                    ? messages.reopenTask
                    : messages.completeTask
                }
                className={
                  task.status === "done"
                    ? "task-check task-check--done"
                    : "task-check"
                }
                disabled={update.isPending}
                onClick={() => void toggle(task)}
              >
                {task.status === "done" ? "✓" : ""}
              </Button>
            ) : null}
            <Button
              className="task-row__content"
              disabled={!canEdit || update.isPending}
              onClick={() => void Taro.navigateTo({ url: editorUrl(task.id) })}
            >
              <Row
                detail={[status, when].filter(Boolean).join(" · ")}
                eyebrow={section}
                title={task.displayName}
              />
            </Button>
          </View>
        );
      })}
    </View>
  );
}

function ExpenseRows({
  items,
  preferences,
  sections,
}: {
  readonly items: readonly ExpenseResponse[];
  readonly preferences: DisplayPreferences;
  readonly sections: readonly SectionResponse[];
}) {
  if (items.length === 0) return <EmptyRows locale={preferences.locale} />;
  return items.map((expense) => (
    <Row
      detail={`${expense.currency} ${expense.amount} · ${formatInstant(
        expense.occurredAt,
        preferences,
      )}`}
      eyebrow={sectionName(expense.sectionId, sections)}
      key={expense.id}
      title={expense.displayName}
    />
  ));
}

function ReminderRows({
  items,
  preferences,
}: {
  readonly items: readonly ReminderResponse[];
  readonly preferences: DisplayPreferences;
}) {
  const messages = getMessages(preferences.locale);
  if (items.length === 0) return <EmptyRows locale={preferences.locale} />;
  return items.map((reminder) => (
    <Row
      detail={`${messages[reminderStatusKeys[reminder.status]]} · ${formatInstant(
        reminder.remindAt,
        preferences,
      )}`}
      key={reminder.id}
      title={reminder.displayName}
    />
  ));
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
  preferences,
  workspaceId,
}: {
  readonly canEditResources: boolean;
  readonly eventId: string;
  readonly kind: PlanningComponentKind;
  readonly preferences: DisplayPreferences;
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
        <TaskRows
          canEdit={canEditResources}
          eventId={eventId}
          items={projection.data.value.items}
          preferences={preferences}
          sections={projection.data.value.sections}
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
          items={projection.data.value.items}
          preferences={preferences}
          sections={projection.data.value.sections}
        />
      );
    case "reminders":
      return (
        <ReminderRows
          items={projection.data.value.items}
          preferences={preferences}
        />
      );
  }
}

export function ProjectionCard(props: ProjectionCardProps) {
  const messages = getMessages(props.preferences.locale);
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
            preferences={props.preferences}
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
