"use client";

import type { ReactNode } from "react";

import { MonthGrid, PeriodNav, WeekStrip } from "../../components/period-views";
import type { DayKey } from "../../lib/day-placement";
import type { Period } from "../../lib/use-period";

/** How a container renders its rows: in full, wrapped for a column, or as one line for a calendar cell. */
export type RowMode = "full" | "compact" | "cell";

/**
 * A container's week or calendar: the items that have no cell (overdue,
 * undated) as strips above, the period navigation, then seven columns or
 * the month's grid over the items placed by day. The container renders
 * its own rows in every mode, so behaviour does not fork by view.
 */
export function PeriodView<Item extends { readonly id: string }>({
  notice,
  overdue = [],
  overdueLabel = "Overdue",
  period,
  placed,
  renderList,
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
  /** The rows of one day or of a strip, as the list view renders them. */
  readonly renderList: (items: readonly Item[], mode: RowMode) => ReactNode;
  readonly undated: readonly Item[];
  readonly undatedLabel: string;
  readonly view: "week" | "month";
}) {
  const { cursor, setCursor } = period;
  const strip = (label: string, tone: string, items: readonly Item[]) =>
    items.length === 0 ? null : (
      <section
        aria-label={label}
        className={`day-group day-group-strip day-group-${tone}`}
      >
        <h3 className="day-group-heading">
          <span>{label}</span>
        </h3>
        {renderList(items, "full")}
      </section>
    );
  const strips =
    overdue.length === 0 && undated.length === 0 ? null : (
      <div className="period-strips">
        {strip(overdueLabel, "overdue", overdue)}
        {strip(undatedLabel, "plain", undated)}
      </div>
    );
  return (
    <div className="period-view">
      {notice}
      {strips}
      <PeriodNav cursor={cursor} onChange={setCursor} period={view} />
      {view === "week" ? (
        <WeekStrip
          cursor={cursor}
          renderDay={(day) => {
            const items = placed.get(day) ?? [];
            return items.length === 0 ? null : renderList(items, "compact");
          }}
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
            );
          }}
        />
      )}
    </div>
  );
}
