"use client";

import { type FormEvent, useEffect, useRef, useState } from "react";

import { ErrorNotice } from "./feedback";
import { PlusIcon } from "./icons";

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
  text,
}: {
  /** The accessible name of the closed row, e.g. "Add a task for Sep 21". */
  readonly label: string;
  /** The accessible name of the field, e.g. "New task". */
  readonly name: string;
  /** Creates the record; the row keeps the name while this rejects. */
  readonly onAdd: (displayName: string) => Promise<unknown>;
  readonly placeholder: string;
  /** The words of the closed row, e.g. "Add task". */
  readonly text: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [isPending, setIsPending] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  // The field takes focus as it opens, so typing can start at once.
  useEffect(() => {
    if (isOpen) input.current?.focus();
  }, [isOpen]);

  function close() {
    setIsOpen(false);
    setValue("");
    setError(null);
  }

  async function submit(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    const displayName = value.trim();
    if (displayName === "" || isPending) return;
    setIsPending(true);
    try {
      await onAdd(displayName);
      setValue("");
      setError(null);
    } catch (failure) {
      setError(failure);
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
        onClick={() => setIsOpen(true)}
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
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
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
