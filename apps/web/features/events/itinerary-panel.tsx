"use client";

import type {
  EventComponentView,
  EventResponse,
  TaskResponse,
} from "@livtales/schemas";
import { useTranslations } from "next-intl";
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EmptyState } from "../../components/feedback";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PinIcon,
} from "../../components/icons";
import { AddRow } from "../../components/quick-add-row";
import { copyText } from "../../lib/copy-text";
import { type DayKey, dayKeyOf, today } from "../../lib/day-placement";
import {
  type DaySheet as DaySheetModel,
  dayName,
  daySheet,
  daySheetText,
  gapText,
  initialItineraryDay,
  itineraryDays,
} from "../../lib/day-sheet";
import { viewsOf } from "../../lib/event-components";
import { itinerarySheet } from "../../lib/export/sheets";
import { formatTime } from "../../lib/format";
import { usePersonsQuery, useUpdateTask } from "../../lib/queries";
import { deriveTaskTree } from "../../lib/task-tree";
import { LayoutControl, PanelHeading } from "./component-frame";
import { CreateScheduleDialog } from "./create-schedule-dialog";
import { ExportControl } from "./export-control";
import { ShareControl } from "./share-control";

/** How far a finger travels across the sheet to turn a day. */
const swipeDistance = 48;

/**
 * The Itinerary: one day at a time, the running order with start and end,
 * where each item happens, the free time between items, the tasks due
 * that day, and the items on the day that have no time yet. Day / All
 * days is the component's view; Copy day puts the shown day on the
 * clipboard as text.
 */
export function ItineraryPanel({
  canEdit,
  event,
  eventId,
  isSavingView,
  items,
  onChangeView,
  tasks,
  view = "by-day",
}: {
  readonly canEdit: boolean;
  /** The event the itinerary belongs to, for the days it turns. */
  readonly event: Pick<
    EventResponse,
    "startsOn" | "endsOn" | "startsAt" | "endsAt"
  >;
  readonly eventId: string;
  readonly isSavingView?: boolean | undefined;
  readonly items: readonly EventResponse[];
  readonly onChangeView?: ((view: EventComponentView) => void) | undefined;
  readonly tasks: readonly TaskResponse[];
  readonly view?: EventComponentView;
}) {
  const t = useTranslations("itinerary");
  const panels = useTranslations("panels");
  const views = useTranslations("views");
  const days = useMemo(() => itineraryDays(event, items), [event, items]);
  const [chosen, setChosen] = useState<DayKey | null>(null);
  const shown =
    chosen !== null && days.includes(chosen)
      ? chosen
      : initialItineraryDay(days);
  const index = days.indexOf(shown);
  const todayKey = dayKeyOf(today());
  const [isAdding, setIsAdding] = useState(false);
  const [copied, setCopied] = useState("");
  const sheets = useMemo(
    () =>
      (view === "list" ? days : [shown]).map((day) =>
        daySheet(day, items, tasks),
      ),
    [days, items, shown, tasks, view],
  );
  useEffect(() => {
    if (copied === "") return;
    const timer = setTimeout(() => setCopied(""), 3000);
    return () => clearTimeout(timer);
  }, [copied]);

  function turn(step: -1 | 1) {
    const next = days[index + step];
    if (next !== undefined) setChosen(next);
  }
  async function copyDay() {
    const sheet = sheets[0];
    if (sheet === undefined) return;
    setCopied((await copyText(daySheetText(sheet))) ? t("copied") : "");
  }

  // A horizontal swipe on the sheet turns a day, on a touch screen only.
  const press = useRef<{ id: number; x: number; y: number } | null>(null);
  function onPointerDown(pointer: ReactPointerEvent<HTMLElement>) {
    if (pointer.pointerType !== "touch") return;
    press.current = {
      id: pointer.pointerId,
      x: pointer.clientX,
      y: pointer.clientY,
    };
  }
  function onPointerUp(pointer: ReactPointerEvent<HTMLElement>) {
    const start = press.current;
    press.current = null;
    if (start === null || start.id !== pointer.pointerId) return;
    const dx = pointer.clientX - start.x;
    const dy = pointer.clientY - start.y;
    if (Math.abs(dx) < swipeDistance || Math.abs(dy) > Math.abs(dx)) return;
    turn(dx < 0 ? 1 : -1);
  }

  const viewLabel = (option: EventComponentView) =>
    option === "list" ? t("allDays") : t("day");
  const panel = useRef<HTMLElement>(null);
  return (
    <section className="planning-panel panel-column" ref={panel}>
      <PanelHeading
        action={
          <button
            className="button button-quiet button-small"
            onClick={() => void copyDay()}
            type="button"
          >
            {t("copyDay")}
          </button>
        }
        controls={
          <div className="head-controls">
            {onChangeView === undefined ? null : (
              <LayoutControl
                busy={isSavingView ?? false}
                labelOf={viewLabel}
                onChange={onChangeView}
                view={view}
                views={viewsOf("itinerary")}
              />
            )}
            <ExportControl
              eventId={eventId}
              panel={panel}
              sheet={() => itinerarySheet(sheets)}
              view="itinerary"
              viewName={views("itinerary")}
            />
            <ShareControl
              eventId={eventId}
              view="itinerary"
              viewName={views("itinerary")}
            />
          </div>
        }
        count={
          view === "list"
            ? undefined
            : t("dayOf", { n: index + 1, total: days.length })
        }
        title={views("itinerary")}
      />
      <p aria-live="polite" className="visually-hidden" role="status">
        {copied}
      </p>
      {view === "list" ? null : (
        <div className="day-sheet-nav">
          <button
            aria-label={t("previousDay")}
            className="icon-control day-sheet-turn"
            disabled={index <= 0}
            onClick={() => turn(-1)}
            type="button"
          >
            <ChevronLeftIcon />
          </button>
          <strong className="day-sheet-day">{dayName(shown)}</strong>
          <button
            aria-label={t("nextDay")}
            className="icon-control day-sheet-turn"
            disabled={index < 0 || index >= days.length - 1}
            onClick={() => turn(1)}
            type="button"
          >
            <ChevronRightIcon />
          </button>
          <button
            className="day-sheet-today"
            disabled={!days.includes(todayKey) || shown === todayKey}
            onClick={() => setChosen(todayKey)}
            type="button"
          >
            {t("today")}
          </button>
        </div>
      )}
      <div
        className="day-sheet-pages"
        onPointerCancel={() => {
          press.current = null;
        }}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        {sheets.map((sheet) => (
          <DaySheetView
            canEdit={canEdit}
            heading={view === "list" ? dayName(sheet.day) : undefined}
            key={sheet.day}
            sheet={sheet}
            tasks={tasks}
          />
        ))}
      </div>
      {canEdit ? (
        <div className="quick-add-item">
          <AddRow
            aria-haspopup="dialog"
            label={panels("addScheduleItem")}
            onOpen={() => setIsAdding(true)}
          />
        </div>
      ) : null}
      {isAdding && canEdit ? (
        <CreateScheduleDialog
          key={eventId}
          eventId={eventId}
          onClose={() => setIsAdding(false)}
        />
      ) : null}
    </section>
  );
}

function DaySheetView({
  canEdit,
  heading,
  sheet,
  tasks,
}: {
  readonly canEdit: boolean;
  /** The day line above the sheet when several days are stacked. */
  readonly heading?: string | undefined;
  readonly sheet: DaySheetModel;
  readonly tasks: readonly TaskResponse[];
}) {
  const t = useTranslations("itinerary");
  const rows = useTranslations("taskRow");
  const persons = usePersonsQuery();
  const { mutate: updateTask, isPending } = useUpdateTask();
  const progress = useMemo(() => deriveTaskTree(tasks).progress, [tasks]);
  const empty =
    sheet.allDay.length === 0 &&
    sheet.rows.length === 0 &&
    sheet.due.length === 0 &&
    sheet.untimed.length === 0;
  return (
    <section
      aria-label={dayName(sheet.day)}
      className="day-sheet"
      data-day={sheet.day}
    >
      {heading === undefined ? null : (
        <h3 className="day-sheet-heading">{heading}</h3>
      )}
      {empty ? <EmptyState title={t("empty")} /> : null}
      {sheet.allDay.length === 0 ? null : (
        <ul aria-label={t("allDay")} className="day-sheet-allday">
          {sheet.allDay.map((item) => (
            <li className="day-sheet-pill" key={item.id}>
              {item.displayName}
            </li>
          ))}
        </ul>
      )}
      {sheet.rows.length === 0 ? null : (
        <ol className="day-sheet-rows">
          {sheet.rows.map((row) =>
            "item" in row ? (
              <li
                className="day-sheet-row"
                data-now={row.now || undefined}
                key={row.item.id}
              >
                <span className="day-sheet-time">
                  {row.start}
                  {row.end === "" ? null : (
                    <span className="day-sheet-end">{row.end}</span>
                  )}
                  {row.duration === "" ? null : (
                    <span className="day-sheet-duration-folded">
                      {row.duration}
                    </span>
                  )}
                </span>
                <span className="day-sheet-copy">
                  <span className="day-sheet-name">{row.item.displayName}</span>
                  {row.item.location === null ? null : (
                    <span className="day-sheet-meta">
                      <PinIcon className="schedule-place-icon" />
                      {row.item.location}
                    </span>
                  )}
                </span>
                <span className="day-sheet-duration">{row.duration}</span>
              </li>
            ) : (
              <li className="day-sheet-gap" key={`gap-${row.beforeId}`}>
                {gapText(row.minutes)}
              </li>
            ),
          )}
        </ol>
      )}
      {sheet.due.length === 0 ? null : (
        <>
          <h4 className="day-sheet-section">{t("dueToday")}</h4>
          <ul className="day-sheet-tasks">
            {sheet.due.map((task) => {
              const isDone = task.status === "done";
              const count = progress[task.id];
              const sub =
                count !== undefined && count.total > 0
                  ? rows("subtasksDone", count)
                  : task.dueAt === null
                    ? ""
                    : t("dueAt", { time: formatTime(task.dueAt) });
              return (
                <li className="day-sheet-task" key={task.id}>
                  <button
                    aria-label={
                      isDone
                        ? rows("reopen", { name: task.displayName })
                        : rows("complete", { name: task.displayName })
                    }
                    className={`task-check${isDone ? " checked" : ""}`}
                    disabled={!canEdit || isPending}
                    onClick={() =>
                      updateTask({
                        id: task.id,
                        workspaceId: task.workspaceId,
                        input: {
                          completedAt: isDone ? null : new Date().toISOString(),
                          expectedVersion: task.version,
                          status: isDone ? "todo" : "done",
                        },
                      })
                    }
                    type="button"
                  >
                    <CheckIcon />
                  </button>
                  <span className="day-sheet-copy">
                    <span
                      className="day-sheet-name"
                      data-done={isDone || undefined}
                    >
                      {task.displayName}
                    </span>
                    {sub === "" ? null : (
                      <span className="day-sheet-meta">{sub}</span>
                    )}
                  </span>
                  <span className="day-sheet-who">
                    {task.assigneeId === null
                      ? ""
                      : (persons.data?.names.get(task.assigneeId) ?? "")}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {sheet.untimed.length === 0 ? null : (
        <>
          <h4 className="day-sheet-section">{t("untimed")}</h4>
          <ul className="day-sheet-rows">
            {sheet.untimed.map((item) => (
              <li className="day-sheet-row" key={item.id}>
                <span className="day-sheet-time day-sheet-time-none">
                  &ndash;
                </span>
                <span className="day-sheet-copy">
                  <span className="day-sheet-name">{item.displayName}</span>
                  {item.location === null ? null : (
                    <span className="day-sheet-meta">
                      <PinIcon className="schedule-place-icon" />
                      {item.location}
                    </span>
                  )}
                </span>
                <span className="day-sheet-duration" />
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
