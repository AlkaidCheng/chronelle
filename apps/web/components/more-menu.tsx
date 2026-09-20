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
import { useInstallControl } from "./install-app";
import { useNotices } from "./notices";
import {
  focusFirstMenuItem,
  moveMenuFocus,
  useMenuDismissal,
} from "./quiet-menu";
import { ThemePanel } from "./theme-panel";

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
  const theme = useTranslations("theme");
  const installText = useTranslations("install");
  const install = useInstallControl();
  const { post } = useNotices();
  const keyboard = useKeyboardDevice();
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
  function notYet(name: string) {
    setOpen(false);
    post({ message: t("notAvailableYet", { name }) });
  }

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
          <Link
            role="menuitem"
            tabIndex={-1}
            className="quiet-menu-item"
            href="/trash"
            onClick={() => setOpen(false)}
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
              setOpen(false);
              setThemeOpen(true);
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
              setOpen(false);
              onCustomize();
            }}
          >
            <PencilIcon />
            <span>{t("customize")}</span>
          </button>
          {keyboard ? (
            <Link
              role="menuitem"
              tabIndex={-1}
              className="quiet-menu-item"
              href="/settings/keyboard"
              onClick={() => setOpen(false)}
            >
              <KeyboardIcon />
              <span>{t("keyboardShortcuts")}</span>
            </Link>
          ) : null}
          {install.mode === "none" ? null : (
            <button
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="quiet-menu-item"
              aria-haspopup={install.mode === "ios" ? "dialog" : undefined}
              onClick={() => {
                // As for the palette: closing the steps returns focus here.
                setOpen(false);
                trigger.current?.focus();
                install.activate();
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
            onClick={() => notYet(t("help"))}
          >
            <HelpIcon />
            <span>{t("help")}</span>
          </button>
        </div>
      ) : null}
      <ThemePanel open={themeOpen} onClose={closeTheme} />
      {install.steps}
    </div>
  );
}
