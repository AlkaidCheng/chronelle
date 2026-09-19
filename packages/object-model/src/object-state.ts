import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  documents,
  events,
  expenses,
  labels,
  notes,
  objects,
  personContacts,
  personLabels,
  persons,
  reminders,
  taskLabels,
  tasks,
  type Database,
  type DatabaseTransaction,
} from "@chronelle/db";
import { and, eq, sql, type SQL } from "drizzle-orm";

// A task's labels in name order, read with its state.
const labelIds = sql<string[]>`(
  SELECT coalesce(array_agg(${labels.id} ORDER BY lower(${labels.name}), ${labels.id}), '{}')
  FROM ${taskLabels}
  JOIN ${labels} ON ${labels.id} = ${taskLabels.labelId}
  WHERE ${taskLabels.workspaceId} = ${objects.workspaceId} AND ${taskLabels.taskId} = ${objects.id}
)`;

// A person's contacts in kept order and labels in name order, read with its state.
const contacts = sql<{ kind: PersonContact["kind"]; value: string }[]>`(
  SELECT coalesce(jsonb_agg(jsonb_build_object('kind', ${personContacts.kind}, 'value', ${personContacts.value}) ORDER BY ${personContacts.position}), '[]'::jsonb)
  FROM ${personContacts}
  WHERE ${personContacts.workspaceId} = ${objects.workspaceId} AND ${personContacts.personId} = ${objects.id}
)`;
const personLabelIds = sql<string[]>`(
  SELECT coalesce(array_agg(${labels.id} ORDER BY lower(${labels.name}), ${labels.id}), '{}')
  FROM ${personLabels}
  JOIN ${labels} ON ${labels.id} = ${personLabels.labelId}
  WHERE ${personLabels.workspaceId} = ${objects.workspaceId} AND ${personLabels.personId} = ${objects.id}
)`;

import type { EventPlanningResource, PersonContact } from "./types.js";

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
      labelIds,
      expense: expenses,
      reminder: reminders,
      document: documents,
      person: persons,
      contacts,
      personLabelIds,
      note: notes,
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
    .leftJoin(
      persons,
      and(
        eq(persons.workspaceId, objects.workspaceId),
        eq(persons.objectId, objects.id),
      ),
    )
    .leftJoin(
      notes,
      and(
        eq(notes.workspaceId, objects.workspaceId),
        eq(notes.objectId, objects.id),
      ),
    )
    .where(condition)
    .orderBy(objects.id)
    .limit(limit);

  return rows.map((row): EventPlanningResource => {
    // The cascade marker stays internal to the lifecycle functions.
    const { deletedWith: _deletedWith, ...common } = row.object;
    switch (common.objectType) {
      case "event":
        if (row.event) {
          const { objectId: _, workspaceId: __, ...content } = row.event;
          return { ...common, ...content };
        }
        break;
      case "task":
        if (row.task) {
          const {
            objectId: _,
            workspaceId: __,
            assigneePersonId,
            ...content
          } = row.task;
          return {
            ...common,
            ...content,
            assigneeId: assigneePersonId,
            labelIds: row.labelIds ?? [],
          };
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
        break;
      case "person":
        if (row.person) {
          const { objectId: _, workspaceId: __, ...content } = row.person;
          return {
            ...common,
            ...content,
            contacts: row.contacts ?? [],
            labelIds: row.personLabelIds ?? [],
          };
        }
        break;
      case "note":
        if (row.note) {
          const { objectId: _, workspaceId: __, ...content } = row.note;
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
