import type { ExpenseResponse, ObjectAccessResponse } from "@livtales/schemas";

import type { PlanningProjection } from "../features/planning/data";

export function replaceExpenseProjection(
  projection: PlanningProjection | undefined,
  saved: ExpenseResponse,
): PlanningProjection | undefined {
  if (projection?.kind !== "expenses") return projection;
  const index = projection.value.items.findIndex(
    (item) => item.id === saved.id,
  );
  if (index < 0) return projection;
  const items = [...projection.value.items];
  items[index] = saved;
  return { ...projection, value: { ...projection.value, items } };
}

export function canEditExpense(
  access: ObjectAccessResponse | undefined,
): boolean {
  return access?.actions.includes("edit") === true;
}
