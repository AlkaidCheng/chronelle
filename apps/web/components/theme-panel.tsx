"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef } from "react";
import { useMenuDismissal } from "./quiet-menu";
import { ThemeControls } from "./theme-controls";

/**
 * The Theme panel beside the rail: the mode, palette, density, and motion
 * choices, opened from the More menu. Escape or a press outside closes it;
 * `onClose` says whether the keyboard closed it so the opener can take focus
 * back. Choices apply to this browser only.
 */
export function ThemePanel({
  open,
  onClose,
}: {
  readonly open: boolean;
  readonly onClose: (byKeyboard: boolean) => void;
}) {
  const id = useId();
  const t = useTranslations("theme");
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open)
      panel.current?.querySelector<HTMLElement>("input:checked")?.focus();
  }, [open]);
  const contains = useCallback(
    (target: Node) => panel.current?.contains(target) ?? false,
    [],
  );
  useMenuDismissal(open, contains, onClose);

  if (!open) return null;
  return (
    <div
      ref={panel}
      id={`${id}-panel`}
      role="dialog"
      aria-label={t("title")}
      className="theme-panel"
    >
      <ThemeControls />
    </div>
  );
}
