import type { CloudBaseRdbClient } from "@livtales/db";

import { CloudBaseObjectWriteRepository } from "./cloudbase-object-write-repository.js";
import { cloudbaseResourceFromRows } from "./cloudbase-read-support.js";
import type {
  CreateNoteInput,
  NoteResource,
  UpdateNoteInput,
} from "./types.js";

/** Note writes through chronelle_note_create and chronelle_note_update. */
export class CloudBaseNoteWriteRepository extends CloudBaseObjectWriteRepository<
  CreateNoteInput,
  UpdateNoteInput,
  NoteResource
> {
  constructor(client: Pick<CloudBaseRdbClient, "rpc">) {
    super(client, {
      objectType: "note",
      decode(rows) {
        const resource = cloudbaseResourceFromRows(rows);
        if (resource.objectType !== "note")
          throw new Error("CloudBase returned an invalid note.");
        return resource;
      },
    });
  }
}
