"use client";

import type {
  RevisionFieldChange,
  RevisionRestorePreview,
} from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { ErrorNotice, LoadingState, Notice } from "../../components/feedback";
import { tr } from "../../i18n/active-locale";
import { formatCalendarDate } from "../../lib/event-schedule";
import { formatDateTime, shortId } from "../../lib/format";
import {
  useObjectHistory,
  useRestorePreview,
  useRestoreRevision,
  useRevisionComparison,
} from "../../lib/history-queries";
import { personDisplayName } from "../../lib/person-fields";
import { useLabelsQuery, usePersonsQuery } from "../../lib/queries";
import { useSessionDialog } from "../../lib/use-session-dialog";

/** Names for the ids a change carries: people for assignees, labels for label lists. */
interface ChangeNames {
  readonly people: ReadonlyMap<string, string>;
  readonly labels: ReadonlyMap<string, string>;
}

const noNames: ChangeNames = { people: new Map(), labels: new Map() };

/** The workspace's people and labels, by id, so a change reads as names. */
function useChangeNames(): ChangeNames {
  const persons = usePersonsQuery();
  const labels = useLabelsQuery();
  const people = new Map(
    (persons.data?.items ?? []).map((person) => [
      person.id,
      personDisplayName(person),
    ]),
  );
  return { people, labels: labels.data?.names ?? new Map() };
}

const actionKeys = {
  recovered: "recovered",
  created: "created",
  updated: "updated",
  baseline: "baseline",
  permission_scope_updated: "permissionScope",
  deleted: "deleted",
  restored: "restored",
} as const;

const calendarDate = /^\d{4}-\d{2}-\d{2}$/u;

function displayValue(
  change: RevisionFieldChange,
  side: "before" | "after",
  names: ChangeNames = noNames,
): string {
  const t = tr("history.values");
  const present =
    side === "before" ? change.beforePresent : change.afterPresent;
  if (!present) return t("notSet");
  const value = change[side];
  if (value === null) return t("empty");
  if (change.field === "assigneeId" && typeof value === "string")
    return names.people.get(value) ?? value;
  if (change.field === "labelIds" && Array.isArray(value))
    return value
      .map((id) => (typeof id === "string" ? (names.labels.get(id) ?? id) : ""))
      .join(", ");
  if (change.valueType === "datetime" && typeof value === "string")
    return formatDateTime(value);
  if (typeof value === "string" && calendarDate.test(value))
    return formatCalendarDate(value);
  if (typeof value === "boolean") return value ? t("yes") : t("no");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

/** The field's name in the language: the catalog knows the typed fields, a custom property carries its key. */
function fieldLabel(change: RevisionFieldChange): string {
  const t = tr("history.fields");
  if (change.field.startsWith("customProperties."))
    return t("customProperty", {
      name: change.field.slice("customProperties.".length),
    });
  const key = change.field as Parameters<typeof t>[0];
  return t.has(key) ? t(key) : change.label;
}

/**
 * One line per changed field for a history row: the field, the value it
 * had (struck through), and the value it took, all on one line.
 */
function ChangePreview({
  changes,
  count,
  names,
}: {
  readonly changes: readonly RevisionFieldChange[];
  readonly count: number;
  readonly names: ChangeNames;
}) {
  const t = useTranslations("history");
  if (changes.length === 0) return null;
  const line = (value: string) => value.replace(/\s+/gu, " ");
  return (
    <ul className="history-change-lines">
      {changes.map((change) => (
        <li key={change.field}>
          {t.rich("changeLine", {
            field: fieldLabel(change),
            before: line(displayValue(change, "before", names)),
            after: line(displayValue(change, "after", names)),
            f: (chunks) => <span className="history-field">{chunks}</span>,
            from: (chunks) => <s className="history-from">{chunks}</s>,
            to: (chunks) => <span className="history-to">{chunks}</span>,
          })}
        </li>
      ))}
      {count > changes.length ? (
        <li className="history-more">
          {t("more", { count: count - changes.length })}
        </li>
      ) : null}
    </ul>
  );
}

function ChangeList({
  changes,
  preview = false,
}: {
  readonly changes: RevisionFieldChange[];
  readonly preview?: boolean;
}) {
  const t = useTranslations("history");
  const names = useChangeNames();
  return changes.length === 0 ? (
    <p className="muted">{t("noDifferences")}</p>
  ) : (
    <dl className="history-changes">
      {changes.map((change) => (
        <div className="history-change" key={change.field}>
          <dt>
            {fieldLabel(change)}
            {preview && !change.restorable ? (
              <span className="status-chip">{t("preserved")}</span>
            ) : null}
          </dt>
          <dd>
            <span>{preview ? t("current") : t("before")}</span>
            <pre>{displayValue(change, "before", names)}</pre>
          </dd>
          <dd>
            <span>
              {preview
                ? change.restorable
                  ? t("willRestore")
                  : t("historicalOnly")
                : t("after")}
            </span>
            <pre>{displayValue(change, "after", names)}</pre>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function RestorationPreview({
  objectId,
  version,
  onRestored,
}: {
  readonly objectId: string;
  readonly version: number;
  readonly onRestored: (version: number) => void;
}) {
  const t = useTranslations("history");
  const preview = useRestorePreview(objectId, version);
  const restore = useRestoreRevision(objectId);
  const [confirmed, setConfirmed] = useState(false);
  const [proposal, setProposal] = useState<RevisionRestorePreview | null>(null);
  // Confirmation is pinned to the exact preview shown, even if a background refresh completes.
  const shown = proposal ?? preview.data;
  const hasError = preview.isError || restore.isError;
  const region = useRef<HTMLElement>(null);
  const isReady = shown !== undefined;
  useEffect(() => {
    if (isReady) region.current?.focus();
  }, [isReady]);
  if (shown === undefined)
    return preview.isError ? (
      <ErrorNotice
        error={preview.error}
        onRefresh={() => void preview.refetch()}
      />
    ) : (
      <LoadingState label={t("loadingPreview")} />
    );
  return (
    <section
      ref={region}
      tabIndex={-1}
      className="history-preview"
      aria-label={t("restorePreview")}
    >
      <h3>{t("restoreVersion", { version })}</h3>
      <p>{t("restoreNote")}</p>
      <p className="muted">
        {t("previewBasedOn", { version: shown.currentVersion })}
      </p>
      <ChangeList changes={shown.changes} preview />
      <p>
        <strong>{t("alwaysPreserved")}</strong>{" "}
        {shown.preservedFields.join("; ")}.
      </p>
      {hasError ? (
        <ErrorNotice
          error={restore.error ?? preview.error}
          onRefresh={() => {
            restore.reset();
            setConfirmed(false);
            setProposal(null);
            void preview.refetch();
          }}
        />
      ) : null}
      {shown.canRestore ? (
        <>
          <label className="check-field">
            <input
              type="checkbox"
              checked={confirmed}
              disabled={restore.isPending || hasError || preview.isFetching}
              onChange={(event) => {
                setProposal(shown);
                setConfirmed(event.target.checked);
              }}
            />
            {t("reviewed")}
          </label>
          <button
            className="button button-primary"
            type="button"
            disabled={
              !confirmed || restore.isPending || hasError || preview.isFetching
            }
            onClick={() => {
              restore.mutate(
                { version, expectedVersion: shown.currentVersion },
                { onSuccess: (saved) => onRestored(saved.version) },
              );
            }}
          >
            {restore.isPending ? t("restoring") : t("confirmRestore")}
          </button>
        </>
      ) : (
        <p className="muted">{t("nothingToRestore")}</p>
      )}
    </section>
  );
}

export function HistoryDrawer({
  objectId,
  displayName,
  onClose,
}: {
  readonly objectId: string;
  readonly displayName: string;
  readonly onClose: () => void;
}) {
  const t = useTranslations("history");
  const dialog = useSessionDialog(onClose);
  const headingId = useId();
  const history = useObjectHistory(objectId);
  const [from, setFrom] = useState<number | null>(null);
  const [to, setTo] = useState<number | null>(null);
  const [restoreVersion, setRestoreVersion] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const comparison = useRevisionComparison(objectId, from, to);
  const revisions = history.data?.pages.flatMap((page) => page.items) ?? [];
  const newest = revisions[0]?.objectVersion;
  const comparisonRegion = useRef<HTMLElement>(null);
  const names = useChangeNames();
  const isComparing = from !== null && to !== null;
  useEffect(() => {
    if (isComparing) comparisonRegion.current?.focus();
  }, [isComparing]);

  return (
    <dialog
      ref={dialog}
      className="history-drawer"
      aria-labelledby={headingId}
      onCancel={onClose}
    >
      <header className="history-header">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h2 id={headingId}>{displayName}</h2>
        </div>
        <button
          className="button button-quiet"
          type="button"
          onClick={onClose}
          aria-label={t("close")}
        >
          {t("closeShort")}
        </button>
      </header>
      {message ? <Notice tone="success">{message}</Notice> : null}
      {history.isError ? (
        <ErrorNotice
          error={history.error}
          onRefresh={() => void history.refetch()}
        />
      ) : history.isPending ? (
        <LoadingState label={t("loading")} />
      ) : (
        <>
          <ol className="history-list">
            {revisions.map((revision) => (
              <li key={revision.id}>
                <div className="history-row-copy">
                  <p className="history-row-head">
                    <strong>
                      {t("version", { version: revision.objectVersion })}
                    </strong>
                    <span className="history-kind">
                      {t(`actions.${actionKeys[revision.mutationKind]}`)}
                    </span>
                  </p>
                  <p className="history-meta">
                    {formatDateTime(revision.createdAt)}
                    {" \u00b7 "}
                    {revision.actorType === "system"
                      ? t("system")
                      : (revision.actorDisplayName ??
                        `${revision.actorType.replace("_", " ")} ${shortId(revision.actorId ?? "")}`)}
                  </p>
                  {revision.mutationKind === "baseline" ? (
                    <p className="history-meta">{t("baselineNote")}</p>
                  ) : (
                    <ChangePreview
                      changes={revision.changedFields}
                      count={revision.changedFieldCount}
                      names={names}
                    />
                  )}
                </div>
                <div className="history-actions">
                  <button
                    aria-label={t("compare", {
                      version: revision.objectVersion,
                    })}
                    className="link-button link-button-quiet"
                    type="button"
                    onClick={() => {
                      setFrom(revision.objectVersion);
                      setTo(newest ?? revision.objectVersion);
                      setRestoreVersion(null);
                      setMessage(null);
                    }}
                  >
                    {t("compareShort")}
                  </button>
                  <button
                    aria-label={t("preview", {
                      version: revision.objectVersion,
                    })}
                    className="link-button link-button-quiet"
                    type="button"
                    onClick={() => {
                      setRestoreVersion(revision.objectVersion);
                      setFrom(null);
                      setTo(null);
                      setMessage(null);
                    }}
                  >
                    {t("previewShort")}
                  </button>
                </div>
              </li>
            ))}
          </ol>
          {history.hasNextPage ? (
            <button
              className="button button-secondary"
              type="button"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {history.isFetchingNextPage ? t("loadingMore") : t("loadOlder")}
            </button>
          ) : null}
          {revisions.length === 0 ? <p>{t("none")}</p> : null}
          {from !== null && to !== null ? (
            <section
              ref={comparisonRegion}
              tabIndex={-1}
              className="history-comparison"
              aria-label={t("comparison")}
            >
              <h3>{t("compareVersions")}</h3>
              <div className="form-grid">
                <label className="field">
                  <span>{t("before")}</span>
                  <select
                    value={from}
                    onChange={(event) => setFrom(Number(event.target.value))}
                  >
                    {revisions.map((revision) => (
                      <option key={revision.id} value={revision.objectVersion}>
                        {t("version", { version: revision.objectVersion })}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>{t("after")}</span>
                  <select
                    value={to}
                    onChange={(event) => setTo(Number(event.target.value))}
                  >
                    {revisions.map((revision) => (
                      <option key={revision.id} value={revision.objectVersion}>
                        {t("version", { version: revision.objectVersion })}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {comparison.isError ? (
                <ErrorNotice
                  error={comparison.error}
                  onRefresh={() => void comparison.refetch()}
                />
              ) : comparison.isPending ? (
                <LoadingState label={t("comparing")} />
              ) : (
                <ChangeList changes={comparison.data.changes} />
              )}
            </section>
          ) : null}
          {restoreVersion !== null ? (
            <RestorationPreview
              key={restoreVersion}
              objectId={objectId}
              version={restoreVersion}
              onRestored={(version) => {
                setRestoreVersion(null);
                setMessage(t("restored", { version }));
              }}
            />
          ) : null}
        </>
      )}
    </dialog>
  );
}
