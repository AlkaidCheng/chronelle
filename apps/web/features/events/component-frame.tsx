"use client";

import type { EventComponentView } from "@chronelle/schemas";
import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { HeadMenu } from "../../components/head-menu";
import { LayoutIcon } from "../../components/icons";
import { componentViewLabel } from "../../lib/event-components";

/**
 * The heading every Event component shares: title, a count when the
 * component keeps one, then its controls and one action.
 */
export function PanelHeading({
  action,
  controls,
  count,
  title,
}: {
  readonly action?: ReactNode;
  readonly controls?: ReactNode;
  /** What the component holds, read beside the title: "3 open". */
  readonly count?: string | undefined;
  readonly title: string;
}) {
  return (
    <header className="panel-heading">
      <div>
        <h2>{title}</h2>
        {count === undefined ? null : <p className="panel-count">{count}</p>}
      </div>
      {controls === undefined && action === undefined ? null : (
        <div className="panel-tools">
          {controls}
          {action}
        </div>
      )}
    </header>
  );
}

/**
 * One quiet control reading the current layout that opens the templates a
 * component offers (List, By day, By week, Calendar); nothing when it
 * offers one.
 */
export function LayoutControl({
  busy = false,
  onChange,
  view,
  views,
}: {
  readonly busy?: boolean;
  readonly onChange: (view: EventComponentView) => void;
  readonly view: EventComponentView;
  readonly views: readonly EventComponentView[];
}) {
  const t = useTranslations("controls");
  if (views.length < 2) return null;
  return (
    <HeadMenu
      busy={busy}
      entries={views.map((option) => ({
        kind: "radio",
        label: componentViewLabel(option),
        checked: option === view,
        onSelect: () => {
          if (option !== view) onChange(option);
        },
      }))}
      icon={<LayoutIcon />}
      label={t("layout")}
      name={componentViewLabel(view)}
    />
  );
}

/**
 * The actions of one row, in the shared order: the row's own action (Edit,
 * Download), then a state change (Dismiss), then History, then Actions.
 */
export function RowActions({ children }: { readonly children: ReactNode }) {
  return <div className="row-actions">{children}</div>;
}

/** A calendar-style date mark: the month above the day. */
export function DateTile({
  dateTime,
  day,
  month,
}: {
  readonly dateTime: string | undefined;
  readonly day: string;
  readonly month: string;
}) {
  return (
    <time className="date-tile" dateTime={dateTime}>
      <span>{month.toUpperCase()}</span>
      <strong>{day}</strong>
    </time>
  );
}

const statuses = [
  "cancelled",
  "dismissed",
  "done",
  "in_progress",
  "pending",
  "todo",
  "triggered",
] as const;

function isStatus(value: string): value is (typeof statuses)[number] {
  return (statuses as readonly string[]).includes(value);
}

/** A status of a Task or Reminder as a labelled chip. */
export function StatusChip({ status }: { readonly status: string }) {
  const t = useTranslations("taskRow.status");
  return (
    <span className={`status-chip status-${status}`}>
      {isStatus(status) ? t(status) : status}
    </span>
  );
}

const objectTypeLabels: Record<string, string> = {
  event: "Scheduled event",
  expense: "Expense",
  person: "Person",
  reminder: "Reminder",
  task: "Task",
};

/** The kind of a canonical object as people read it. */
export function objectTypeLabel(objectType: string): string {
  return objectTypeLabels[objectType] ?? objectType;
}
