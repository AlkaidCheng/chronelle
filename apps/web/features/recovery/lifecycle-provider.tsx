"use client";

import Link from "next/link";
import { createContext, type ReactNode, useContext, useState } from "react";
import { ErrorNotice, LoadingState } from "../../components/feedback";
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

export function LifecycleButton({
  target,
}: {
  readonly target: LifecycleTarget;
}) {
  const open = useContext(LifecycleContext);
  if (open === null) throw new Error("LifecycleProvider is required.");
  return (
    <button
      className="button button-quiet button-small"
      type="button"
      aria-label={`Actions for ${target.displayName}`}
      onClick={() => open(target)}
    >
      Actions
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
          <p role="status" className="notice">
            {message}
          </p>
          <Link href="/trash" onClick={onClose}>
            Open Trash
          </Link>
        </>
      ) : (
        <>
          <p>
            Removing a context link and moving the object to Trash have
            different effects.
          </p>
          {actions.objectAccess.isPending ? (
            <LoadingState label="Checking available actions" />
          ) : null}
          {error !== null ? (
            <>
              <ErrorNotice error={error} />
              <p>Close this dialog and reload the view before trying again.</p>
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
                Remove context link
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
                Move to Trash
              </button>
            ) : null}
          </div>
          {proposal !== null ? (
            <section className="history-preview" aria-label="Deletion preview">
              <h3>
                {proposal.kind === "remove"
                  ? "Remove this link only"
                  : "Move the canonical object to Trash"}
              </h3>
              <p>
                {proposal.kind === "remove"
                  ? "The object, its history, permissions, and other contexts remain unchanged. Recover this link from Removed links while both objects are available."
                  : "This object disappears from normal views and downloads. Its content, files, history, and permissions are retained. Related objects are not deleted. A current Owner can recover it from Trash."}
              </p>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={pending || error !== null}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I understand what will change.
              </label>
              <button
                className="button button-primary"
                type="button"
                disabled={!confirmed || pending || error !== null}
                onClick={() => {
                  if (proposal.kind === "remove")
                    actions.remove.mutate(proposal, {
                      onSuccess: () =>
                        setMessage(
                          "Link removed. The canonical object remains available.",
                        ),
                    });
                  else
                    actions.trash.mutate(undefined, {
                      onSuccess: () =>
                        setMessage(
                          "Moved to Trash. No related objects were deleted.",
                        ),
                    });
                }}
              >
                {pending
                  ? "Saving..."
                  : proposal.kind === "remove"
                    ? "Confirm removal"
                    : "Confirm move to Trash"}
              </button>
            </section>
          ) : null}
          {actions.objectAccess.isSuccess &&
          !actions.objectAccess.data.actions.includes("delete") &&
          !canRemove ? (
            <p className="muted">
              No deletion actions are available with your current access.
            </p>
          ) : null}
        </>
      )}
    </RecoveryDialog>
  );
}
