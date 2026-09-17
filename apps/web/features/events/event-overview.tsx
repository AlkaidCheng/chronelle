"use client";

import { useTranslations } from "next-intl";
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
  PeopleIcon,
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
    <section className="planning-panel overview-panel">
      <div className="overview-intro">
        <span className="object-label">{t("eyebrow")}</span>
        <h2>{t("title")}</h2>
        <p>{t("intro")}</p>
      </div>
      {detail.lockedRelationCount > 0 ? (
        <div className="locked-reference surface-subtle">
          <LockIcon />
          <div>
            <strong>{t("privateTitle")}</strong>
            <p>{t("privateNote", { count: detail.lockedRelationCount })}</p>
          </div>
        </div>
      ) : null}
      <div className="overview-grid">
        <OverviewCard
          count={String(openTasks.length)}
          icon={<CheckIcon />}
          label={t("openTodos")}
          onOpen={() => onOpen("todos")}
        />
        <OverviewCard
          count={String(
            detail.events.filter(
              (item) => item.startsAt !== null || item.startsOn !== null,
            ).length,
          )}
          icon={<CalendarIcon />}
          label={t("scheduled")}
          onOpen={() => onOpen("calendar")}
        />
        <OverviewCard
          count={expenseSummary}
          icon={<WalletIcon />}
          label={t("expenses")}
          onOpen={() => onOpen("expenses")}
        />
        <OverviewCard
          count={String(detail.reminders.length)}
          icon={<BellIcon />}
          label={t("reminders")}
          onOpen={() => onOpen("reminders")}
        />
        <OverviewCard
          count={String(detail.documents.length)}
          icon={<PaperclipIcon />}
          label={t("files")}
          onOpen={() => onOpen("files")}
        />
        <OverviewCard
          count={String(detail.persons.length)}
          icon={<PeopleIcon />}
          label={t("people")}
          onOpen={() => onOpen("people")}
        />
      </div>
      <div className="next-up surface-subtle">
        <ClockIcon />
        <div>
          <span className="object-label">{t("nextUp")}</span>
          {nextItem === undefined ? (
            <p>{t("nothingUpcoming")}</p>
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
