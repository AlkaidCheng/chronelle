import type { EventListItem, SessionResponse } from "@chronelle/schemas";
import {
  Button,
  Input,
  Label,
  Picker,
  ScrollView,
  Text,
  View,
} from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { useMemo, useState } from "react";

import { useSession } from "../../auth/session-context";
import { canCreateInActiveWorkspace } from "../../auth/workspace-access";
import { formatEventSchedule } from "../../events/format";
import { useEventList } from "../../events/queries";
import {
  type AppLocale,
  getMessages,
  interpolate,
  type MessageKey,
  resolveLocale,
} from "../../i18n/catalog";
import "./index.scss";

function systemLanguage(): string | undefined {
  try {
    return Taro.getSystemInfoSync().language;
  } catch {
    return undefined;
  }
}

function localeFor(session?: SessionResponse): AppLocale {
  return resolveLocale(session?.user.locale ?? systemLanguage());
}

function Brand({ subtitle }: { readonly subtitle: string }) {
  return (
    <View className="brand-row">
      <Text className="brand-mark">C</Text>
      <View className="brand-copy">
        <Text className="brand">Chronelle</Text>
        <Text className="eyebrow">{subtitle}</Text>
      </View>
    </View>
  );
}

function Notice({
  code,
  locale,
}: {
  readonly code: MessageKey;
  readonly locale: AppLocale;
}) {
  return <Text className="notice">{getMessages(locale)[code]}</Text>;
}

function StateView({
  action,
  detail,
  onAction,
  title,
}: {
  readonly action?: string | undefined;
  readonly detail?: string | undefined;
  readonly onAction?: (() => void) | undefined;
  readonly title: string;
}) {
  return (
    <View className="state-view">
      <View className="state-mark" aria-hidden />
      <Text className="state-title">{title}</Text>
      {detail ? <Text className="state-detail">{detail}</Text> : null}
      {action && onAction ? (
        <Button className="secondary-button" onClick={onAction}>
          {action}
        </Button>
      ) : null}
    </View>
  );
}

function SignInView({ locale }: { readonly locale: AppLocale }) {
  const messages = getMessages(locale);
  const session = useSession();
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [method, setMethod] = useState<"wechat" | "account">("wechat");
  const needsLink =
    method === "wechat" &&
    session.state.status === "signed-out" &&
    session.state.linkingRequired;
  const showAccountForm = needsLink || method === "account";

  function switchMethod(next: "wechat" | "account") {
    setPassword("");
    session.resetSignInFlow();
    setMethod(next);
  }

  function submitPassword() {
    if (session.busy || login.trim().length === 0 || password.length === 0)
      return;
    if (needsLink) void session.linkExistingAccount(login.trim(), password);
    else void session.signInWithPassword(login.trim(), password);
  }

  return (
    <View className="entry-shell">
      <Brand subtitle={messages.eyebrow} />
      <View className="entry-copy">
        <Text className="entry-title">
          {needsLink
            ? messages.linkTitle
            : showAccountForm
              ? messages.accountSignInTitle
              : messages.signInTitle}
        </Text>
        {method === "wechat" ? (
          <Text className="entry-detail">
            {needsLink ? messages.linkDetail : messages.signInDetail}
          </Text>
        ) : null}
      </View>

      {session.notice ? <Notice code={session.notice} locale={locale} /> : null}

      {showAccountForm ? (
        <>
          <View className="form-card">
            <Label className="field-label" for="chronelle-login">
              {messages.loginLabel}
            </Label>
            <Input
              className="text-input"
              confirmType="next"
              disabled={session.busy}
              id="chronelle-login"
              maxlength={254}
              onInput={(event) => setLogin(event.detail.value)}
              value={login}
            />
            <Label className="field-label" for="chronelle-password">
              {messages.passwordLabel}
            </Label>
            <Input
              className="text-input"
              confirmType="done"
              disabled={session.busy}
              id="chronelle-password"
              maxlength={256}
              onConfirm={submitPassword}
              password
              onInput={(event) => setPassword(event.detail.value)}
              value={password}
            />
            <Button
              className="primary-button"
              disabled={
                session.busy ||
                login.trim().length === 0 ||
                password.length === 0
              }
              loading={session.busy}
              onClick={submitPassword}
            >
              {needsLink ? messages.linkAction : messages.accountSignInAction}
            </Button>
          </View>
          <Button
            className="text-button auth-switch"
            disabled={session.busy}
            onClick={() => switchMethod(needsLink ? "account" : "wechat")}
          >
            {needsLink ? messages.withoutLink : messages.backToWeChat}
          </Button>
        </>
      ) : (
        <View className="auth-methods">
          <Button
            className="primary-button auth-method-primary"
            disabled={session.busy}
            loading={session.busy}
            onClick={() => void session.signInWithWeChat()}
          >
            {messages.signInAction}
          </Button>
          <Button
            className="secondary-button auth-method-secondary"
            disabled={session.busy}
            onClick={() => switchMethod("account")}
          >
            {messages.accountSignInOption}
          </Button>
          <Text className="auth-help">{messages.wechatHelp}</Text>
        </View>
      )}
      <Text className="footnote">CHRONELLE · 同行</Text>
    </View>
  );
}

function OnboardingView({ session }: { readonly session: SessionResponse }) {
  const locale = localeFor(session);
  const messages = getMessages(locale);
  const auth = useSession();
  const [displayName, setDisplayName] = useState(session.user.displayName);
  return (
    <View className="entry-shell">
      <Brand subtitle={messages.eyebrow} />
      <View className="entry-copy">
        <Text className="entry-title">{messages.onboardingTitle}</Text>
        <Text className="entry-detail">{messages.onboardingDetail}</Text>
      </View>
      <View className="form-card">
        <Text className="field-label">{messages.displayNameLabel}</Text>
        <Input
          className="text-input"
          disabled={auth.busy}
          maxlength={120}
          onInput={(event) => setDisplayName(event.detail.value)}
          value={displayName}
        />
        <Button
          className="primary-button"
          disabled={auth.busy || displayName.trim().length === 0}
          loading={auth.busy}
          onClick={() => void auth.completeOnboarding(displayName)}
        >
          {messages.onboardingAction}
        </Button>
      </View>
    </View>
  );
}

function roleLabel(
  role: EventListItem["access"]["role"],
  locale: AppLocale,
): string {
  const messages = getMessages(locale);
  if (role === "editor") return messages.roleEditor;
  if (role === "viewer") return messages.roleViewer;
  return messages.roleOwner;
}

function EventCard({
  event,
  locale,
  session,
}: {
  readonly event: EventListItem;
  readonly locale: AppLocale;
  readonly session: SessionResponse;
}) {
  const messages = getMessages(locale);
  const schedule = formatEventSchedule(event, {
    hourCycle: session.user.hourCycle,
    locale,
    timeZone: session.user.timeZone,
  });
  const sharing = event.access.sharedBy
    ? interpolate(messages.sharedBy, {
        name: event.access.sharedBy.displayName,
      })
    : event.access.sharedWith > 0
      ? interpolate(messages.sharedWith, { count: event.access.sharedWith })
      : messages.ownEvent;
  return (
    <View
      className="event-card"
      hoverClass="event-card--pressed"
      onClick={() =>
        void Taro.navigateTo({
          url: `/pages/event/index?id=${encodeURIComponent(event.id)}`,
        })
      }
      role="button"
    >
      <View className="event-card__head">
        <Text className="event-name">{event.displayName}</Text>
        <Text className="role-badge">
          {roleLabel(event.access.role, locale)}
        </Text>
      </View>
      <Text
        className={schedule ? "event-date" : "event-date event-date--muted"}
      >
        {schedule ?? messages.unscheduled}
      </Text>
      {event.location ? (
        <Text className="event-location">{event.location}</Text>
      ) : null}
      <Text className="event-sharing">{sharing}</Text>
    </View>
  );
}

function EventWorkspace({ session }: { readonly session: SessionResponse }) {
  const locale = localeFor(session);
  const messages = getMessages(locale);
  const auth = useSession();
  const events = useEventList(session.workspace.id);
  const items = useMemo(
    () => events.data?.pages.flatMap((page) => page.items) ?? [],
    [events.data],
  );
  const workspaces = session.availableWorkspaces;
  const selectedWorkspace = Math.max(
    0,
    workspaces.findIndex((workspace) => workspace.id === session.workspace.id),
  );
  const canCreate = canCreateInActiveWorkspace(session);

  return (
    <View className="workspace-shell">
      <View className="workspace-header">
        <Brand subtitle={messages.eyebrow} />
        <View className="workspace-header__actions">
          <Button
            className="text-button"
            onClick={() =>
              void Taro.navigateTo({
                url: "/features/account-preferences/index",
              })
            }
          >
            {messages.account}
          </Button>
          <Button
            className="text-button trash-link"
            onClick={() =>
              void Taro.navigateTo({ url: "/features/trash/index" })
            }
          >
            {messages.trash}
          </Button>
          <Button
            className="text-button"
            disabled={auth.busy}
            onClick={() => void auth.signOut()}
          >
            {messages.signOut}
          </Button>
        </View>
      </View>

      <View className="workspace-toolbar">
        <View className="workspace-heading">
          <Text className="workspace-title">{messages.title}</Text>
          <Text className="workspace-description">{messages.description}</Text>
        </View>
        <View className="workspace-actions">
          <Picker
            mode="selector"
            range={workspaces.map((workspace) => workspace.displayName)}
            value={selectedWorkspace}
            onChange={(event) => {
              const next = workspaces[Number(event.detail.value)];
              if (next) void auth.switchWorkspace(next.id);
            }}
          >
            <View className="workspace-picker">
              <Text className="workspace-picker__label">
                {messages.workspace}
              </Text>
              <Text className="workspace-picker__value">
                {session.workspace.displayName}
              </Text>
            </View>
          </Picker>
          {canCreate ? (
            <Button
              className="new-event-button"
              onClick={() =>
                void Taro.navigateTo({ url: "/features/event-editor/index" })
              }
            >
              {messages.newEvent}
            </Button>
          ) : null}
        </View>
      </View>

      <View className="workspace-collections">
        <Button
          className="collection-link"
          onClick={() =>
            void Taro.navigateTo({ url: "/features/people/index" })
          }
        >
          {messages.people}
        </Button>
        <Button
          className="collection-link"
          onClick={() =>
            void Taro.navigateTo({ url: "/features/people/friends" })
          }
        >
          {messages.friends}
        </Button>
      </View>

      {events.isPending ? (
        <StateView title={messages.loading} />
      ) : events.isError ? (
        <StateView
          action={messages.retry}
          detail={messages.errorDetail}
          onAction={() => void events.refetch()}
          title={messages.errorTitle}
        />
      ) : items.length === 0 ? (
        <StateView detail={messages.emptyDetail} title={messages.emptyTitle} />
      ) : (
        <ScrollView
          className="event-list"
          enhanced
          lowerThreshold={120}
          onScrollToLower={() => {
            if (events.hasNextPage && !events.isFetchingNextPage) {
              void events.fetchNextPage();
            }
          }}
          scrollY
          showScrollbar={false}
        >
          <View className="event-list__content">
            {items.map((event) => (
              <EventCard
                event={event}
                key={event.id}
                locale={locale}
                session={session}
              />
            ))}
            {events.hasNextPage ? (
              <Button
                className="secondary-button load-more"
                disabled={events.isFetchingNextPage}
                loading={events.isFetchingNextPage}
                onClick={() => void events.fetchNextPage()}
              >
                {messages.loadMore}
              </Button>
            ) : null}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

export default function IndexPage() {
  const session = useSession();
  const stateSession =
    session.state.status === "ready" || session.state.status === "onboarding"
      ? session.state.session
      : undefined;
  const locale = localeFor(stateSession);
  const messages = getMessages(locale);

  usePullDownRefresh(() => {
    void session.refresh().finally(() => Taro.stopPullDownRefresh());
  });

  if (session.state.status === "configuration-error") {
    return (
      <View className="entry-shell">
        <Brand subtitle={messages.eyebrow} />
        <StateView
          detail={messages.configurationDetail}
          title={messages.configurationTitle}
        />
      </View>
    );
  }
  if (session.state.status === "signed-out")
    return <SignInView locale={locale} />;
  if (session.state.status === "onboarding") {
    return <OnboardingView session={session.state.session} />;
  }
  if (session.state.status === "ready") {
    return <EventWorkspace session={session.state.session} />;
  }
  if (session.state.status === "offline") {
    return (
      <View className="entry-shell">
        <Brand subtitle={messages.eyebrow} />
        <StateView
          detail={messages.offlineDetail}
          title={messages.offlineTitle}
        />
      </View>
    );
  }
  if (session.state.status === "error") {
    return (
      <View className="entry-shell">
        <Brand subtitle={messages.eyebrow} />
        <StateView
          action={messages.retry}
          detail={messages.errorDetail}
          onAction={() => void session.refresh()}
          title={messages.errorTitle}
        />
      </View>
    );
  }
  return (
    <View className="entry-shell">
      <Brand subtitle={messages.eyebrow} />
      <StateView
        title={
          session.state.status === "restoring"
            ? messages.restoring
            : messages.loading
        }
      />
    </View>
  );
}
