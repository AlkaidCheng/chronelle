"use client";

import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";
import { ThemeIcon } from "./icons";
import { ThemeControls } from "./theme-controls";

/**
 * The sidebar's Theme entry: a panel beside it with the mode, palette,
 * density, and motion choices; the language moved to Settings. Escape or
 * a press outside closes the panel and returns focus to the entry.
 */
export function ThemePanel() {
  const [open, setOpen] = useState(false);
  const id = useId();
  const t = useTranslations("theme");
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    panel.current?.querySelector<HTMLElement>("input:checked")?.focus();
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && root.current?.contains(event.target))
        return;
      setOpen(false);
    }
    // Escape closes from anywhere: a pointer press on a control does not
    // move focus into the panel in every browser.
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="theme-entry" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="sidebar-entry"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={`${id}-panel`}
        onClick={() => setOpen((current) => !current)}
      >
        <ThemeIcon />
        {t("title")}
      </button>
      {open ? (
        <div
          ref={panel}
          id={`${id}-panel`}
          role="dialog"
          aria-label={t("title")}
          className="theme-panel"
        >
          <ThemeControls />
        </div>
      ) : null}
    </div>
  );
}
