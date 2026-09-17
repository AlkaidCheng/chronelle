"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useContext, useState } from "react";
import { ErrorNotice, LoadingState, Notice } from "../../components/feedback";
import {
  type LifecycleTarget,
  useLifecycleActions,
} from "../../lib/recovery-queries";
import { RecoveryDialog } from "./recovery-dialog";

const LifecycleContext = createContext<
  ((target: LifecycleTarget) => void) | null
>(null);

export function LifecycleProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [target, setTarget] = useState<LifecycleTarget | null>(null);
  return (
    <LifecycleContext.Provider value={setTarget}>
      {children}
      {target === null ? null : (
        <LifecycleDialog
          key={target.id}
          target={target}
          onClose={() => setTarget(null)}
        />
      )}
    </LifecycleContext.Provider>
  );
}

/** Opens the move-to-Trash dialog for a record. */
export function useOpenLifecycle() {
  const open = useContext(LifecycleContext);
  if (open === null) throw new Error("LifecycleProvider is required.");
  return open;
}

export function LifecycleButton({
  target,
}: {
  readonly target: LifecycleTarget;
}) {
  const t = useTranslations("lifecycle");
  const open = useOpenLifecycle();
  return (
    <button
      className="button button-quiet button-small"
      type="button"
      aria-label={t("actionsFor", { name: target.displayName })}
      onClick={() => open(target)}
    >
      {t("actions")}
    </button>
  );
}

function LifecycleDialog({
  target,
  onClose,
}: {
  readonly target: LifecycleTarget;
  readonly onClose: () => void;
}) {
  const t = useTranslations("lifecycle");
  const actions = useLifecycleActions(target);
  const [proposal, setProposal] = useState<
    { kind: "trash" } | { kind: "remove"; id: string; version: number } | null
  >(null);
  const [confirmed, setConfirmed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pending = actions.trash.isPending || actions.remove.isPending;
  const error =
    actions.trash.error ??
    actions.remove.error ??
    actions.objectAccess.error ??
    actions.contextAccess.error ??
    actions.relations.error;
  const canRemove =
    actions.inclusion !== undefined &&
    (target.relation === undefined
      ? actions.contextAccess.data?.actions.includes("edit")
      : actions.objectAccess.data?.actions.includes("edit"));
  return (
    <RecoveryDialog title={target.displayName} onClose={onClose}>
      {message !== null ? (
        <>
          <Notice tone="success">{message}</Notice>
          <Link href="/trash" onClick={onClose}>
            {t("openTrash")}
          </Link>
        </>
      ) : (
        <>
          <p>{t("intro")}</p>
          {actions.objectAccess.isPending ? (
            <LoadingState label={t("checking")} />
          ) : null}
          {error !== null ? (
            <>
              <ErrorNotice error={error} />
              <p>{t("reloadNote")}</p>
            </>
          ) : null}
          <div className="recovery-options">
            {canRemove && actions.inclusion !== undefined ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={pending || error !== null}
                onClick={() => {
                  if (actions.inclusion !== undefined)
                    setProposal({
                      kind: "remove",
                      id: actions.inclusion.id,
                      version: actions.inclusion.version,
                    });
                  setConfirmed(false);
                }}
              >
                {t("removeLink")}
              </button>
            ) : null}
            {actions.objectAccess.data?.actions.includes("delete") ? (
              <button
                className="button button-secondary"
                type="button"
                disabled={pending || error !== null}
                onClick={() => {
                  setProposal({ kind: "trash" });
                  setConfirmed(false);
                }}
              >
                {t("moveToTrash")}
              </button>
            ) : null}
          </div>
          {proposal !== null ? (
            <section className="history-preview" aria-label={t("preview")}>
              <h3>
                {proposal.kind === "remove"
                  ? t("removeTitle")
                  : t("trashTitle")}
              </h3>
              <p>
                {proposal.kind === "remove" ? t("removeNote") : t("trashNote")}
              </p>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={pending || error !== null}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                {t("understand")}
              </label>
              <button
                className="button button-primary"
                type="button"
                disabled={!confirmed || pending || error !== null}
                onClick={() => {
                  if (proposal.kind === "remove")
                    actions.remove.mutate(proposal, {
                      onSuccess: () => setMessage(t("linkRemoved")),
                    });
                  else
                    actions.trash.mutate(undefined, {
                      onSuccess: () => setMessage(t("movedToTrash")),
                    });
                }}
              >
                {pending
                  ? t("saving")
                  : proposal.kind === "remove"
                    ? t("confirmRemoval")
                    : t("confirmTrash")}
              </button>
            </section>
          ) : null}
          {actions.objectAccess.isSuccess &&
          !actions.objectAccess.data.actions.includes("delete") &&
          !canRemove ? (
            <p className="muted">{t("noActions")}</p>
          ) : null}
        </>
      )}
    </RecoveryDialog>
  );
}
