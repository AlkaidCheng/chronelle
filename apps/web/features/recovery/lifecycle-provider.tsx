"use client";

import { useTranslations } from "next-intl";
import { createContext, type ReactNode, useContext, useState } from "react";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { useNotices } from "../../components/notices";
import {
  type LifecycleTarget,
  useLifecycleActions,
  useRecoverObject,
  useRecoverRelation,
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
  const verbs = useTranslations("verbs");
  const confirm = useTranslations("confirm");
  const done = useTranslations("done");
  const common = useTranslations("common");
  const actions = useLifecycleActions(target);
  const recoverRelation = useRecoverRelation();
  const recoverObject = useRecoverObject(target.id);
  const { post } = useNotices();
  const [askingTrash, setAskingTrash] = useState(false);
  const pending = actions.trash.isPending || actions.remove.isPending;
  const error =
    actions.trash.error ??
    actions.remove.error ??
    actions.objectAccess.error ??
    actions.contextAccess.error ??
    actions.relations.error;
  const inclusion = actions.inclusion;
  const canRemove =
    inclusion !== undefined &&
    (target.relation === undefined
      ? actions.contextAccess.data?.actions.includes("edit")
      : actions.objectAccess.data?.actions.includes("edit"));
  const canTrash = actions.objectAccess.data?.actions.includes("delete");

  // Each outcome is posted once the API has answered, past tense, with the
  // step that reverses it; a refusal stays in the dialog under the verb.
  function removeFromEvent() {
    if (inclusion === undefined) return;
    actions.remove.mutate(
      { id: inclusion.id, version: inclusion.version },
      {
        onSuccess: (removed) => {
          onClose();
          post({
            message: done("removedFromEvent"),
            action: {
              label: done("undo"),
              run: () =>
                recoverRelation.mutateAsync({
                  id: removed.id,
                  version: removed.version,
                }),
            },
          });
        },
      },
    );
  }
  function moveToTrash() {
    actions.trash.mutate(undefined, {
      onSuccess: (deleted) => {
        onClose();
        post({
          message: done("movedToTrash"),
          action: {
            label: done("undo"),
            run: () =>
              recoverObject.mutateAsync({ expectedVersion: deleted.version }),
          },
        });
      },
    });
  }

  return (
    <RecoveryDialog title={target.displayName} onClose={onClose}>
      {actions.objectAccess.isPending ? (
        <LoadingState label={t("checking")} />
      ) : null}
      {error !== null ? <ErrorNotice error={error} /> : null}
      <div className="lifecycle-options">
        {canRemove ? (
          <div className="lifecycle-option">
            <button
              className="button button-secondary"
              type="button"
              disabled={pending}
              onClick={removeFromEvent}
            >
              {actions.remove.isPending
                ? t("saving")
                : verbs("removeFromEvent")}
            </button>
            <p className="muted">{t("removeNote")}</p>
          </div>
        ) : null}
        {canTrash ? (
          <div className="lifecycle-option">
            {askingTrash ? (
              <div className="confirm-line">
                <span>{confirm("trash", { name: target.displayName })}</span>
                <button
                  className="button button-primary button-small"
                  type="button"
                  disabled={pending}
                  onClick={moveToTrash}
                >
                  {actions.trash.isPending ? t("saving") : verbs("moveToTrash")}
                </button>
                <button
                  className="button button-quiet button-small"
                  type="button"
                  disabled={pending}
                  onClick={() => setAskingTrash(false)}
                >
                  {common("cancel")}
                </button>
              </div>
            ) : (
              <>
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={pending}
                  onClick={() => setAskingTrash(true)}
                >
                  {verbs("moveToTrash")}
                </button>
                <p className="muted">{t("trashNote")}</p>
              </>
            )}
          </div>
        ) : null}
      </div>
      {actions.objectAccess.isSuccess && !canTrash && !canRemove ? (
        <p className="muted">{t("noActions")}</p>
      ) : null}
    </RecoveryDialog>
  );
}
