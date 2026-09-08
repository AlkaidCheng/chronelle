"use client";

import { useEffect, useRef, useState } from "react";
import type { EventLayoutResponse, EventPage } from "@chronelle/schemas";
import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { eventComponents } from "../../lib/event-components";
import {
  useEventLayout,
  useEventLayoutHistory,
  useLayoutUndo,
  useRestoreEventLayout,
  useUpdateEventLayout,
} from "../../lib/event-layout-queries";
import { useSessionDialog } from "../../lib/use-session-dialog";
import type { LayoutUndoState } from "../../lib/layout-undo";

type Confirmation = { expectedVersion: number } & (
  | { kind: "remove"; title: string; pages: EventPage[] }
  | { kind: "restore"; snapshot: EventLayoutResponse }
);

function LayoutRecoveryDialog({
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
    setNotice("Layout saved. Planning records are unchanged.");
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
    >
      <header className="event-create-header">
        <h2 id="layout-recovery-heading">
          {canEdit ? "Manage event pages" : "Layout history"}
        </h2>
        <button
          type="button"
          className="dialog-close"
          aria-label="Close layout options"
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
        <p>Removing pages or components keeps their planning records.</p>
        {confirmation ? (
          <section aria-label="Confirm layout change">
            <h3 ref={confirmationHeading} tabIndex={-1}>
              {confirmation.kind === "remove"
                ? `Remove ${confirmation.title}?`
                : `Restore ${confirmation.snapshot.version === 0 ? "the initial empty layout" : `layout version ${confirmation.snapshot.version}`}?`}
            </h3>
            <p>
              {confirmation.kind === "remove"
                ? "You can recover this layout from history. No planning records will be deleted."
                : "This replaces the current page arrangement and creates a new saved version. Planning records and access permissions do not change."}
            </p>
            {confirmation.kind === "restore" ? (
              <ul className="layout-preview">
                {confirmation.snapshot.pages.map((page) => (
                  <li key={page.id}>
                    <strong>{page.name}</strong>:{" "}
                    {page.components
                      .map((component) => eventComponents[component.kind].label)
                      .join(", ") || "Empty page"}
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
                    Pages
                  </button>
                  <button
                    type="button"
                    className="button button-secondary"
                    aria-pressed={tab === "history"}
                    onClick={() => setTab("history")}
                    disabled={busy}
                  >
                    Layout history
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    aria-label="Undo layout change"
                    disabled={busy || !canUndo}
                    onClick={() => rewind("undo")}
                  >
                    Undo
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    aria-label="Redo layout change"
                    disabled={busy || !canRedo}
                    onClick={() => rewind("redo")}
                  >
                    Redo
                  </button>
                </>
              ) : null}
            </div>
            {canEdit ? (
              <p className="composition-hint">
                Undo/redo resets on reload. Saved history is retained.
              </p>
            ) : null}
            {tab === "pages" ? (
              <div className="layout-revision-list">
                {source.pages.length === 0 ? (
                  <EmptyState
                    title="No pages in this layout"
                    description="Open Layout history to recover a saved arrangement."
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
                            `page ${page.name}`,
                            source.pages.filter(
                              (candidate) => candidate.id !== page.id,
                            ),
                          )
                        }
                      >
                        Remove page
                      </button>
                    </div>
                    {page.components.map((component, index) => (
                      <div key={component.id} className="layout-component-row">
                        <span>
                          {eventComponents[component.kind].label}{" "}
                          <span className="muted">({index + 1})</span>
                        </span>
                        <button
                          type="button"
                          className="button button-quiet"
                          aria-label={`Remove ${eventComponents[component.kind].label} from ${page.name}`}
                          disabled={busy}
                          onClick={() =>
                            remove(
                              eventComponents[component.kind].label,
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
                          Remove component
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
                  <LoadingState label="Loading layout history" />
                ) : (
                  <>
                    {history.data.pages
                      .flatMap((page) => page.items)
                      .map((revision) => (
                        <section
                          key={revision.version}
                          className="layout-revision"
                        >
                          <h3>
                            Version {revision.version}
                            {revision.version === source.version
                              ? " (current)"
                              : ""}
                          </h3>
                          <p>
                            {revision.updatedAt
                              ? new Date(revision.updatedAt).toLocaleString()
                              : "Initial layout"}
                            , {revision.pages.length} pages,{" "}
                            {revision.pages.reduce(
                              (count, page) => count + page.components.length,
                              0,
                            )}{" "}
                            components
                          </p>
                          <button
                            type="button"
                            className="button button-secondary"
                            disabled={busy}
                            onClick={() => preview(revision)}
                          >
                            Preview version {revision.version}
                          </button>
                        </section>
                      ))}
                    {history.hasNextPage ? (
                      <button
                        type="button"
                        className="button button-secondary"
                        disabled={busy || history.isFetchingNextPage}
                        onClick={() => void history.fetchNextPage()}
                      >
                        Load older layouts
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
                      Preview initial layout
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
        <p role="status">{busy ? "Saving layout..." : notice}</p>
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
            Back
          </button>
        ) : (
          <button
            type="button"
            className="button button-quiet"
            disabled={busy}
            onClick={onClose}
          >
            Close
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
              ? "Saving..."
              : confirmation.kind === "remove"
                ? "Remove from layout"
                : "Restore layout"}
          </button>
        ) : null}
      </footer>
    </dialog>
  );
}

export function LayoutRecoveryTools({
  layout,
  canEdit,
  disabled,
}: {
  readonly layout: EventLayoutResponse;
  readonly canEdit: boolean;
  readonly disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const undo = useLayoutUndo(layout.eventId);
  return (
    <>
      <button
        type="button"
        className="button button-quiet"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        {canEdit ? "Page options" : "Layout history"}
      </button>
      {open ? (
        <LayoutRecoveryDialog
          layout={layout}
          canEdit={canEdit}
          undo={undo.data}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}
