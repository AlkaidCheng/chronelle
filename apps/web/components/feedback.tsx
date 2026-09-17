"use client";

import { ApiClientError } from "@chronelle/api-client";
import { useTranslations } from "next-intl";
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

export function LoadingState({ label }: { readonly label?: string }) {
  const t = useTranslations("notices");
  return (
    <div aria-live="polite" className="loading-state" role="status">
      <span aria-hidden="true" className="spinner" />
      {label ?? t("loading")}
    </div>
  );
}

const mappedCodes = [
  "version_conflict",
  "workspace_unavailable",
  "network_error",
  "request_failed",
  "internal_error",
  "invalid_credentials",
  "email_unverified",
  "principal_unavailable",
] as const;
type MappedCode = (typeof mappedCodes)[number];

function isMappedCode(code: string): code is MappedCode {
  return (mappedCodes as readonly string[]).includes(code);
}

/**
 * What a notice says for an error: the message of a known API code in the
 * active language, the API's own message for others, and a generic line
 * for anything that is not an Error.
 */
export function useErrorMessage(): (error: unknown) => string {
  const t = useTranslations("notices");
  return (error) => {
    if (error instanceof ApiClientError && isMappedCode(error.code))
      return t(`codes.${error.code}`);
    return error instanceof Error ? error.message : t("incomplete");
  };
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
  const t = useTranslations("notices");
  const describe = useErrorMessage();
  const isConflict =
    error instanceof ApiClientError && error.code === "version_conflict";
  const message = describe(error);

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
              ? t("refreshing")
              : (refreshLabel ??
                (isConflict ? t("refreshLatest") : t("tryAgain")))}
          </button>
        ) : null
      }
      role="alert"
      title={isConflict ? t("newerVersion") : t("somethingWrong")}
      tone={isConflict ? "warning" : "danger"}
    >
      {message}
    </Notice>
  );
}
