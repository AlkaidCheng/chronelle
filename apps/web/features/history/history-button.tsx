"use client";

import { useOpenHistory } from "./history-provider";

export function HistoryButton({
  objectId,
  displayName,
}: {
  readonly objectId: string;
  readonly displayName: string;
}) {
  const open = useOpenHistory();
  return (
    <button
      className="button button-quiet button-small"
      type="button"
      aria-label={`History for ${displayName}`}
      onClick={() => open({ objectId, displayName })}
    >
      History
    </button>
  );
}
