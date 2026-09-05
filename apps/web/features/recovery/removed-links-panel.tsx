"use client";

import { useState } from "react";
import type { RemovedRelationListResponse } from "@chronelle/schemas";
import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import {
  useRecoverRelation,
  useRemovedRelations,
} from "../../lib/recovery-queries";
import { RecoveryDialog } from "./recovery-dialog";

type RemovedLink = RemovedRelationListResponse["items"][number];

export function RemovedLinksPanel({ objectId }: { readonly objectId: string }) {
  const removed = useRemovedRelations(objectId);
  const [selected, setSelected] = useState<RemovedLink | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const recover = useRecoverRelation();
  const items = removed.data?.pages.flatMap((page) => page.items) ?? [];
  function close() {
    setSelected(null);
    setConfirmed(false);
    recover.reset();
  }
  return (
    <section className="planning-panel">
      <header className="panel-heading">
        <div>
          <h2>Removed links</h2>
          <p>
            Restore a context link without copying or changing either object.
            Only links with live, accessible endpoints and an editable source
            appear here.
          </p>
        </div>
      </header>
      {removed.isPending ? (
        <LoadingState label="Loading removed links" />
      ) : null}
      {removed.isError ? (
        <ErrorNotice
          error={removed.error}
          onRefresh={() => void removed.refetch()}
        />
      ) : null}
      {removed.isSuccess && items.length === 0 ? (
        <EmptyState
          title="No recoverable links"
          description="Recover deleted objects from Trash first. An equivalent active link cannot be recovered twice."
        />
      ) : null}
      <div className="resource-list recovery-list">
        {items.map((item) => (
          <article key={item.relation.id}>
            <div>
              <h3>
                {item.sourceDisplayName} → {item.targetDisplayName}
              </h3>
              <span className="object-label">
                {item.relation.relationType} · link v{item.relation.version}
              </span>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setSelected(item)}
            >
              Preview link recovery
            </button>
          </article>
        ))}
      </div>
      {removed.hasNextPage ? (
        <button
          className="button button-secondary"
          type="button"
          disabled={removed.isFetchingNextPage}
          onClick={() => void removed.fetchNextPage()}
        >
          Load more removed links
        </button>
      ) : null}
      {selected === null ? null : (
        <RecoveryDialog title="Recover context link" onClose={close}>
          {recover.isSuccess ? (
            <p role="status" className="notice">
              Link recovered. Neither canonical object was changed.
            </p>
          ) : (
            <>
              <p>
                {selected.sourceDisplayName} → {selected.targetDisplayName}
              </p>
              <p>
                Recovering link version {selected.relation.version}. Content and
                permissions stay unchanged.
              </p>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={recover.isPending || recover.isError}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                I reviewed this link.
              </label>
              <button
                className="button button-primary"
                type="button"
                disabled={!confirmed || recover.isPending || recover.isError}
                onClick={() => recover.mutate(selected.relation)}
              >
                {recover.isPending ? "Recovering..." : "Confirm link recovery"}
              </button>
              {recover.isError ? (
                <>
                  <ErrorNotice error={recover.error} />
                  <p>
                    Close this preview and refresh the Event before trying
                    again.
                  </p>
                </>
              ) : null}
            </>
          )}
        </RecoveryDialog>
      )}
    </section>
  );
}
