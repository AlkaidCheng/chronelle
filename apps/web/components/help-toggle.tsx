"use client";

import { useTranslations } from "next-intl";
import { useCallback, useId, useRef, useState } from "react";
import { HelpIcon } from "./icons";
import { useMenuDismissal } from "./quiet-menu";

/** One titled entry of a dialog's exposition. */
export interface HelpEntry {
  readonly title: string;
  readonly body: string;
}

/**
 * The quiet question mark in a dialog's header, the one place for
 * exposition: it opens a popover of short titled entries about that
 * dialog, none of them needed to use it. It belongs only to surfaces
 * opened deliberately; the pages and panels that are always in view carry
 * no help control. Escape and a press outside close the popover; from the
 * keyboard, focus returns to the control.
 */
export function HelpToggle({
  surface,
  entries,
  hidden = false,
  disabled = false,
}: {
  /** The dialog's kind as its name reads it: "editor" or "dialog". */
  readonly surface: string;
  readonly entries: readonly HelpEntry[];
  readonly hidden?: boolean;
  readonly disabled?: boolean;
}) {
  const t = useTranslations("help");
  const id = useId();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const contains = useCallback(
    (target: Node) => root.current?.contains(target) ?? false,
    [],
  );
  const close = useCallback((byKeyboard: boolean) => {
    setOpen(false);
    if (byKeyboard) trigger.current?.focus();
  }, []);
  useMenuDismissal(open, contains, close);
  const label = t("open", { surface });

  return (
    <span className="help-toggle" ref={root} hidden={hidden}>
      <button
        ref={trigger}
        type="button"
        className="help-toggle-control"
        aria-label={label}
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled}
        onClick={() => setOpen((value) => !value)}
      >
        <HelpIcon />
      </button>
      {open ? (
        <div className="help-popover" id={id} role="note" aria-label={label}>
          <h3>{label}</h3>
          <dl>
            {entries.map((entry) => (
              <div key={entry.title}>
                <dt>{entry.title}</dt>
                <dd>{entry.body}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </span>
  );
}
