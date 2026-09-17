"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { IconButton } from "../../components/icon-button";
import { PlusIcon, RefreshIcon, SearchIcon } from "../../components/icons";
import { useQuickAddSlots } from "../../components/quick-add-row";
import {
  activePersonFilterCount,
  defaultPersonFilters,
  filterPersons,
  isPersonLayout,
  type PersonFilters,
  type PersonLayout,
  type PersonSort,
  sortPersons,
} from "../../lib/person-collection";
import {
  useLabelsQuery,
  usePersonsQuery,
  useSessionQuery,
} from "../../lib/queries";
import { usePersonConnections } from "../../lib/use-person-connections";
import {
  PersonFilterControl,
  PersonLayoutControl,
  PersonSortControl,
} from "./person-controls";
import { PersonForm } from "./person-form";
import { PersonInspector } from "./person-inspector";
import { QuickAddPerson } from "./quick-add-person";
import { PersonListing } from "./person-row";

const layoutStorageKey = "chronelle.people-layout";

/**
 * Everyone the workspace keeps track of, as rows or as namecards, in name
 * order unless another is chosen, narrowed by account and label. The
 * layout is a device preference like the Event collection's; the filter,
 * sort, and name query live with the tab.
 */
export function PeoplePage() {
  const t = useTranslations("people");
  const controls = useTranslations("controls");
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [filters, setFilters] = useState<PersonFilters>(defaultPersonFilters);
  const [sort, setSort] = useState<PersonSort>("name");
  const [layout, setLayout] = useState<PersonLayout>("list");
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    if (isComposing) return;
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query, isComposing]);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(layoutStorageKey);
      if (isPersonLayout(stored)) setLayout(stored);
    } catch {
      // The list stays usable when browser storage is unavailable.
    }
  }, []);
  const people = usePersonsQuery(true, { query: debouncedQuery });
  const labels = useLabelsQuery();
  const session = useSessionQuery();
  const quickAdd = useQuickAddSlots();
  const me = session.data?.user.id;
  const changingQuery = isComposing || query.trim() !== debouncedQuery;
  const loaded = changingQuery ? [] : (people.data?.items ?? []);
  const connections = usePersonConnections();
  const items = useMemo(
    () => sortPersons(filterPersons(loaded, filters, connections), sort),
    [loaded, filters, sort, connections],
  );
  const filtered =
    debouncedQuery !== "" || activePersonFilterCount(filters) > 0;

  function changeLayout(next: PersonLayout) {
    setLayout(next);
    try {
      window.localStorage.setItem(layoutStorageKey, next);
    } catch {
      // A preference that cannot be stored still applies to this page.
    }
  }

  const context = {
    canEdit: true,
    connections,
    labelNames: labels.data?.names,
    me,
    onEdit: setEditingId,
  };

  return (
    <main className="workspace-page" tabIndex={-1}>
      <header className="quiet-heading">
        <h1>{t("title")}</h1>
        <div className="quiet-tools">
          <label className="inline-search">
            <SearchIcon />
            <span className="visually-hidden">{t("filterByName")}</span>
            <input
              maxLength={240}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionEnd={(event) => {
                setQuery(event.currentTarget.value);
                setIsComposing(false);
              }}
              onCompositionStart={() => setIsComposing(true)}
              placeholder={t("find")}
              type="search"
              value={query}
            />
          </label>
          <PersonFilterControl
            filters={filters}
            labels={labels.data?.items ?? []}
            onChange={setFilters}
          />
          <PersonSortControl onChange={setSort} sort={sort} />
          <PersonLayoutControl layout={layout} onChange={changeLayout} />
          <IconButton
            disabled={people.isFetching || changingQuery}
            label={t("refresh")}
            onClick={() => void people.refetch()}
          >
            <RefreshIcon />
          </IconButton>
          <IconButton
            aria-haspopup="dialog"
            label={t("new")}
            onClick={(event) => {
              event.currentTarget.focus();
              setIsAdding(true);
            }}
            tone="primary"
          >
            <PlusIcon />
          </IconButton>
        </div>
      </header>

      {isAdding ? (
        <PersonForm key="new" onCancel={() => setIsAdding(false)} />
      ) : null}

      <section aria-labelledby="people-heading" className="event-list-section">
        <p
          aria-label={t("countLabel")}
          className="visually-hidden"
          role="status"
        >
          {people.data && !changingQuery
            ? t("count", { count: items.length })
            : ""}
        </p>
        <div className="visually-hidden">
          <h2 id="people-heading">{t("all")}</h2>
        </div>
        {people.isPending || changingQuery ? (
          <LoadingState label={t("loading")} />
        ) : null}
        {people.isError ? (
          <ErrorNotice
            error={people.error}
            isRefreshing={people.isFetching}
            onRefresh={() => void people.refetch()}
          />
        ) : null}
        {!changingQuery && people.data && items.length === 0 ? (
          <div className="collection-empty">
            <EmptyState title={filtered ? t("noMatch") : t("empty")} />
            {filtered ? (
              <button
                className="button button-secondary"
                onClick={() => {
                  setQuery("");
                  setFilters(defaultPersonFilters);
                }}
                type="button"
              >
                {controls("clearFilters")}
              </button>
            ) : null}
            <div className="quick-add-item quick-add-empty">
              <QuickAddPerson slots={quickAdd} />
            </div>
          </div>
        ) : null}
        {items.length > 0 ? (
          <PersonListing
            context={context}
            items={items}
            label={t("listLabel")}
            layout={layout}
            quickAdd={quickAdd}
          />
        ) : null}
      </section>
      {editingId ? (
        <PersonInspector
          key={editingId}
          personId={editingId}
          onClose={() => setEditingId(null)}
        />
      ) : null}
    </main>
  );
}
