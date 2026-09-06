import type { EventDetailResponse } from "@chronelle/schemas";

/** Returns the next unfinished planning item; expenses remain historical facts. */
export function nextPlanningItem(detail: EventDetailResponse, now: number) {
  return [
    ...detail.events.map((event) => ({
      id: event.id,
      displayName: event.displayName,
      occursAt: event.startsAt,
    })),
    ...detail.tasks
      .filter((task) => task.status !== "done" && task.status !== "cancelled")
      .map((task) => ({
        id: task.id,
        displayName: task.displayName,
        occursAt: task.dueAt,
      })),
    ...detail.reminders
      .filter((reminder) => reminder.status === "pending")
      .map((reminder) => ({
        id: reminder.id,
        displayName: reminder.displayName,
        occursAt: reminder.remindAt,
      })),
  ]
    .filter(
      (item) => item.occursAt !== null && Date.parse(item.occursAt) >= now,
    )
    .sort(
      (left, right) =>
        String(left.occursAt).localeCompare(String(right.occursAt)) ||
        left.id.localeCompare(right.id),
    )[0];
}
