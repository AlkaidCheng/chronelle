import { ApiClientError } from "@livtales/api-client";
import type {
  ObjectAccessResponse,
  PendingShare,
  PersonResponse,
  SessionResponse,
  ShareResponse,
  ShareView,
} from "@livtales/schemas";
import {
  Button,
  Input,
  Picker,
  ScrollView,
  Text,
  View,
} from "@tarojs/components";
import Taro, { usePullDownRefresh, useRouter } from "@tarojs/taro";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { useSession } from "../../auth/session-context";
import {
  eventListQueryKey,
  eventOverviewQueryKey,
  useEventOverview,
} from "../../events/queries";
import {
  getMessages,
  interpolate,
  resolveLocale,
  type AppLocale,
} from "../../i18n/catalog";
import { useReadyAppRuntime } from "../../runtime/app-runtime";
import { useOnline } from "../../runtime/online";
import {
  applySharingChange,
  type GrantRole,
  pendingInvitationUrl,
  rolesFor,
  sharingAccess,
  type ShareRole,
} from "../../sharing/model";
import "./index.scss";

function State({
  detail,
  title,
  onRetry,
  retry,
}: {
  readonly detail: string;
  readonly title: string;
  readonly onRetry?: (() => void) | undefined;
  readonly retry?: string | undefined;
}) {
  return (
    <View className="sharing-state">
      <Text className="sharing-title">{title}</Text>
      <Text className="sharing-note">{detail}</Text>
      {onRetry && retry ? (
        <Button className="sharing-button" onClick={onRetry}>
          {retry}
        </Button>
      ) : null}
    </View>
  );
}

function roleName(role: GrantRole, locale: AppLocale): string {
  const messages = getMessages(locale);
  return role === "owner"
    ? messages.roleOwner
    : role === "editor"
      ? messages.roleEditor
      : messages.roleViewer;
}

function viewName(view: ShareView, locale: AppLocale): string {
  const messages = getMessages(locale);
  switch (view) {
    case "todos":
      return messages.componentTodos;
    case "calendar":
      return messages.componentCalendar;
    case "itinerary":
      return messages.componentItinerary;
    case "expenses":
      return messages.componentExpenses;
    case "reminders":
      return messages.componentReminders;
    case "notes":
      return messages.componentNotes;
  }
}

function RolePicker({
  locale,
  onChange,
  value,
}: {
  readonly locale: AppLocale;
  readonly onChange: (role: GrantRole) => void;
  readonly value: GrantRole;
}) {
  const roles = rolesFor(value);
  return (
    <Picker
      mode="selector"
      range={roles.map((role) => roleName(role, locale))}
      value={roles.indexOf(value)}
      onChange={(event) => {
        const role = roles[Number(event.detail.value)];
        if (role) onChange(role);
      }}
    >
      <View className="sharing-picker">{roleName(value, locale)} ▾</View>
    </Picker>
  );
}

function GrantRow({
  busy,
  grant,
  locale,
  onRevoke,
  onRoleChange,
}: {
  readonly busy: boolean;
  readonly grant: ShareResponse;
  readonly locale: AppLocale;
  readonly onRevoke: () => void;
  readonly onRoleChange: (role: ShareRole) => void;
}) {
  const messages = getMessages(locale);
  const [chosenRole, setChosenRole] = useState<GrantRole>(grant.role);
  useEffect(() => setChosenRole(grant.role), [grant.role]);
  return (
    <View className="sharing-row">
      <Text className="sharing-row__name">{grant.principal.displayName}</Text>
      <Text className="sharing-note">
        {grant.scope === null
          ? messages.sharingWholeEvent
          : interpolate(
              grant.scope.sectionId === null
                ? messages.sharingNarrowed
                : messages.sharingNarrowedSection,
              { view: viewName(grant.scope.view, locale) },
            )}
      </Text>
      <RolePicker locale={locale} value={chosenRole} onChange={setChosenRole} />
      <Button
        disabled={busy || chosenRole === grant.role || chosenRole === "owner"}
        className="sharing-text-button"
        onClick={() => {
          if (chosenRole !== "owner") onRoleChange(chosenRole);
        }}
      >
        {messages.sharingChangeRole}
      </Button>
      <Button
        disabled={busy}
        className="sharing-text-button sharing-text-button--danger"
        onClick={onRevoke}
      >
        {messages.sharingRevoke}
      </Button>
    </View>
  );
}

function SharingControls({
  access,
  eventId,
  locale,
  session,
}: {
  readonly access: ObjectAccessResponse;
  readonly eventId: string;
  readonly locale: AppLocale;
  readonly session: SessionResponse;
}) {
  const messages = getMessages(locale);
  const { api } = useReadyAppRuntime();
  const auth = useSession();
  const queryClient = useQueryClient();
  const online = useOnline();
  const permissions = sharingAccess(access);
  const activeRole = session.availableWorkspaces.find(
    (workspace) => workspace.id === session.workspace.id,
  )?.role;
  const canListPeople = permissions.canManage && activeRole != null;
  const [personSearchInput, setPersonSearchInput] = useState("");
  const [personQuery, setPersonQuery] = useState("");
  const key = ["wechat-event-sharing", session.workspace.id, eventId] as const;
  const shares = useQuery({
    enabled: permissions.canManage,
    queryKey: [...key, "shares"],
    queryFn: () => api.listShares(eventId),
    retry: 1,
  });
  const people = useQuery({
    enabled: canListPeople,
    queryKey: [...key, "people", personQuery],
    queryFn: () => api.listPersons({ limit: 200, query: personQuery }),
    retry: 1,
  });
  const friends = useQuery({
    enabled: permissions.canManage,
    queryKey: [...key, "friends"],
    queryFn: () => api.listFriends(),
    retry: 1,
  });
  const [role, setRole] = useState<ShareRole>("viewer");
  const [selectedPerson, setSelectedPerson] = useState<number>(-1);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  usePullDownRefresh(() => {
    if (!permissions.canManage) {
      void Taro.stopPullDownRefresh();
      return;
    }
    void refresh().finally(() => Taro.stopPullDownRefresh());
  });

  const candidates = (people.data?.items ?? []).filter(
    (person) => person.userId !== session.user.id,
  );

  async function refresh(): Promise<boolean> {
    const results = await Promise.allSettled([
      shares.refetch(),
      ...(canListPeople ? [people.refetch()] : []),
      friends.refetch(),
    ]);
    return results.every(
      (result) => result.status === "fulfilled" && !result.value.isError,
    );
  }

  async function run(
    action: () => Promise<unknown>,
    success = messages.sharingSaved,
  ): Promise<boolean> {
    if (busy || !online) {
      setNotice(messages.offlineDetail);
      return false;
    }
    setBusy(true);
    setNotice(null);
    try {
      const fresh = await applySharingChange(action, refresh, () =>
        setNotice(success),
      );
      if (!fresh) setNotice(messages.sharingSavedStale);
      return true;
    } catch (error) {
      if (
        error instanceof ApiClientError &&
        (error.status === 403 || error.status === 404)
      ) {
        setNotice(
          error.code === "principal_unavailable"
            ? messages.sharingRecipientUnavailable
            : messages.sharingPermissionLost,
        );
        await queryClient.invalidateQueries({
          queryKey: eventOverviewQueryKey(session.workspace.id, eventId),
        });
      } else {
        setNotice(messages.sharingFailed);
      }
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function shareWithPerson(): Promise<void> {
    const person = candidates[selectedPerson];
    if (!person) return;
    const shared = await run(
      async () => {
        if (person.userId === null) {
          await api.queuePendingShare({
            resourceId: eventId,
            personId: person.id,
            role,
          });
        } else {
          await api.shareResource({
            resourceId: eventId,
            personId: person.id,
            role,
          });
        }
      },
      person.userId === null ? messages.sharingQueued : messages.sharingSaved,
    );
    if (shared) setSelectedPerson(-1);
  }

  function searchPeople(): void {
    if (busy) return;
    if (!online) {
      setNotice(messages.offlineDetail);
      return;
    }
    setSelectedPerson(-1);
    setPersonQuery(personSearchInput.trim());
  }

  async function shareByEmail(): Promise<void> {
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(address)) {
      setNotice(messages.sharingEmailRequired);
      return;
    }
    const shared = await run(() =>
      api.shareResource({
        resourceId: eventId,
        principalEmail: address,
        role,
      }),
    );
    if (shared) setEmail("");
  }

  async function confirmRevoke(id: string, pending: boolean): Promise<void> {
    const answer = await Taro.showModal({
      title: messages.sharingRevokeTitle,
      content: messages.sharingRevokeDetail,
      cancelText: messages.cancel,
      confirmText: messages.sharingRevoke,
      confirmColor: "#a33c2f",
    });
    if (answer.confirm) {
      await run(() =>
        pending ? api.revokePendingShare(id) : api.revokeShare(id),
      );
    }
  }

  async function leave(): Promise<void> {
    const answer = await Taro.showModal({
      title: messages.sharingLeaveTitle,
      content: messages.sharingLeaveDetail,
      cancelText: messages.cancel,
      confirmText: messages.sharingLeave,
      confirmColor: "#a33c2f",
    });
    if (!answer.confirm || busy) return;
    setBusy(true);
    let left = false;
    try {
      await api.leaveObject(eventId);
      left = true;
      const personal = session.availableWorkspaces.find(
        (workspace) => workspace.personal,
      );
      if (
        activeRole == null &&
        personal &&
        personal.id !== session.workspace.id
      ) {
        await auth.switchWorkspace(personal.id);
      } else {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: eventListQueryKey(session.workspace.id),
          }),
          queryClient.invalidateQueries({
            queryKey: eventOverviewQueryKey(session.workspace.id, eventId),
          }),
        ]);
      }
      await Taro.reLaunch({ url: "/pages/index/index" });
    } catch (error) {
      setNotice(
        left
          ? messages.sharingLeftNavigationFailed
          : error instanceof ApiClientError &&
              (error.status === 403 || error.status === 404)
            ? messages.sharingPermissionLost
            : messages.sharingFailed,
      );
      void queryClient
        .invalidateQueries({
          queryKey: eventOverviewQueryKey(session.workspace.id, eventId),
        })
        .catch(() => undefined);
      setBusy(false);
    }
  }

  async function copyInvite(pending: PendingShare): Promise<void> {
    const url = pendingInvitationUrl(pending, friends.data?.sent ?? []);
    if (!url) {
      setNotice(messages.sharingLinkUnavailable);
      return;
    }
    try {
      await Taro.setClipboardData({ data: url });
      setNotice(messages.sharingLinkCopied);
    } catch {
      setNotice(messages.sharingLinkUnavailable);
    }
  }

  return (
    <>
      {notice ? <Text className="sharing-notice">{notice}</Text> : null}
      {permissions.canManage ? (
        <>
          <View className="sharing-card">
            <Text className="sharing-heading">{messages.sharingPeople}</Text>
            {canListPeople ? (
              <View className="sharing-search">
                <Input
                  className="sharing-input"
                  type="text"
                  maxlength={240}
                  value={personSearchInput}
                  placeholder={messages.sharingSearchPeople}
                  onInput={(event) => setPersonSearchInput(event.detail.value)}
                  onConfirm={searchPeople}
                />
                <Button
                  className="sharing-button sharing-button--secondary"
                  disabled={busy || !online}
                  onClick={searchPeople}
                >
                  {messages.sharingSearchPeople}
                </Button>
              </View>
            ) : null}
            {!canListPeople ? (
              <Text className="sharing-note">
                {messages.sharingPeopleUnavailable}
              </Text>
            ) : people.isPending ? (
              <Text className="sharing-note">{messages.loading}</Text>
            ) : people.isError ? (
              <Button
                className="sharing-text-button"
                onClick={() => void people.refetch()}
              >
                {messages.retry}
              </Button>
            ) : candidates.length === 0 ? (
              <Text className="sharing-note">
                {personQuery
                  ? messages.sharingNoPeopleMatching
                  : messages.sharingNoPeople}
              </Text>
            ) : (
              <Picker
                mode="selector"
                range={candidates.map(
                  (person: PersonResponse) =>
                    person.nickname || person.displayName,
                )}
                value={Math.max(selectedPerson, 0)}
                onChange={(event) =>
                  setSelectedPerson(Number(event.detail.value))
                }
              >
                <View className="sharing-picker">
                  {selectedPerson >= 0
                    ? candidates[selectedPerson]?.nickname ||
                      candidates[selectedPerson]?.displayName
                    : messages.sharingPeople}{" "}
                  ▾
                </View>
              </Picker>
            )}
            <Text className="sharing-label">{messages.sharingRole}</Text>
            <RolePicker
              locale={locale}
              value={role}
              onChange={(next) => {
                if (next !== "owner") setRole(next);
              }}
            />
            <Button
              disabled={busy || selectedPerson < 0 || !online}
              className="sharing-button"
              onClick={() => void shareWithPerson()}
            >
              {messages.sharingGrant}
            </Button>
            <Text className="sharing-heading sharing-heading--spaced">
              {messages.sharingEmail}
            </Text>
            <Input
              className="sharing-input"
              type="text"
              value={email}
              onInput={(event) => setEmail(event.detail.value)}
              placeholder={messages.sharingEmailPlaceholder}
            />
            <Button
              disabled={busy || !online}
              className="sharing-button sharing-button--secondary"
              onClick={() => void shareByEmail()}
            >
              {messages.sharingGrant}
            </Button>
          </View>
          <View className="sharing-card">
            <Text className="sharing-heading">{messages.sharingActive}</Text>
            {shares.isPending ? (
              <Text className="sharing-note">{messages.loading}</Text>
            ) : shares.isError ? (
              <Button
                className="sharing-button"
                onClick={() => void shares.refetch()}
              >
                {messages.retry}
              </Button>
            ) : shares.data?.items.length === 0 ? (
              <Text className="sharing-note">{messages.sharingNoGrants}</Text>
            ) : (
              shares.data?.items.map((grant) => (
                <GrantRow
                  key={grant.id}
                  busy={busy}
                  grant={grant}
                  locale={locale}
                  onRevoke={() => void confirmRevoke(grant.id, false)}
                  onRoleChange={(nextRole) =>
                    void run(() =>
                      api.shareResource({
                        resourceId: eventId,
                        principalId: grant.principal.id,
                        role: nextRole,
                        ...(grant.scope === null ? {} : { scope: grant.scope }),
                      }),
                    )
                  }
                />
              ))
            )}
          </View>
          {shares.data?.pending.length ? (
            <View className="sharing-card">
              <Text className="sharing-heading">{messages.sharingPending}</Text>
              {shares.data.pending.map((pending) => {
                const inviteUrl = pendingInvitationUrl(
                  pending,
                  friends.data?.sent ?? [],
                );
                return (
                  <View className="sharing-row" key={pending.id}>
                    <Text className="sharing-row__name">
                      {pending.person?.displayName ??
                        pending.email ??
                        messages.sharingPending}
                    </Text>
                    <Text className="sharing-note">
                      {roleName(pending.role, locale)} ·{" "}
                      {pending.kind === "connection"
                        ? messages.sharingQueued
                        : pending.email !== null
                          ? messages.sharingInvited
                          : inviteUrl
                            ? messages.sharingLinkReady
                            : friends.isPending
                              ? messages.loading
                              : messages.sharingLinkUnavailable}
                    </Text>
                    {inviteUrl ? (
                      <Button
                        className="sharing-text-button"
                        onClick={() => void copyInvite(pending)}
                      >
                        {messages.sharingCopyLink}
                      </Button>
                    ) : null}
                    <Button
                      disabled={busy}
                      className="sharing-text-button sharing-text-button--danger"
                      onClick={() => void confirmRevoke(pending.id, true)}
                    >
                      {messages.sharingRevoke}
                    </Button>
                  </View>
                );
              })}
            </View>
          ) : null}
          {friends.isError ? (
            <Button
              className="sharing-button sharing-button--secondary"
              onClick={() => void refresh()}
            >
              {messages.retry}
            </Button>
          ) : null}
        </>
      ) : (
        <State title={messages.roleViewer} detail={messages.sharingReadOnly} />
      )}
      {permissions.canLeave ? (
        <Button
          disabled={busy || !online}
          className="sharing-button sharing-button--leave"
          onClick={() => void leave()}
        >
          {messages.sharingLeave}
        </Button>
      ) : null}
    </>
  );
}

function ReadySharingPage({
  eventId,
  session,
}: {
  readonly eventId: string | null;
  readonly session: SessionResponse;
}) {
  const locale = resolveLocale(session.user.locale ?? undefined);
  const messages = getMessages(locale);
  const overview = useEventOverview(session.workspace.id, eventId);
  if (
    eventId === null ||
    (overview.error instanceof ApiClientError &&
      (overview.error.status === 403 || overview.error.status === 404))
  ) {
    return (
      <State
        title={messages.permissionLostTitle}
        detail={messages.permissionLostDetail}
      />
    );
  }
  if (overview.isPending)
    return <State title={messages.loading} detail={messages.sharingTitle} />;
  if (overview.isError || !overview.data)
    return (
      <State
        title={messages.errorTitle}
        detail={messages.errorDetail}
        retry={messages.retry}
        onRetry={() => void overview.refetch()}
      />
    );
  return (
    <>
      <Text className="sharing-eyebrow">{messages.manageSharing}</Text>
      <Text className="sharing-title">{overview.data.event.displayName}</Text>
      <SharingControls
        access={overview.data.access}
        eventId={eventId}
        locale={locale}
        session={session}
      />
    </>
  );
}

export default function SharingPage() {
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
  return (
    <ScrollView className="sharing-shell" scrollY>
      <Button className="sharing-back" onClick={() => void Taro.navigateBack()}>
        {messages.backToEvents}
      </Button>
      {session.state.status === "ready" ? (
        <ReadySharingPage eventId={eventId} session={session.state.session} />
      ) : (
        <State title={messages.loading} detail={messages.errorDetail} />
      )}
    </ScrollView>
  );
}
