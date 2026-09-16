"use client";

import type {
  EventDetailResponse,
  EventPlanningResourceResponse,
} from "@chronelle/schemas";
import { type FormEvent, useMemo, useState } from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { LockIcon, ShareIcon } from "../../components/icons";
import { shortId } from "../../lib/format";
import {
  usePersonsQuery,
  useRefreshEvent,
  useRevokeShare,
  useSessionQuery,
  useShareResource,
  useSharesQuery,
  useUpdatePermissionScope,
} from "../../lib/queries";
import { ShareWithPeople, shareablePeople } from "./share-with-people";

type SharedRole = "owner" | "viewer";

function relatedResources(
  detail: EventDetailResponse,
): EventPlanningResourceResponse[] {
  return [
    ...detail.events,
    ...detail.tasks,
    ...detail.expenses,
    ...detail.reminders,
    ...detail.documents,
  ];
}

export function SharingPanel({
  detail,
  eventId,
}: {
  readonly detail: EventDetailResponse;
  readonly eventId: string;
}) {
  const shares = useSharesQuery(eventId, true);
  const share = useShareResource(eventId);
  const revoke = useRevokeShare();
  const updateScope = useUpdatePermissionScope();
  const refresh = useRefreshEvent(eventId);
  const [principalEmail, setPrincipalEmail] = useState("");
  const [role, setRole] = useState<SharedRole>("viewer");
  const resources = useMemo(() => relatedResources(detail), [detail]);
  const persons = usePersonsQuery();
  const session = useSessionQuery();
  const people = useMemo(
    () => shareablePeople(persons.data?.items ?? [], session.data?.user.id),
    [persons.data, session.data],
  );

  function handleShare(formEvent: FormEvent<HTMLFormElement>) {
    formEvent.preventDefault();
    share.mutate(
      { principalEmail, role },
      {
        onSuccess: () => {
          setPrincipalEmail("");
          setRole("viewer");
        },
      },
    );
  }

  return (
    <section className="planning-panel sharing-panel">
      <header className="panel-heading">
        <div>
          <h2>Sharing</h2>
          <p>
            Grant access to this Event and its inheriting resources. A
            relationship alone never grants access. Collaborators can also read
            earlier saved versions of resources they can currently view,
            including versions saved before this invitation.
          </p>
        </div>
        <ShareIcon />
      </header>

      <form className="share-form surface-subtle" onSubmit={handleShare}>
        <label className="field field-wide">
          <span>Collaborator email</span>
          <input
            autoComplete="email"
            onChange={(input) => setPrincipalEmail(input.target.value)}
            placeholder="collaborator@example.com"
            required
            type="email"
            value={principalEmail}
          />
        </label>
        <label className="field">
          <span>Access</span>
          <select
            onChange={(input) => setRole(input.target.value as SharedRole)}
            value={role}
          >
            <option value="viewer">Viewer</option>
            <option value="owner">Owner</option>
          </select>
        </label>
        <button
          className="button button-primary"
          disabled={share.isPending}
          type="submit"
        >
          {share.isPending ? "Sharing..." : "Share event"}
        </button>
        {share.isError ? <ErrorNotice error={share.error} /> : null}
      </form>

      <ShareWithPeople
        eventId={eventId}
        grants={shares.data?.items ?? []}
        legend="Share with people"
        people={people}
      />

      <div className="sharing-section">
        <div className="section-title-row">
          <h3>People with access</h3>
          <span>{shares.data?.items.length ?? 0}</span>
        </div>
        {shares.isPending ? (
          <LoadingState label="Loading collaborators" />
        ) : null}
        {shares.isError ? (
          <ErrorNotice
            error={shares.error}
            onRefresh={() => void shares.refetch()}
          />
        ) : null}
        {shares.data?.items.length === 0 ? (
          <EmptyState
            description="Share with a development user who has signed in at least once."
            title="Only you have access"
          />
        ) : null}
        <div className="share-list">
          {shares.data?.items.map((grant) => (
            <article key={grant.id}>
              <span className="profile-mark" aria-hidden="true">
                {grant.principal.displayName.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{grant.principal.displayName}</strong>
                <span>{grant.principal.email}</span>
              </div>
              <span className={`status-chip status-${grant.role}`}>
                {grant.role}
              </span>
              <button
                className="button button-quiet button-small"
                disabled={revoke.isPending}
                onClick={() => revoke.mutate(grant.id)}
                type="button"
              >
                Revoke
              </button>
            </article>
          ))}
        </div>
        {revoke.isError ? <ErrorNotice error={revoke.error} /> : null}
      </div>

      <div className="sharing-section">
        <div className="section-title-row">
          <div>
            <h3>Inherited resources</h3>
            <p>Stop inheritance to keep one related object private.</p>
          </div>
          <span>{resources.length}</span>
        </div>
        {resources.length === 0 ? (
          <EmptyState
            description="Related planning objects will appear here."
            title="No related resources"
          />
        ) : (
          <div className="scope-list">
            {resources.map((resource) => {
              const inherits = resource.permissionScopeId === eventId;
              return (
                <article key={resource.id}>
                  <span className="scope-icon">
                    {inherits ? <ShareIcon /> : <LockIcon />}
                  </span>
                  <div>
                    <span className="object-label">{resource.objectType}</span>
                    <strong>{resource.displayName}</strong>
                    <span>ID {shortId(resource.id)}</span>
                  </div>
                  <span className="scope-state">
                    {inherits ? "Inherits Event access" : "Private scope"}
                  </span>
                  {inherits ? (
                    <button
                      className="button button-secondary button-small"
                      disabled={updateScope.isPending}
                      onClick={() =>
                        updateScope.mutate({
                          id: resource.id,
                          input: {
                            expectedVersion: resource.version,
                            permissionScopeId: resource.id,
                          },
                        })
                      }
                      type="button"
                    >
                      Make private
                    </button>
                  ) : null}
                </article>
              );
            })}
          </div>
        )}
        {updateScope.isError ? (
          <ErrorNotice
            error={updateScope.error}
            onRefresh={() => void refresh().then(() => updateScope.reset())}
          />
        ) : null}
      </div>
    </section>
  );
}
