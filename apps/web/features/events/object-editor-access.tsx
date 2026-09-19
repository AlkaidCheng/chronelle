"use client";

import { type ReactNode, useEffect, useState } from "react";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import type { UseQueryResult } from "@tanstack/react-query";
import type { ObjectAccessResponse } from "@chronelle/schemas";
import { useEditorDraftStore } from "../../lib/editor-draft-context";
import { isTemporaryReadError } from "../../lib/query-errors";
import { useSessionDialog } from "../../lib/use-session-dialog";

export function ObjectEditorAccess<Resource>({
  id,
  kind,
  resource,
  access,
  onClose,
  children,
}: {
  readonly id: string;
  readonly kind: "task" | "expense" | "reminder" | "person" | "note";
  readonly resource: UseQueryResult<Resource>;
  readonly access: UseQueryResult<ObjectAccessResponse>;
  readonly onClose: () => void;
  readonly children: (
    resource: Resource,
    refresh: () => Promise<void>,
  ) => ReactNode;
}) {
  const drafts = useEditorDraftStore();
  const [approved, setApproved] = useState(false);
  const queries = [resource, access];
  const failure = queries.find((query) => query.isError);
  const denied =
    (access.data !== undefined && !access.data.actions.includes("edit")) ||
    queries.some(
      (query) => query.isError && !isTemporaryReadError(query.error),
    );
  const verified =
    !denied &&
    !failure &&
    resource.isFetchedAfterMount &&
    access.isFetchedAfterMount;
  if (verified && !approved) setApproved(true);
  useEffect(() => {
    if (denied) drafts.forget(id);
  }, [denied, drafts, id]);

  async function refresh() {
    await Promise.all(
      queries.map((query) => query.refetch({ throwOnError: true })),
    );
  }

  if (!denied && (approved || verified) && resource.data && access.data)
    return children(resource.data, refresh);

  return (
    <ObjectEditorStatus kind={kind} onClose={onClose}>
      {denied ? (
        <p role="alert">This {kind} is no longer available to edit.</p>
      ) : failure ? (
        <ErrorNotice
          error={failure.error}
          isRefreshing={queries.some((query) => query.isFetching)}
          onRefresh={() => {
            for (const query of queries) void query.refetch();
          }}
        />
      ) : (
        <LoadingState label={`Checking ${kind} access`} />
      )}
    </ObjectEditorStatus>
  );
}

function ObjectEditorStatus({
  kind,
  children,
  onClose,
}: {
  readonly kind: "task" | "expense" | "reminder" | "person" | "note";
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  const dialog = useSessionDialog(onClose);
  return (
    <dialog
      ref={dialog}
      className="event-create-dialog"
      aria-label={`Edit ${kind}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="event-create-header">
        <h2>Edit {kind}</h2>
        <button
          className="dialog-close"
          type="button"
          aria-label={`Close ${kind} editor`}
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body">{children}</div>
    </dialog>
  );
}
