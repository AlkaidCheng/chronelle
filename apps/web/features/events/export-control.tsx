"use client";

import type { EventResponse } from "@livtales/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { RefObject } from "react";

import { HeadMenu } from "../../components/head-menu";
import { DownloadIcon } from "../../components/icons";
import { dayKeyOf } from "../../lib/day-placement";
import { csvFile, exportFileName, saveFile } from "../../lib/export/csv";
import { printPanel } from "../../lib/export/print";
import type { ExportSheet } from "../../lib/export/sheets";
import { queryKeys } from "../../lib/queries";

/**
 * Export, at the end of a view's head row: the view as it is shown, with
 * its sort, filter, and layout applied, as a PDF (the browser's print
 * dialog over the view alone) or as data (a CSV file named after the
 * event, the view, and the day).
 */
export function ExportControl({
  eventId,
  panel,
  sheet,
  view,
  viewName,
}: {
  readonly eventId: string;
  readonly panel: RefObject<HTMLElement | null>;
  /**
   * The rows the view holds, in its order, built when an export is asked
   * for; the event's name is passed for a sheet that carries it.
   */
  readonly sheet: (eventName: string) => ExportSheet;
  /** The view's kind, marked on the document while it prints. */
  readonly view: string;
  /** The view as people read it: the file's name and the printed heading. */
  readonly viewName: string;
}) {
  const t = useTranslations("export");
  const cache = useQueryClient();
  const eventName = () =>
    cache.getQueryData<EventResponse>(queryKeys.eventResource(eventId))
      ?.displayName ?? "";

  function exportCsv() {
    const name = eventName();
    const { columns, rows } = sheet(name);
    saveFile(
      `${exportFileName([name, viewName, dayKeyOf(new Date())])}.csv`,
      csvFile(
        columns.map((column) => t(`columns.${column}`)),
        rows,
      ),
      "text/csv;charset=utf-8",
    );
  }

  function exportPdf() {
    if (panel.current === null) return;
    printPanel(panel.current, view);
  }

  return (
    <HeadMenu
      entries={[
        { kind: "item", label: t("pdf"), onSelect: exportPdf },
        { kind: "item", label: t("csv"), onSelect: exportCsv },
      ]}
      icon={<DownloadIcon />}
      label={t("title")}
    />
  );
}
