import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  documents,
  events,
  expenses,
  objects,
  reminders,
  tasks,
  type Database,
  type DatabaseTransaction,
} from "@chronelle/db";
import { and, eq, type SQL } from "drizzle-orm";

import type { EventPlanningResource } from "./types.js";

/** Read complete typed states in one statement, including tombstones. Callers authorize access. */
export async function readObjectStates(
  database: Database | DatabaseTransaction,
  condition: SQL | undefined,
  limit: number,
): Promise<EventPlanningResource[]> {
  const rows = await database
    .select({
      object: objects,
      event: events,
      task: tasks,
      expense: expenses,
      reminder: reminders,
      document: documents,
    })
    .from(objects)
    .leftJoin(
      events,
      and(
        eq(events.workspaceId, objects.workspaceId),
        eq(events.objectId, objects.id),
      ),
    )
    .leftJoin(
      tasks,
      and(
        eq(tasks.workspaceId, objects.workspaceId),
        eq(tasks.objectId, objects.id),
      ),
    )
    .leftJoin(
      expenses,
      and(
        eq(expenses.workspaceId, objects.workspaceId),
        eq(expenses.objectId, objects.id),
      ),
    )
    .leftJoin(
      reminders,
      and(
        eq(reminders.workspaceId, objects.workspaceId),
        eq(reminders.objectId, objects.id),
      ),
    )
    .leftJoin(
      documents,
      and(
        eq(documents.workspaceId, objects.workspaceId),
        eq(documents.objectId, objects.id),
      ),
    )
    .where(condition)
    .orderBy(objects.id)
    .limit(limit);

  return rows.map((row): EventPlanningResource => {
    const common = row.object;
    switch (common.objectType) {
      case "event":
        if (row.event) {
          const { objectId: _, workspaceId: __, ...content } = row.event;
          return { ...common, ...content };
        }
        break;
      case "task":
        if (row.task) {
          const { objectId: _, workspaceId: __, ...content } = row.task;
          return { ...common, ...content };
        }
        break;
      case "expense":
        if (row.expense) {
          const { objectId: _, workspaceId: __, ...content } = row.expense;
          return { ...common, ...content };
        }
        break;
      case "reminder":
        if (row.reminder) {
          const { objectId: _, workspaceId: __, ...content } = row.reminder;
          return { ...common, ...content };
        }
        break;
      case "document":
        if (row.document) {
          const { objectId: _, workspaceId: __, ...content } = row.document;
          return { ...common, ...content };
        }
    }
    throw new Error("The canonical object is missing its typed state.");
  });
}

export async function readObjectState(
  database: Database | DatabaseTransaction,
  workspaceId: string,
  objectId: string,
): Promise<EventPlanningResource> {
  const [resource] = await readObjectStates(
    database,
    and(eq(objects.workspaceId, workspaceId), eq(objects.id, objectId)),
    1,
  );
  if (resource === undefined) throw new AuthorizationDeniedError();
  return resource;
}
