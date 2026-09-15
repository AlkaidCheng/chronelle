"use client";

import { useEffect, useMemo, useState } from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { PlusIcon, SearchIcon } from "../../components/icons";
import { usePersonsQuery, useSessionQuery } from "../../lib/queries";
import { PersonCard } from "./person-card";
import { PersonForm } from "./person-form";
import { PersonInspector } from "./person-inspector";

const fieldsStorageKey = "chronelle.people-fields";

/**
 * Everyone the workspace keeps track of, as namecards. Which custom fields
 * the cards show is a device preference; absent, every field shows. The
 * name query lives with the tab.
 */
export function PeoplePage() {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isComposing, setIsComposing] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  useEffect(() => {
    if (isComposing) return;
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query, isComposing]);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(fieldsStorageKey);
      if (stored !== null) setHidden(new Set(JSON.parse(stored) as string[]));
    } catch {
      // Every field shows when the preference cannot be read.
    }
  }, []);
  const people = usePersonsQuery(true, { query: debouncedQuery });
  const session = useSessionQuery();
  const me = session.data?.user.id;
  const changingQuery = isComposing || query.trim() !== debouncedQuery;
  const items = changingQuery ? [] : (people.data?.items ?? []);
  // Every custom field any loaded person carries, in first-seen order.
  const fieldNames = useMemo(() => {
    const names: string[] = [];
    for (const person of items)
      for (const key of Object.keys(person.customProperties))
        if (!names.includes(key)) names.push(key);
    return names;
  }, [items]);

  function toggleField(name: string, shown: boolean) {
    const next = new Set(hidden);
    if (shown) next.delete(name);
    else next.add(name);
    setHidden(next);
    try {
      window.localStorage.setItem(fieldsStorageKey, JSON.stringify([...next]));
    } catch {
      // A preference that cannot be stored still applies to this page.
    }
  }

  return (
    <main className="workspace-page" tabIndex={-1}>
      <header className="page-heading split-heading">
        <div>
          <p className="eyebrow">Who is involved</p>
          <h1>People</h1>
          <p>Everyone your plans involve, with the details worth keeping.</p>
        </div>
        <button
          aria-haspopup="dialog"
          className="button button-primary"
          onClick={(event) => {
            event.currentTarget.focus();
            setIsAdding(true);
          }}
          type="button"
        >
          <PlusIcon />
          New person
        </button>
      </header>

      {isAdding ? (
        <PersonForm key="new" onCancel={() => setIsAdding(false)} />
      ) : null}

      <section aria-labelledby="people-heading" className="event-list-section">
        <div className="collection-toolbar">
          <label className="collection-search">
            <SearchIcon />
            <span className="visually-hidden">Filter people by name</span>
            <input
              maxLength={240}
              onChange={(event) => setQuery(event.target.value)}
              onCompositionEnd={(event) => {
                setQuery(event.currentTarget.value);
                setIsComposing(false);
              }}
              onCompositionStart={() => setIsComposing(true)}
              placeholder="Find a person..."
              type="search"
              value={query}
            />
          </label>
          {fieldNames.length > 0 ? (
            <details className="shown-fields">
              <summary>Shown fields</summary>
              <fieldset className="assignee-choices">
                <legend className="visually-hidden">Fields to show</legend>
                <ul className="label-options">
                  {fieldNames.map((name) => (
                    <li key={name}>
                      <label className="check-field">
                        <input
                          checked={!hidden.has(name)}
                          onChange={(input) =>
                            toggleField(name, input.target.checked)
                          }
                          type="checkbox"
                        />
                        <span>{name}</span>
                      </label>
                    </li>
                  ))}
                </ul>
              </fieldset>
            </details>
          ) : null}
          <button
            className="button button-quiet"
            disabled={people.isFetching || changingQuery}
            onClick={() => void people.refetch()}
            type="button"
          >
            Refresh people
          </button>
        </div>
        <div className="collection-heading">
          <h2 id="people-heading">Everyone</h2>
          <p
            aria-label="People count"
            className="collection-count"
            role="status"
          >
            {changingQuery || people.data === undefined
              ? ""
              : `${items.length} ${items.length === 1 ? "person" : "people"} loaded`}
          </p>
        </div>
        {people.isError ? (
          <ErrorNotice
            error={people.error}
            isRefreshing={people.isFetching}
            onRefresh={() => void people.refetch()}
          />
        ) : people.isPending && !changingQuery ? (
          <LoadingState label="Loading people" />
        ) : items.length === 0 && !changingQuery ? (
          <div className="collection-empty">
            <EmptyState
              description={
                debouncedQuery === ""
                  ? "Add the people your plans involve; a task can then be assigned to them."
                  : "Try another name."
              }
              title={
                debouncedQuery === "" ? "No people yet" : "No matching people"
              }
            />
          </div>
        ) : null}
        {items.length > 0 ? (
          <ul aria-label="People" className="person-grid">
            {items.map((person) => (
              <PersonCard
                hidden={hidden}
                isMe={me !== undefined && person.userId === me}
                key={person.id}
                onEdit={setEditingId}
                person={person}
              />
            ))}
          </ul>
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
