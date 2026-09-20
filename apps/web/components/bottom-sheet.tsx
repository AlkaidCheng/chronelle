"use client";

import { useTranslations } from "next-intl";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useLayoutEffect,
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

  // A layout effect, so the dialog is open before what is inside it
  // places its focus in an effect of its own.
  useLayoutEffect(() => {
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
    <dialog
      ref={dialog}
      className="bottom-sheet"
      aria-label={label}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      // Escape closes the sheet from anywhere inside it: a search field
      // with text would otherwise take the key to clear itself.
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
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
