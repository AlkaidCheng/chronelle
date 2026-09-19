"use client";

import type { ShareView } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useCallback, useRef, useState } from "react";

import { ShareIcon } from "../../components/icons";
import { useEventAccessQuery } from "../../lib/queries";
import { ShareSheet } from "./share-sheet";

/** Whether the account may share the Event, which the view controls and section menus follow. */
export function useCanShareEvent(eventId: string | undefined): boolean {
  const access = useEventAccessQuery(eventId);
  return access.data?.actions.includes("share") ?? false;
}

/**
 * Share, at the end of a view's head row, for whoever may share the
 * Event: opens the sheet that shares that view of the Event with people
 * at a role.
 */
export function ShareControl({
  eventId,
  view,
  viewName,
}: {
  readonly eventId: string;
  readonly view: ShareView;
  /** The view as people read it, for the sheet's title and hint. */
  readonly viewName: string;
}) {
  const t = useTranslations("share");
  const canShare = useCanShareEvent(eventId);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback((byKeyboard: boolean) => {
    setOpen(false);
    if (byKeyboard) trigger.current?.focus();
  }, []);
  if (!canShare) return null;
  return (
    <div className="head-menu share-control">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`button button-quiet head-menu-button${open ? " is-active" : ""}`}
        onClick={() => setOpen((current) => !current)}
        ref={trigger}
        type="button"
      >
        <ShareIcon />
        <span className="head-menu-text">{t("view")}</span>
      </button>
      {open ? (
        <ShareSheet
          eventId={eventId}
          hint={t("viewHint", { what: viewName })}
          name={viewName}
          onClose={close}
          scope={{ view, sectionId: null }}
        />
      ) : null}
    </div>
  );
}
