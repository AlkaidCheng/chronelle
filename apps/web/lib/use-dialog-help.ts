"use client";

import { useTranslations } from "next-intl";
import type { DialogHelp } from "../components/editor-dialog-controls";

/** The dialogs that carry a help control, each with its own entries. */
export type HelpedDialog =
  | "event"
  | "task"
  | "expense"
  | "reminder"
  | "note"
  | "person"
  | "page"
  | "tabs";

type EntryKey =
  | "drafts"
  | "schedule"
  | "reminder"
  | "noteText"
  | "accounts"
  | "fields"
  | "pages"
  | "presets"
  | "tabs"
  | "fixedTabs";

const entriesOf: Record<HelpedDialog, readonly EntryKey[]> = {
  event: ["schedule", "drafts"],
  task: ["drafts"],
  expense: ["drafts"],
  reminder: ["reminder", "drafts"],
  note: ["noteText", "drafts"],
  person: ["accounts", "fields", "drafts"],
  page: ["pages", "presets"],
  tabs: ["tabs", "fixedTabs"],
};

/**
 * The exposition a dialog's help control shows. The editors (which keep
 * drafts) read as "editor"; the page and tabs dialogs as "dialog".
 */
export function useDialogHelp(dialog: HelpedDialog): DialogHelp {
  const t = useTranslations("help");
  const surface = t(
    dialog === "page" || dialog === "tabs"
      ? "surface.dialog"
      : "surface.editor",
  );
  return {
    surface,
    entries: entriesOf[dialog].map((key) => ({
      title: t(`${key}.title`),
      body: t(`${key}.body`),
    })),
  };
}
