"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { EventDetailResponse } from "@chronelle/schemas";
import {
  BellIcon,
  CalendarIcon,
  CheckIcon,
  ChevronRightIcon,
  ClockIcon,
  LockIcon,
  PaperclipIcon,
  PeopleIcon,
  WalletIcon,
} from "../../components/icons";
import { formatDateTime } from "../../lib/format";
import { formatCalendarDate } from "../../lib/event-schedule";
import { formatMoney, sumMoneyByCurrency } from "../../lib/money";
import type { EventView } from "../../lib/event-views";
import { useClock } from "../../lib/use-clock";
import { nextPlanningItem } from "../../lib/upcoming-plan";

/** One row of the glance list: the view's mark, its name, what it holds, and the way in. */
function OverviewRow({
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
    <li>
      <button className="glance-row" onClick={onOpen} type="button">
        {icon}
        <span className="glance-label">{label}</span>
        <span className="glance-count">{count}</span>
        <ChevronRightIcon className="glance-chevron" />
      </button>
    </li>
  );
}

export function EventOverview({
  detail,
  onOpen,
}: {
  readonly detail: EventDetailResponse;
  readonly onOpen: (view: EventView) => void;
}) {
  const t = useTranslations("overview");
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
      : t("transactions", { count: detail.expenses.length });

  return (
    <section aria-label={t("glance")} className="planning-panel overview-panel">
      {detail.lockedRelationCount > 0 ? (
        <div className="locked-reference surface-subtle">
          <LockIcon />
          <div>
            <strong>{t("privateTitle")}</strong>
            <p>{t("privateNote", { count: detail.lockedRelationCount })}</p>
          </div>
        </div>
      ) : null}
      <ul className="glance">
        <OverviewRow
          count={String(openTasks.length)}
          icon={<CheckIcon />}
          label={t("openTodos")}
          onOpen={() => onOpen("todos")}
        />
        <OverviewRow
          count={String(
            detail.events.filter(
              (item) => item.startsAt !== null || item.startsOn !== null,
            ).length,
          )}
          icon={<CalendarIcon />}
          label={t("scheduled")}
          onOpen={() => onOpen("calendar")}
        />
        <OverviewRow
          count={expenseSummary}
          icon={<WalletIcon />}
          label={t("expenses")}
          onOpen={() => onOpen("expenses")}
        />
        <OverviewRow
          count={String(detail.reminders.length)}
          icon={<BellIcon />}
          label={t("reminders")}
          onOpen={() => onOpen("reminders")}
        />
        <OverviewRow
          count={String(detail.documents.length)}
          icon={<PaperclipIcon />}
          label={t("files")}
          onOpen={() => onOpen("files")}
        />
        <OverviewRow
          count={String(detail.persons.length)}
          icon={<PeopleIcon />}
          label={t("people")}
          onOpen={() => onOpen("people")}
        />
      </ul>
      <section aria-labelledby="next-up-heading" className="next-up">
        <header className="panel-heading">
          <div>
            <h2 id="next-up-heading">{t("nextUp")}</h2>
          </div>
        </header>
        {nextItem === undefined ? (
          <p className="next-up-empty">{t("nothingUpcoming")}</p>
        ) : (
          <div className="next-up-row">
            <ClockIcon />
            <div className="resource-copy">
              <strong>{nextItem.displayName}</strong>
              <p>
                {nextItem.occursOn
                  ? formatCalendarDate(nextItem.occursOn)
                  : formatDateTime(nextItem.occursAt)}
              </p>
            </div>
          </div>
        )}
      </section>
    </section>
  );
}
