"use client";

import { useState } from "react";

interface VersionedResource {
  readonly id: string;
  readonly version: number;
}

export function useEditSource<Resource extends VersionedResource>(
  latest: Resource | undefined,
) {
  const [source, setSource] = useState(latest);

  if (source?.id !== latest?.id) {
    setSource(latest);
  }

  return {
    source,
    hasNewerVersion:
      source !== undefined &&
      latest !== undefined &&
      latest.version > source.version,
    accept: (saved: Resource) => setSource(saved),
    loadLatest: () => setSource(latest),
  };
}
