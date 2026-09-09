"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { canOpenCommands } from "../lib/keyboard";
import { WorkspaceCommands } from "./workspace-commands";

const shortcutStorageKey = "chronelle.command-shortcut";

export function WorkspaceHeader({
  workspaceName,
}: {
  readonly workspaceName: string;
}) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    try {
      setEnabled(
        window.localStorage.getItem(shortcutStorageKey) !== "disabled",
      );
    } catch {
      setEnabled(true);
    }
    function synchronize(event: StorageEvent) {
      try {
        if (event.storageArea !== window.localStorage) return;
      } catch {
        return;
      }
      if (event.key === null || event.key === shortcutStorageKey)
        setEnabled(event.newValue !== "disabled");
    }
    window.addEventListener("storage", synchronize);
    return () => window.removeEventListener("storage", synchronize);
  }, []);
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

  function changeShortcut(value: boolean) {
    setEnabled(value);
    try {
      if (value) window.localStorage.removeItem(shortcutStorageKey);
      else window.localStorage.setItem(shortcutStorageKey, "disabled");
    } catch {
      // The current-page choice remains usable when storage is blocked.
    }
  }
  const trigger = (
    <button
      className="button button-quiet workspace-command-trigger"
      type="button"
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-keyshortcuts={enabled ? "Control+k Meta+k" : undefined}
      onClick={(event) => {
        event.currentTarget.focus();
        setOpen(true);
      }}
    >
      Commands
    </button>
  );
  return (
    <>
      <header className="workspace-topbar">
        <span>{workspaceName}</span>
        {trigger}
      </header>
      <header className="mobile-header">
        <div className="mobile-workspace-identity">
          <Link className="brand" href="/events">
            <span className="brand-mark">C</span>
            <span>Chronelle</span>
          </Link>
          <span className="mobile-workspace-name">{workspaceName}</span>
        </div>
        {trigger}
      </header>
      {open &&
        createPortal(
          <WorkspaceCommands
            workspaceName={workspaceName}
            shortcutEnabled={enabled}
            onShortcutChange={changeShortcut}
            onClose={() => setOpen(false)}
          />,
          document.body,
        )}
    </>
  );
}
