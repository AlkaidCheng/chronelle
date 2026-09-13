"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { useApiClient } from "../../lib/api-context";
import { useAuthSession } from "../../lib/auth-session";
import {
  useEditorDraftStore,
  useKeptEditorDraft,
} from "../../lib/editor-draft-context";
import type { RetainedDraftSnapshot } from "../../lib/editor-draft-store";
import { queryKeys } from "../../lib/queries";
import { isTemporaryReadError } from "../../lib/query-errors";
import { useSessionDialog } from "../../lib/use-session-dialog";

type DraftKind = RetainedDraftSnapshot["kind"];
const draftFields: Record<DraftKind, string> = {
  event: "event name and schedule",
  task: "task name and due time",
  expense: "expense name, amount, currency and transaction time",
  reminder: "reminder name and time",
};
type DraftOfKind<Kind extends DraftKind> = Extract<
  RetainedDraftSnapshot,
  { kind: Kind }
>;

function matchesKind<Kind extends DraftKind>(
  snapshot: RetainedDraftSnapshot,
  kind: Kind,
): snapshot is DraftOfKind<Kind> {
  return snapshot.kind === kind;
}

export function EditorDraftRecovery<Kind extends DraftKind>({
  kind,
  id,
  accessId = id,
  onClose,
  children,
}: {
  readonly kind: Kind;
  readonly id: string;
  readonly accessId?: string;
  readonly onClose: () => void;
  readonly children: (snapshot: DraftOfKind<Kind> | undefined) => ReactNode;
}) {
  const store = useEditorDraftStore();
  const [offering, setOffering] = useState(() => store.get(id) !== undefined);
  const [snapshot, setSnapshot] = useState<DraftOfKind<Kind>>();
  return offering ? (
    <ResumeDraft
      kind={kind}
      id={id}
      accessId={accessId}
      onClose={onClose}
      onResume={(draft) => {
        if (!matchesKind(draft, kind))
          throw new Error("The draft does not belong to this editor.");
        setSnapshot(draft);
        setOffering(false);
      }}
    />
  ) : (
    children(snapshot)
  );
}

function ResumeDraft({
  kind,
  id,
  accessId,
  onClose,
  onResume,
}: {
  readonly kind: DraftKind;
  readonly id: string;
  readonly accessId: string;
  readonly onClose: () => void;
  readonly onResume: (snapshot: RetainedDraftSnapshot) => void;
}) {
  const store = useEditorDraftStore();
  const kept = useKeptEditorDraft(id);
  const client = useApiClient();
  const queries = useQueryClient();
  const { signal } = useAuthSession();
  const dialog = useSessionDialog(onClose);
  const headingId = useId();
  const mounted = useRef(false);
  const checking = useRef(false);
  const [isChecking, setIsChecking] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const resumeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!kept?.pending) resumeButton.current?.focus();
  }, [kept?.pending]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    if (!kept) onClose();
  }, [kept, onClose]);

  async function resume() {
    if (!kept || kept.pending || checking.current) return;
    checking.current = true;
    setIsChecking(true);
    setError(null);
    try {
      if (accessId === "new") await client.getSession();
      else {
        const isObjectEdit =
          kind !== "event" && kept.snapshot.source !== undefined;
        const readResource = () => {
          if (!isObjectEdit) return client.getEvent(accessId);
          if (kind === "reminder") return client.getReminder(accessId);
          return kind === "expense"
            ? client.getExpense(accessId)
            : client.getTask(accessId);
        };
        const [resource, access] = await Promise.all([
          readResource(),
          client.getObjectAccess(accessId),
        ]);
        if (signal.aborted || !mounted.current) return;
        queries.setQueryData(
          isObjectEdit
            ? queryKeys.objectResource(accessId)
            : queryKeys.eventResource(accessId),
          resource,
        );
        queries.setQueryData(queryKeys.access(accessId), access);
        if (!access.actions.includes("edit")) {
          store.forget(id);
          return;
        }
      }
      if (!signal.aborted && mounted.current && store.get(id) === kept)
        onResume(kept.snapshot);
    } catch (failure) {
      if (!signal.aborted && mounted.current) {
        if (!isTemporaryReadError(failure)) {
          store.forget(id);
          void queries.invalidateQueries({
            queryKey: queryKeys.event(accessId),
          });
          void queries.invalidateQueries({
            queryKey: queryKeys.objectResource(accessId),
          });
        }
        setError(failure);
      }
    } finally {
      checking.current = false;
      if (mounted.current) setIsChecking(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog"
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="event-create-header">
        <h2 id={headingId}>
          {kept?.pending ? `Saving ${kind}` : "Resume your draft?"}
        </h2>
        <button
          className="dialog-close"
          type="button"
          aria-label="Close draft recovery"
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body">
        {kept?.pending ? (
          <LoadingState label="Your save is still in progress. You can close this panel." />
        ) : (
          <p>
            Your entered {draftFields[kind]} are kept in this tab. Current
            access is checked before resuming.
          </p>
        )}
        {kept?.failed && (
          <p role="status">
            {kept.snapshot.creationAttempt
              ? "The previous save could not be confirmed. Resume and retry unchanged fields to reuse the same save attempt."
              : "The previous save could not be confirmed. Check whether it was saved before trying again."}
          </p>
        )}
        {error !== null && <ErrorNotice error={error} />}
      </div>
      <footer className="event-create-footer">
        <button
          className="button button-quiet"
          type="button"
          disabled={kept?.pending || isChecking}
          onClick={() => {
            store.forget(id);
            onClose();
          }}
        >
          Discard draft
        </button>
        <button
          ref={resumeButton}
          className="button button-primary"
          type="button"
          disabled={!kept || kept.pending || isChecking}
          onClick={() => void resume()}
        >
          {isChecking ? "Checking access..." : "Resume draft"}
        </button>
      </footer>
    </dialog>
  );
}

export function EditorDraftStatus({
  isRetained,
  failed,
  failureMessage = "The last save failed. Check for a saved event before submitting again.",
}: {
  readonly isRetained: boolean;
  readonly failed: boolean;
  readonly failureMessage?: string;
}) {
  return (
    <p className="editor-help" role="status">
      {!isRetained
        ? "Draft recovery is full while other saves are pending. Keep this editor open."
        : failed
          ? failureMessage
          : "Drafts stay in this tab until reload or sign-out."}
    </p>
  );
}
