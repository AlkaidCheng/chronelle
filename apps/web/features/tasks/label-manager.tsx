"use client";

import type { LabelResponse } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { CountedField } from "../../components/counted-field";
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
  const t = useTranslations("labels");
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
        <h2 id={`${id}-title`}>{t("title")}</h2>
        <button
          aria-label={t("close")}
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
          <p className="field-hint">{t("loading")}</p>
        ) : labels.data.items.length === 0 ? (
          <p className="field-hint">{t("none")}</p>
        ) : (
          <ul className="label-manager">
            {labels.data.items.map((label) => (
              <LabelRow key={label.id} label={label} />
            ))}
          </ul>
        )}
        <div className="label-add">
          <CountedField
            label={t("newLabel")}
            limit={40}
            onChange={setDraft}
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
            {create.isPending ? t("adding") : t("add")}
          </button>
        </div>
        {error ? (
          <p role="alert">
            {error instanceof Error ? error.message : t("addFailed")}
          </p>
        ) : null}
      </div>
    </dialog>
  );
}

function LabelRow({ label }: { readonly label: LabelResponse }) {
  const t = useTranslations("labels");
  const update = useUpdateLabel();
  const remove = useDeleteLabel();
  const [name, setName] = useState(label.name);
  const [confirming, setConfirming] = useState(false);
  const busy = update.isPending || remove.isPending;
  const failure = update.error ?? remove.error;
  return (
    <li>
      <CountedField
        disabled={busy}
        hideLabel
        label={t("nameOf", { name: label.name })}
        limit={40}
        onChange={setName}
        value={name}
      />
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
        {update.isPending ? t("renaming") : t("rename")}
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
            {remove.isPending
              ? t("deleting")
              : t("deleteNamed", { name: label.name })}
          </button>
          <button
            className="button button-quiet button-small"
            disabled={busy}
            onClick={() => setConfirming(false)}
            type="button"
          >
            {t("keep")}
          </button>
        </>
      ) : (
        <button
          aria-label={t("deleteNamed", { name: label.name })}
          className="button button-quiet button-small"
          disabled={busy}
          onClick={() => setConfirming(true)}
          type="button"
        >
          {t("delete")}
        </button>
      )}
      {failure ? (
        <p role="alert">
          {failure instanceof Error ? failure.message : t("changeFailed")}
        </p>
      ) : null}
    </li>
  );
}
