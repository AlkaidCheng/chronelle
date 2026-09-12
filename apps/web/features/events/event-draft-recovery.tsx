"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { useApiClient } from "../../lib/api-context";
import { useAuthSession } from "../../lib/auth-session";
import {
  useEventDraftStore,
  useKeptEventDraft,
} from "../../lib/event-draft-context";
import type { EventDraftSnapshot } from "../../lib/event-draft-store";
import { queryKeys } from "../../lib/queries";
import { isTemporaryReadError } from "../../lib/query-errors";
import { useSessionDialog } from "../../lib/use-session-dialog";

export function EventDraftRecovery({
  id,
  onClose,
  children,
}: {
  readonly id: string;
  readonly onClose: () => void;
  readonly children: (snapshot: EventDraftSnapshot | undefined) => ReactNode;
}) {
  const store = useEventDraftStore();
  const [offering, setOffering] = useState(() => store.get(id) !== undefined);
  const [snapshot, setSnapshot] = useState<EventDraftSnapshot>();
  return offering ? (
    <ResumeEventDraft
      id={id}
      onClose={onClose}
      onResume={(draft) => {
        setSnapshot(draft);
        setOffering(false);
      }}
    />
  ) : (
    children(snapshot)
  );
}

function ResumeEventDraft({
  id,
  onClose,
  onResume,
}: {
  readonly id: string;
  readonly onClose: () => void;
  readonly onResume: (snapshot: EventDraftSnapshot) => void;
}) {
  const store = useEventDraftStore();
  const kept = useKeptEventDraft(id);
  const client = useApiClient();
  const queries = useQueryClient();
  const { signal } = useAuthSession();
  const dialog = useSessionDialog(onClose);
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
      if (id === "new") await client.getSession();
      else {
        const [event, access] = await Promise.all([
          client.getEvent(id),
          client.getObjectAccess(id),
        ]);
        if (signal.aborted || !mounted.current) return;
        queries.setQueryData(queryKeys.eventResource(id), event);
        queries.setQueryData(queryKeys.access(id), access);
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
          void queries.invalidateQueries({ queryKey: queryKeys.event(id) });
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
      aria-labelledby="resume-event-heading"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="event-create-header">
        <h2 id="resume-event-heading">
          {kept?.pending ? "Saving event" : "Resume your draft?"}
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
            Your unsaved event name and schedule are kept in this tab. Current
            access is checked before resuming.
          </p>
        )}
        {kept?.failed && (
          <p role="status">
            The previous save did not complete. Check whether it was saved
            before trying again.
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

export function EventDraftStatus({
  isRetained,
  failed,
}: {
  readonly isRetained: boolean;
  readonly failed: boolean;
}) {
  return (
    <p className="editor-help" role="status">
      {!isRetained
        ? "Draft recovery is full while other saves are pending. Keep this editor open."
        : failed
          ? "The last save failed. Check for a saved event before submitting again."
          : "Drafts stay in this tab until reload or sign-out."}
    </p>
  );
}
