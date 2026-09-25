import type { EventDetailResponse } from "@livtales/schemas";
import { eventPeriod } from "./event-collection";

/** Returns the next unfinished planning item; expenses remain historical facts. */
export function nextPlanningItem(detail: EventDetailResponse, now: number) {
  return [
    ...detail.events.map((event) => ({
      id: event.id,
      displayName: event.displayName,
      occursAt: event.startsAt,
      occursOn: event.startsOn,
      upcoming: event.startsOn
        ? eventPeriod(event, now) === "upcoming"
        : event.startsAt !== null && Date.parse(event.startsAt) >= now,
    })),
    ...detail.tasks
      .filter((task) => task.status !== "done" && task.status !== "cancelled")
      .map((task) => ({
        id: task.id,
        displayName: task.displayName,
        occursAt: task.dueAt,
        occursOn: task.dueOn,
        upcoming: task.dueOn
          ? Date.parse(`${task.dueOn}T23:59:59.999Z`) >= now
          : task.dueAt !== null && Date.parse(task.dueAt) >= now,
      })),
    ...detail.reminders
      .filter((reminder) => reminder.status === "pending")
      .map((reminder) => ({
        id: reminder.id,
        displayName: reminder.displayName,
        occursAt: reminder.remindAt,
        occursOn: null,
        upcoming: Date.parse(reminder.remindAt) >= now,
      })),
  ]
    .filter((item) => item.upcoming)
    .sort(
      (left, right) =>
        String(left.occursOn ?? left.occursAt).localeCompare(
          String(right.occursOn ?? right.occursAt),
        ) || left.id.localeCompare(right.id),
    )[0];
}
