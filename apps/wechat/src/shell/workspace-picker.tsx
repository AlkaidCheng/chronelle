import type { AccessibleWorkspace, SessionResponse } from "@livtales/schemas";
import { Button, Input, ScrollView, Text, View } from "@tarojs/components";
import { useState } from "react";

import {
  matchesWorkspaceQuery,
  splitMatch,
  type WorkspaceIdentity,
  workspaceIdentity,
} from "../account/workspace-identity";
import { type AppLocale, getMessages, interpolate } from "../i18n/catalog";
import { useNavigationBarLayout } from "./use-navigation-bar";
import { workspaceLabels } from "./workspace-labels";
import { WorkspaceMark } from "./workspace-mark";
import "../styles/icons.scss";
import "./shell.scss";

function Highlighted({
  query,
  text,
}: {
  readonly query: string;
  readonly text: string;
}) {
  const [before, match, after] = splitMatch(text, query);
  return (
    <>
      {before}
      {match ? <Text className="workspace-picker__match">{match}</Text> : null}
      {after}
    </>
  );
}

/** Switches the active workspace, searching names, owners, and access. */
export function WorkspacePicker({
  locale,
  onClose,
  onPick,
  session,
}: {
  readonly locale: AppLocale;
  readonly onClose: () => void;
  readonly onPick: (workspaceId: string) => void;
  readonly session: SessionResponse;
}) {
  const messages = getMessages(locale);
  const layout = useNavigationBarLayout();
  const [query, setQuery] = useState("");
  const labels = workspaceLabels(messages);
  const visible = session.availableWorkspaces
    .map((workspace) => ({
      identity: workspaceIdentity(workspace, labels),
      workspace,
    }))
    .filter(({ identity }) => matchesWorkspaceQuery(identity, query));
  const own = visible.filter(({ workspace }) => workspace.personal);
  const shared = visible.filter(({ workspace }) => !workspace.personal);

  function row({
    identity,
    workspace,
  }: {
    readonly identity: WorkspaceIdentity;
    readonly workspace: AccessibleWorkspace;
  }) {
    const current = workspace.id === session.workspace.id;
    return (
      <Button
        aria-selected={current}
        className="shell-button workspace-picker__row"
        key={workspace.id}
        onClick={() => onPick(workspace.id)}
      >
        <WorkspaceMark mark={identity.mark} />
        <View className="workspace-picker__text">
          <Text className="workspace-picker__title">
            <Highlighted query={query} text={identity.title} />
          </Text>
          {identity.detail ? (
            <Text className="workspace-picker__detail">
              <Highlighted query={query} text={identity.detail} />
            </Text>
          ) : null}
        </View>
        {current ? (
          <View className="icon icon--check workspace-picker__tick" />
        ) : null}
      </Button>
    );
  }

  return (
    <View className="workspace-picker-layer">
      <View className="workspace-picker-scrim" onClick={onClose} />
      <View
        aria-label={messages.switchWorkspaceTitle}
        aria-role="dialog"
        className="workspace-picker"
        style={{ top: `${layout.statusBarHeight + layout.rowHeight}px` }}
      >
        <View className="workspace-picker__head">
          <Text className="workspace-picker__heading">
            {messages.switchWorkspaceTitle}
          </Text>
          <Button
            aria-label={messages.close}
            className="shell-button workspace-picker__close"
            onClick={onClose}
          >
            <View className="icon icon--close" />
          </Button>
        </View>
        <View className="workspace-picker__search">
          <View className="icon icon--search" />
          <Input
            adjustPosition={false}
            className="workspace-picker__input"
            confirmType="search"
            maxlength={60}
            onInput={(event) => setQuery(event.detail.value)}
            placeholder={messages.workspaceSearch}
            placeholderClass="workspace-picker__placeholder"
            value={query}
          />
        </View>
        <ScrollView
          className="workspace-picker__list"
          enhanced
          scrollY
          showScrollbar={false}
        >
          {own.length > 0 ? (
            <View className="workspace-picker__group">{own.map(row)}</View>
          ) : null}
          {shared.length > 0 ? (
            <>
              <Text className="workspace-picker__section">
                {messages.sharedWithYou}
              </Text>
              <View className="workspace-picker__group">{shared.map(row)}</View>
            </>
          ) : null}
          {visible.length === 0 ? (
            <Text className="workspace-picker__empty">
              {interpolate(messages.workspaceSearchEmpty, {
                query: query.trim(),
              })}
            </Text>
          ) : null}
        </ScrollView>
      </View>
    </View>
  );
}
