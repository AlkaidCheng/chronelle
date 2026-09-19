"use client";

import type { RecoveryPreview, TrashQueryInput } from "@chronelle/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { ConfirmAction } from "../../components/confirm-action";
import {
  EmptyState,
  ErrorNotice,
  LoadingState,
  Notice,
} from "../../components/feedback";
import { useNotices } from "../../components/notices";
import { formatDateTime, shortId } from "../../lib/format";
import { useRevokeShare, useSharesQuery } from "../../lib/queries";
import {
  useRecoverObject,
  useRecoveryPreview,
  useTrash,
} from "../../lib/recovery-queries";
import { RecoveryDialog } from "./recovery-dialog";

export function TrashWorkspace() {
  const t = useTranslations("trash");
  const types = useTranslations("objectTypes");
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
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p>{t("intro")}</p>
      </header>
      <div className="panel-heading">
        <label className="field trash-filter">
          <span>{t("objectType")}</span>
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
            <option value="">{t("allTypes")}</option>
            <option value="event">{types("events")}</option>
            <option value="task">{types("tasks")}</option>
            <option value="expense">{types("expenses")}</option>
            <option value="reminder">{types("reminders")}</option>
            <option value="document">{types("documents")}</option>
            <option value="person">{types("people")}</option>
            <option value="note">{types("notes")}</option>
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
          {t("refresh")}
        </button>
      </div>
      {trash.isPending ? <LoadingState label={t("loading")} /> : null}
      {trash.isError ? (
        <ErrorNotice
          error={trash.error}
          onRefresh={() => void trash.refetch()}
        />
      ) : null}
      {trash.isSuccess && items.length === 0 ? (
        <div className="collection-empty">
          <EmptyState
            title={filter === undefined ? t("emptyTitle") : t("emptyTypeTitle")}
            description={
              filter === undefined
                ? t("emptyDescription")
                : t("emptyTypeDescription")
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
              {t("clearType")}
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="resource-list recovery-list trash-list">
        {items.map((item) => (
          <article key={item.id}>
            <div>
              <span className="object-label">
                {t("objectLabel", {
                  type: types(item.objectType),
                  version: item.version,
                })}
              </span>
              <h2>{item.displayName}</h2>
              <p className="muted">
                {t("deletedAt", {
                  when: formatDateTime(item.deletedAt),
                  id: shortId(item.id),
                })}
              </p>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setSelectedId(item.id)}
              aria-label={t("previewFor", { name: item.displayName })}
            >
              {t("previewRecovery")}
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
          {trash.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
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
  const t = useTranslations("trash");
  const preview = useRecoveryPreview(objectId);
  const recover = useRecoverObject(objectId);
  const [proposal, setProposal] = useState<RecoveryPreview | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const shown = proposal ?? preview.data;
  const hasError = preview.isError || recover.isError;
  return (
    <RecoveryDialog title={t("recoveryPreview")} onClose={onClose}>
      {savedVersion !== null ? (
        <>
          <Notice tone="success">
            {t("recovered", { version: savedVersion })}
          </Notice>
          {shown?.object.objectType === "event" ? (
            <Link
              className="button button-primary"
              href={`/events/${objectId}`}
            >
              {t("openRecovered")}
            </Link>
          ) : null}
        </>
      ) : (
        <>
          {preview.isPending ? (
            <LoadingState label={t("loadingPreview")} />
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
                {t("previewBasedOn", { version: shown.object.version })}
              </p>
              <p>{t("keepsNote")}</p>
              <p>{t("linksNote")}</p>
              {shown.blockedReason === null ? null : (
                <Notice tone="warning">{shown.blockedReason}</Notice>
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
                    {t("reviewed")}
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
                    {recover.isPending ? t("recovering") : t("confirm")}
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
  const t = useTranslations("trash");
  const verbs = useTranslations("verbs");
  const confirm = useTranslations("confirm");
  const done = useTranslations("done");
  const { post } = useNotices();
  const shares = useSharesQuery(objectId, true);
  const revoke = useRevokeShare();
  return (
    <section className="sharing-section">
      <h3>{t("directGrants")}</h3>
      <p className="muted">{t("grantsNote")}</p>
      {shares.isPending ? <LoadingState label={t("loadingGrants")} /> : null}
      {shares.isError ? (
        <ErrorNotice
          error={shares.error}
          onRefresh={() => void shares.refetch()}
        />
      ) : null}
      {shares.data?.items.length === 0 ? <p>{t("noGrants")}</p> : null}
      <ul className="trash-grants">
        {shares.data?.items.map((grant) => (
          <li key={grant.id}>
            <span>
              {grant.principal.email} · {grant.role}
            </span>
            <ConfirmAction
              disabled={revoke.isPending}
              label={verbs("removeShare")}
              onConfirm={() =>
                revoke.mutate(grant.id, {
                  onSuccess: () => post({ message: done("shareRemoved") }),
                })
              }
              pending={revoke.isPending}
              question={confirm("removeShare", {
                name: grant.principal.displayName,
                resource: t("thisRecord"),
              })}
            />
          </li>
        ))}
      </ul>
      {revoke.isError ? <ErrorNotice error={revoke.error} /> : null}
    </section>
  );
}
