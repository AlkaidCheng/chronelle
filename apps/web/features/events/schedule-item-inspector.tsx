"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect } from "react";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import { useEditorDraftStore } from "../../lib/editor-draft-context";
import { useEventWorkspaceQueries } from "../../lib/queries";
import { isTemporaryReadError } from "../../lib/query-errors";
import { useSessionDialog } from "../../lib/use-session-dialog";
import { EventInspector } from "./event-inspector";

export function ScheduleItemInspector({
  eventId,
  onClose,
}: {
  readonly eventId: string;
  readonly onClose: () => void;
}) {
  const t = useTranslations("scheduleItemEditor");
  const { event, access } = useEventWorkspaceQueries(eventId, null, "always");
  const drafts = useEditorDraftStore();
  const queries = [event, access];
  const failure = queries.find((query) => query.isError);
  const denied =
    (access.data !== undefined && !access.data.actions.includes("edit")) ||
    queries.some(
      (query) => query.isError && !isTemporaryReadError(query.error),
    );
  useEffect(() => {
    if (denied) drafts.forget(eventId);
  }, [denied, drafts, eventId]);

  if (
    !denied &&
    failure === undefined &&
    event.isFetchedAfterMount &&
    access.isFetchedAfterMount &&
    event.data &&
    access.data
  )
    return (
      <EventInspector
        key={eventId}
        event={event.data}
        onClose={onClose}
        title={t("title")}
      />
    );

  return (
    <ScheduleItemStatus onClose={onClose}>
      {denied ? (
        <p role="alert">{t("unavailable")}</p>
      ) : failure ? (
        <ErrorNotice
          error={failure.error}
          isRefreshing={queries.some((query) => query.isFetching)}
          onRefresh={() => {
            for (const query of queries) void query.refetch();
          }}
        />
      ) : (
        <LoadingState label={t("checking")} />
      )}
    </ScheduleItemStatus>
  );
}

function ScheduleItemStatus({
  children,
  onClose,
}: {
  readonly children: ReactNode;
  readonly onClose: () => void;
}) {
  const t = useTranslations("scheduleItemEditor");
  const dialog = useSessionDialog(onClose);
  return (
    <dialog
      ref={dialog}
      className="event-create-dialog"
      aria-label={t("title")}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header className="event-create-header">
        <h2>{t("title")}</h2>
        <button
          className="dialog-close"
          type="button"
          aria-label={t("close")}
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body">{children}</div>
    </dialog>
  );
}
