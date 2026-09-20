"use client";

import type { ReactNode } from "react";

import { MonthGrid, PeriodNav, WeekStrip } from "../../components/period-views";
import type { DayKey } from "../../lib/day-placement";
import type { Period } from "../../lib/use-period";

/** How a container renders its rows: in full, as a card in a week's column, or as one line for a calendar cell. */
export type RowMode = "full" | "card" | "cell";

/** The group key of a strip's rows; a day's rows take the day as their key. */
export const overdueGroup = "overdue";
export const undatedGroup = "undated";

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
