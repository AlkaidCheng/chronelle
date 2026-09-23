import { ApiClientError } from "@chronelle/api-client";
import type { ObjectAccessResponse, SessionResponse } from "@chronelle/schemas";
import { Button, Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh, useRouter } from "@tarojs/taro";

import { useSession } from "../../auth/session-context";
import { formatEventSchedule } from "../../events/format";
import { useEventOverview } from "../../events/queries";
import {
  getMessages,
  interpolate,
  resolveLocale,
  type AppLocale,
} from "../../i18n/catalog";
import { useOnline } from "../../runtime/online";
import "./index.scss";

function roleLabel(access: ObjectAccessResponse, locale: AppLocale): string {
  const messages = getMessages(locale);
  if (access.source.kind === "own") return messages.roleOwner;
  if (access.source.role === "editor") return messages.roleEditor;
  return messages.roleViewer;
}

function accessDetail(access: ObjectAccessResponse, locale: AppLocale): string {
  const messages = getMessages(locale);
  if (access.source.kind === "own") return messages.ownEvent;
  if (access.source.kind === "direct") {
    return interpolate(messages.sharedBy, {
      name: access.source.grantedBy.displayName,
    });
  }
  return interpolate(messages.inheritedAccess, {
    name: access.source.through.displayName,
  });
}

function DetailState({
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
    <View className="detail-state">
      <View className="detail-state__mark" aria-hidden />
      <Text className="detail-state__title">{title}</Text>
      <Text className="detail-state__copy">{detail}</Text>
      {action && onAction ? (
        <Button
          className="detail-button detail-button--secondary"
          onClick={onAction}
        >
          {action}
        </Button>
      ) : null}
    </View>
  );
}

function ReadyEventPage({
  eventId,
  session,
}: {
  readonly eventId: string | null;
  readonly session: SessionResponse;
}) {
  const locale = resolveLocale(session.user.locale ?? undefined);
  const messages = getMessages(locale);
  const online = useOnline();
  const overview = useEventOverview(session.workspace.id, eventId);

  usePullDownRefresh(() => {
    void overview.refetch().finally(() => Taro.stopPullDownRefresh());
  });

  const inaccessible =
    eventId === null ||
    (overview.error instanceof ApiClientError &&
      (overview.error.status === 403 || overview.error.status === 404));

  if (inaccessible) {
    return (
      <View className="detail-shell">
        <DetailState
          action={messages.backToEvents}
          detail={messages.permissionLostDetail}
          onAction={() => void Taro.reLaunch({ url: "/pages/index/index" })}
          title={messages.permissionLostTitle}
        />
      </View>
    );
  }
  if (overview.isPending) {
    return (
      <View className="detail-shell">
        <DetailState detail={messages.eventOverview} title={messages.loading} />
      </View>
    );
  }
  if (overview.isError || overview.data === undefined) {
    return (
      <View className="detail-shell">
        <DetailState
          action={messages.retry}
          detail={online ? messages.errorDetail : messages.offlineDetail}
          onAction={() => void overview.refetch()}
          title={online ? messages.errorTitle : messages.offlineTitle}
        />
      </View>
    );
  }

  const { access, event } = overview.data;
  const schedule = formatEventSchedule(event, {
    hourCycle: session.user.hourCycle,
    locale,
    timeZone: session.user.timeZone,
  });

  return (
    <View className="detail-shell">
      <View className="detail-nav">
        <Button
          className="back-button"
          onClick={() => void Taro.navigateBack()}
        >
          {messages.backToEvents}
        </Button>
        {access.actions.includes("edit") ? (
          <Button
            className="edit-button"
            onClick={() =>
              void Taro.navigateTo({
                url: `/features/event-editor/index?id=${encodeURIComponent(event.id)}`,
              })
            }
          >
            {messages.editEvent}
          </Button>
        ) : null}
        {access.actions.includes("share") || access.source.kind === "direct" ? (
          <Button
            className="edit-button"
            onClick={() =>
              void Taro.navigateTo({
                url: `/features/sharing/index?id=${encodeURIComponent(event.id)}`,
              })
            }
          >
            {messages.manageSharing}
          </Button>
        ) : null}
      </View>
      <Text className="detail-eyebrow">{messages.eventOverview}</Text>
      <Text className="detail-title">{event.displayName}</Text>
      <Text
        className={schedule ? "detail-date" : "detail-date detail-date--muted"}
      >
        {schedule ?? messages.unscheduled}
      </Text>

      <Button
        className="planning-link"
        onClick={() =>
          void Taro.navigateTo({
            url: `/features/planning/index?id=${encodeURIComponent(event.id)}`,
          })
        }
      >
        <Text className="planning-link__title">{messages.openPlanning}</Text>
        <Text className="planning-link__detail">
          {messages.planningDescription}
        </Text>
      </Button>

      {event.location ? (
        <View className="detail-section">
          <Text className="detail-label">{messages.location}</Text>
          <Text className="detail-value">{event.location}</Text>
        </View>
      ) : null}
      {event.description ? (
        <View className="detail-section">
          <Text className="detail-label">{messages.descriptionLabel}</Text>
          <Text className="detail-value detail-value--body">
            {event.description}
          </Text>
        </View>
      ) : null}

      <View className="detail-section access-card">
        <View>
          <Text className="detail-label">{messages.access}</Text>
          <Text className="detail-value">{accessDetail(access, locale)}</Text>
        </View>
        <Text className="detail-role">{roleLabel(access, locale)}</Text>
      </View>
    </View>
  );
}

export default function EventPage() {
  const route = useRouter();
  const session = useSession();
  const eventId =
    typeof route.params.id === "string" && route.params.id.length > 0
      ? route.params.id
      : null;
  const locale = resolveLocale(
    session.state.status === "ready"
      ? (session.state.session.user.locale ?? undefined)
      : undefined,
  );
  const messages = getMessages(locale);

  if (session.state.status === "ready") {
    return <ReadyEventPage eventId={eventId} session={session.state.session} />;
  }
  return (
    <View className="detail-shell">
      <DetailState
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
            : messages.loading
        }
      />
    </View>
  );
}
