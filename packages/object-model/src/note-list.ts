import { withReadAuthorization } from "@livtales/authorization";
import type { UserPrincipal } from "@livtales/authorization";
import {
  objectRelations,
  objectRevisions,
  objects,
  users,
  type Database,
  type DatabaseTransaction,
} from "@livtales/db";
import {
  noteListQuerySchema,
  type NoteListQuery,
  type NoteListQueryInput,
} from "@livtales/schemas";
import { and, eq, inArray, isNull } from "drizzle-orm";

import { EventPlanningObjectService } from "./object-service.js";
import type { NoteResource } from "./types.js";

/** A Note as the Notes projection lists it: with the display name of the account whose revision is its current version. */
export interface NoteListItem extends NoteResource {
  readonly editedBy: string | null;
}

export interface NotePage {
  readonly sourceEventId: string;
  readonly items: NoteListItem[];
}

/**
 * Read boundary for an Event's Notes: the live notes it includes that the
 * caller may view, last edited first or by title. Both backends authorize
 * the Event for view and omit notes the caller cannot see.
 */
export interface NoteReadRepository {
  listNotes(
    principal: UserPrincipal,
    eventId: string,
    input?: NoteListQueryInput,
  ): Promise<NotePage>;
}

/** The projection's order: the newest edit first, or titles without regard to case; ties by id. */
export function compareNotes(
  sort: NoteListQuery["sort"],
  first: NoteListItem,
  second: NoteListItem,
): number {
  if (sort === "title") {
    const firstTitle = first.displayName.toLowerCase();
    const secondTitle = second.displayName.toLowerCase();
    if (firstTitle !== secondTitle) return firstTitle < secondTitle ? -1 : 1;
  } else {
    const difference = second.updatedAt.getTime() - first.updatedAt.getTime();
    if (difference !== 0) return difference;
  }
  return first.id < second.id ? -1 : first.id > second.id ? 1 : 0;
}

export class PostgresNoteReadRepository implements NoteReadRepository {
  readonly #database: Database;

  constructor(database: Database) {
    this.#database = database;
  }

  listNotes(
    principal: UserPrincipal,
    eventId: string,
    options: NoteListQueryInput = {},
  ): Promise<NotePage> {
    const input = noteListQuerySchema.parse(options);
    return withReadAuthorization(
      this.#database,
      async (transaction, authorization) => {
        const reader = new EventPlanningObjectService({
          database: transaction,
          authorization,
        });
        await reader.getEvent(principal, eventId);
        const relations = await transaction
          .select({ targetObjectId: objectRelations.targetObjectId })
          .from(objectRelations)
          .innerJoin(
            objects,
            and(
              eq(objects.workspaceId, objectRelations.workspaceId),
              eq(objects.id, objectRelations.targetObjectId),
              eq(objects.objectType, "note"),
              isNull(objects.deletedAt),
            ),
          )
          .where(
            and(
              eq(objectRelations.workspaceId, principal.workspaceId),
              eq(objectRelations.sourceObjectId, eventId),
              eq(objectRelations.relationType, "includes"),
              isNull(objectRelations.deletedAt),
            ),
          );
        const resources = await reader.listVisibleObjects(
          principal,
          relations.map(({ targetObjectId }) => targetObjectId),
        );
        const notes = resources.filter(
          (resource): resource is NoteResource =>
            resource.objectType === "note",
        );
        const editors = await readNoteEditors(
          transaction,
          notes.map((note) => note.id),
        );
        const items = notes.map((note): NoteListItem => ({
          ...note,
          editedBy: editors.get(note.id) ?? null,
        }));
        items.sort((first, second) => compareNotes(input.sort, first, second));
        return { sourceEventId: eventId, items };
      },
    );
  }
}

/** The display name of the account that wrote each note's current version, by note id. */
async function readNoteEditors(
  transaction: DatabaseTransaction,
  noteIds: readonly string[],
): Promise<ReadonlyMap<string, string | null>> {
  if (noteIds.length === 0) return new Map();
  const rows = await transaction
    .select({
      objectId: objectRevisions.objectId,
      displayName: users.displayName,
    })
    .from(objectRevisions)
    .innerJoin(
      objects,
      and(
        eq(objects.id, objectRevisions.objectId),
        eq(objects.version, objectRevisions.objectVersion),
      ),
    )
    .leftJoin(
      users,
      and(
        eq(objectRevisions.actorType, "user"),
        eq(users.id, objectRevisions.actorId),
      ),
    )
    .where(inArray(objectRevisions.objectId, [...noteIds]));
  return new Map(rows.map((row) => [row.objectId, row.displayName ?? null]));
}
