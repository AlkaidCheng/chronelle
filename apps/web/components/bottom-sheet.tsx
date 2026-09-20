"use client";

import { useTranslations } from "next-intl";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
} from "react";

/** How far a finger pulls the handle down before the sheet closes. */
const pullToClose = 56;

/**
 * A panel that rises from the bottom of a phone's screen and never leaves
 * it: a scrim behind, a handle at its top, rounded upper corners, and the
 * safe area kept clear below. It is a modal dialog, so focus stays inside
 * while it is open and returns to the control that opened it; Escape, a
 * press on the scrim, or a pull on the handle close it.
 */
export function BottomSheet({
  open,
  label,
  onClose,
  children,
}: {
  readonly open: boolean;
  readonly label: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  const t = useTranslations("common");
  const dialog = useRef<HTMLDialogElement>(null);
  const pull = useRef<{ id: number; y: number } | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);

  function onHandleDown(event: ReactPointerEvent<HTMLButtonElement>) {
    pull.current = { id: event.pointerId, y: event.clientY };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function onHandleUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = pull.current;
    pull.current = null;
    if (start === null || start.id !== event.pointerId) return;
    if (event.clientY - start.y > pullToClose) onClose();
  }

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: Escape closes the dialog through its cancel event; the click closes on the scrim alone.
    <dialog
      ref={dialog}
      className="bottom-sheet"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open) onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        className="bottom-sheet-handle"
        aria-label={t("close")}
        onPointerDown={onHandleDown}
        onPointerUp={onHandleUp}
        onPointerCancel={() => {
          pull.current = null;
        }}
        onClick={onClose}
      >
        <span aria-hidden="true" />
      </button>
      {open ? children : null}
    </dialog>
  );
}
