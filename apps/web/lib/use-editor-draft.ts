"use client";

import { useState } from "react";

interface VersionedResource {
  readonly id: string;
  readonly version: number;
}

export interface EditorDraftSnapshot<Resource, Fields> {
  readonly source: Resource | undefined;
  readonly fields: Fields;
  readonly baseline: Fields;
}

/** Keeps flat editor fields and their baseline pinned to one source version. */
export function useEditorDraft<
  Resource extends VersionedResource,
  Fields extends object,
>(
  latest: Resource | undefined,
  initialize: (source: Resource | undefined) => Fields,
  initial?: EditorDraftSnapshot<Resource, Fields>,
) {
  function read(source: Resource | undefined) {
    const fields = initialize(source);
    return { source, fields, baseline: fields };
  }
  const [draft, setDraft] = useState(() => initial ?? read(latest));

  function load(source: Resource | undefined) {
    setDraft(read(source));
  }

  if (draft.source?.id !== latest?.id) {
    load(latest);
  }

  const hasNewerVersion =
    draft.source !== undefined &&
    latest !== undefined &&
    latest.version > draft.source.version;

  return {
    snapshot: draft,
    source: draft.source,
    fields: draft.fields,
    baseline: draft.baseline,
    isDirty: (Object.keys(draft.fields) as (keyof Fields)[]).some(
      (key) => !Object.is(draft.fields[key], draft.baseline[key]),
    ),
    hasNewerVersion,
    /** The newest version's fields while it is ahead of the draft's base. */
    theirs: hasNewerVersion ? initialize(latest) : undefined,
    change: (fields: Partial<Fields>) =>
      setDraft((current) => ({
        ...current,
        fields: { ...current.fields, ...fields },
      })),
    accept: (saved: Resource) => load(saved),
    loadLatest: () => load(latest),
    /**
     * Pins the draft to the newest version with the given fields, so the
     * next save writes them over it as a new version.
     */
    rebase: (fields: Fields) =>
      setDraft({ source: latest, fields, baseline: initialize(latest) }),
  };
}
