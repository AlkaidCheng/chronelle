"use client";

import type {
  ObjectSearchQueryInput,
  ObjectSearchResult,
} from "@chronelle/schemas";
import Link from "next/link";
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
  { label: "All objects", value: "" },
  { label: "Events", value: "event" },
  { label: "Tasks", value: "task" },
  { label: "Expenses", value: "expense" },
  { label: "Reminders", value: "reminder" },
  { label: "Documents", value: "document" },
] as const;

function SearchResultCard({ result }: { readonly result: ObjectSearchResult }) {
  const href = getSearchResultHref(result);
  const content = (
    <>
      <span className="search-result-icon">
        <SearchIcon />
      </span>
      <span className="search-result-copy">
        <span className="object-label">{result.objectType}</span>
        <strong>{result.displayName}</strong>
        <span>
          Updated {formatDateTime(result.updatedAt)} | ID {shortId(result.id)}
        </span>
      </span>
      {href === null ? (
        <span className="search-result-state">Canonical record</span>
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
          <p className="eyebrow">Canonical retrieval</p>
          <h1>Search</h1>
          <p>
            Find the event-planning objects available in this workspace. Every
            result uses the same permission decision as its detail view.
          </p>
        </div>
        <SearchIcon className="heading-icon" />
      </header>

      <section
        aria-labelledby="search-heading"
        className="surface search-surface"
      >
        <div>
          <span className="object-label">Workspace index</span>
          <h2 id="search-heading">Find an object</h2>
        </div>
        <search>
          <form className="search-form" onSubmit={handleSubmit}>
            <label className="compact-field grow-field" htmlFor="object-search">
              <span>Keywords</span>
              <input
                id="object-search"
                maxLength={120}
                minLength={2}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Launch night"
                required
                type="search"
                value={query}
              />
            </label>
            <label className="compact-field" htmlFor="object-search-type">
              <span>Type</span>
              <select
                id="object-search-type"
                onChange={(event) =>
                  setObjectType(
                    event.target.value as ObjectSearchResult["objectType"] | "",
                  )
                }
                value={objectType}
              >
                {searchableTypes.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button button-primary"
              disabled={search.isFetching}
              type="submit"
            >
              {search.isFetching ? "Searching..." : "Search"}
            </button>
          </form>
        </search>
      </section>

      <section
        aria-labelledby="search-results-heading"
        className="search-results"
      >
        <div className="section-title-row">
          <h2 id="search-results-heading">Results</h2>
          <span aria-live="polite">
            {search.data?.items.length ?? 0} loaded
          </span>
        </div>
        {search.isPending && submittedInput !== null ? (
          <LoadingState label="Searching workspace" />
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
            description="Enter at least two letters or numbers and optionally choose an object type."
            title="Search your workspace"
          />
        ) : null}
        {search.data?.items.length === 0 ? (
          <EmptyState
            description="Try a broader phrase or search all object types."
            title="No accessible objects found"
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
            {search.isFetchingNextPage
              ? "Loading more..."
              : "Load more results"}
          </button>
        ) : null}
      </section>
    </main>
  );
}
