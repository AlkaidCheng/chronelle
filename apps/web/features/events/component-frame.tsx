"use client";

import type { EventComponentView } from "@chronelle/schemas";
import type { ReactNode } from "react";
import { eventComponentViews } from "../../lib/event-components";

/**
 * The heading every Event component shares: title, one line of purpose,
 * then its view control and one action.
 */
export function PanelHeading({
  action,
  controls,
  description,
  title,
}: {
  readonly action?: ReactNode;
  readonly controls?: ReactNode;
  readonly description: string;
  readonly title: string;
}) {
  return (
    <header className="panel-heading">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
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

/** Chooses among the views a component offers; nothing when it offers one. */
export function ViewSwitch({
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
  if (views.length < 2) return null;
  return (
    <fieldset className="view-switch" disabled={busy}>
      <legend>View</legend>
      {views.map((option) => (
        <button
          aria-pressed={option === view}
          className={option === view ? "active" : ""}
          key={option}
          onClick={() => {
            if (option !== view) onChange(option);
          }}
          type="button"
        >
          {eventComponentViews[option].label}
        </button>
      ))}
    </fieldset>
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

const statusLabels: Record<string, string> = {
  cancelled: "Cancelled",
  dismissed: "Dismissed",
  done: "Done",
  in_progress: "In progress",
  pending: "Pending",
  todo: "To do",
  triggered: "Triggered",
};

/** A status of a Task or Reminder as a labelled chip. */
export function StatusChip({ status }: { readonly status: string }) {
  return (
    <span className={`status-chip status-${status}`}>
      {statusLabels[status] ?? status}
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
