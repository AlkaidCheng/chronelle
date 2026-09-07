"use client";

import { useState } from "react";

interface VersionedResource {
  readonly id: string;
  readonly version: number;
}

export function useEditorDraft<
  Resource extends VersionedResource,
  Fields extends object,
>(
  latest: Resource | undefined,
  initialize: (source: Resource | undefined) => Fields,
) {
  const [draft, setDraft] = useState(() => ({
    source: latest,
    fields: initialize(latest),
  }));

  function load(source: Resource | undefined) {
    setDraft({ source, fields: initialize(source) });
  }

  if (draft.source?.id !== latest?.id) {
    load(latest);
  }

  return {
    source: draft.source,
    fields: draft.fields,
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
