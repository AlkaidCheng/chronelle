"use client";

import type { Ref } from "react";
import { useOpenHistory } from "./history-provider";

export function HistoryButton({
  objectId,
  displayName,
  ref,
}: {
  readonly objectId: string;
  readonly displayName: string;
  readonly ref?: Ref<HTMLButtonElement>;
}) {
  const open = useOpenHistory();
  return (
    <button
      ref={ref}
      className="button button-quiet button-small"
      type="button"
      aria-label={`History for ${displayName}`}
      onClick={() => open({ objectId, displayName })}
    >
      History
    </button>
  );
}
