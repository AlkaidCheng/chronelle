/** The kinds of record a list's rows open in place as a composer. */
export type ComposerKind = "task" | "event" | "reminder" | "expense";

/** The key of a row's composer: the record it edits, in one key space per list. */
export const recordComposerKey = (kind: ComposerKind, id: string) =>
  `${kind}:${id}`;
