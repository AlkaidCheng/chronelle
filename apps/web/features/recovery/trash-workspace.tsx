"use client";

import type { RecoveryPreview, TrashQueryInput } from "@chronelle/schemas";
import Link from "next/link";
import { useState } from "react";
import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { formatDateTime, shortId } from "../../lib/format";
import {
  useRecoverObject,
  useRecoveryPreview,
  useTrash,
} from "../../lib/recovery-queries";
import { useRevokeShare, useSharesQuery } from "../../lib/queries";
import { RecoveryDialog } from "./recovery-dialog";

export function TrashWorkspace() {
  const [filter, setFilter] = useState<TrashQueryInput["objectType"]>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const trash = useTrash({
    limit: 20,
    ...(filter === undefined ? {} : { objectType: filter }),
  });
  const items = [
    ...new Map(
      trash.data?.pages
        .flatMap((page) => page.items)
        .map((item) => [item.id, item]) ?? [],
    ).values(),
  ];
  return (
    <main className="workspace-page">
      <header className="page-heading">
        <p className="eyebrow">Workspace recovery</p>
        <h1>Trash</h1>
        <p>
          Deleted objects you currently own, including those inherited from a
          shared Owner scope. Nothing here is permanently erased.
        </p>
      </header>
      <div className="panel-heading">
        <label className="field trash-filter">
          <span>Object type</span>
          <select
            value={filter ?? ""}
            onChange={(event) => {
              setSelectedId(null);
              setFilter(
                event.target.value === ""
                  ? undefined
                  : (event.target.value as TrashQueryInput["objectType"]),
              );
            }}
          >
            <option value="">All types</option>
            <option value="event">Events</option>
            <option value="task">To-dos</option>
            <option value="expense">Expenses</option>
            <option value="reminder">Reminders</option>
            <option value="document">Documents</option>
          </select>
        </label>
        <button
          className="button button-secondary"
          type="button"
          disabled={trash.isFetching}
          onClick={() => {
            setSelectedId(null);
            void trash.refetch();
          }}
        >
          Refresh Trash
        </button>
      </div>
      {trash.isPending ? <LoadingState label="Loading Trash" /> : null}
      {trash.isError ? (
        <ErrorNotice
          error={trash.error}
          onRefresh={() => void trash.refetch()}
        />
      ) : null}
      {trash.isSuccess && items.length === 0 ? (
        <div className="collection-empty">
          <EmptyState
            title={
              filter === undefined
                ? "No recoverable objects"
                : "No recoverable objects of this type"
            }
            description={
              filter === undefined
                ? "Objects appear here only when your current access allows recovery. Removed context links are listed separately inside each Event."
                : "Try all types. Only objects you can currently recover are shown."
            }
          />
          {filter !== undefined ? (
            <button
              className="button button-secondary"
              type="button"
              onClick={() => {
                setSelectedId(null);
                setFilter(undefined);
              }}
            >
              Clear type filter
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="resource-list recovery-list trash-list">
        {items.map((item) => (
          <article key={item.id}>
            <div>
              <span className="object-label">
                {item.objectType} · v{item.version}
              </span>
              <h2>{item.displayName}</h2>
              <p className="muted">
                Deleted {formatDateTime(item.deletedAt)} · ID {shortId(item.id)}
              </p>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setSelectedId(item.id)}
              aria-label={`Preview recovery for ${item.displayName}`}
            >
              Preview recovery
            </button>
          </article>
        ))}
      </div>
      {trash.hasNextPage ? (
        <button
          className="button button-secondary"
          type="button"
          disabled={trash.isFetching}
          onClick={() => void trash.fetchNextPage()}
        >
          {trash.isFetchingNextPage
            ? "Loading deleted objects..."
            : "Load more deleted objects"}
        </button>
      ) : null}
      {selectedId === null ? null : (
        <ObjectRecoveryPreview
          key={selectedId}
          objectId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </main>
  );
}

function ObjectRecoveryPreview({
  objectId,
  onClose,
}: {
  readonly objectId: string;
  readonly onClose: () => void;
}) {
  const preview = useRecoveryPreview(objectId);
  const recover = useRecoverObject(objectId);
  const [proposal, setProposal] = useState<RecoveryPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const shown = proposal ?? preview.data;
  const hasError = preview.isError || recover.isError;
  return (
    <RecoveryDialog title="Recovery preview" onClose={onClose}>
      {savedVersion !== null ? (
        <>
          <p role="status" className="notice">
            Recovered as version {savedVersion}. Normal views have been
            refreshed.
          </p>
          {shown?.object.objectType === "event" ? (
            <Link
              className="button button-primary"
              href={`/events/${objectId}`}
            >
              Open recovered event
            </Link>
          ) : null}
        </>
      ) : (
        <>
          {preview.isPending ? (
            <LoadingState label="Loading recovery preview" />
          ) : null}
          {hasError ? (
            <ErrorNotice
              error={recover.error ?? preview.error}
              onRefresh={() => {
                recover.reset();
                setConfirmed(false);
                setProposal(null);
                void preview.refetch();
              }}
            />
          ) : null}
          {shown === undefined ? null : (
            <>
              <h3>{shown.object.displayName}</h3>
              <p className="muted">
                Preview based on deleted version {shown.object.version}.
              </p>
              <p>
                Recovery keeps this object's ID, current content, files,
                permissions, and history. It creates a new version, without
                replaying an earlier snapshot.
              </p>
              <p>
                Existing links appear again only when both objects are available
                and authorized. Independently removed links stay removed.
                Related objects are not recovered automatically.
              </p>
              {shown.blockedReason === null ? null : (
                <p className="notice">{shown.blockedReason}</p>
              )}
              {shown.canRecover ? (
                <>
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={
                        hasError || preview.isFetching || recover.isPending
                      }
                      onChange={(event) => {
                        setProposal(shown);
                        setConfirmed(event.target.checked);
                      }}
                    />
                    I reviewed this recovery.
                  </label>
                  <button
                    className="button button-primary"
                    type="button"
                    disabled={
                      !confirmed ||
                      hasError ||
                      preview.isFetching ||
                      recover.isPending
                    }
                    onClick={() =>
                      recover.mutate(
                        { expectedVersion: shown.object.version },
                        {
                          onSuccess: (saved) => setSavedVersion(saved.version),
                        },
                      )
                    }
                  >
                    {recover.isPending ? "Recovering..." : "Confirm recovery"}
                  </button>
                </>
              ) : null}
              <TrashGrants objectId={objectId} />
            </>
          )}
        </>
      )}
    </RecoveryDialog>
  );
}

function TrashGrants({ objectId }: { readonly objectId: string }) {
  const shares = useSharesQuery(objectId, true);
  const revoke = useRevokeShare();
  return (
    <section className="sharing-section">
      <h3>Direct grants</h3>
      <p className="muted">
        Recovery does not re-create revoked grants. Inherited access must be
        managed on its canonical scope.
      </p>
      {shares.isPending ? <LoadingState label="Loading direct grants" /> : null}
      {shares.isError ? (
        <ErrorNotice
          error={shares.error}
          onRefresh={() => void shares.refetch()}
        />
      ) : null}
      {shares.data?.items.length === 0 ? <p>No direct grants.</p> : null}
      <ul className="trash-grants">
        {shares.data?.items.map((grant) => (
          <li key={grant.id}>
            <span>
              {grant.principal.email} · {grant.role}
            </span>
            <button
              className="button button-quiet button-small"
              type="button"
              disabled={revoke.isPending}
              onClick={() => revoke.mutate(grant.id)}
            >
              Revoke
            </button>
          </li>
        ))}
      </ul>
      {revoke.isError ? <ErrorNotice error={revoke.error} /> : null}
    </section>
  );
}
