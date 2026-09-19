import type { UserPrincipal } from "@chronelle/authorization";
import { CloudBaseRpcError, type CloudBaseRdbClient } from "@chronelle/db";
import {
  noteListQuerySchema,
  type NoteListQueryInput,
} from "@chronelle/schemas";

import {
  cloudbaseNullableText,
  cloudbaseResourceFromRows,
  cloudbaseText,
} from "./cloudbase-read-support.js";
import { mapRpcError } from "./cloudbase-rpc-errors.js";
import type {
  NoteListItem,
  NotePage,
  NoteReadRepository,
} from "./note-list.js";

/**
 * An Event's Notes through chronelle_note_list, which authorizes the Event,
 * selects the notes the caller may view, orders them, and names the account
 * behind each note's current version, as the PostgreSQL repository does.
 */
export class CloudBaseNoteReadRepository implements NoteReadRepository {
  readonly #client: Pick<CloudBaseRdbClient, "rpc">;

  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    this.#client = client;
  }

  async listNotes(
    principal: UserPrincipal,
    eventId: string,
    options: NoteListQueryInput = {},
  ): Promise<NotePage> {
    const input = noteListQuerySchema.parse(options);
    let page: unknown;
    try {
      page = await this.#client.rpc("chronelle_note_list", {
        workspace_id: principal.workspaceId,
        user_id: principal.userId,
        event_id: eventId,
        sort: input.sort,
      });
    } catch (error) {
      if (error instanceof CloudBaseRpcError) throw mapRpcError(error);
      throw error;
    }
    if (page === null || typeof page !== "object")
      throw new Error("CloudBase returned an invalid note list.");
    const record = page as Record<string, unknown>;
    if (!Array.isArray(record.items))
      throw new Error("CloudBase returned an invalid note list.");
    return {
      sourceEventId: cloudbaseText(record.sourceEventId, "note list event"),
      items: record.items.map((item): NoteListItem => {
        if (item === null || typeof item !== "object")
          throw new Error("CloudBase returned an invalid note.");
        const { editedBy, ...rows } = item as Record<string, unknown>;
        const resource = cloudbaseResourceFromRows(rows);
        if (resource.objectType !== "note")
          throw new Error("CloudBase returned an invalid note.");
        return {
          ...resource,
          editedBy: cloudbaseNullableText(editedBy, "note editor"),
        };
      }),
    };
  }
}
