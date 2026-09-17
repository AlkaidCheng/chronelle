"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import type { EventLayoutResponse, EventPage } from "@chronelle/schemas";
import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { componentKindLabel } from "../../lib/event-components";
import { formatDateTime } from "../../lib/format";
import { undoDirection } from "../../lib/keyboard";
import { describeLayoutChanges } from "../../lib/layout-changes";
import {
  useEventLayout,
  useEventLayoutHistory,
  useRestoreEventLayout,
  useUpdateEventLayout,
} from "../../lib/event-layout-queries";
import { useSessionDialog } from "../../lib/use-session-dialog";
import type { LayoutUndoState } from "../../lib/layout-undo";

type Confirmation = { expectedVersion: number } & (
  | { kind: "remove"; title: string; pages: EventPage[] }
  | { kind: "restore"; snapshot: EventLayoutResponse }
);

export function LayoutRecoveryDialog({
  layout,
  canEdit,
  undo,
  onClose,
}: {
  readonly layout: EventLayoutResponse;
  readonly canEdit: boolean;
  readonly undo: LayoutUndoState;
  readonly onClose: () => void;
}) {
  const [source, setSource] = useState(layout);
  const [tab, setTab] = useState(canEdit ? "pages" : "history");
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const t = useTranslations("layoutRecovery");
  const common = useTranslations("common");
  const [notice, setNotice] = useState("");
  const confirmationHeading = useRef<HTMLHeadingElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const wasConfirming = useRef(false);
  const dialog = useSessionDialog(onClose);
  const current = useEventLayout(layout.eventId);
  const history = useEventLayoutHistory(layout.eventId);
  const restore = useRestoreEventLayout(layout.eventId);
  const update = useUpdateEventLayout(layout.eventId);
  const busy = restore.isPending || update.isPending;
  const error = restore.error ?? update.error;
  const canUndo =
    canEdit && undo.version === source.version && undo.undo.length > 0;
  const canRedo =
    canEdit && undo.version === source.version && undo.redo.length > 0;

  useEffect(() => {
    if (confirmation) confirmationHeading.current?.focus();
    else if (wasConfirming.current) body.current?.focus();
    wasConfirming.current = confirmation !== null;
  }, [confirmation]);

  function saved(next: EventLayoutResponse) {
    setSource(next);
    setConfirmation(null);
    setNotice(t("saved"));
  }

  function rewind(intent: "undo" | "redo") {
    const targetVersion = undo[intent].at(-1);
    if (busy || !canEdit || targetVersion === undefined) return;
    update.reset();
    setNotice("");
    restore.mutate(
      { expectedVersion: source.version, targetVersion, intent },
      { onSuccess: saved },
    );
  }

  function preview(snapshot: EventLayoutResponse) {
    restore.reset();
    update.reset();
    setNotice("");
    setConfirmation({
      kind: "restore",
      snapshot,
      expectedVersion: source.version,
    });
  }

  function remove(title: string, pages: EventPage[]) {
    restore.reset();
    update.reset();
    setNotice("");
    setConfirmation({
      kind: "remove",
      title,
      pages,
      expectedVersion: source.version,
    });
  }

  function confirm() {
    if (!confirmation || busy || !canEdit) return;
    if (confirmation.kind === "remove")
      update.mutate(
        {
          expectedVersion: confirmation.expectedVersion,
          pages: confirmation.pages,
        },
        { onSuccess: saved },
      );
    else
      restore.mutate(
        {
          expectedVersion: confirmation.expectedVersion,
          targetVersion: confirmation.snapshot.version,
        },
        { onSuccess: saved },
      );
  }

  async function refresh() {
    const latest = await current.refetch();
    if (latest.isSuccess) {
      setSource(latest.data);
      setConfirmation(null);
      restore.reset();
      update.reset();
      await history.refetch();
    }
  }

  return (
    <dialog
      ref={dialog}
      className="event-create-dialog layout-recovery-dialog"
      aria-labelledby="layout-recovery-heading"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
      onKeyDown={(event) => {
        // The dialog owns the layout stack: its keys never reach the page.
        const direction = undoDirection(event.nativeEvent, event.currentTarget);
        if (direction === null) return;
        event.preventDefault();
        if (direction === "undo" ? canUndo : canRedo) rewind(direction);
      }}
    >
      <header className="event-create-header">
        <h2 id="layout-recovery-heading">
          {canEdit ? t("manageTitle") : t("historyTitle")}
        </h2>
        <button
          type="button"
          className="dialog-close"
          aria-label={t("close")}
          disabled={busy}
          onClick={onClose}
        >
          &#215;
        </button>
      </header>
      <div
        className="event-create-body"
        aria-busy={busy}
        ref={body}
        tabIndex={-1}
      >
        <p>{t("intro")}</p>
        {confirmation ? (
          <section aria-label={t("confirmLabel")}>
            <h3 ref={confirmationHeading} tabIndex={-1}>
              {confirmation.kind === "remove"
                ? t("removeQuestion", { title: confirmation.title })
                : t(canEdit ? "restoreQuestion" : "previewTitle", {
                    version: confirmation.snapshot.version,
                  })}
            </h3>
            <p>
              {confirmation.kind === "remove"
                ? t("removeNote")
                : canEdit
                  ? t("restoreNote")
                  : t("previewNote")}
            </p>
            {confirmation.kind === "restore" ? (
              <ul className="layout-preview">
                {confirmation.snapshot.pages.map((page) => (
                  <li key={page.id}>
                    <strong>{page.name}</strong>:{" "}
                    {page.components
                      .map((component) => componentKindLabel(component.kind))
                      .join(", ") || t("emptyPage")}
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : (
          <>
            <div className="composition-actions">
              {canEdit ? (
                <>
                  <button
                    type="button"
                    className="button button-secondary"
                    aria-pressed={tab === "pages"}
                    onClick={() => setTab("pages")}
                    disabled={busy}
                  >
                    {t("pages")}
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    aria-pressed={tab === "history"}
                    onClick={() => setTab("history")}
                    disabled={busy}
                  >
                    {t("historyTitle")}
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    aria-label={t("undoLabel")}
                    disabled={busy || !canUndo}
                    onClick={() => rewind("undo")}
                  >
                    {t("undo")}
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    aria-label={t("redoLabel")}
                    disabled={busy || !canRedo}
                    onClick={() => rewind("redo")}
                  >
                    {t("redo")}
                  </button>
                </>
              ) : null}
            </div>
            {canEdit ? (
              <p className="composition-hint">{t("undoNote")}</p>
            ) : null}
            {tab === "pages" ? (
              <div className="layout-revision-list">
                {source.pages.length === 0 ? (
                  <EmptyState
                    title={t("noPagesTitle")}
                    description={t("noPagesDescription")}
                  />
                ) : null}
                {source.pages.map((page) => (
                  <section key={page.id} className="layout-revision">
                    <div className="panel-heading">
                      <h3>{page.name}</h3>
                      <button
                        type="button"
                        className="button button-quiet"
                        disabled={busy}
                        onClick={() =>
                          remove(
                            t("pageTitle", { name: page.name }),
                            source.pages.filter(
                              (candidate) => candidate.id !== page.id,
                            ),
                          )
                        }
                      >
                        {t("removePage")}
                      </button>
                    </div>
                    {page.components.map((component, index) => (
                      <div key={component.id} className="layout-component-row">
                        <span>
                          {componentKindLabel(component.kind)}{" "}
                          <span className="muted">({index + 1})</span>
                        </span>
                        <button
                          type="button"
                          className="button button-quiet"
                          aria-label={t("removeFrom", {
                            component: componentKindLabel(component.kind),
                            page: page.name,
                          })}
                          disabled={busy}
                          onClick={() =>
                            remove(
                              componentKindLabel(component.kind),
                              source.pages.map((candidate) =>
                                candidate.id === page.id
                                  ? {
                                      ...candidate,
                                      components: candidate.components.filter(
                                        (item) => item.id !== component.id,
                                      ),
                                    }
                                  : candidate,
                              ),
                            )
                          }
                        >
                          {t("removeComponent")}
                        </button>
                      </div>
                    ))}
                  </section>
                ))}
              </div>
            ) : (
              <div className="layout-revision-list">
                {history.isError ? (
                  <ErrorNotice
                    error={history.error}
                    onRefresh={() => void history.refetch()}
                  />
                ) : history.isPending ? (
                  <LoadingState label={t("loadingHistory")} />
                ) : (
                  <>
                    {(() => {
                      const items = history.data.pages.flatMap(
                        (page) => page.items,
                      );
                      return items.map((revision, index) => {
                        // The version before this one is the next row, or
                        // the empty layout at the start; a row whose
                        // predecessor is on a page not yet loaded reads
                        // only its summary.
                        const earlier =
                          items[index + 1] ??
                          (revision.version === 1 ? { pages: [] } : undefined);
                        const changes =
                          earlier === undefined
                            ? undefined
                            : describeLayoutChanges(
                                earlier.pages,
                                revision.pages,
                              );
                        return (
                          <section
                            key={revision.version}
                            className="layout-revision"
                          >
                            <h3>
                              {revision.version === source.version
                                ? t("currentVersion", {
                                    version: revision.version,
                                  })
                                : t("version", { version: revision.version })}
                            </h3>
                            <p className="history-kind">{t("kind")}</p>
                            <p>
                              {t("revisionSummary", {
                                when: revision.updatedAt
                                  ? formatDateTime(revision.updatedAt)
                                  : t("initialLayout"),
                                pages: revision.pages.length,
                                components: revision.pages.reduce(
                                  (count, page) =>
                                    count + page.components.length,
                                  0,
                                ),
                              })}
                            </p>
                            {changes !== undefined &&
                            changes.sentences.length > 0 ? (
                              <ul className="history-change-lines">
                                {changes.sentences.map((sentence) => (
                                  <li key={sentence}>{sentence}</li>
                                ))}
                                {changes.more > 0 ? (
                                  <li className="muted">
                                    {t("moreChanges", { count: changes.more })}
                                  </li>
                                ) : null}
                              </ul>
                            ) : null}
                            <button
                              type="button"
                              className="button button-secondary"
                              disabled={busy}
                              onClick={() => preview(revision)}
                            >
                              {t("previewVersion", {
                                version: revision.version,
                              })}
                            </button>
                          </section>
                        );
                      });
                    })()}
                    {history.hasNextPage ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={busy || history.isFetchingNextPage}
                        onClick={() => void history.fetchNextPage()}
                      >
                        {t("loadOlder")}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="button button-quiet"
                      disabled={busy}
                      onClick={() =>
                        preview({
                          eventId: source.eventId,
                          version: 0,
                          updatedAt: null,
                          pages: [],
                        })
                      }
                    >
                      {t("previewInitial")}
                    </button>
                  </>
                )}
              </div>
            )}
          </>
        )}
        {error ? (
          <ErrorNotice error={error} onRefresh={() => void refresh()} />
        ) : null}
        <p role="status">{busy ? t("savingLayout") : notice}</p>
      </div>
      <footer className="event-create-footer">
        {confirmation ? (
          <button
            type="button"
            className="button button-quiet"
            disabled={busy}
            onClick={() => {
              setConfirmation(null);
              restore.reset();
              update.reset();
            }}
          >
            {t("back")}
          </button>
        ) : (
          <button
            type="button"
            className="button button-quiet"
            disabled={busy}
            onClick={onClose}
          >
            {common("close")}
          </button>
        )}
        {confirmation && canEdit ? (
          <button
            type="button"
            className="button button-primary"
            disabled={busy}
            onClick={confirm}
          >
            {busy
              ? t("saving")
              : confirmation.kind === "remove"
                ? t("removeFromLayout")
                : t("restoreLayout")}
          </button>
        ) : null}
      </footer>
    </dialog>
  );
}
