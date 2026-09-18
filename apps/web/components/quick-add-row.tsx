"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { ErrorNotice } from "./feedback";
import { IconButton } from "./icon-button";
import { PencilIcon, PlusIcon } from "./icons";

/** What a quick add row holds: whether it is open, the typed name, a refusal. */
export interface QuickAddState {
  readonly isOpen: boolean;
  readonly value: string;
  readonly error: unknown;
}

const closedQuickAdd: QuickAddState = { isOpen: false, value: "", error: null };

/**
 * The state of a collection's quick add rows, by slot, owned by the
 * collection rather than by the rows: the row under an empty collection
 * and the row that follows its first item are different elements, and the
 * field must stay open, typed, and focused across that change.
 */
export interface QuickAddSlots {
  readonly stateOf: (slot: string) => QuickAddState;
  readonly update: (slot: string, patch: Partial<QuickAddState>) => void;
}

export function useQuickAddSlots(): QuickAddSlots {
  const [slots, setSlots] = useState<Readonly<Record<string, QuickAddState>>>(
    {},
  );
  return useMemo(
    () => ({
      stateOf: (slot) => slots[slot] ?? closedQuickAdd,
      update: (slot, patch) =>
        setSlots((current) => ({
          ...current,
          [slot]: { ...(current[slot] ?? closedQuickAdd), ...patch },
        })),
    }),
    [slots],
  );
}

/**
 * A quiet "Add expense" line on the rows' own grid that opens the
 * collection's editor: the add control of a collection that has no
 * quick add of its own.
 */
export function AddRow({
  label,
  onOpen,
  ...rest
}: {
  /** The words of the row, also its accessible name unless one is given. */
  readonly label: string;
  readonly onOpen: () => void;
  readonly "aria-haspopup"?: "dialog" | undefined;
}) {
  return (
    <button
      className="quick-add"
      onClick={(event) => {
        // The row keeps focus so a dialog it opens can return it.
        event.currentTarget.focus();
        onOpen();
      }}
      type="button"
      {...rest}
    >
      <PlusIcon />
      <span>{label}</span>
    </button>
  );
}

/**
 * The last row of a collection: a quiet "Add task" line on the rows' own
 * grid that becomes a name field in place. Enter adds the name and keeps
 * the field open for the next one; Escape, or leaving the field empty,
 * puts the row back. A refused add keeps the typed name under a notice.
 * With `details`, the open row offers the full editor for what was typed.
 */
export function QuickAddRow({
  details,
  label,
  name,
  onAdd,
  placeholder,
  slot,
  slots,
  text,
}: {
  /** The full editor, opened with the typed name: its accessible name and what it does. */
  readonly details?:
    | { readonly label: string; readonly open: (displayName: string) => void }
    | undefined;
  /** The accessible name of the closed row, e.g. "Add a task for Sep 21". */
  readonly label: string;
  /** The accessible name of the field, e.g. "New task". */
  readonly name: string;
  /** Creates the record; the row keeps the name while this rejects. */
  readonly onAdd: (displayName: string) => Promise<unknown>;
  readonly placeholder: string;
  /** Which of the collection's rows this is, e.g. "list" or a day. */
  readonly slot: string;
  readonly slots: QuickAddSlots;
  /** The words of the closed row, e.g. "Add task". */
  readonly text: string;
}) {
  const { isOpen, value, error } = slots.stateOf(slot);
  const [isPending, setIsPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The field takes focus as it opens, and again when the collection
  // re-renders it elsewhere (after its first item, say), so typing goes on.
  useEffect(() => {
    if (isOpen) input.current?.focus();
  }, [isOpen]);

  function close() {
    slots.update(slot, closedQuickAdd);
  }

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const displayName = value.trim();
    if (displayName === "" || isPending) return;
    setIsPending(true);
    try {
      await onAdd(displayName);
      slots.update(slot, { value: "", error: null });
    } catch (failure) {
      slots.update(slot, { error: failure });
    } finally {
      setIsPending(false);
      input.current?.focus();
    }
  }

  if (!isOpen)
    return (
      <button
        aria-label={label}
        className="quick-add"
        onClick={() => slots.update(slot, { isOpen: true })}
        type="button"
      >
        <PlusIcon />
        <span>{text}</span>
      </button>
    );
  return (
    <form
      className="quick-add is-open"
      onSubmit={(event) => void submit(event)}
    >
      <PlusIcon />
      <div className="quick-add-field">
        <input
          aria-label={name}
          onBlur={() => {
            if (!isPending && value.trim() === "") close();
          }}
          onChange={(event) =>
            slots.update(slot, { value: event.target.value, error: null })
          }
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              close();
            }
          }}
          placeholder={placeholder}
          ref={input}
          type="text"
          value={value}
        />
        {error === null ? null : <ErrorNotice error={error} />}
      </div>
      {details === undefined ? null : (
        <IconButton
          className="quick-add-details"
          label={details.label}
          onClick={() => {
            const typed = value.trim();
            close();
            details.open(typed);
          }}
          onMouseDown={(event) => event.preventDefault()}
        >
          <PencilIcon />
        </IconButton>
      )}
    </form>
  );
}
