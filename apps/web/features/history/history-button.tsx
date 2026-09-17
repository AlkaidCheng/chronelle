"use client";

import { useTranslations } from "next-intl";
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
  const t = useTranslations("history");
  const open = useOpenHistory();
  if (variant === "icon")
    return (
      <IconButton
        ref={ref}
        label={t("button")}
        aria-label={t("buttonFor", { name: displayName })}
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
      aria-label={t("buttonFor", { name: displayName })}
      onClick={() => open({ objectId, displayName })}
    >
      {t("button")}
    </button>
  );
}
