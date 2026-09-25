"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import {
  relationTypeSchema,
  type RemovedRelationListResponse,
} from "@livtales/schemas";
import {
  EmptyState,
  ErrorNotice,
  LoadingState,
  Notice,
} from "../../components/feedback";
import {
  useRecoverRelation,
  useRemovedRelations,
} from "../../lib/recovery-queries";
import { RecoveryDialog } from "./recovery-dialog";

type RemovedLink = RemovedRelationListResponse["items"][number];

export function RemovedLinksPanel({ objectId }: { readonly objectId: string }) {
  const [relationType, setRelationType] = useState("");
  const removed = useRemovedRelations(objectId, {
    relationType:
      relationType === "" ? undefined : relationTypeSchema.parse(relationType),
  });
  const [selected, setSelected] = useState<RemovedLink | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const t = useTranslations("removedLinks");
  const recover = useRecoverRelation();
  const items = [
    ...new Map(
      removed.data?.pages
        .flatMap((page) => page.items)
        .map((item) => [item.relation.id, item]) ?? [],
    ).values(),
  ];
  function close() {
    setSelected(null);
    setConfirmed(false);
    recover.reset();
  }
  return (
    <section className="planning-panel">
      <header className="panel-heading">
        <div>
          <h2>{t("title")}</h2>
          <p>{t("intro")}</p>
        </div>
      </header>
      <div className="panel-heading">
        <label className="field">
          <span>{t("linkType")}</span>
          <select
            value={relationType}
            onChange={(event) => {
              setRelationType(event.target.value);
              close();
            }}
          >
            <option value="">{t("allTypes")}</option>
            {relationTypeSchema.options.map((type) => (
              <option key={type} value={type}>
                {t(`types.${type}`)}
              </option>
            ))}
          </select>
        </label>
        <button
          className="button button-secondary"
          type="button"
          disabled={removed.isFetching}
          onClick={() => {
            close();
            void removed.refetch();
          }}
        >
          {t("refresh")}
        </button>
      </div>
      {removed.isPending ? <LoadingState label={t("loading")} /> : null}
      {removed.isError ? (
        <ErrorNotice
          error={removed.error}
          onRefresh={() => void removed.refetch()}
        />
      ) : null}
      {removed.isSuccess && items.length === 0 ? (
        <EmptyState
          title={t("emptyTitle")}
          description={t("emptyDescription")}
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
                {t("linkLabel", {
                  type: t(`types.${item.relation.relationType}`),
                  version: item.relation.version,
                })}
              </span>
            </div>
            <button
              className="button button-secondary"
              type="button"
              onClick={() => setSelected(item)}
            >
              {t("previewRecovery")}
            </button>
          </article>
        ))}
      </div>
      {removed.hasNextPage ? (
        <button
          className="button button-secondary"
          type="button"
          disabled={removed.isFetching}
          onClick={() => void removed.fetchNextPage()}
        >
          {removed.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
        </button>
      ) : null}
      {selected === null ? null : (
        <RecoveryDialog title={t("recoverTitle")} onClose={close}>
          {recover.isSuccess ? (
            <Notice tone="success">{t("recovered")}</Notice>
          ) : (
            <>
              <p>
                {selected.sourceDisplayName} → {selected.targetDisplayName}
              </p>
              <p>
                {t("recoveringVersion", { version: selected.relation.version })}
              </p>
              <label className="check-field">
                <input
                  type="checkbox"
                  checked={confirmed}
                  disabled={recover.isPending || recover.isError}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                {t("reviewed")}
              </label>
              <button
                className="button button-primary"
                type="button"
                disabled={!confirmed || recover.isPending || recover.isError}
                onClick={() => recover.mutate(selected.relation)}
              >
                {recover.isPending ? t("recovering") : t("confirm")}
              </button>
              {recover.isError ? (
                <>
                  <ErrorNotice error={recover.error} />
                  <p>{t("refreshNote")}</p>
                </>
              ) : null}
            </>
          )}
        </RecoveryDialog>
      )}
    </section>
  );
}
