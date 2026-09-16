"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";

import { ErrorNotice } from "./feedback";
import { PlusIcon } from "./icons";

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
 * The last row of a collection: a quiet "Add task" line on the rows' own
 * grid that becomes a name field in place. Enter adds the name and keeps
 * the field open for the next one; Escape, or leaving the field empty,
 * puts the row back. A refused add keeps the typed name under a notice.
 */
export function QuickAddRow({
  label,
  name,
  onAdd,
  placeholder,
  slot,
  slots,
  text,
}: {
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
    </form>
  );
}
