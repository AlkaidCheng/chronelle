import type { PersonResponse, SessionResponse } from "@chronelle/schemas";
import { Button, Input, Text, View } from "@tarojs/components";
import Taro, { usePullDownRefresh } from "@tarojs/taro";
import { useEffect, useState } from "react";

import { useSession } from "../../auth/session-context";
import { canCreateInActiveWorkspace } from "../../auth/workspace-access";
import { EditorStateCard } from "../../components/editor";
import { getMessages, resolveLocale } from "../../i18n/catalog";
import { usePeopleList } from "../../people/queries";
import "../../styles/editor.scss";
import "./people.scss";

function ReadyPeople({ session }: { readonly session: SessionResponse }) {
  const messages = getMessages(resolveLocale(session.user.locale ?? undefined));
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  const people = usePeopleList(session.workspace.id, query);

  usePullDownRefresh(() => {
    void people.refetch().finally(() => Taro.stopPullDownRefresh());
  });

  function open(person?: PersonResponse): void {
    void Taro.navigateTo({
      url: person
        ? `/features/people/editor?id=${encodeURIComponent(person.id)}`
        : "/features/people/editor",
    });
  }

  return (
    <View className="people-shell">
      <View className="people-header">
        <View>
          <Text className="people-eyebrow">
            {session.workspace.displayName}
          </Text>
          <Text className="people-title">{messages.people}</Text>
          <Text className="people-intro">{messages.peopleIntro}</Text>
        </View>
        {canCreateInActiveWorkspace(session) ? (
          <Button
            className="people-primary people-primary--compact"
            onClick={() => open()}
          >
            {messages.addPerson}
          </Button>
        ) : null}
      </View>
      <Input
        className="people-search"
        confirmType="search"
        maxlength={240}
        onInput={(event) => setSearch(event.detail.value)}
        placeholder={messages.personSearch}
        value={search}
      />
      {people.isPending ? (
        <EditorStateCard
          detail={messages.peopleIntro}
          title={messages.loading}
        />
      ) : people.isError ? (
        <EditorStateCard
          action={messages.retry}
          detail={messages.errorDetail}
          onAction={() => void people.refetch()}
          title={messages.errorTitle}
        />
      ) : people.data.items.length === 0 ? (
        <EditorStateCard detail={messages.noPeople} title={messages.people} />
      ) : (
        <View className="people-list">
          {people.data.items.map((person) => (
            <View
              className="people-card"
              key={person.id}
              onClick={() => open(person)}
              role="button"
            >
              <View className="people-avatar">
                {(person.nickname ?? person.displayName).slice(0, 1)}
              </View>
              <View className="people-card__body">
                <Text className="people-card__name">
                  {person.nickname ?? person.displayName}
                </Text>
                {person.nickname ? (
                  <Text className="people-card__secondary">
                    {person.displayName}
                  </Text>
                ) : null}
                {person.contacts[0] ? (
                  <Text className="people-card__secondary">
                    {person.contacts[0].value}
                  </Text>
                ) : null}
              </View>
              <Text className="people-card__arrow">›</Text>
            </View>
          ))}
          <Text className="people-footnote">{messages.personSearchHint}</Text>
        </View>
      )}
    </View>
  );
}

export default function PeoplePage() {
  const session = useSession();
  if (session.state.status === "ready")
    return <ReadyPeople session={session.state.session} />;
  const messages = getMessages(resolveLocale(undefined));
  return (
    <View className="people-shell">
      <EditorStateCard
        action={messages.backToEvents}
        detail={messages.errorDetail}
        onAction={() => void Taro.reLaunch({ url: "/pages/index/index" })}
        title={messages.loading}
      />
    </View>
  );
}
