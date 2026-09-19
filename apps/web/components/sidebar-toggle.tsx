"use client";

import { useTranslations } from "next-intl";
import {
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useSyncExternalStore,
} from "react";

import { canToggleSidebar } from "../lib/keyboard";
import { useDisplayPreference } from "../lib/use-display-preference";
import { IconButton } from "./icon-button";
import { SidebarIcon } from "./icons";

/** A window this wide has a sidebar to fold; a phone keeps its bottom bar. */
const desktopQuery = "(min-width: 761px)";

/** The keys, as `aria-keyshortcuts` names them, that fold the sidebar on either platform. */
const shortcutKeys = "Meta+\\ Control+\\";

/** A document without media queries (a test's) counts as wide. */
function isWide() {
  return (
    typeof window.matchMedia !== "function" ||
    window.matchMedia(desktopQuery).matches
  );
}

function subscribeToWidth(notify: () => void) {
  if (typeof window.matchMedia !== "function") return () => {};
  const media = window.matchMedia(desktopQuery);
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}

export interface SidebarState {
  /** The sidebar is folded away: only on a wide window, never a phone's bar. */
  readonly collapsed: boolean;
  readonly toggle: () => void;
  readonly collapseControl: RefObject<HTMLButtonElement | null>;
  readonly expandControl: RefObject<HTMLButtonElement | null>;
}

/**
 * Whether the sidebar is shown or collapsed, kept on this device as a
 * display preference (applied before the first paint by the bootstrap
 * script, like the theme) and honoured only while the window is wide
 * enough for a sidebar. Collapsing moves focus to the control that expands
 * and expanding to the one that collapses, so the keyboard keeps its place;
 * Cmd/Ctrl+\ toggles it outside text fields and dialogs.
 */
export function useSidebar(): SidebarState {
  const { value, setValue } = useDisplayPreference("sidebar");
  const wide = useSyncExternalStore(subscribeToWidth, isWide, () => false);
  const collapsed = wide && value === "collapsed";
  const collapseControl = useRef<HTMLButtonElement>(null);
  const expandControl = useRef<HTMLButtonElement>(null);
  const focusAfter = useRef<"collapse" | "expand" | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: The fold decides when the control to focus is mounted.
  useEffect(() => {
    const target = focusAfter.current;
    if (target === null) return;
    focusAfter.current = null;
    (target === "expand" ? expandControl : collapseControl).current?.focus();
  }, [collapsed]);

  const toggle = useCallback(() => {
    focusAfter.current = collapsed ? "collapse" : "expand";
    setValue(collapsed ? "open" : "collapsed");
  }, [collapsed, setValue]);

  useEffect(() => {
    if (!wide) return;
    function onKeyDown(event: KeyboardEvent) {
      if (!canToggleSidebar(event)) return;
      event.preventDefault();
      toggle();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [toggle, wide]);

  return { collapsed, toggle, collapseControl, expandControl };
}

/** The control in the sidebar's head that collapses it. */
export function SidebarCollapseControl({
  sidebar,
}: {
  readonly sidebar: SidebarState;
}) {
  const t = useTranslations("nav");
  return (
    <IconButton
      ref={sidebar.collapseControl}
      className="sidebar-collapse"
      label={t("collapseSidebar")}
      aria-keyshortcuts={shortcutKeys}
      onClick={sidebar.toggle}
    >
      <SidebarIcon />
    </IconButton>
  );
}

/** The control at the content's edge that brings a collapsed sidebar back. */
export function SidebarExpandControl({
  sidebar,
}: {
  readonly sidebar: SidebarState;
}) {
  const t = useTranslations("nav");
  if (!sidebar.collapsed) return null;
  return (
    <IconButton
      ref={sidebar.expandControl}
      className="sidebar-expand"
      label={t("expandSidebar")}
      aria-keyshortcuts={shortcutKeys}
      onClick={sidebar.toggle}
    >
      <SidebarIcon />
    </IconButton>
  );
}
