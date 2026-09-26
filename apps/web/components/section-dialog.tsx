"use client";

import { type ReactNode, useEffect, useId } from "react";
import { useSessionDialog } from "../lib/use-session-dialog";

/** One section of a section dialog, as its list shows it. */
export interface DialogSection {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
  /** The caption the section is listed under; a group's sections are adjacent. */
  readonly group?: string | undefined;
  /** A section of actions that cannot be undone, listed in the danger colour. */
  readonly tone?: "danger" | undefined;
}

/** Consecutive sections under one caption, or a single ungrouped one. */
interface SectionRun {
  readonly group: string | undefined;
  readonly sections: readonly DialogSection[];
}

function runsOf(sections: readonly DialogSection[]): readonly SectionRun[] {
  const runs: { group: string | undefined; sections: DialogSection[] }[] = [];
  for (const section of sections) {
    const last = runs.at(-1);
    if (section.group !== undefined && last?.group === section.group)
      last.sections.push(section);
    else runs.push({ group: section.group, sections: [section] });
  }
  return runs;
}

/**
 * A modal dialog of sections over the page it opens from: a heading above
 * the list of sections at the left (each with its icon, groups under their
 * captions), and the current section's title, the close control, and its
 * body at the right. On a narrow screen it fills the screen and the list
 * becomes a row that scrolls sideways. Escape and the close control close
 * it, and focus returns to the control that opened it.
 */
export function SectionDialog({
  label,
  heading,
  sections,
  current,
  onSelect,
  onClose,
  closeLabel,
  children,
}: {
  /** The dialog's accessible name. */
  readonly label: string;
  /** Shown above the list of sections. */
  readonly heading: ReactNode;
  readonly sections: readonly DialogSection[];
  readonly current: string;
  readonly onSelect: (id: string) => void;
  readonly onClose: () => void;
  readonly closeLabel: string;
  /** The current section's body. */
  readonly children: ReactNode;
}) {
  const dialog = useSessionDialog(onClose);
  const id = useId();
  const active = sections.find((section) => section.id === current);
  // Focus starts on the current section's entry once the dialog is modal,
  // so a dialog opened at a later section starts there.
  useEffect(() => {
    dialog.current
      ?.querySelector<HTMLElement>('[aria-current="page"]')
      ?.focus();
  }, [dialog]);
  const item = (section: DialogSection) => (
    <li key={section.id}>
      <button
        aria-current={section.id === current ? "page" : undefined}
        className={`section-dialog-item${section.tone === "danger" ? " is-danger" : ""}`}
        onClick={() => onSelect(section.id)}
        type="button"
      >
        {section.icon}
        <span>{section.label}</span>
      </button>
    </li>
  );
  return (
    <dialog
      ref={dialog}
      aria-label={label}
      className="section-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <nav aria-label={label} className="section-dialog-nav">
        <div className="section-dialog-heading">{heading}</div>
        <ul>
          {runsOf(sections).map((run, index) =>
            run.group === undefined ? (
              run.sections.map(item)
            ) : (
              <li
                className="section-dialog-group"
                key={run.sections[0]?.id ?? run.group}
              >
                <span id={`${id}-group-${index}`}>{run.group}</span>
                <ul aria-labelledby={`${id}-group-${index}`}>
                  {run.sections.map(item)}
                </ul>
              </li>
            ),
          )}
        </ul>
      </nav>
      <section aria-labelledby={`${id}-title`} className="section-dialog-body">
        <header className="section-dialog-head">
          <h2 id={`${id}-title`}>{active?.label}</h2>
          <button
            aria-label={closeLabel}
            className="dialog-close"
            onClick={onClose}
            type="button"
          >
            &#215;
          </button>
        </header>
        {/* Keyed by section, so each one opens scrolled to its top. */}
        <div key={current} className="section-dialog-content">
          {children}
        </div>
      </section>
    </dialog>
  );
}
