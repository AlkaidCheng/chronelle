import type { SessionResponse } from "@chronelle/schemas";
import { Button, Text, View } from "@tarojs/components";
import Taro from "@tarojs/taro";
import { useState } from "react";

import {
  accountLine,
  personInitials,
  workspaceIdentity,
} from "../account/workspace-identity";
import { type AppLocale, getMessages } from "../i18n/catalog";
import { Brand } from "./brand";
import { useNavigationBarLayout } from "./use-navigation-bar";
import { workspaceLabels } from "./workspace-labels";
import { WorkspaceMark } from "./workspace-mark";
import "../styles/icons.scss";
import "./shell.scss";

/**
 * The Events page's drawer: its collections, Trash, and the account at the
 * foot, whose menu holds the workspace, Friends, preferences, and sign-out.
 */
export function Sidebar({
  locale,
  onClose,
  onSignOut,
  onSwitchWorkspace,
  session,
}: {
  readonly locale: AppLocale;
  readonly onClose: () => void;
  readonly onSignOut: () => void;
  readonly onSwitchWorkspace: () => void;
  readonly session: SessionResponse;
}) {
  const messages = getMessages(locale);
  const layout = useNavigationBarLayout();
  const [accountOpen, setAccountOpen] = useState(false);
  const workspace = session.availableWorkspaces.find(
    (candidate) => candidate.id === session.workspace.id,
  );
  const identity = workspace
    ? workspaceIdentity(workspace, workspaceLabels(messages))
    : null;

  function open(url: string): void {
    onClose();
    void Taro.navigateTo({ url });
  }

  return (
    <View className="sidebar-layer">
      <View className="sidebar-scrim" onClick={onClose} />
      <View
        aria-label={messages.menu}
        aria-role="navigation"
        className="sidebar"
        style={{
          paddingTop: `${layout.statusBarHeight}px`,
          width: `${layout.drawerWidth}px`,
        }}
      >
        <View
          className="sidebar__head"
          style={{ height: `${layout.rowHeight}px` }}
        >
          <Brand />
          <Button
            aria-label={messages.close}
            className="shell-button sidebar__close"
            onClick={onClose}
          >
            <View className="icon icon--close" />
          </Button>
        </View>

        <Text className="sidebar__label">{messages.collections}</Text>
        <Button
          aria-selected
          className="shell-button sidebar__item sidebar__item--current"
          onClick={onClose}
        >
          <View className="icon icon--calendar sidebar__icon" />
          <Text>{messages.title}</Text>
        </Button>
        <Button
          className="shell-button sidebar__item"
          onClick={() => open("/features/people/index")}
        >
          <View className="icon icon--people sidebar__icon" />
          <Text>{messages.people}</Text>
        </Button>
        <View className="sidebar__rule" />
        <Button
          className="shell-button sidebar__item"
          onClick={() => open("/features/trash/index")}
        >
          <View className="icon icon--trash sidebar__icon" />
          <Text>{messages.trash}</Text>
        </Button>

        <View className="sidebar__fill" />

        {accountOpen ? (
          <View
            className="account-menu__catch"
            onClick={() => setAccountOpen(false)}
          />
        ) : null}
        <View className="sidebar__foot">
          {accountOpen ? (
            <View aria-role="menu" className="account-menu">
              <Text className="account-menu__label">{messages.workspace}</Text>
              {identity ? (
                <View className="account-menu__row">
                  <WorkspaceMark mark={identity.mark} />
                  <View className="account-menu__text">
                    <Text className="account-menu__title">
                      {identity.title}
                    </Text>
                    {identity.detail ? (
                      <Text className="account-menu__detail">
                        {identity.detail}
                      </Text>
                    ) : null}
                  </View>
                  <View className="icon icon--check account-menu__tick" />
                </View>
              ) : null}
              <Button
                className="shell-button account-menu__row"
                onClick={() => {
                  setAccountOpen(false);
                  onSwitchWorkspace();
                }}
              >
                <View className="account-menu__icon">
                  <View className="icon icon--switch" />
                </View>
                <Text className="account-menu__title">
                  {messages.switchWorkspace}
                </Text>
              </Button>
              <View className="account-menu__rule" />
              <Button
                className="shell-button account-menu__row"
                onClick={() => open("/features/people/friends")}
              >
                <View className="account-menu__icon">
                  <View className="icon icon--friends" />
                </View>
                <Text className="account-menu__title">{messages.friends}</Text>
              </Button>
              <Button
                className="shell-button account-menu__row"
                onClick={() => open("/features/account-preferences/index")}
              >
                <View className="account-menu__icon">
                  <View className="icon icon--sliders" />
                </View>
                <Text className="account-menu__title">
                  {messages.preferenceTitle}
                </Text>
              </Button>
              <View className="account-menu__rule" />
              <Button
                className="shell-button account-menu__row account-menu__row--danger"
                onClick={() => {
                  setAccountOpen(false);
                  onSignOut();
                }}
              >
                <View className="account-menu__icon">
                  <View className="icon icon--sign-out" />
                </View>
                <Text className="account-menu__title">{messages.signOut}</Text>
              </Button>
            </View>
          ) : null}
          <Button
            aria-expanded={accountOpen}
            className="shell-button account-block"
            onClick={() => setAccountOpen((value) => !value)}
          >
            <Text className="avatar">
              {personInitials(session.user.displayName)}
            </Text>
            <View className="account-block__who">
              <Text className="account-block__name">
                {session.user.displayName}
              </Text>
              <Text className="account-block__line">
                {workspace && identity
                  ? accountLine(session.user.username, workspace, identity)
                  : `@${session.user.username}`}
              </Text>
            </View>
            <View className="icon icon--caret-up account-block__caret" />
          </Button>
        </View>
      </View>
    </View>
  );
}
