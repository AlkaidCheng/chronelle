"use client";

import { useState } from "react";

interface VersionedResource {
  readonly id: string;
  readonly version: number;
}

/** Keeps flat editor fields and their baseline pinned to one source version. */
export function useEditorDraft<
  Resource extends VersionedResource,
  Fields extends object,
>(
  latest: Resource | undefined,
  initialize: (source: Resource | undefined) => Fields,
) {
  function read(source: Resource | undefined) {
    const fields = initialize(source);
    return { source, fields, baseline: fields };
  }
  const [draft, setDraft] = useState(() => read(latest));

  function load(source: Resource | undefined) {
    setDraft(read(source));
  }

  if (draft.source?.id !== latest?.id) {
    load(latest);
  }

  return {
    source: draft.source,
    fields: draft.fields,
    isDirty: (Object.keys(draft.fields) as (keyof Fields)[]).some(
      (key) => !Object.is(draft.fields[key], draft.baseline[key]),
    ),
    hasNewerVersion:
      draft.source !== undefined &&
      latest !== undefined &&
      latest.version > draft.source.version,
    change: (fields: Partial<Fields>) =>
      setDraft((current) => ({
        ...current,
        fields: { ...current.fields, ...fields },
      })),
    accept: (saved: Resource) => load(saved),
    loadLatest: () => load(latest),
  };
}
