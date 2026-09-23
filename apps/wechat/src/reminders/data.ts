import type {
  ObjectAccessResponse,
  ReminderResponse,
} from "@chronelle/schemas";

import type { PlanningProjection } from "../features/planning/data";

export function replaceReminderProjection(
  projection: PlanningProjection | undefined,
  saved: ReminderResponse,
): PlanningProjection | undefined {
  if (projection?.kind !== "reminders") return projection;
  const index = projection.value.items.findIndex(
    (item) => item.id === saved.id,
  );
  if (index < 0) return projection;
  const items = [...projection.value.items];
  items[index] = saved;
  return { ...projection, value: { ...projection.value, items } };
}

export function canEditReminder(
  access: ObjectAccessResponse | undefined,
): boolean {
  return access?.actions.includes("edit") === true;
}
