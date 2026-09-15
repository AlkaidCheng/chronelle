"use client";

import type { LabelResponse } from "@chronelle/schemas";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ErrorNotice } from "../../components/feedback";
import {
  useCreateLabel,
  useDeleteLabel,
  useLabelsQuery,
  useUpdateLabel,
} from "../../lib/queries";
import { useSessionDialog } from "../../lib/use-session-dialog";

/** Opens the label manager: the workspace's labels, renamed, added, and deleted in place. */
export function ManageLabelsButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        aria-haspopup="dialog"
        className="button button-quiet"
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
        type="button"
      >
        Manage labels
      </button>
      {open
        ? createPortal(
            <LabelManagerDialog onClose={() => setOpen(false)} />,
            document.body,
          )
        : null}
    </>
  );
}

function LabelManagerDialog({ onClose }: { readonly onClose: () => void }) {
  const dialog = useSessionDialog(onClose);
  const backdropPress = useRef(false);
  const id = useId();
  const labels = useLabelsQuery();
  const create = useCreateLabel();
  const [draft, setDraft] = useState("");
  const error = create.error;
  return (
    <dialog
      aria-labelledby={`${id}-title`}
      className="event-create-dialog"
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        backdropPress.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (backdropPress.current && event.target === event.currentTarget)
          onClose();
        backdropPress.current = false;
      }}
      ref={dialog}
    >
      <header className="event-create-header">
        <h2 id={`${id}-title`}>Labels</h2>
        <button
          aria-label="Close labels"
          className="dialog-close"
          onClick={onClose}
          type="button"
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body">
        {labels.isError ? (
          <ErrorNotice
            error={labels.error}
            onRefresh={() => void labels.refetch()}
          />
        ) : labels.data === undefined ? (
          <p className="field-hint">Loading labels...</p>
        ) : labels.data.items.length === 0 ? (
          <p className="field-hint">No labels yet.</p>
        ) : (
          <ul className="label-manager">
            {labels.data.items.map((label) => (
              <LabelRow key={label.id} label={label} />
            ))}
          </ul>
        )}
        <div className="label-add">
          <label className="field">
            <span>New label</span>
            <input
              maxLength={40}
              onChange={(input) => setDraft(input.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                if (draft.trim() !== "" && !create.isPending)
                  create.mutate(
                    { name: draft.trim() },
                    { onSuccess: () => setDraft("") },
                  );
              }}
              value={draft}
            />
          </label>
          <button
            className="button button-secondary button-small"
            disabled={draft.trim() === "" || create.isPending}
            onClick={() =>
              create.mutate(
                { name: draft.trim() },
                { onSuccess: () => setDraft("") },
              )
            }
            type="button"
          >
            {create.isPending ? "Adding..." : "Add label"}
          </button>
        </div>
        {error ? (
          <p role="alert">
            {error instanceof Error
              ? error.message
              : "The label could not be added."}
          </p>
        ) : null}
      </div>
    </dialog>
  );
}

function LabelRow({ label }: { readonly label: LabelResponse }) {
  const update = useUpdateLabel();
  const remove = useDeleteLabel();
  const [name, setName] = useState(label.name);
  const [confirming, setConfirming] = useState(false);
  const busy = update.isPending || remove.isPending;
  const failure = update.error ?? remove.error;
  return (
    <li>
      <label className="field">
        <span className="visually-hidden">Name of {label.name}</span>
        <input
          aria-label={`Name of ${label.name}`}
          disabled={busy}
          maxLength={40}
          onChange={(input) => setName(input.target.value)}
          value={name}
        />
      </label>
      <button
        className="button button-secondary button-small"
        disabled={busy || name.trim() === "" || name.trim() === label.name}
        onClick={() =>
          update.mutate({
            id: label.id,
            input: { expectedVersion: label.version, name: name.trim() },
          })
        }
        type="button"
      >
        {update.isPending ? "Renaming..." : "Rename"}
      </button>
      {confirming ? (
        <>
          <button
            className="button button-primary button-small"
            disabled={busy}
            onClick={() =>
              remove.mutate({ id: label.id, expectedVersion: label.version })
            }
            type="button"
          >
            {remove.isPending ? "Deleting..." : `Delete ${label.name}`}
          </button>
          <button
            className="button button-quiet button-small"
            disabled={busy}
            onClick={() => setConfirming(false)}
            type="button"
          >
            Keep
          </button>
        </>
      ) : (
        <button
          aria-label={`Delete ${label.name}`}
          className="button button-quiet button-small"
          disabled={busy}
          onClick={() => setConfirming(true)}
          type="button"
        >
          Delete
        </button>
      )}
      {failure ? (
        <p role="alert">
          {failure instanceof Error ? failure.message : "The change failed."}
        </p>
      ) : null}
    </li>
  );
}
