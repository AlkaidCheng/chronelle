"use client";

import type { ReactNode } from "react";

import {
  type BoardColumn,
  BoardStrip,
  MonthGrid,
  PeriodNav,
  WeekStrip,
} from "../../components/period-views";
import { type DayKey, instantDay } from "../../lib/day-placement";
import type { Period } from "../../lib/use-period";

/** How a container renders its rows: in full, as a card in a week's column, or as one line for a calendar cell. */
export type RowMode = "full" | "card" | "cell";

/** The group key of a strip's rows; a day's rows take the day as their key. */
export const overdueGroup = "overdue";
export const undatedGroup = "undated";

/**
 * The columns of a container's board: Overdue first when anything is
 * overdue, Today always, then each later or earlier day that holds
 * something in date order, the undated last. An overdue item sits in
 * Overdue alone, not in its day as well, so a column never repeats a row.
 */
export function boardColumns<Item extends { readonly id: string }>({
  overdue = [],
  overdueAction,
  overdueLabel = "",
  placed,
  today = new Date(),
  undated = [],
  undatedLabel,
}: {
  readonly overdue?: readonly Item[];
  readonly overdueAction?: ReactNode;
  readonly overdueLabel?: string;
  readonly placed: ReadonlyMap<DayKey, readonly Item[]>;
  readonly today?: Date;
  readonly undated?: readonly Item[];
  readonly undatedLabel: string;
}): BoardColumn<Item>[] {
  const todayKey = instantDay(today);
  const overdueIds = new Set(overdue.map((item) => item.id));
  const dayColumn = (day: DayKey): BoardColumn<Item> => ({
    key: day,
    day,
    items: (placed.get(day) ?? []).filter((item) => !overdueIds.has(item.id)),
    tone: day === todayKey ? "today" : "plain",
  });
  // Today leads the days; the days before it hold only what is done or
  // dismissed, so they read after the present, still in date order.
  const days = [...placed.keys()]
    .filter((day) => day !== todayKey)
    .sort()
    .map(dayColumn)
    .filter((column) => column.items.length > 0);
  return [
    ...(overdue.length === 0
      ? []
      : [
          {
            key: overdueGroup,
            day: null,
            items: overdue,
            label: overdueLabel,
            tone: "overdue" as const,
            action: overdueAction,
          },
        ]),
    dayColumn(todayKey),
    ...days,
    ...(undated.length === 0
      ? []
      : [
          {
            key: undatedGroup,
            day: null,
            items: undated,
            label: undatedLabel,
            tone: "undated" as const,
          },
        ]),
  ];
}

/**
 * A container's board: the columns of `boardColumns` scrolling sideways,
 * the rows of each rendered by the container as cards, a footer under
 * them so a column may end in an add row presetting its day.
 */
export function BoardView<Item extends { readonly id: string }>({
  columns,
  notice,
  renderFooter,
  renderList,
  rootProps,
}: {
  readonly columns: readonly BoardColumn<Item>[];
  readonly notice?: ReactNode;
  /** What a column ends with; the day is null for a strip's column. */
  readonly renderFooter?:
    ((column: BoardColumn<Item>) => ReactNode) | undefined;
  readonly renderList: (
    items: readonly Item[],
    mode: RowMode,
    groupKey: string,
  ) => ReactNode;
  readonly rootProps?:
    { readonly [attribute: `data-${string}`]: string } | undefined;
}) {
  return (
    <div className="period-view board-view" {...rootProps}>
      {notice}
      <BoardStrip
        columns={columns}
        renderColumn={(column) => renderList(column.items, "card", column.key)}
        renderFooter={renderFooter}
      />
    </div>
  );
}

/**
 * A container's week or calendar: the items that have no cell (overdue,
 * undated) as strips above, the period navigation, then seven columns or
 * the month's grid over the items placed by day. The container renders
 * its own rows in every mode, so behaviour does not fork by view; a week's
 * column gets its rows even when empty, and a footer under them, so a
 * container may make each day a drop target with an add row of its own.
 */
export function PeriodView<Item extends { readonly id: string }>({
  notice,
  overdue = [],
  overdueLabel = "Overdue",
  period,
  placed,
  renderDayFooter,
  renderList,
  rootProps,
  undated,
  undatedLabel,
  view,
}: {
  readonly notice?: ReactNode;
  /** Open items whose day has passed; shown as a strip since a past cell may be out of view. */
  readonly overdue?: readonly Item[];
  readonly overdueLabel?: string;
  readonly period: Period;
  readonly placed: ReadonlyMap<DayKey, readonly Item[]>;
  /** What a week's column ends with, under its rows. */
  readonly renderDayFooter?: ((day: DayKey) => ReactNode) | undefined;
  /**
   * The rows of one day or of a strip, as the list view renders them; the
   * group is the day, or the strip's key.
   */
  readonly renderList: (
    items: readonly Item[],
    mode: RowMode,
    groupKey: string,
  ) => ReactNode;
  /** Data attributes of the view's element, such as a drag root's. */
  readonly rootProps?:
    { readonly [attribute: `data-${string}`]: string } | undefined;
  readonly undated: readonly Item[];
  readonly undatedLabel: string;
  readonly view: "week" | "month";
}) {
  const { cursor, setCursor } = period;
  const strip = (
    label: string,
    tone: string,
    groupKey: string,
    items: readonly Item[],
  ) =>
    items.length === 0 ? null : (
      <section
        aria-label={label}
        className={`day-group day-group-strip day-group-${tone}`}
      >
        <h3 className="day-group-heading">
          <span>{label}</span>
        </h3>
        {renderList(items, "full", groupKey)}
      </section>
    );
  const strips =
    overdue.length === 0 && undated.length === 0 ? null : (
      <div className="period-strips">
        {strip(overdueLabel, "overdue", overdueGroup, overdue)}
        {strip(undatedLabel, "plain", undatedGroup, undated)}
      </div>
    );
  return (
    <div className="period-view" {...rootProps}>
      {notice}
      {strips}
      <PeriodNav cursor={cursor} onChange={setCursor} period={view} />
      {view === "week" ? (
        <WeekStrip
          cursor={cursor}
          renderDay={(day) => renderList(placed.get(day) ?? [], "card", day)}
          renderFooter={renderDayFooter}
        />
      ) : (
        <MonthGrid
          countOf={(day) => (placed.get(day) ?? []).length}
          cursor={cursor}
          renderDay={(day, limit) => {
            const items = placed.get(day) ?? [];
            return renderList(
              limit === null ? items : items.slice(0, limit),
              "cell",
              day,
            );
          }}
        />
      )}
    </div>
  );
}
