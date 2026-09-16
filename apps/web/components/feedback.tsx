"use client";

import { ApiClientError } from "@chronelle/api-client";
import type { ReactNode } from "react";

import { AlertIcon, CheckIcon, InfoIcon } from "./icons";

/** What a notice means; its color and icon follow. */
export type NoticeTone = "neutral" | "success" | "warning" | "danger";

const toneIcons = {
  neutral: InfoIcon,
  success: CheckIcon,
  warning: AlertIcon,
  danger: AlertIcon,
} as const;

/**
 * A boxed notice in one tone. Errors alert; everything else is announced
 * politely as a status unless a role is given.
 */
export function Notice({
  action,
  children,
  role,
  title,
  tone = "neutral",
}: {
  readonly action?: ReactNode;
  readonly children: ReactNode;
  readonly role?: "alert" | "status";
  readonly title?: string;
  readonly tone?: NoticeTone;
}) {
  const Icon = toneIcons[tone];
  return (
    <div
      className={`notice notice-${tone}`}
      data-tone={tone}
      role={role ?? (tone === "danger" ? "alert" : "status")}
    >
      <span aria-hidden="true" className="notice-mark">
        <Icon />
      </span>
      <div className="notice-body">
        {title === undefined ? null : <strong>{title}</strong>}
        {typeof children === "string" ? <p>{children}</p> : children}
      </div>
      {action}
    </div>
  );
}

interface ErrorNoticeProps {
  readonly error: unknown;
  readonly onRefresh?: (() => void) | undefined;
  readonly refreshLabel?: string;
  readonly isRefreshing?: boolean;
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
  readonly description?: string;
  readonly title: string;
}) {
  return (
    <div className="empty-state">
      <span aria-hidden="true">+</span>
      <h3>{title}</h3>
      {description === undefined ? null : <p>{description}</p>}
    </div>
  );
}

export function ErrorNotice({
  error,
  onRefresh,
  refreshLabel,
  isRefreshing = false,
}: ErrorNoticeProps) {
  const isConflict =
    error instanceof ApiClientError && error.code === "version_conflict";
  const message =
    error instanceof Error
      ? error.message
      : "The request could not be completed.";

  return (
    <Notice
      action={
        onRefresh !== undefined ? (
          <button
            className="button button-secondary button-small"
            disabled={isRefreshing}
            onClick={onRefresh}
            type="button"
          >
            {isRefreshing
              ? "Refreshing..."
              : (refreshLabel ?? (isConflict ? "Refresh latest" : "Try again"))}
          </button>
        ) : null
      }
      role="alert"
      title={
        isConflict ? "A newer version is available" : "Something went wrong"
      }
      tone={isConflict ? "warning" : "danger"}
    >
      {message}
    </Notice>
  );
}

export function DraftNotice({
  onLoadLatest,
}: {
  readonly onLoadLatest: () => void;
}) {
  return (
    <Notice
      action={
        <button
          className="button button-secondary button-small"
          onClick={onLoadLatest}
          type="button"
        >
          Discard draft and load latest
        </button>
      }
      title="A newer version is available"
      tone="warning"
    >
      Your draft is preserved. Load the latest version to discard this draft and
      continue editing.
    </Notice>
  );
}
