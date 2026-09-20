"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { canOpenCommands } from "../lib/keyboard";
import { subscribeCommandPalette } from "../lib/command-palette";
import { useCommandShortcut } from "../lib/shortcut-preference";
import { SearchIcon } from "./icons";
import { WorkspaceCommands } from "./workspace-commands";

/**
 * The sidebar's Search entry: one palette for records, navigation, and the
 * current page's actions, opened from the entry, with Cmd/Ctrl+K, or by a
 * request from elsewhere in the shell (the phone's drawer, once closed).
 * The key hint shows on keyboard devices only; the shortcut stays bound.
 */
export function SearchEntry({
  current = false,
}: {
  readonly current?: boolean;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => subscribeCommandPalette(() => setOpen(true)), []);
  const t = useTranslations("nav");
  const shortcut = useCommandShortcut();
  const enabled = shortcut.value === "enabled";
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!canOpenCommands(event)) return;
      event.preventDefault();
      setOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
  return (
    <>
      <button
        type="button"
        className={current ? "active" : ""}
        aria-label={t("searchAndCommands")}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-keyshortcuts={enabled ? "Control+k Meta+k" : undefined}
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        <SearchIcon />
        {t("search")}
        {enabled ? <kbd className="keyboard-only">&#8984;K</kbd> : null}
      </button>
      {open &&
        createPortal(
          <WorkspaceCommands onClose={() => setOpen(false)} />,
          document.body,
        )}
    </>
  );
}
