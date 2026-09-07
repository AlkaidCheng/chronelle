"use client";

import type {
  RevisionFieldChange,
  RevisionRestorePreview,
} from "@chronelle/schemas";
import { useEffect, useId, useRef, useState } from "react";

import { ErrorNotice, LoadingState } from "../../components/feedback";
import { formatDateTime, shortId } from "../../lib/format";
import {
  useObjectHistory,
  useRestorePreview,
  useRestoreRevision,
  useRevisionComparison,
} from "../../lib/history-queries";
import { useSessionDialog } from "../../lib/use-session-dialog";

const actionNames = {
  recovered: "Recovered from trash",
  created: "Created",
  updated: "Edited",
  baseline: "Baseline captured",
  permission_scope_updated: "Permission scope changed",
  deleted: "Moved to trash",
  restored: "Restored",
};

function displayValue(
  change: RevisionFieldChange,
  side: "before" | "after",
): string {
  const present =
    side === "before" ? change.beforePresent : change.afterPresent;
  if (!present) return "Not set";
  const value = change[side];
  if (value === null) return "Empty";
  if (change.valueType === "datetime" && typeof value === "string")
    return formatDateTime(value);
  if (typeof value === "boolean") return value ? "Yes" : "No";
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
  return changes.length === 0 ? (
    <p className="muted">No content differences between these versions.</p>
  ) : (
    <dl className="history-changes">
      {changes.map((change) => (
        <div className="history-change" key={change.field}>
          <dt>
            {change.label}
            {preview && !change.restorable ? (
              <span className="status-chip">Preserved</span>
            ) : null}
          </dt>
          <dd>
            <span>{preview ? "Current" : "Before"}</span>
            <pre>{displayValue(change, "before")}</pre>
          </dd>
          <dd>
            <span>
              {preview
                ? change.restorable
                  ? "Will restore"
                  : "Historical only"
                : "After"}
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
      <LoadingState label="Loading restore preview" />
    );
  return (
    <section
      ref={region}
      tabIndex={-1}
      className="history-preview"
      aria-label="Restore preview"
    >
      <h3>Restore version {version}</h3>
      <p>
        This creates a new version of this object. Later history remains
        available. Any open editor draft is kept and may need reconciliation.
      </p>
      <p className="muted">
        Preview based on current version {shown.currentVersion}.
      </p>
      <ChangeList changes={shown.changes} preview />
      <p>
        <strong>Always preserved:</strong> {shown.preservedFields.join("; ")}.
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
            I reviewed the changes to this canonical object.
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
            {restore.isPending ? "Restoring..." : "Confirm restore"}
          </button>
        </>
      ) : (
        <p className="muted">
          There are no eligible changes to restore, or your access is read-only.
        </p>
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
          <p className="eyebrow">Object history</p>
          <h2 id={headingId}>{displayName}</h2>
        </div>
        <button
          className="button button-quiet"
          type="button"
          onClick={onClose}
          aria-label="Close history"
        >
          Close
        </button>
      </header>
      <p className="muted">
        Saved versions of one canonical object. History follows current access.
      </p>
      {message ? (
        <p role="status" className="notice">
          {message}
        </p>
      ) : null}
      {history.isError ? (
        <ErrorNotice
          error={history.error}
          onRefresh={() => void history.refetch()}
        />
      ) : history.isPending ? (
        <LoadingState label="Loading history" />
      ) : (
        <>
          <ol className="history-list">
            {revisions.map((revision) => (
              <li key={revision.id}>
                <div>
                  <strong>Version {revision.objectVersion}</strong>{" "}
                  <span>{actionNames[revision.mutationKind]}</span>
                  <p>
                    {formatDateTime(revision.createdAt)} /{" "}
                    {revision.actorType === "system"
                      ? "System"
                      : (revision.actorDisplayName ??
                        `${revision.actorType.replace("_", " ")} ${shortId(revision.actorId ?? "")}`)}
                  </p>
                  {revision.mutationKind === "baseline" ? (
                    <p>Earlier states were not recorded.</p>
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
                    Compare v{revision.objectVersion}
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
                    Preview v{revision.objectVersion}
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
              {history.isFetchingNextPage
                ? "Loading..."
                : "Load older versions"}
            </button>
          ) : null}
          {revisions.length === 0 ? (
            <p>No saved versions are available.</p>
          ) : null}
          {from !== null && to !== null ? (
            <section
              ref={comparisonRegion}
              tabIndex={-1}
              className="history-comparison"
              aria-label="Version comparison"
            >
              <h3>Compare versions</h3>
              <div className="form-grid">
                <label className="field">
                  <span>Before</span>
                  <select
                    value={from}
                    onChange={(event) => setFrom(Number(event.target.value))}
                  >
                    {revisions.map((revision) => (
                      <option key={revision.id} value={revision.objectVersion}>
                        Version {revision.objectVersion}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>After</span>
                  <select
                    value={to}
                    onChange={(event) => setTo(Number(event.target.value))}
                  >
                    {revisions.map((revision) => (
                      <option key={revision.id} value={revision.objectVersion}>
                        Version {revision.objectVersion}
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
                <LoadingState label="Comparing versions" />
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
                setMessage(
                  `Restored as version ${version}. Other views have been refreshed.`,
                );
              }}
            />
          ) : null}
        </>
      )}
    </dialog>
  );
}
