"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  type CommandPaletteSection,
  subscribeCommandPalette,
} from "../lib/command-palette";
import { canOpenCommands } from "../lib/keyboard";
import { useCommandShortcut } from "../lib/shortcut-preference";
import { SearchIcon } from "./icons";
import { WorkspaceCommands } from "./workspace-commands";

/**
 * The sidebar's Search entry: one palette for records, navigation, and the
 * current page's actions, opened from the entry, with Cmd/Ctrl+K, or by a
 * request from elsewhere in the shell (More opens it at its Keyboard
 * shortcuts section).
 */
export function SearchEntry({
  workspaceName,
  current = false,
}: {
  readonly workspaceName: string;
  readonly current?: boolean;
}) {
  const [open, setOpen] = useState<false | { section?: CommandPaletteSection }>(
    false,
  );
  const t = useTranslations("nav");
  const shortcut = useCommandShortcut();
  const enabled = shortcut.value === "enabled";
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!canOpenCommands(event)) return;
      event.preventDefault();
      setOpen({});
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
  useEffect(
    () =>
      subscribeCommandPalette((request) =>
        setOpen(
          request.section === undefined ? {} : { section: request.section },
        ),
      ),
    [],
  );
  return (
    <>
      <button
        type="button"
        className={current ? "active" : ""}
        aria-label={t("searchAndCommands")}
        aria-haspopup="dialog"
        aria-expanded={open !== false}
        aria-keyshortcuts={enabled ? "Control+k Meta+k" : undefined}
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen({});
        }}
      >
        <SearchIcon />
        {t("search")}
        {enabled ? <kbd>&#8984;K</kbd> : null}
      </button>
      {open !== false &&
        createPortal(
          <WorkspaceCommands
            workspaceName={workspaceName}
            shortcutEnabled={enabled}
            onShortcutChange={(value) =>
              shortcut.setValue(value ? "enabled" : "disabled")
            }
            onClose={() => setOpen(false)}
            section={open.section}
          />,
          document.body,
        )}
    </>
  );
}
