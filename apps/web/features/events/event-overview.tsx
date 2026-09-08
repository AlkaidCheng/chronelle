"use client";

import type { ReactNode } from "react";
import type { EventDetailResponse } from "@chronelle/schemas";
import {
  ArrowIcon,
  BellIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  LockIcon,
  PaperclipIcon,
  WalletIcon,
} from "../../components/icons";
import { formatDateTime } from "../../lib/format";
import { formatCalendarDate } from "../../lib/event-schedule";
import { formatMoney, sumMoneyByCurrency } from "../../lib/money";
import type { EventView } from "../../lib/event-views";
import { useClock } from "../../lib/use-clock";
import { nextPlanningItem } from "../../lib/upcoming-plan";

function OverviewCard({
  count,
  icon,
  label,
  onOpen,
}: {
  readonly count: string;
  readonly icon: ReactNode;
  readonly label: string;
  readonly onOpen: () => void;
}) {
  return (
    <button className="overview-card" onClick={onOpen} type="button">
      <span className="overview-icon">{icon}</span>
      <span>{label}</span>
      <strong>{count}</strong>
      <span aria-hidden="true" className="card-arrow">
        <ArrowIcon />
      </span>
    </button>
  );
}

export function EventOverview({
  detail,
  onOpen,
}: {
  readonly detail: EventDetailResponse;
  readonly onOpen: (view: EventView) => void;
}) {
  const now = useClock();
  const nextItem = nextPlanningItem(detail, now);
  const openTasks = detail.tasks.filter(
    (task) => task.status !== "done" && task.status !== "cancelled",
  );
  const expenseTotals = sumMoneyByCurrency(detail.expenses);
  const firstTotal = expenseTotals[0];
  const expenseSummary =
    expenseTotals.length === 1 && firstTotal !== undefined
      ? formatMoney(firstTotal.amount, firstTotal.currency)
      : `${detail.expenses.length} transaction${detail.expenses.length === 1 ? "" : "s"}`;

  return (
    <section className="planning-panel overview-panel">
      <div className="overview-intro">
        <span className="object-label">At a glance</span>
        <h2>Your event, connected.</h2>
        <p>
          A little structure, a clearer plan. Pick a view to keep the details
          moving.
        </p>
      </div>
      {detail.lockedRelationCount > 0 ? (
        <div className="locked-reference surface-subtle">
          <LockIcon />
          <div>
            <strong>Private related items</strong>
            <p>
              {detail.lockedRelationCount} related
              {detail.lockedRelationCount === 1
                ? " item is"
                : " items are"}{" "}
              outside your permission scope.
            </p>
          </div>
        </div>
      ) : null}
      <div className="overview-grid">
        <OverviewCard
          count={String(openTasks.length)}
          icon={<CheckIcon />}
          label="Open to-dos"
          onOpen={() => onOpen("todos")}
        />
        <OverviewCard
          count={String(
            detail.events.filter(
              (item) => item.startsAt !== null || item.startsOn !== null,
            ).length,
          )}
          icon={<CalendarIcon />}
          label="Scheduled items"
          onOpen={() => onOpen("calendar")}
        />
        <OverviewCard
          count={expenseSummary}
          icon={<WalletIcon />}
          label="Recorded expenses"
          onOpen={() => onOpen("expenses")}
        />
        <OverviewCard
          count={String(detail.reminders.length)}
          icon={<BellIcon />}
          label="Reminders"
          onOpen={() => onOpen("reminders")}
        />
        <OverviewCard
          count={String(detail.documents.length)}
          icon={<PaperclipIcon />}
          label="Event files"
          onOpen={() => onOpen("files")}
        />
      </div>
      <div className="next-up surface-subtle">
        <ClockIcon />
        <div>
          <span className="object-label">Next up</span>
          {nextItem === undefined ? (
            <p>
              Nothing upcoming. Add a schedule item, a task with a due date, or
              a reminder when you are ready.
            </p>
          ) : (
            <>
              <h3>{nextItem.displayName}</h3>
              <p>
                {nextItem.occursOn
                  ? formatCalendarDate(nextItem.occursOn)
                  : formatDateTime(nextItem.occursAt)}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
