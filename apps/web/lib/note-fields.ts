import type { NoteResponse } from "@livtales/schemas";

/** The note editor's fields: the title and the text as typed. */
export function readNoteFields(
  note?: Pick<NoteResponse, "displayName" | "body">,
) {
  return {
    displayName: note?.displayName ?? "",
    body: note?.body ?? "",
  };
}

export function noteFieldsPayload(fields: ReturnType<typeof readNoteFields>) {
  return { displayName: fields.displayName.trim(), body: fields.body };
}

/** The lines a growing text field shows: one more than the text has, within six and twenty-four. */
export function noteBodyRows(body: string): number {
  const lines = body.split("\n").length;
  return Math.min(24, Math.max(6, lines + 1));
}

/** The first two lines of a note's text, for its card when folded. */
export function notePreview(body: string): string {
  return body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .slice(0, 2)
    .join("\n");
}
