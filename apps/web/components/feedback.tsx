"use client";

import { ApiClientError } from "@chronelle/api-client";

interface ErrorNoticeProps {
  readonly error: unknown;
  readonly onRefresh?: (() => void) | undefined;
}

export function LoadingState({
  label = "Loading",
}: {
  readonly label?: string;
}) {
  return (
    <div aria-live="polite" className="loading-state" role="status">
      <span aria-hidden="true" className="spinner" />
      {label}
    </div>
  );
}

export function EmptyState({
  description,
  title,
}: {
  readonly description: string;
  readonly title: string;
}) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">+</span>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

export function ErrorNotice({ error, onRefresh }: ErrorNoticeProps) {
  const isConflict =
    error instanceof ApiClientError && error.code === "version_conflict";
  const message =
    error instanceof Error
      ? error.message
      : "The request could not be completed.";

  return (
    <div
      className={isConflict ? "notice notice-conflict" : "notice notice-error"}
      role="alert"
    >
      <div>
        <strong>
          {isConflict ? "A newer version is available" : "Something went wrong"}
        </strong>
        <p>{message}</p>
      </div>
      {onRefresh !== undefined ? (
        <button
          className="button button-secondary button-small"
          onClick={onRefresh}
          type="button"
        >
          {isConflict ? "Refresh latest" : "Try again"}
        </button>
      ) : null}
    </div>
  );
}

export function DraftNotice({
  onLoadLatest,
}: {
  readonly onLoadLatest: () => void;
}) {
  return (
    <div className="notice notice-conflict" role="status">
      <div>
        <strong>A newer version is available</strong>
        <p>
          Your draft is preserved. Load the latest version to discard this draft
          and continue editing.
        </p>
      </div>
      <button
        className="button button-secondary button-small"
        onClick={onLoadLatest}
        type="button"
      >
        Discard draft and load latest
      </button>
    </div>
  );
}
