import { ApiClientError } from "@livtales/api-client";
import type {
  HourCycle,
  SectionResponse,
  TaskResponse,
  WeekStart,
} from "@livtales/schemas";
import { Button, ScrollView, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState } from "react";

import { formatCalendarDate, formatInstant } from "../../events/format";
import { deviceTimeZone, supportedTimeZone } from "../../events/wall-clock";
import {
  getMessages,
  type AppLocale,
  type MessageKey,
} from "../../i18n/catalog";
import {
  groupTasksByDay,
  groupTasksBySection,
  monthDays,
  shiftPeriod,
  taskDay,
  taskViews,
  todayInZone,
  weekDays,
  type TaskView,
} from "../../tasks/presentations";
import { useUpdateEventTask } from "../../tasks/queries";
import { TaskSections } from "./task-sections";

interface Preferences {
  readonly hourCycle: HourCycle | null;
  readonly locale: AppLocale;
  readonly timeZone: string | null;
  readonly weekStart: WeekStart | null;
}

const statusKeys = {
  todo: "taskTodo",
  in_progress: "taskInProgress",
  done: "taskDone",
  cancelled: "taskCancelled",
} as const satisfies Record<TaskResponse["status"], MessageKey>;

const viewKeys = {
  list: "taskViewList",
  "by-day": "taskViewByDay",
  week: "taskViewWeek",
  board: "taskViewBoard",
  month: "taskViewMonth",
} as const satisfies Record<TaskView, MessageKey>;

const weekdayFormatters = new Map<AppLocale, Intl.DateTimeFormat>();

function weekday(day: string, locale: AppLocale): string {
  let formatter = weekdayFormatters.get(locale);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(locale, {
      timeZone: "UTC",
      weekday: "short",
    });
    weekdayFormatters.set(locale, formatter);
  }
  return formatter.format(new Date(`${day}T12:00:00.000Z`));
}

export function TaskPresentation({
  canEdit,
  eventId,
  items,
  onChangeView,
  preferences,
  sections,
  view,
  viewSaving,
  workspaceId,
}: {
  readonly canEdit: boolean;
  readonly eventId: string;
  readonly items: readonly TaskResponse[];
  readonly onChangeView: (view: TaskView) => void;
  readonly preferences: Preferences;
  readonly sections: readonly SectionResponse[];
  readonly view: TaskView;
  readonly viewSaving: boolean;
  readonly workspaceId: string;
}) {
  const messages = getMessages(preferences.locale);
  const timeZone = supportedTimeZone(
    preferences.timeZone ?? deviceTimeZone(null),
  );
  const today = todayInZone(timeZone);
  const [cursor, setCursor] = useState(today);
  const [selectedDay, setSelectedDay] = useState(today);
  const update = useUpdateEventTask(workspaceId, eventId);
  const dueGroups = groupTasksByDay(items, timeZone, today);
  const sectionGroups = groupTasksBySection(items, sections);
  const start =
    preferences.weekStart ?? (preferences.locale === "en-US" ? 7 : 1);
  const periodDays =
    view === "week"
      ? weekDays(cursor, start)
      : view === "month"
        ? monthDays(cursor, start)
        : [];
  const visibleDay = periodDays.includes(selectedDay)
    ? selectedDay
    : periodDays.includes(today)
      ? today
      : periodDays[0];
  const dueCounts = new Map<string, number>();
  for (const task of items) {
    const day = taskDay(task, timeZone);
    if (day !== null) dueCounts.set(day, (dueCounts.get(day) ?? 0) + 1);
  }

  function editorUrl(taskId?: string, sectionId?: string): string {
    const base = `/features/task-editor/index?eventId=${encodeURIComponent(eventId)}`;
    if (taskId !== undefined)
      return `${base}&taskId=${encodeURIComponent(taskId)}`;
    return sectionId === undefined
      ? base
      : `${base}&sectionId=${encodeURIComponent(sectionId)}`;
  }

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
    } catch (error) {
      await Taro.showToast({
        icon: "none",
        title:
          error instanceof ApiClientError && error.code === "version_conflict"
            ? messages.taskChanged
            : messages.taskSaveFailed,
      });
    }
  }

  function rows(tasks: readonly TaskResponse[], showSection = false) {
    return tasks.map((task) => {
      const when =
        task.dueOn !== null
          ? formatCalendarDate(task.dueOn, preferences.locale)
          : task.dueAt === null
            ? null
            : formatInstant(task.dueAt, preferences);
      const section = showSection
        ? sections.find((item) => item.id === task.sectionId)?.name
        : null;
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
            {section ? (
              <Text className="projection-row__eyebrow">{section}</Text>
            ) : null}
            <Text className="projection-row__title">{task.displayName}</Text>
            <Text className="projection-row__detail">
              {[messages[statusKeys[task.status]], when]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </Button>
        </View>
      );
    });
  }

  function group(
    title: string,
    tasks: readonly TaskResponse[],
    key: string,
    sectionId?: string,
  ) {
    return (
      <View className="task-group" key={key}>
        <View className="task-group__heading">
          <Text className="task-group__title">{title}</Text>
          <Text className="task-group__count">{tasks.length}</Text>
          {canEdit && sectionId !== undefined ? (
            <Button
              aria-label={messages.addTask}
              className="text-button"
              onClick={() =>
                void Taro.navigateTo({ url: editorUrl(undefined, sectionId) })
              }
            >
              +
            </Button>
          ) : null}
        </View>
        {tasks.length === 0 ? (
          <Text className="projection-empty">{messages.noItems}</Text>
        ) : (
          rows(tasks)
        )}
      </View>
    );
  }

  function datedTitle(day: string): string {
    return `${formatCalendarDate(day, preferences.locale)} · ${weekday(day, preferences.locale)}`;
  }

  function period(periodView: "week" | "month") {
    const first = periodDays[0];
    const last = periodDays[periodDays.length - 1];
    const title =
      periodView === "month"
        ? new Intl.DateTimeFormat(preferences.locale, {
            month: "long",
            timeZone: "UTC",
            year: "numeric",
          }).format(new Date(`${cursor.slice(0, 7)}-01T12:00:00.000Z`))
        : first && last
          ? `${formatCalendarDate(first, preferences.locale)} – ${formatCalendarDate(last, preferences.locale)}`
          : "";
    const chosen = visibleDay ?? today;
    const selected = items.filter((task) => taskDay(task, timeZone) === chosen);
    return (
      <>
        <View className="task-period__nav">
          <Button
            aria-label={messages.previousPeriod}
            className="icon-button"
            onClick={() =>
              setCursor((current) => shiftPeriod(current, periodView, -1))
            }
          >
            ←
          </Button>
          <Text className="task-period__title">{title}</Text>
          <Button
            aria-label={messages.nextPeriod}
            className="icon-button"
            onClick={() =>
              setCursor((current) => shiftPeriod(current, periodView, 1))
            }
          >
            →
          </Button>
          <Button
            className="text-button"
            onClick={() => {
              setCursor(today);
              setSelectedDay(today);
            }}
          >
            {messages.today}
          </Button>
        </View>
        <View
          className={
            periodView === "month"
              ? "task-period__days task-period__days--month"
              : "task-period__days"
          }
        >
          {periodDays.map((day) => (
            <Button
              aria-label={`${datedTitle(day)}, ${dueCounts.get(day) ?? 0}`}
              className={`task-period__day${day === chosen ? " task-period__day--selected" : ""}${day === today ? " task-period__day--today" : ""}${periodView === "month" && day.slice(0, 7) !== cursor.slice(0, 7) ? " task-period__day--outside" : ""}`}
              key={day}
              onClick={() => setSelectedDay(day)}
            >
              <Text>{weekday(day, preferences.locale)}</Text>
              <Text className="task-period__number">
                {Number(day.slice(8))}
              </Text>
              <Text className="task-period__count">
                {dueCounts.get(day) ?? ""}
              </Text>
            </Button>
          ))}
        </View>
        {group(datedTitle(chosen), selected, chosen)}
        {dueGroups.undated.length > 0
          ? group(messages.noDueDate, dueGroups.undated, "undated")
          : null}
      </>
    );
  }

  function content() {
    if (
      items.length === 0 &&
      (view === "by-day" ||
        view === "board" ||
        (view === "list" && sections.length === 0))
    )
      return <Text className="projection-empty">{messages.noItems}</Text>;
    switch (view) {
      case "list":
        return (
          <>
            {sectionGroups.loose.length > 0 || sections.length === 0
              ? group(
                  sections.length === 0
                    ? messages.allTasks
                    : messages.noSection,
                  sectionGroups.loose,
                  "loose",
                )
              : null}
            {sectionGroups.groups.map(({ section, items: tasks }) =>
              group(section.name, tasks, section.id, section.id),
            )}
          </>
        );
      case "by-day":
        return (
          <>
            {dueGroups.overdue.length > 0
              ? group(messages.overdue, dueGroups.overdue, "overdue")
              : null}
            {dueGroups.dates.map(({ day, items: tasks }) =>
              group(datedTitle(day), tasks, day),
            )}
            {dueGroups.undated.length > 0
              ? group(messages.noDueDate, dueGroups.undated, "undated")
              : null}
          </>
        );
      case "week":
      case "month":
        return period(view);
      case "board": {
        const columns = [
          ...(dueGroups.overdue.length > 0
            ? [
                {
                  key: "overdue",
                  title: messages.overdue,
                  tasks: dueGroups.overdue,
                },
              ]
            : []),
          ...dueGroups.dates.map(({ day, items: tasks }) => ({
            key: day,
            title: datedTitle(day),
            tasks,
          })),
          ...(dueGroups.undated.length > 0
            ? [
                {
                  key: "undated",
                  title: messages.noDueDate,
                  tasks: dueGroups.undated,
                },
              ]
            : []),
        ];
        return (
          <ScrollView className="task-board" scrollX showScrollbar={false}>
            <View className="task-board__track">
              {columns.map((column) => (
                <View className="task-board__column" key={column.key}>
                  {group(column.title, column.tasks, column.key)}
                </View>
              ))}
            </View>
          </ScrollView>
        );
      }
    }
  }

  return (
    <View className="task-projection">
      <ScrollView className="task-view-tabs" scrollX showScrollbar={false}>
        <View className="task-view-tabs__track">
          {taskViews.map((candidate) => (
            <Button
              aria-label={messages[viewKeys[candidate]]}
              className={
                candidate === view
                  ? "task-view-tab task-view-tab--active"
                  : "task-view-tab"
              }
              disabled={viewSaving}
              key={candidate}
              onClick={() => {
                if (candidate !== view) onChangeView(candidate);
              }}
            >
              {messages[viewKeys[candidate]]}
            </Button>
          ))}
        </View>
      </ScrollView>
      {canEdit ? (
        <>
          <View className="task-projection__toolbar">
            <Button
              className="text-button text-button--primary"
              onClick={() => void Taro.navigateTo({ url: editorUrl() })}
            >
              {messages.addTask}
            </Button>
          </View>
          <TaskSections
            eventId={eventId}
            locale={preferences.locale}
            sections={sections}
            workspaceId={workspaceId}
          />
        </>
      ) : null}
      {content()}
    </View>
  );
}
