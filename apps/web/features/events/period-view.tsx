"use client";

import type { ReactNode } from "react";

import { MonthGrid, PeriodNav, WeekStrip } from "../../components/period-views";
import { type DayKey, dayKeyOf } from "../../lib/day-placement";
import { formatCalendarDate } from "../../lib/event-schedule";
import type { Period } from "../../lib/use-period";

/**
 * A container's week or month: the period navigation, seven columns or a
 * six-week grid over the items placed by day, the selected day's rows
 * under a grid (today's while the month is the current one), and the
 * items without a day under either. The container renders its own rows
 * and cell nodes, so behaviour does not fork by view.
 */
export function PeriodView<Item extends { readonly id: string }>({
  cellOf,
  emptyDay,
  notice,
  period,
  placed,
  renderList,
  undated,
  undatedLabel,
  view,
}: {
  /** The compact node a month cell shows for one item. */
  readonly cellOf: (item: Item) => ReactNode;
  /** The hint under a month when the shown day holds nothing. */
  readonly emptyDay: string;
  readonly notice?: ReactNode;
  readonly period: Period;
  readonly placed: ReadonlyMap<DayKey, readonly Item[]>;
  /** The rows of one day or of the undated group, as the list view renders them. */
  readonly renderList: (items: readonly Item[], compact: boolean) => ReactNode;
  readonly undated: readonly Item[];
  readonly undatedLabel: string;
  readonly view: "week" | "month";
}) {
  const { cursor, selected, setCursor, setSelected } = period;
  const undatedGroup =
    undated.length === 0 ? null : (
      <section aria-label={undatedLabel} className="day-group day-group-plain">
        <h3 className="day-group-heading">
          <span>{undatedLabel}</span>
        </h3>
        {renderList(undated, false)}
      </section>
    );
  if (view === "week")
    return (
      <div className="period-view">
        {notice}
        <PeriodNav cursor={cursor} onChange={setCursor} period="week" />
        <WeekStrip
          cursor={cursor}
          renderDay={(day) => {
            const items = placed.get(day) ?? [];
            return items.length === 0 ? null : renderList(items, true);
          }}
        />
        {undatedGroup}
      </div>
    );
  const now = new Date();
  const shownDay =
    selected ??
    (cursor.getMonth() === now.getMonth() &&
    cursor.getFullYear() === now.getFullYear()
      ? dayKeyOf(now)
      : null);
  const dayItems = shownDay === null ? [] : (placed.get(shownDay) ?? []);
  return (
    <div className="period-view">
      {notice}
      <PeriodNav cursor={cursor} onChange={setCursor} period="month" />
      <MonthGrid
        cursor={cursor}
        onSelect={setSelected}
        renderItem={(day) =>
          (placed.get(day) ?? []).map((item) => ({
            key: item.id,
            node: cellOf(item),
          }))
        }
        selected={shownDay}
      />
      {shownDay === null ? (
        <p className="field-hint">Select a day to see it.</p>
      ) : (
        <section
          aria-label={formatCalendarDate(shownDay)}
          className="day-group day-group-plain"
        >
          <h3 className="day-group-heading">
            <span>{formatCalendarDate(shownDay)}</span>
          </h3>
          {dayItems.length === 0 ? (
            <p className="field-hint">{emptyDay}</p>
          ) : (
            renderList(dayItems, false)
          )}
        </section>
      )}
      {undatedGroup}
    </div>
  );
}
