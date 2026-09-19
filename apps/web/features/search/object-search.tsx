"use client";

import type {
  ObjectSearchQueryInput,
  ObjectSearchResult,
} from "@chronelle/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { type FormEvent, useState } from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { SearchIcon } from "../../components/icons";
import { formatDateTime, shortId } from "../../lib/format";
import { useObjectSearch } from "../../lib/queries";
import { getSearchResultHref } from "../../lib/search-result";

const searchableTypes = [
  "event",
  "task",
  "expense",
  "reminder",
  "document",
  "person",
  "note",
] as const;

function SearchResultCard({ result }: { readonly result: ObjectSearchResult }) {
  const t = useTranslations("search");
  const types = useTranslations("objectTypes");
  const href = getSearchResultHref(result);
  const content = (
    <>
      <span className="search-result-icon">
        <SearchIcon />
      </span>
      <span className="search-result-copy">
        <span className="object-label">{types(result.objectType)}</span>
        <strong>{result.displayName}</strong>
        <span>
          {t("updatedAt", {
            when: formatDateTime(result.updatedAt),
            id: shortId(result.id),
          })}
        </span>
      </span>
      {href === null ? (
        <span className="search-result-state">{t("canonicalRecord")}</span>
      ) : (
        <span aria-hidden="true" className="card-arrow">
          -&gt;
        </span>
      )}
    </>
  );

  return href === null ? (
    <article className="search-result">{content}</article>
  ) : (
    <Link className="search-result" href={href}>
      {content}
    </Link>
  );
}

export function ObjectSearch() {
  const t = useTranslations("search");
  const types = useTranslations("objectTypes");
  const [query, setQuery] = useState("");
  const [objectType, setObjectType] = useState<
    ObjectSearchResult["objectType"] | ""
  >("");
  const [submittedInput, setSubmittedInput] =
    useState<ObjectSearchQueryInput | null>(null);
  const search = useObjectSearch(submittedInput);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmittedInput(objectType === "" ? { query } : { objectType, query });
  }

  return (
    <main className="workspace-page search-page">
      <header className="page-heading split-heading">
        <div>
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1>{t("title")}</h1>
          <p>{t("intro")}</p>
        </div>
        <SearchIcon className="heading-icon" />
      </header>

      <section
        aria-labelledby="search-heading"
        className="surface search-surface"
      >
        <div>
          <span className="object-label">{t("index")}</span>
          <h2 id="search-heading">{t("findObject")}</h2>
        </div>
        <search>
          <form className="search-form" onSubmit={handleSubmit}>
            <label className="compact-field grow-field" htmlFor="object-search">
              <span>{t("keywords")}</span>
              <input
                id="object-search"
                maxLength={120}
                minLength={2}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("placeholder")}
                required
                type="search"
                value={query}
              />
            </label>
            <label className="compact-field" htmlFor="object-search-type">
              <span>{t("type")}</span>
              <select
                id="object-search-type"
                onChange={(event) =>
                  setObjectType(
                    event.target.value as ObjectSearchResult["objectType"] | "",
                  )
                }
                value={objectType}
              >
                <option value="">{t("allObjects")}</option>
                {searchableTypes.map((option) => (
                  <option key={option} value={option}>
                    {types(option)}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-primary"
              disabled={search.isFetching}
              type="submit"
            >
              {search.isFetching ? t("searching") : t("search")}
            </button>
          </form>
        </search>
      </section>

      <section
        aria-labelledby="search-results-heading"
        className="search-results"
      >
        <div className="section-title-row">
          <h2 id="search-results-heading">{t("results")}</h2>
          <span aria-live="polite">
            {t("loaded", { count: search.data?.items.length ?? 0 })}
          </span>
        </div>
        {search.isPending && submittedInput !== null ? (
          <LoadingState label={t("searchingWorkspace")} />
        ) : null}
        {search.isError ? (
          <ErrorNotice
            error={search.error}
            onRefresh={() =>
              void (search.isFetchNextPageError
                ? search.fetchNextPage()
                : search.refetch())
            }
          />
        ) : null}
        {submittedInput === null ? (
          <EmptyState
            description={t("startDescription")}
            title={t("startTitle")}
          />
        ) : null}
        {search.data?.items.length === 0 ? (
          <EmptyState
            description={t("noneDescription")}
            title={t("noneTitle")}
          />
        ) : null}
        <div className="search-result-list">
          {search.data?.items.map((result) => (
            <SearchResultCard key={result.id} result={result} />
          ))}
        </div>
        {search.hasNextPage ? (
          <button
            className="button button-secondary"
            disabled={search.isFetching}
            onClick={() => void search.fetchNextPage()}
            type="button"
          >
            {search.isFetchingNextPage ? t("loadingMore") : t("loadMore")}
          </button>
        ) : null}
      </section>
    </main>
  );
}
