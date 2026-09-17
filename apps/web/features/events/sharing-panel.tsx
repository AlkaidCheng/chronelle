"use client";

import type {
  EventDetailResponse,
  EventPlanningResourceResponse,
} from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { type FormEvent, useMemo, useState } from "react";

import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { LockIcon, ShareIcon } from "../../components/icons";
import { shortId } from "../../lib/format";
import { useFriendsQuery } from "../../lib/friend-queries";
import {
  usePersonsQuery,
  useRefreshEvent,
  useRevokePendingShare,
  useRevokeShare,
  useSessionQuery,
  useShareResource,
  useSharesQuery,
  useUpdatePermissionScope,
} from "../../lib/queries";
import { ShareWithPeople, shareRows } from "./share-with-people";

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
  const t = useTranslations("sharing");
  const tp = useTranslations("sharingPanel");
  const types = useTranslations("objectTypes");
  const shares = useSharesQuery(eventId, true);
  const share = useShareResource(eventId);
  const revoke = useRevokeShare();
  const revokePending = useRevokePendingShare(eventId);
  const updateScope = useUpdatePermissionScope();
  const refresh = useRefreshEvent(eventId);
  const [principalEmail, setPrincipalEmail] = useState("");
  const [role, setRole] = useState<SharedRole>("viewer");
  const resources = useMemo(() => relatedResources(detail), [detail]);
  const persons = usePersonsQuery();
  const session = useSessionQuery();
  const friends = useFriendsQuery();
  const rows = useMemo(
    () =>
      shareRows({
        friends: friends.data?.friends ?? [],
        grants: shares.data?.items ?? [],
        me: session.data?.user.id,
        pending: shares.data?.pending ?? [],
        people: persons.data?.items ?? [],
        sent: friends.data?.sent ?? [],
        workspaceId: session.data?.workspace.id,
        scope: "workspace",
      }),
    [friends.data, persons.data, session.data, shares.data],
  );
  const pending = shares.data?.pending ?? [];

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
          <h2>{tp("title")}</h2>
        </div>
        <ShareIcon />
      </header>

      <ShareWithPeople
        eventId={eventId}
        legend={t("sharePeople")}
        rows={rows}
      />

      <form className="share-form surface-subtle" onSubmit={handleShare}>
        <span className="share-group-title">{t("byEmail")}</span>
        <label className="field field-wide">
          <span>{tp("collaboratorEmail")}</span>
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
          <span>{tp("access")}</span>
          <select
            onChange={(input) => setRole(input.target.value as SharedRole)}
            value={role}
          >
            <option value="viewer">{tp("roles.viewer")}</option>
            <option value="owner">{tp("roles.owner")}</option>
          </select>
        </label>
        <button
          className="button button-primary"
          disabled={share.isPending}
          type="submit"
        >
          {share.isPending ? tp("sharing") : tp("shareEvent")}
        </button>
        {share.isError ? <ErrorNotice error={share.error} /> : null}
      </form>

      <div className="sharing-section">
        <div className="section-title-row">
          <h3>{t("peopleWithAccess")}</h3>
          <span>{(shares.data?.items.length ?? 0) + pending.length}</span>
        </div>
        {shares.isPending ? (
          <LoadingState label={tp("loadingCollaborators")} />
        ) : null}
        {shares.isError ? (
          <ErrorNotice
            error={shares.error}
            onRefresh={() => void shares.refetch()}
          />
        ) : null}
        {shares.data?.items.length === 0 && pending.length === 0 ? (
          <EmptyState title={t("onlyYou")} />
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
                {t("remove")}
              </button>
            </article>
          ))}
          {pending.map((item) => {
            const name = item.person?.displayName ?? item.email ?? "";
            return (
              <article className="share-pending" key={item.id}>
                <span className="profile-mark" aria-hidden="true">
                  {name.slice(0, 1).toUpperCase()}
                </span>
                <div>
                  <strong>{name}</strong>
                  <span>
                    {item.person === null ? t("accessFollows") : item.email}
                    {item.person === null
                      ? null
                      : ` \u00b7 ${t("accessFollows")}`}
                  </span>
                </div>
                <span className={`status-chip status-${item.role}`}>
                  {t(`roles.${item.role}` as "roles.viewer")}
                </span>
                <button
                  className="button button-quiet button-small"
                  disabled={revokePending.isPending}
                  onClick={() => revokePending.mutate(item.id)}
                  type="button"
                >
                  {t("remove")}
                </button>
              </article>
            );
          })}
        </div>
        {revoke.isError ? <ErrorNotice error={revoke.error} /> : null}
        {revokePending.isError ? (
          <ErrorNotice error={revokePending.error} />
        ) : null}
      </div>

      <div className="sharing-section">
        <div className="section-title-row">
          <div>
            <h3>{tp("inheritedResources")}</h3>
            <p>{tp("inheritedNote")}</p>
          </div>
          <span>{resources.length}</span>
        </div>
        {resources.length === 0 ? (
          <EmptyState title={tp("noResources")} />
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
                    <span className="object-label">
                      {types(resource.objectType)}
                    </span>
                    <strong>{resource.displayName}</strong>
                    <span>{tp("id", { id: shortId(resource.id) })}</span>
                  </div>
                  <span className="scope-state">
                    {inherits ? tp("inherits") : tp("privateScope")}
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
                      {tp("makePrivate")}
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
