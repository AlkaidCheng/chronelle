"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";
import { Notice } from "../../components/feedback";
import { formatCalendarDate } from "../../lib/event-schedule";
import { formatDateTime } from "../../lib/format";
import { useObjectHistory } from "../../lib/history-queries";

/** The editor's draft against the newest version, both pinned to one base. */
export interface ConflictDraft<Fields extends Record<string, string>> {
  readonly fields: Fields;
  readonly baseline: Fields;
  readonly theirs: Fields | undefined;
}

/** Shows a field's value the way the editor names it; empty reads as such. */
export type FieldFormatter = (key: string, value: string) => string | undefined;

const calendarDate = /^\d{4}-\d{2}-\d{2}$/u;
const localDateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u;

/** A date or date-time the editor keeps as an input value, in the display locale. */
function formatFieldValue(value: string): string {
  if (calendarDate.test(value)) return formatCalendarDate(value);
  if (localDateTime.test(value)) return formatDateTime(value);
  return value;
}

interface Row {
  readonly key: string;
  readonly mine: string;
  readonly theirs: string;
  /** Who changed the field since the base: one side merges silently. */
  readonly changedBy: "mine" | "theirs" | "both";
}

function rows<Fields extends Record<string, string>>(
  draft: ConflictDraft<Fields>,
): Row[] {
  const theirs = draft.theirs;
  if (theirs === undefined) return [];
  return Object.keys(draft.baseline).flatMap((key) => {
    const base = draft.baseline[key] ?? "";
    const mine = draft.fields[key] ?? "";
    const other = theirs[key] ?? "";
    const mineChanged = mine !== base;
    const theirsChanged = other !== base;
    if (!mineChanged && !theirsChanged) return [];
    return [
      {
        key,
        mine,
        theirs: other,
        changedBy:
          mineChanged && theirsChanged
            ? "both"
            : mineChanged
              ? "mine"
              : "theirs",
      },
    ];
  });
}

/**
 * A stale write, compared: the fields that differ between the draft and the
 * newest version, with the author and time of theirs, and three ways out.
 * Keep mine writes the draft over the newest version; Take theirs loads it
 * and drops the draft; Merge fields chooses per field, where a field only
 * one side changed is kept from that side.
 */
export function ConflictNotice<Fields extends Record<string, string>>({
  draft,
  format,
  objectId,
  onKeepMine,
  onMerge,
  onTakeTheirs,
}: {
  readonly draft: ConflictDraft<Fields>;
  readonly format?: FieldFormatter | undefined;
  readonly objectId: string;
  readonly onKeepMine: () => void;
  readonly onMerge: (fields: Fields) => void;
  readonly onTakeTheirs: () => void;
}) {
  const t = useTranslations("conflict");
  const names = useTranslations("conflict.fields");
  const history = useObjectHistory(objectId);
  const id = useId();
  const [merging, setMerging] = useState(false);
  const [chosen, setChosen] = useState<Record<string, "mine" | "theirs">>({});
  const newest = history.data?.pages[0]?.items[0];
  const author = newest?.actorDisplayName ?? t("someone");
  const differences = rows(draft);
  const show = (key: string, value: string) =>
    format?.(key, value) ??
    (value === "" ? t("empty") : formatFieldValue(value));
  const label = (field: string) => {
    const key = field as Parameters<typeof names>[0];
    return names.has(key) ? names(key) : field;
  };
  const side = (row: Row): "mine" | "theirs" =>
    row.changedBy === "both" ? (chosen[row.key] ?? "theirs") : row.changedBy;

  function merged(): Fields {
    const result: Record<string, string> = { ...draft.baseline };
    for (const row of differences)
      result[row.key] = side(row) === "mine" ? row.mine : row.theirs;
    return result as Fields;
  }

  return (
    <Notice role="alert" title={t("title")} tone="warning">
      <p className="conflict-meta">
        {newest === undefined
          ? null
          : `${t("theirs", {
              name: author,
              when: formatDateTime(newest.createdAt),
            })}. `}
        {t("draftKept")}
      </p>
      <table className="conflict-table">
        <thead>
          <tr>
            <th scope="col">{t("field")}</th>
            <th scope="col">{t("mine")}</th>
            <th scope="col">{author}</th>
          </tr>
        </thead>
        <tbody>
          {differences.map((row) => {
            const picked = side(row);
            const choice = merging && row.changedBy === "both";
            return (
              <tr
                className={
                  row.changedBy === "both" ? "conflict-both" : undefined
                }
                key={row.key}
              >
                <th scope="row">{label(row.key)}</th>
                <td
                  className={
                    merging && picked === "mine" ? "conflict-kept" : undefined
                  }
                >
                  {choice ? (
                    <label>
                      <input
                        checked={picked === "mine"}
                        name={`${id}-${row.key}`}
                        onChange={() =>
                          setChosen((current) => ({
                            ...current,
                            [row.key]: "mine",
                          }))
                        }
                        type="radio"
                      />
                      {show(row.key, row.mine)}
                    </label>
                  ) : (
                    show(row.key, row.mine)
                  )}
                  {merging && !choice && picked === "mine" ? (
                    <span className="conflict-chip">{t("kept")}</span>
                  ) : null}
                </td>
                <td
                  className={
                    merging && picked === "theirs" ? "conflict-kept" : undefined
                  }
                >
                  {choice ? (
                    <label>
                      <input
                        checked={picked === "theirs"}
                        name={`${id}-${row.key}`}
                        onChange={() =>
                          setChosen((current) => ({
                            ...current,
                            [row.key]: "theirs",
                          }))
                        }
                        type="radio"
                      />
                      {show(row.key, row.theirs)}
                    </label>
                  ) : (
                    show(row.key, row.theirs)
                  )}
                  {merging && !choice && picked === "theirs" ? (
                    <span className="conflict-chip">{t("kept")}</span>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="conflict-actions">
        {merging ? (
          <button
            className="button button-primary button-small"
            onClick={() => onMerge(merged())}
            type="button"
          >
            {t("saveMerged")}
          </button>
        ) : (
          <>
            <button
              className="button button-secondary button-small"
              onClick={onKeepMine}
              type="button"
            >
              {t("keepMine")}
            </button>
            <button
              className="button button-secondary button-small"
              onClick={onTakeTheirs}
              type="button"
            >
              {t("takeTheirs")}
            </button>
            <button
              className="button button-secondary button-small"
              onClick={() => setMerging(true)}
              type="button"
            >
              {t("merge")}
            </button>
          </>
        )}
      </div>
    </Notice>
  );
}
