import {
  friendInvitationRequestSchema,
  type SessionResponse,
  type SentInvitation,
} from "@livtales/schemas";
import { Button, Input, Text, Textarea, View } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { useState } from "react";

import { useSession } from "../../auth/session-context";
import { EditorStateCard } from "../../components/editor";
import { getMessages, resolveLocale } from "../../i18n/catalog";
import { useFriends } from "../../people/queries";
import { useReadyAppRuntime } from "../../runtime/app-runtime";
import { useNavigationTitle } from "../../shell/use-navigation-title";
import { PeopleSessionState } from "./session-state";
import "../../styles/editor.scss";
import "./people.scss";

function ReadyFriends({ session }: { readonly session: SessionResponse }) {
  const messages = getMessages(resolveLocale(session.user.locale ?? undefined));
  const { api } = useReadyAppRuntime();
  const friends = useFriends(session.user.id);
  const [inviting, setInviting] = useState(false);
  const [channel, setChannel] = useState<"email" | "link">("email");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [lastSent, setLastSent] = useState<SentInvitation | null>(null);
  const lastLink = lastSent?.inviteUrl;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  usePullDownRefresh(() => {
    void refreshList(messages.errorDetail)
      .finally(() => Taro.stopPullDownRefresh())
      .catch(() => undefined);
  });

  async function refreshList(errorMessage: string): Promise<void> {
    try {
      const refreshed = await friends.refetch();
      if (refreshed.isError) setError(errorMessage);
      else
        setError((current) =>
          current === messages.friendRefreshFailed ||
          current === messages.errorDetail
            ? null
            : current,
        );
    } catch {
      setError(errorMessage);
    }
  }

  async function act(operation: () => Promise<unknown>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError(null);
    try {
      await operation();
      await refreshList(messages.friendRefreshFailed);
      return true;
    } catch {
      setError(messages.friendActionFailed);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function invite(): Promise<void> {
    if (busy) return;
    const payload = friendInvitationRequestSchema.safeParse({
      channel,
      ...(channel === "email" ? { email: email.trim() } : {}),
      ...(note.trim() ? { message: note.trim() } : {}),
    });
    if (!payload.success) {
      setError(
        channel === "email"
          ? messages.inviteInvalidEmail
          : messages.inviteFailed,
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sent = await api.inviteFriend(payload.data);
      setLastSent(sent);
      setInviting(false);
      setEmail("");
      setNote("");
      await refreshList(messages.friendRefreshFailed);
    } catch {
      setError(messages.inviteFailed);
    } finally {
      setBusy(false);
    }
  }

  async function copyLink(url: string): Promise<void> {
    try {
      await Taro.setClipboardData({ data: url });
    } catch {
      setError(messages.friendActionFailed);
      return;
    }
    void Taro.showToast({
      icon: "success",
      title: messages.inviteCopied,
    }).catch(() => undefined);
  }

  async function withdraw(id: string): Promise<void> {
    try {
      const answer = await Taro.showModal({
        cancelText: messages.cancel,
        confirmColor: "#a33c2f",
        confirmText: messages.withdrawInvite,
        content: messages.friendWithdrawalDetail,
        title: messages.friendWithdrawalTitle,
      });
      if (
        answer.confirm &&
        (await act(() => api.withdrawFriendInvitation(id)))
      ) {
        setLastSent((current) => (current?.id === id ? null : current));
      }
    } catch {
      setError(messages.friendActionFailed);
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      const answer = await Taro.showModal({
        cancelText: messages.cancel,
        confirmColor: "#a33c2f",
        confirmText: messages.friendRemove,
        content: messages.friendRemoveDetail,
        title: messages.friendRemoveTitle,
      });
      if (answer.confirm) await act(() => api.removeFriend(id));
    } catch {
      setError(messages.friendActionFailed);
    }
  }

  if (friends.isError) {
    return (
      <View className="people-shell">
        <EditorStateCard
          action={messages.retry}
          detail={messages.errorDetail}
          onAction={() => void refreshList(messages.errorDetail)}
          title={messages.errorTitle}
        />
      </View>
    );
  }

  return (
    <View className="people-shell">
      <View className="people-header">
        <View>
          <Text className="people-eyebrow">LivTales</Text>
          <Text className="people-title">{messages.friends}</Text>
        </View>
        <Button
          className="people-primary people-primary--compact"
          disabled={busy}
          onClick={() => {
            setError(null);
            setLastSent(null);
            setInviting((current) => !current);
          }}
        >
          {messages.inviteFriend}
        </Button>
      </View>

      {inviting ? (
        <View className="people-panel">
          <Text className="people-panel__title">{messages.inviteFriend}</Text>
          <View className="people-row-actions">
            <Button
              className={
                channel === "email"
                  ? "people-mode people-mode--active"
                  : "people-mode"
              }
              disabled={busy}
              onClick={() => setChannel("email")}
            >
              {messages.inviteEmail}
            </Button>
            <Button
              className={
                channel === "link"
                  ? "people-mode people-mode--active"
                  : "people-mode"
              }
              disabled={busy}
              onClick={() => setChannel("link")}
            >
              {messages.inviteLink}
            </Button>
          </View>
          {channel === "email" ? (
            <Input
              className="people-search people-search--form"
              disabled={busy}
              maxlength={254}
              onInput={(event) => setEmail(event.detail.value)}
              placeholder={messages.inviteAddress}
              type="text"
              value={email}
            />
          ) : null}
          <Textarea
            autoHeight
            className="people-note"
            disabled={busy}
            maxlength={500}
            onInput={(event) => setNote(event.detail.value)}
            placeholder={messages.inviteNote}
            value={note}
          />
          <View className="people-row-actions">
            <Button
              className="people-secondary"
              disabled={busy}
              onClick={() => setInviting(false)}
            >
              {messages.cancel}
            </Button>
            <Button
              className="people-primary"
              disabled={busy || (channel === "email" && !email.trim())}
              loading={busy}
              onClick={() => void invite()}
            >
              {channel === "email"
                ? messages.inviteSubmit
                : messages.inviteLink}
            </Button>
          </View>
        </View>
      ) : null}
      {lastSent ? (
        <View className="people-panel">
          <Text className="people-panel__title">
            {lastLink ? messages.friendInvitation : messages.inviteSent}
          </Text>
          <Text className="people-muted">
            {lastLink ? messages.inviteWebLink : messages.friendPending}
          </Text>
          {lastLink ? (
            <Button
              className="people-secondary"
              onClick={() => void copyLink(lastLink)}
            >
              {messages.inviteCopy}
            </Button>
          ) : null}
        </View>
      ) : null}
      {error ? <Text className="people-alert">{error}</Text> : null}
      {friends.isPending ? (
        <EditorStateCard title={messages.loading} />
      ) : (
        <View className="people-sections">
          <View className="people-panel">
            <Text className="people-panel__title">
              {messages.incomingRequests}
              {" \u00b7 "}
              {friends.data.incoming.length}
            </Text>
            {friends.data.incoming.length === 0 ? (
              <Text className="people-muted">{messages.noRequests}</Text>
            ) : (
              friends.data.incoming.map((request) => (
                <View className="people-item" key={request.id}>
                  <Text className="people-item__name">
                    {request.requester.displayName}
                  </Text>
                  {request.requester.email ? (
                    <Text className="people-muted">
                      {request.requester.email}
                    </Text>
                  ) : null}
                  {request.message ? (
                    <Text className="people-muted">{request.message}</Text>
                  ) : null}
                  <View className="people-row-actions">
                    <Button
                      className="people-secondary"
                      disabled={busy}
                      onClick={() =>
                        void act(() => api.declineFriendRequest(request.id))
                      }
                    >
                      {messages.declineRequest}
                    </Button>
                    <Button
                      className="people-primary"
                      disabled={busy}
                      onClick={() =>
                        void act(() => api.acceptFriendRequest(request.id))
                      }
                    >
                      {messages.acceptRequest}
                    </Button>
                  </View>
                </View>
              ))
            )}
          </View>
          <View className="people-panel">
            <Text className="people-panel__title">
              {messages.acceptedFriends}
              {" \u00b7 "}
              {friends.data.friends.length}
            </Text>
            {friends.data.friends.length === 0 ? (
              <Text className="people-muted">{messages.noFriends}</Text>
            ) : (
              friends.data.friends.map((friend) => (
                <View className="people-item" key={friend.id}>
                  <Text className="people-item__name">
                    {friend.displayName}
                  </Text>
                  {friend.email ? (
                    <Text className="people-muted">{friend.email}</Text>
                  ) : null}
                  <Button
                    className="people-text-button"
                    disabled={busy}
                    onClick={() => void remove(friend.id)}
                  >
                    {messages.friendRemove}
                  </Button>
                </View>
              ))
            )}
          </View>
          <View className="people-panel">
            <Text className="people-panel__title">
              {messages.sentInvitations}
              {" \u00b7 "}
              {friends.data.sent.length}
            </Text>
            {friends.data.sent.length === 0 ? (
              <Text className="people-muted">{messages.noSent}</Text>
            ) : (
              friends.data.sent.map((sent) => (
                <View className="people-item" key={sent.id}>
                  <Text className="people-item__name">
                    {sent.email ?? messages.friendInvitation}
                  </Text>
                  <Text className="people-muted">
                    {sent.kind === "connection"
                      ? messages.friendPending
                      : messages.friendNotOnLivTales}
                  </Text>
                  <View className="people-row-actions">
                    {sent.inviteUrl ? (
                      <Button
                        className="people-secondary"
                        disabled={busy}
                        onClick={() => {
                          if (sent.inviteUrl) void copyLink(sent.inviteUrl);
                        }}
                      >
                        {messages.inviteCopy}
                      </Button>
                    ) : null}
                    <Button
                      className="people-text-button"
                      disabled={busy}
                      onClick={() => void withdraw(sent.id)}
                    >
                      {messages.withdrawInvite}
                    </Button>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>
      )}
    </View>
  );
}

export default function FriendsPage() {
  const session = useSession();
  useNavigationTitle("friends");
  if (session.state.status === "ready")
    return <ReadyFriends session={session.state.session} />;
  return (
    <PeopleSessionState shell="people-shell" status={session.state.status} />
  );
}
