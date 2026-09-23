import { ApiClientError } from "@chronelle/api-client";
import type {
  RevisionFieldChange,
  RevisionRestorePreview,
  RevisionRestoreRequest,
} from "@chronelle/schemas";

import type { AppLocale } from "../i18n/catalog";

export function isHistoryPermissionLoss(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.status === 403 || error.status === 404)
  );
}

export function restoreRequestForPreview(
  preview: RevisionRestorePreview,
  canEdit: boolean,
): RevisionRestoreRequest | null {
  return canEdit && preview.canRestore
    ? { expectedVersion: preview.currentVersion }
    : null;
}

export function reviewRestoration(
  displayed: RevisionRestorePreview,
  fresh: RevisionRestorePreview,
  currentEventVersion: number,
  canEdit: boolean,
):
  | { readonly status: "ready"; readonly request: RevisionRestoreRequest }
  | { readonly status: "changed" }
  | { readonly status: "readonly" }
  | { readonly status: "unavailable" } {
  if (!canEdit) return { status: "readonly" };
  if (
    displayed.sourceRevisionId !== fresh.sourceRevisionId ||
    displayed.currentVersion !== fresh.currentVersion ||
    currentEventVersion !== fresh.currentVersion
  ) {
    return { status: "changed" };
  }
  const request = restoreRequestForPreview(fresh, canEdit);
  return request === null
    ? { status: "unavailable" }
    : { status: "ready", request };
}

const fieldNames: Readonly<Record<string, string>> = {
  displayName: "名称",
  startsOn: "开始日期",
  endsOn: "结束日期",
  startsAt: "开始时间",
  endsAt: "结束时间",
  timezone: "时区",
  isAllDay: "全天",
  location: "地点",
  description: "详情",
};

export function historyFieldLabel(
  change: RevisionFieldChange,
  locale: AppLocale,
): string {
  if (locale === "en-US") return change.label;
  if (change.field.startsWith("customProperties.")) {
    return `自定义属性：${change.field.slice("customProperties.".length)}`;
  }
  return fieldNames[change.field] ?? change.label;
}

export function historyValue(
  value: unknown,
  present: boolean,
  locale: AppLocale,
): string {
  if (!present || value === null || value === undefined || value === "") {
    return locale === "zh-CN" ? "未设置" : "Not set";
  }
  if (typeof value === "boolean") {
    return value
      ? locale === "zh-CN"
        ? "是"
        : "Yes"
      : locale === "zh-CN"
        ? "否"
        : "No";
  }
  const content =
    typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? String(value));
  return content.length > 160 ? `${content.slice(0, 160)}…` : content;
}
