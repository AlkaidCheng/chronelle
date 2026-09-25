import type {
  AccessibleWorkspace,
  EventListItem,
  SessionResponse,
} from "@livtales/schemas";
import {
  Button,
  Input,
  Label,
  ScrollView,
  Text,
  View,
} from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { useMemo, useState } from "react";

import { useSession } from "../../auth/session-context";
import {
  activeWorkspaceRole,
  canCreateInActiveWorkspace,
} from "../../auth/workspace-access";
import { marksReadOnly, sharedWithCount } from "../../events/card";
import { formatEventSchedule } from "../../events/format";
import { useEventList } from "../../events/queries";
import {
  type AppLocale,
  getMessages,
  interpolate,
  type MessageKey,
  resolveLocale,
} from "../../i18n/catalog";
import { Brand } from "../../shell/brand";
import { Sidebar } from "../../shell/sidebar";
import { TopBar } from "../../shell/top-bar";
import { WorkspacePicker } from "../../shell/workspace-picker";
import "../../styles/icons.scss";
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
      <TopBar />
      <Brand />
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
            <Label className="field-label" for="livtales-login">
              {messages.loginLabel}
            </Label>
            <Input
              className="text-input"
              confirmType="next"
              disabled={session.busy}
              id="livtales-login"
              maxlength={254}
              onInput={(event) => setLogin(event.detail.value)}
              value={login}
            />
            <Label className="field-label" for="livtales-password">
              {messages.passwordLabel}
            </Label>
            <Input
              className="text-input"
              confirmType="done"
              disabled={session.busy}
              id="livtales-password"
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
      <Text className="footnote">LivTales · 同行</Text>
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
      <TopBar />
      <Brand />
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

function EventCard({
  event,
  locale,
  session,
  workspaceRole,
}: {
  readonly event: EventListItem;
  readonly locale: AppLocale;
  readonly session: SessionResponse;
  readonly workspaceRole: AccessibleWorkspace["role"];
}) {
  const messages = getMessages(locale);
  const schedule = formatEventSchedule(event, {
    hourCycle: session.user.hourCycle,
    locale,
    timeZone: session.user.timeZone,
  });
  const sharedWith = sharedWithCount(event);
  const sharedBy = event.access.sharedBy?.displayName ?? null;
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
        {marksReadOnly(event, workspaceRole) ? (
          <Text className="role-badge">{messages.roleViewer}</Text>
        ) : null}
      </View>
      <Text
        className={schedule ? "event-date" : "event-date event-date--muted"}
      >
        {schedule ?? messages.unscheduled}
      </Text>
      {event.location || sharedWith > 0 || sharedBy ? (
        <View className="event-meta">
          {event.location ? (
            <Text className="event-meta__item">{event.location}</Text>
          ) : null}
          {sharedWith > 0 ? (
            <View
              aria-label={interpolate(messages.sharedWith, {
                count: sharedWith,
              })}
              className="event-meta__item event-meta__shared"
            >
              <View className="icon icon--people event-meta__icon" />
              <Text>{sharedWith}</Text>
            </View>
          ) : null}
          {sharedBy ? (
            <Text className="event-meta__item">
              {interpolate(messages.sharedBy, { name: sharedBy })}
            </Text>
          ) : null}
        </View>
      ) : null}
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
  const canCreate = canCreateInActiveWorkspace(session);
  const workspaceRole = activeWorkspaceRole(session);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function confirmSignOut(): Promise<void> {
    const answer = await Taro.showModal({
      title: messages.signOutConfirmTitle,
      content: messages.signOutConfirmDetail,
      cancelText: messages.cancel,
      confirmText: messages.signOutConfirm,
      confirmColor: "#a33c2f",
    });
    if (!answer.confirm) return;
    setSidebarOpen(false);
    await auth.signOut();
  }

  return (
    <View className="workspace-shell">
      <TopBar>
        <Button
          aria-label={messages.menu}
          className="shell-button top-bar__menu"
          onClick={() => setSidebarOpen(true)}
        >
          <View className="icon icon--menu" />
        </Button>
      </TopBar>

      <View className="workspace-toolbar">
        <Text className="workspace-title">{messages.title}</Text>
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
        <StateView title={messages.emptyTitle} />
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
                workspaceRole={workspaceRole}
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

      {sidebarOpen ? (
        <Sidebar
          locale={locale}
          onClose={() => setSidebarOpen(false)}
          onSignOut={() => void confirmSignOut()}
          onSwitchWorkspace={() => setPickerOpen(true)}
          session={session}
        />
      ) : null}
      {pickerOpen ? (
        <WorkspacePicker
          locale={locale}
          onClose={() => setPickerOpen(false)}
          onPick={(workspaceId) => {
            setPickerOpen(false);
            setSidebarOpen(false);
            void auth.switchWorkspace(workspaceId);
          }}
          session={session}
        />
      ) : null}
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
        <TopBar />
        <Brand />
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
        <TopBar />
        <Brand />
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
        <TopBar />
        <Brand />
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
      <TopBar />
      <Brand />
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
