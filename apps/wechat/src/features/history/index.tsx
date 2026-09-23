import { ApiClientError } from "@chronelle/api-client";
import type {
  RevisionFieldChange,
  RevisionListResponse,
  SessionResponse,
} from "@chronelle/schemas";
import { Button, Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh, useRouter } from "@tarojs/taro";
import { useState } from "react";

import { useSession } from "../../auth/session-context";
import { formatEventSchedule, formatInstant } from "../../events/format";
import {
  historyFieldLabel,
  historySummaryValue,
  historyValue,
  isHistoryPermissionLoss,
  reviewRestoration,
  restoreRequestForPreview,
} from "../../events/history";
import {
  useEventHistory,
  useEventRestorePreview,
  useEventRevision,
  useRestoreEventRevision,
} from "../../events/history-queries";
import { useEventOverview } from "../../events/queries";
import {
  getMessages,
  interpolate,
  resolveLocale,
  type AppLocale,
} from "../../i18n/catalog";
import { useOnline } from "../../runtime/online";
import "./index.scss";

type HistoryIssue =
  "conflict" | "failed" | "permission" | "readonly" | "success" | null;

function HistoryState({
  action,
  detail,
  onAction,
  title,
}: {
  readonly action?: string;
  readonly detail: string;
  readonly onAction?: () => void;
  readonly title: string;
}) {
  return (
    <View className="history-state">
      <Text className="history-state__title">{title}</Text>
      <Text className="history-state__detail">{detail}</Text>
      {action && onAction ? (
        <Button className="history-button" onClick={onAction}>
          {action}
        </Button>
      ) : null}
    </View>
  );
}

function revisionKind(
  kind: RevisionListResponse["items"][number]["mutationKind"],
  locale: AppLocale,
) {
  const labels = {
    "en-US": {
      baseline: "Initial record",
      created: "Created",
      deleted: "Deleted",
      permission_scope_updated: "Access changed",
      recovered: "Recovered",
      restored: "Restored",
      updated: "Updated",
    },
    "zh-CN": {
      baseline: "初始记录",
      created: "已创建",
      deleted: "已删除",
      permission_scope_updated: "权限变更",
      recovered: "已恢复",
      restored: "内容已恢复",
      updated: "已更新",
    },
  } as const;
  return labels[locale][kind];
}

function ChangeRow({
  change,
  locale,
}: {
  readonly change: RevisionFieldChange;
  readonly locale: AppLocale;
}) {
  const messages = getMessages(locale);
  return (
    <View className="history-change">
      <Text className="history-change__label">
        {historyFieldLabel(change, locale)}
        {!change.restorable ? ` · ${messages.historyPreservedTag}` : ""}
      </Text>
      <Text className="history-change__value">
        {historyValue(change.before, change.beforePresent, locale)} →{" "}
        {historyValue(change.after, change.afterPresent, locale)}
      </Text>
    </View>
  );
}

function ReadyHistory({
  eventId,
  session,
}: {
  readonly eventId: string;
  readonly session: SessionResponse;
}) {
  const locale = resolveLocale(session.user.locale ?? undefined);
  const messages = getMessages(locale);
  const online = useOnline();
  const overview = useEventOverview(session.workspace.id, eventId);
  const history = useEventHistory(session.workspace.id, eventId);
  const [selectedVersion, setSelectedVersion] = useState<number | null>(null);
  const [issue, setIssue] = useState<HistoryIssue>(null);
  const revision = useEventRevision(
    session.workspace.id,
    eventId,
    selectedVersion,
  );
  const preview = useEventRestorePreview(
    session.workspace.id,
    eventId,
    selectedVersion,
  );
  const restore = useRestoreEventRevision(session.workspace.id, eventId);
  const preferences = {
    hourCycle: session.user.hourCycle,
    locale,
    timeZone: session.user.timeZone,
  };

  usePullDownRefresh(() => {
    void Promise.all([
      overview.refetch(),
      history.refetch(),
      ...(selectedVersion === null
        ? []
        : [revision.refetch(), preview.refetch()]),
    ]).finally(() => Taro.stopPullDownRefresh());
  });

  const permissionLost =
    issue === "permission" ||
    [overview.error, history.error, revision.error, preview.error].some(
      isHistoryPermissionLoss,
    );
  if (permissionLost) {
    return (
      <View className="history-shell">
        <HistoryState
          action={messages.backToEvents}
          detail={messages.permissionLostDetail}
          onAction={() => void Taro.reLaunch({ url: "/pages/index/index" })}
          title={messages.permissionLostTitle}
        />
      </View>
    );
  }
  if (overview.isPending || history.isPending) {
    return (
      <View className="history-shell">
        <HistoryState
          detail={messages.eventHistoryDescription}
          title={messages.loading}
        />
      </View>
    );
  }
  if (overview.isError || history.isError || !overview.data || !history.data) {
    return (
      <View className="history-shell">
        <HistoryState
          action={messages.retry}
          detail={online ? messages.errorDetail : messages.offlineDetail}
          onAction={() =>
            void Promise.all([overview.refetch(), history.refetch()])
          }
          title={online ? messages.errorTitle : messages.offlineTitle}
        />
      </View>
    );
  }

  const canEdit = overview.data.access.actions.includes("edit");
  const items = history.data.pages.flatMap((page) => page.items);

  async function confirmRestore(): Promise<void> {
    if (
      selectedVersion === null ||
      preview.data === undefined ||
      restore.isPending
    )
      return;
    const displayed = preview.data;
    setIssue(null);
    try {
      const [freshOverview, freshPreview] = await Promise.all([
        overview.refetch(),
        preview.refetch(),
      ]);
      if (freshOverview.error) throw freshOverview.error;
      if (freshPreview.error) throw freshPreview.error;
      const latest = freshPreview.data;
      if (!freshOverview.data || !latest)
        throw new Error("History preview unavailable.");
      const reviewed = reviewRestoration(
        displayed,
        latest,
        freshOverview.data.event.version,
        freshOverview.data.access.actions.includes("edit"),
      );
      if (reviewed.status === "readonly") {
        setIssue("readonly");
        return;
      }
      if (reviewed.status === "changed") {
        setIssue("conflict");
        return;
      }
      if (reviewed.status === "unavailable") {
        setIssue("failed");
        return;
      }
      const answer = await Taro.showModal({
        title: messages.historyRestoreConfirmTitle,
        content: interpolate(messages.historyRestoreConfirmDetail, {
          current: latest.currentVersion,
          source: latest.sourceVersion,
        }),
        confirmText: messages.historyRestore,
        cancelText: messages.cancel,
      });
      if (!answer.confirm) return;
      await restore.mutateAsync({
        version: selectedVersion,
        expectedVersion: reviewed.request.expectedVersion,
      });
      setIssue("success");
    } catch (error) {
      if (isHistoryPermissionLoss(error)) {
        const refreshed = await overview.refetch();
        setIssue(
          refreshed.data && !refreshed.data.access.actions.includes("edit")
            ? "readonly"
            : "permission",
        );
      } else if (error instanceof ApiClientError && error.status === 409) {
        setIssue("conflict");
        void Promise.all([overview.refetch(), preview.refetch()]).catch(
          () => undefined,
        );
      } else {
        setIssue("failed");
      }
    }
  }

  const selected = revision.data;
  const selectedEvent =
    selected?.snapshot.objectType === "event" ? selected.snapshot : null;
  const selectionError = revision.isError || preview.isError;
  const restoreRequest =
    preview.data === undefined
      ? null
      : restoreRequestForPreview(preview.data, canEdit && issue !== "readonly");

  return (
    <View className="history-shell">
      <Button className="history-back" onClick={() => void Taro.navigateBack()}>
        {messages.eventOverview}
      </Button>
      <Text className="history-eyebrow">{messages.eventHistory}</Text>
      <Text className="history-title">{overview.data.event.displayName}</Text>
      <Text className="history-intro">{messages.eventHistoryDescription}</Text>
      {!canEdit ? (
        <Text className="history-notice">{messages.historyReadOnly}</Text>
      ) : null}
      {issue === "readonly" && canEdit ? (
        <Text className="history-notice">{messages.historyReadOnly}</Text>
      ) : null}
      {issue === "conflict" ? (
        <Text className="history-notice">{messages.historyConflict}</Text>
      ) : null}
      {issue === "failed" ? (
        <Text className="history-notice">{messages.historyRestoreFailed}</Text>
      ) : null}
      {issue === "success" ? (
        <Text className="history-notice">
          {messages.historyRestoreSucceeded}
        </Text>
      ) : null}

      {selectedVersion === null ? (
        <View>
          {items.length === 0 ? (
            <HistoryState
              detail={messages.historyEmptyDetail}
              title={messages.historyEmptyTitle}
            />
          ) : (
            items.map((item) => (
              <Button
                className="history-entry"
                key={item.id}
                onClick={() => {
                  setIssue(null);
                  setSelectedVersion(item.objectVersion);
                }}
              >
                <Text className="history-entry__title">
                  {interpolate(messages.historyVersion, {
                    version: item.objectVersion,
                  })}{" "}
                  · {revisionKind(item.mutationKind, locale)}
                </Text>
                <Text className="history-entry__meta">
                  {formatInstant(item.createdAt, preferences)} ·{" "}
                  {item.actorDisplayName ?? messages.historyUnknownActor}
                </Text>
                {item.changedFields.map((change) => (
                  <Text className="history-entry__change" key={change.field}>
                    {historyFieldLabel(change, locale)}:{" "}
                    {historySummaryValue(
                      change.after,
                      change.afterPresent,
                      locale,
                    )}
                  </Text>
                ))}
                {item.changedFieldCount > item.changedFields.length ? (
                  <Text className="history-entry__meta">
                    {interpolate(messages.historyMoreFields, {
                      count: item.changedFieldCount - item.changedFields.length,
                    })}
                  </Text>
                ) : null}
              </Button>
            ))
          )}
          {history.hasNextPage ? (
            <Button
              className="history-button"
              disabled={history.isFetchingNextPage}
              onClick={() => void history.fetchNextPage()}
            >
              {messages.loadMore}
            </Button>
          ) : null}
          {history.isFetchNextPageError ? (
            <Text className="history-notice">{messages.errorDetail}</Text>
          ) : null}
        </View>
      ) : (
        <View>
          <Button
            className="history-back"
            onClick={() => {
              setIssue(null);
              setSelectedVersion(null);
            }}
          >
            {messages.historyBackToList}
          </Button>
          {revision.isPending || preview.isPending ? (
            <HistoryState
              detail={messages.eventHistoryDescription}
              title={messages.loading}
            />
          ) : selectionError || !selected || !selectedEvent || !preview.data ? (
            <HistoryState
              action={messages.retry}
              detail={online ? messages.errorDetail : messages.offlineDetail}
              onAction={() =>
                void Promise.all([revision.refetch(), preview.refetch()])
              }
              title={online ? messages.errorTitle : messages.offlineTitle}
            />
          ) : (
            <View>
              <Text className="history-section-title">
                {interpolate(messages.historyVersion, {
                  version: selected.objectVersion,
                })}
              </Text>
              <Text className="history-entry__meta">
                {revisionKind(selected.mutationKind, locale)} ·{" "}
                {formatInstant(selected.createdAt, preferences)}
              </Text>
              <Text className="history-snapshot-name">
                {selectedEvent.displayName}
              </Text>
              <Text className="history-snapshot-detail">
                {formatEventSchedule(selectedEvent, preferences) ??
                  messages.unscheduled}
              </Text>
              {selectedEvent.location ? (
                <Text className="history-snapshot-detail">
                  {messages.location}: {selectedEvent.location}
                </Text>
              ) : null}
              {selectedEvent.description ? (
                <Text className="history-snapshot-detail">
                  {selectedEvent.description}
                </Text>
              ) : null}
              <Text className="history-section-title">
                {messages.historyComparedToCurrent}
              </Text>
              {preview.data.changes.length === 0 ? (
                <Text className="history-snapshot-detail">
                  {messages.historyNoChanges}
                </Text>
              ) : (
                preview.data.changes.map((change) => (
                  <ChangeRow
                    change={change}
                    key={change.field}
                    locale={locale}
                  />
                ))
              )}
              <Text className="history-snapshot-detail">
                {messages.historyPreservedDetail}
              </Text>
              {restoreRequest !== null ? (
                <Button
                  className="history-button history-button--primary"
                  disabled={restore.isPending || !online}
                  onClick={() => void confirmRestore()}
                >
                  {restore.isPending
                    ? messages.saving
                    : messages.historyRestore}
                </Button>
              ) : canEdit && issue !== "readonly" ? (
                <Text className="history-notice">
                  {messages.historyCannotRestore}
                </Text>
              ) : null}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

export default function EventHistoryPage() {
  const route = useRouter();
  const session = useSession();
  const eventId = typeof route.params.id === "string" ? route.params.id : "";
  const locale = resolveLocale(
    session.state.status === "ready"
      ? (session.state.session.user.locale ?? undefined)
      : undefined,
  );
  const messages = getMessages(locale);
  if (
    session.state.status === "restoring" ||
    session.state.status === "loading"
  ) {
    return (
      <View className="history-shell">
        <HistoryState
          detail={messages.eventHistoryDescription}
          title={messages.loading}
        />
      </View>
    );
  }
  if (session.state.status === "ready" && eventId.length > 0) {
    return <ReadyHistory eventId={eventId} session={session.state.session} />;
  }
  return (
    <View className="history-shell">
      <HistoryState
        action={messages.backToEvents}
        detail={
          session.state.status === "offline"
            ? messages.offlineDetail
            : messages.permissionLostDetail
        }
        onAction={() => void Taro.reLaunch({ url: "/pages/index/index" })}
        title={
          session.state.status === "offline"
            ? messages.offlineTitle
            : messages.permissionLostTitle
        }
      />
    </View>
  );
}
