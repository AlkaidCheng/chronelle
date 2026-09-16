"use client";

import type { Ref } from "react";
import { IconButton } from "../../components/icon-button";
import { ClockIcon } from "../../components/icons";
import { useOpenHistory } from "./history-provider";

export function HistoryButton({
  objectId,
  displayName,
  ref,
  variant = "text",
}: {
  readonly objectId: string;
  readonly displayName: string;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly variant?: "text" | "icon";
}) {
  const open = useOpenHistory();
  if (variant === "icon")
    return (
      <IconButton
        ref={ref}
        label="History"
        aria-label={`History for ${displayName}`}
        onClick={() => open({ objectId, displayName })}
      >
        <ClockIcon />
      </IconButton>
    );
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
