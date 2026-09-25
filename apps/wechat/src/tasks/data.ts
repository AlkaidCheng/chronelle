import type { TaskResponse } from "@livtales/schemas";

import type { PlanningProjection } from "../features/planning/data";

export function taskAccessQueryKey(workspaceId: string, resourceId: string) {
  return ["wechat-task-access", workspaceId, resourceId] as const;
}

export function replaceTaskProjection(
  projection: PlanningProjection | undefined,
  saved: TaskResponse,
): PlanningProjection | undefined {
  if (projection?.kind !== "todos") return projection;
  const index = projection.value.items.findIndex(
    (task) => task.id === saved.id,
  );
  if (index < 0) return projection;
  const items = [...projection.value.items];
  items[index] = saved;
  return { ...projection, value: { ...projection.value, items } };
}
