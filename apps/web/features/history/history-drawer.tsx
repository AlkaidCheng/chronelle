"use client";

import type {
  RevisionFieldChange,
  RevisionRestorePreview,
} from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useEffect, useId, useRef, useState } from "react";

import { ErrorNotice, LoadingState, Notice } from "../../components/feedback";
import { tr } from "../../i18n/active-locale";
import { formatDateTime, shortId } from "../../lib/format";
import {
  useObjectHistory,
  useRestorePreview,
  useRestoreRevision,
  useRevisionComparison,
} from "../../lib/history-queries";
import { useSessionDialog } from "../../lib/use-session-dialog";

const actionKeys = {
  recovered: "recovered",
  created: "created",
  updated: "updated",
  baseline: "baseline",
  permission_scope_updated: "permissionScope",
  deleted: "deleted",
  restored: "restored",
} as const;

function displayValue(
  change: RevisionFieldChange,
  side: "before" | "after",
): string {
  const t = tr("history.values");
  const present =
    side === "before" ? change.beforePresent : change.afterPresent;
  if (!present) return t("notSet");
  const value = change[side];
  if (value === null) return t("empty");
  if (change.valueType === "datetime" && typeof value === "string")
    return formatDateTime(value);
  if (typeof value === "boolean") return value ? t("yes") : t("no");
  if (typeof value === "object") return JSON.stringify(value, null, 2);
  return String(value);
}

function ChangeList({
  changes,
  preview = false,
}: {
  readonly changes: RevisionFieldChange[];
  readonly preview?: boolean;
}) {
  const t = useTranslations("history");
  return changes.length === 0 ? (
    <p className="muted">{t("noDifferences")}</p>
  ) : (
    <dl className="history-changes">
      {changes.map((change) => (
        <div className="history-change" key={change.field}>
          <dt>
            {change.label}
            {preview && !change.restorable ? (
              <span className="status-chip">{t("preserved")}</span>
            ) : null}
          </dt>
          <dd>
            <span>{preview ? t("current") : t("before")}</span>
            <pre>{displayValue(change, "before")}</pre>
          </dd>
          <dd>
            <span>
              {preview
                ? change.restorable
                  ? t("willRestore")
                  : t("historicalOnly")
                : t("after")}
            </span>
            <pre>{displayValue(change, "after")}</pre>
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
          <code className="history-object-id" title={t("objectId")}>
            {objectId}
          </code>
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
      <p className="muted">{t("intro")}</p>
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
                <div>
                  <strong>
                    {t("version", { version: revision.objectVersion })}
                  </strong>{" "}
                  <span>
                    {t(`actions.${actionKeys[revision.mutationKind]}`)}
                  </span>
                  <p>
                    {formatDateTime(revision.createdAt)} /{" "}
                    {revision.actorType === "system"
                      ? t("system")
                      : (revision.actorDisplayName ??
                        `${revision.actorType.replace("_", " ")} ${shortId(revision.actorId ?? "")}`)}
                  </p>
                  {revision.mutationKind === "baseline" ? (
                    <p>{t("baselineNote")}</p>
                  ) : null}
                </div>
                <div className="history-actions">
                  <button
                    className="button button-quiet button-small"
                    type="button"
                    onClick={() => {
                      setFrom(revision.objectVersion);
                      setTo(newest ?? revision.objectVersion);
                      setRestoreVersion(null);
                      setMessage(null);
                    }}
                  >
                    {t("compare", { version: revision.objectVersion })}
                  </button>
                  <button
                    className="button button-secondary button-small"
                    type="button"
                    onClick={() => {
                      setRestoreVersion(revision.objectVersion);
                      setFrom(null);
                      setTo(null);
                      setMessage(null);
                    }}
                  >
                    {t("preview", { version: revision.objectVersion })}
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
