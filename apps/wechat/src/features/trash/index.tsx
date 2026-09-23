import type { SessionResponse, TrashItem } from "@chronelle/schemas";
import { useQueryClient } from "@tanstack/react-query";
import { Button, Picker, ScrollView, Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { useMemo, useState } from "react";

import { useSession } from "../../auth/session-context";
import { formatInstant } from "../../events/format";
import {
  type AppLocale,
  getMessages,
  interpolate,
  resolveLocale,
} from "../../i18n/catalog";
import {
  recoveryErrorKind,
  recoveryPreviewQueryKey,
  recoveryTarget,
  trashObjectTypes,
  trashTypeLabels,
} from "../../recovery/data";
import {
  useRecoverObject,
  useRecoveryPreview,
  useTrash,
} from "../../recovery/queries";
import { useOnline } from "../../runtime/online";
import "./index.scss";

function TrashState({
  action,
  detail,
  onAction,
  title,
}: {
  readonly action?: string | undefined;
  readonly detail: string;
  readonly onAction?: (() => void) | undefined;
  readonly title: string;
}) {
  return (
    <View className="trash-state">
      <Text className="trash-state__title">{title}</Text>
      <Text className="trash-state__detail">{detail}</Text>
      {action && onAction ? (
        <Button
          className="trash-button trash-button--secondary"
          onClick={onAction}
        >
          {action}
        </Button>
      ) : null}
    </View>
  );
}

function RecoveryDetail({
  objectId,
  onBack,
  session,
}: {
  readonly objectId: string;
  readonly onBack: () => void;
  readonly session: SessionResponse;
}) {
  const locale = resolveLocale(session.user.locale ?? undefined);
  const messages = getMessages(locale);
  const online = useOnline();
  const preview = useRecoveryPreview(session.workspace.id, objectId);
  const recover = useRecoverObject();
  const [issue, setIssue] = useState<
    "conflict" | "request" | "unavailable" | null
  >(null);
  const [confirming, setConfirming] = useState(false);
  const [recovered, setRecovered] = useState(false);
  const data = preview.data;
  const unavailable =
    issue === "unavailable" ||
    (preview.isError && recoveryErrorKind(preview.error) === "unavailable");

  async function restore() {
    if (
      data === undefined ||
      confirming ||
      recover.isPending ||
      preview.isFetching
    )
      return;
    const target = recoveryTarget(data);
    if (target === null) return;
    setConfirming(true);
    try {
      const answer = await Taro.showModal({
        title: messages.trashConfirmTitle,
        content: interpolate(messages.trashConfirmDetail, {
          name: data.object.displayName,
        }),
        confirmText: messages.trashConfirmAction,
        cancelText: messages.cancel,
      });
      if (!answer.confirm) return;
      setIssue(null);
      await recover.mutateAsync(target);
      setRecovered(true);
    } catch (error) {
      const kind = recoveryErrorKind(error);
      setIssue(kind);
      if (kind === "conflict") void preview.refetch();
    } finally {
      setConfirming(false);
    }
  }

  return (
    <View className="trash-detail">
      <Button className="trash-back" onClick={onBack}>
        {messages.trashBack}
      </Button>
      <Text className="trash-eyebrow">{messages.trashPreview}</Text>
      {recovered ? (
        <View className="trash-card">
          <Text className="trash-card__name">{messages.trashRecovered}</Text>
          <Text className="trash-card__detail">
            {messages.trashRecoveredDetail}
          </Text>
          {data?.object.objectType === "event" ? (
            <Button
              className="trash-button"
              onClick={() =>
                void Taro.navigateTo({
                  url: `/pages/event/index?id=${encodeURIComponent(objectId)}`,
                })
              }
            >
              {messages.trashOpenEvent}
            </Button>
          ) : null}
        </View>
      ) : unavailable ? (
        <TrashState
          detail={messages.trashUnavailableDetail}
          title={messages.trashUnavailable}
        />
      ) : preview.isPending ? (
        <TrashState detail="" title={messages.trashPreviewLoading} />
      ) : preview.isError || data === undefined ? (
        <TrashState
          action={messages.retry}
          detail={online ? messages.errorDetail : messages.offlineDetail}
          onAction={() => void preview.refetch()}
          title={online ? messages.errorTitle : messages.offlineTitle}
        />
      ) : (
        <View className="trash-card">
          <Text className="trash-card__type">
            {messages[trashTypeLabels[data.object.objectType]]}
          </Text>
          <Text className="trash-card__name">{data.object.displayName}</Text>
          <Text className="trash-card__detail">
            {interpolate(messages.trashRemovedAt, {
              date: formatInstant(data.object.deletedAt, {
                locale,
                timeZone: session.user.timeZone,
                hourCycle: session.user.hourCycle,
              }),
            })}
          </Text>
          <Text className="trash-card__note">
            {messages.trashRecoveryKeeps}
          </Text>
          {issue === "conflict" ? (
            <Text className="trash-alert">
              {messages.trashConflict}. {messages.trashConflictDetail}
            </Text>
          ) : issue === "request" ? (
            <Text className="trash-alert">{messages.trashRestoreFailed}</Text>
          ) : null}
          {!data.canRecover ? (
            <Text className="trash-alert">{messages.trashRecoveryBlocked}</Text>
          ) : (
            <Button
              className="trash-button"
              disabled={confirming || preview.isFetching || recover.isPending}
              loading={confirming || recover.isPending}
              onClick={() => void restore()}
            >
              {recover.isPending
                ? messages.trashRecovering
                : messages.trashRecover}
            </Button>
          )}
        </View>
      )}
    </View>
  );
}

function ReadyTrashPage({ session }: { readonly session: SessionResponse }) {
  const locale: AppLocale = resolveLocale(session.user.locale ?? undefined);
  const messages = getMessages(locale);
  const online = useOnline();
  const queryClient = useQueryClient();
  const [objectType, setObjectType] = useState<TrashItem["objectType"] | null>(
    null,
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const trash = useTrash(session.workspace.id, objectType);
  const items = useMemo(
    () => [
      ...new Map(
        trash.data?.pages
          .flatMap((page) => page.items)
          .map((item) => [item.id, item]) ?? [],
      ).values(),
    ],
    [trash.data],
  );
  const filterTypes = [null, ...trashObjectTypes] as const;
  const selectedFilter = filterTypes.indexOf(objectType);

  usePullDownRefresh(() => {
    const refresh =
      selectedId === null
        ? trash.refetch()
        : queryClient.invalidateQueries({
            queryKey: recoveryPreviewQueryKey(session.workspace.id, selectedId),
          });
    void refresh.finally(() => Taro.stopPullDownRefresh());
  });

  return (
    <View className="trash-shell">
      {selectedId === null ? (
        <>
          <View className="trash-header">
            <Button
              className="trash-back"
              onClick={() => void Taro.navigateBack()}
            >
              {messages.backToEvents}
            </Button>
            <Text className="trash-eyebrow">
              {session.workspace.displayName}
            </Text>
            <Text className="trash-title">{messages.trash}</Text>
            <Text className="trash-intro">{messages.trashIntro}</Text>
            <Picker
              mode="selector"
              range={filterTypes.map((type) =>
                type === null
                  ? messages.trashAllTypes
                  : messages[trashTypeLabels[type]],
              )}
              value={selectedFilter}
              onChange={(event) => {
                setObjectType(filterTypes[Number(event.detail.value)] ?? null);
              }}
            >
              <View className="trash-filter" role="button">
                <Text className="trash-filter__label">
                  {messages.trashFilter}
                </Text>
                <Text className="trash-filter__value">
                  {objectType === null
                    ? messages.trashAllTypes
                    : messages[trashTypeLabels[objectType]]}
                </Text>
              </View>
            </Picker>
          </View>
          {trash.isPending ? (
            <TrashState detail="" title={messages.trashLoading} />
          ) : trash.isError &&
            recoveryErrorKind(trash.error) === "unavailable" ? (
            <TrashState
              action={messages.backToEvents}
              detail={messages.trashUnavailableDetail}
              onAction={() => void Taro.reLaunch({ url: "/pages/index/index" })}
              title={messages.trashUnavailable}
            />
          ) : trash.isError ? (
            <TrashState
              action={messages.retry}
              detail={online ? messages.errorDetail : messages.offlineDetail}
              onAction={() => void trash.refetch()}
              title={online ? messages.errorTitle : messages.offlineTitle}
            />
          ) : items.length === 0 ? (
            <TrashState
              detail={messages.trashEmptyDetail}
              title={
                objectType === null
                  ? messages.trashEmpty
                  : messages.trashFilteredEmpty
              }
            />
          ) : (
            <ScrollView
              className="trash-list"
              enhanced
              lowerThreshold={120}
              onScrollToLower={() => {
                if (trash.hasNextPage && !trash.isFetchingNextPage)
                  void trash.fetchNextPage();
              }}
              scrollY
              showScrollbar={false}
            >
              <View className="trash-list__content">
                {items.map((item) => (
                  <Button
                    className="trash-row"
                    key={item.id}
                    onClick={() => setSelectedId(item.id)}
                  >
                    <Text className="trash-row__type">
                      {messages[trashTypeLabels[item.objectType]]}
                    </Text>
                    <Text className="trash-row__name">{item.displayName}</Text>
                    <Text className="trash-row__date">
                      {interpolate(messages.trashRemovedAt, {
                        date: formatInstant(item.deletedAt, {
                          locale,
                          timeZone: session.user.timeZone,
                          hourCycle: session.user.hourCycle,
                        }),
                      })}
                    </Text>
                  </Button>
                ))}
                {trash.hasNextPage ? (
                  <Button
                    className="trash-button trash-button--secondary"
                    disabled={trash.isFetchingNextPage}
                    loading={trash.isFetchingNextPage}
                    onClick={() => void trash.fetchNextPage()}
                  >
                    {messages.loadMore}
                  </Button>
                ) : null}
              </View>
            </ScrollView>
          )}
        </>
      ) : (
        <RecoveryDetail
          key={selectedId}
          objectId={selectedId}
          onBack={() => setSelectedId(null)}
          session={session}
        />
      )}
    </View>
  );
}

export default function TrashPage() {
  const session = useSession();
  const locale = resolveLocale(
    session.state.status === "ready"
      ? (session.state.session.user.locale ?? undefined)
      : undefined,
  );
  const messages = getMessages(locale);
  if (session.state.status === "ready") {
    return (
      <ReadyTrashPage
        key={session.state.session.workspace.id}
        session={session.state.session}
      />
    );
  }
  return (
    <View className="trash-shell">
      <TrashState
        action={messages.backToEvents}
        detail={
          session.state.status === "offline"
            ? messages.offlineDetail
            : messages.errorDetail
        }
        onAction={() => void Taro.reLaunch({ url: "/pages/index/index" })}
        title={
          session.state.status === "offline"
            ? messages.offlineTitle
            : session.state.status === "restoring" ||
                session.state.status === "loading"
              ? messages.restoring
              : messages.sessionExpired
        }
      />
    </View>
  );
}
