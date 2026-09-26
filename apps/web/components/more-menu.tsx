"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import {
  DownloadIcon,
  HelpIcon,
  KeyboardIcon,
  MoreGridIcon,
  PencilIcon,
  ThemeIcon,
  TrashIcon,
} from "./icons";
import { useKeyboardDevice } from "../lib/use-keyboard-device";
import type { InstallMode } from "../lib/use-install-app";
import { useInstallControl } from "./install-app";
import { useNotices } from "./notices";
import {
  focusFirstMenuItem,
  moveMenuFocus,
  useMenuDismissal,
} from "./quiet-menu";
import { SettingsLink } from "./settings-link";
import { ThemePanel } from "./theme-panel";

/**
 * What More offers: Trash, Theme, Customize sidebar, Keyboard shortcuts
 * (the Keyboard section of Settings, on a keyboard device), Install app
 * while the browser can install it from here, and Help. The rail's menu
 * and the phone's account sheet both list them; `onChoose` runs as an
 * entry is taken, before it acts, `onSettings` in its place as Keyboard
 * shortcuts opens Settings (the surface closes and puts focus where
 * closing the dialog returns it), and the surface decides how Theme and
 * the install steps open.
 */
export function MoreMenuItems({
  onChoose,
  onSettings,
  onTheme,
  onCustomize,
  installMode,
  onInstall,
}: {
  readonly onChoose: () => void;
  readonly onSettings: () => void;
  readonly onTheme: () => void;
  readonly onCustomize: () => void;
  readonly installMode: InstallMode;
  readonly onInstall: () => void;
}) {
  const t = useTranslations("nav");
  const theme = useTranslations("theme");
  const installText = useTranslations("install");
  const keyboard = useKeyboardDevice();
  const { post } = useNotices();
  return (
    <>
      <Link
        role="menuitem"
        tabIndex={-1}
        className="quiet-menu-item"
        href="/trash"
        onClick={onChoose}
      >
        <TrashIcon />
        <span>{t("trash")}</span>
      </Link>
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="quiet-menu-item"
        aria-haspopup="dialog"
        onClick={() => {
          onChoose();
          onTheme();
        }}
      >
        <ThemeIcon />
        <span>{theme("title")}</span>
      </button>
      <hr className="quiet-menu-separator" />
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="quiet-menu-item more-customize"
        onClick={() => {
          onChoose();
          onCustomize();
        }}
      >
        <PencilIcon />
        <span>{t("customize")}</span>
      </button>
      {keyboard ? (
        <SettingsLink
          role="menuitem"
          tabIndex={-1}
          className="quiet-menu-item"
          section="keyboard"
          onOpen={onSettings}
        >
          <KeyboardIcon />
          <span>{t("keyboardShortcuts")}</span>
        </SettingsLink>
      ) : null}
      {installMode === "none" ? null : (
        <button
          type="button"
          role="menuitem"
          tabIndex={-1}
          className="quiet-menu-item"
          aria-haspopup={installMode === "ios" ? "dialog" : undefined}
          onClick={() => {
            onChoose();
            onInstall();
          }}
        >
          <DownloadIcon />
          <span>{installText("title")}</span>
        </button>
      )}
      <button
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="quiet-menu-item"
        onClick={() => {
          onChoose();
          post({ message: t("notAvailableYet", { name: t("help") }) });
        }}
      >
        <HelpIcon />
        <span>{t("help")}</span>
      </button>
    </>
  );
}

/**
 * The More control beside the profile block: what acts on the app rather
 * than on records. Trash, Theme (the panel opens beside the rail),
 * Customize sidebar, Keyboard shortcuts (the Keyboard section of
 * Settings, offered on keyboard devices only), Install app while the
 * browser can install it from here, then Help, which has no surface yet:
 * choosing it posts a passing notice saying so. Escape or a press outside
 * closes the menu or the panel and, from the keyboard, returns focus to
 * the control.
 */
export function MoreMenu({
  onCustomize,
}: {
  readonly onCustomize: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [themeOpen, setThemeOpen] = useState(false);
  const id = useId();
  const t = useTranslations("nav");
  const install = useInstallControl();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) focusFirstMenuItem(menu.current);
  }, [open]);
  const contains = useCallback(
    (target: Node) => root.current?.contains(target) ?? false,
    [],
  );
  const close = useCallback((byKeyboard: boolean) => {
    setOpen(false);
    if (byKeyboard) trigger.current?.focus();
  }, []);
  useMenuDismissal(open, contains, close);
  const closeTheme = useCallback((byKeyboard: boolean) => {
    setThemeOpen(false);
    if (byKeyboard) trigger.current?.focus();
  }, []);

  return (
    <div className="more-menu" ref={root}>
      <button
        ref={trigger}
        type="button"
        className="more-trigger"
        aria-label={t("more")}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={`${id}-menu`}
        onClick={() => {
          setThemeOpen(false);
          setOpen((current) => !current);
        }}
      >
        <MoreGridIcon />
      </button>
      {open ? (
        <div
          ref={menu}
          id={`${id}-menu`}
          role="menu"
          aria-label={t("more")}
          className="quiet-menu-list more-menu-list"
          onKeyDown={(event) => {
            if (moveMenuFocus(event, menu.current) === "left") setOpen(false);
          }}
        >
          <MoreMenuItems
            onChoose={() => setOpen(false)}
            onSettings={() => close(true)}
            onTheme={() => setThemeOpen(true)}
            onCustomize={onCustomize}
            installMode={install.mode}
            // The control takes focus before the steps open, so closing
            // them returns focus here, as closing the Theme panel does.
            onInstall={() => {
              trigger.current?.focus();
              install.activate();
            }}
          />
        </div>
      ) : null}
      <ThemePanel open={themeOpen} onClose={closeTheme} />
      {install.steps}
    </div>
  );
}
