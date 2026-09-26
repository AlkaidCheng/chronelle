"use client";

import type {
  EventDetailResponse,
  EventPlanningResourceResponse,
  ShareResponse,
} from "@livtales/schemas";
import { useTranslations } from "next-intl";
import { type FormEvent, useMemo, useState } from "react";
import { ConfirmAction } from "../../components/confirm-action";
import {
  EmptyState,
  ErrorNotice,
  LoadingState,
} from "../../components/feedback";
import { LockIcon, ShareIcon } from "../../components/icons";
import { useNotices } from "../../components/notices";
import { eventViewLabel } from "../../lib/event-views";
import { shortId } from "../../lib/format";
import { useFriendsQuery } from "../../lib/friend-queries";
import { personInitials } from "../../lib/person-collection";
import {
  useEventSectionsQuery,
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

type SharedRole = "owner" | "editor" | "viewer";

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
  const shareT = useTranslations("share");
  const access = useTranslations("access");
  const types = useTranslations("objectTypes");
  const verbs = useTranslations("verbs");
  const confirm = useTranslations("confirm");
  const done = useTranslations("done");
  const { post } = useNotices();
  const shares = useSharesQuery(eventId, true);
  const narrowed = (shares.data?.items ?? []).some(
    (grant) => grant.scope !== null,
  );
  const sections = useEventSectionsQuery(eventId, narrowed);
  // What a narrowed grant opens, under the person: the view, or the section.
  function scopeLine(grant: ShareResponse): string | null {
    if (grant.scope === null) return null;
    if (grant.scope.sectionId === null)
      return shareT("sharedView", { name: eventViewLabel(grant.scope.view) });
    const section = sections.data?.find(
      (item) => item.id === grant.scope?.sectionId,
    );
    return shareT("sharedSection", {
      name: section?.name ?? eventViewLabel(grant.scope.view),
    });
  }
  // Whole grants first, then the narrowed ones under their view.
  const listed = [...(shares.data?.items ?? [])].sort(
    (a, b) =>
      Number(a.scope !== null) - Number(b.scope !== null) ||
      (a.scope?.view ?? "").localeCompare(b.scope?.view ?? "") ||
      (a.scope?.sectionId ?? "").localeCompare(b.scope?.sectionId ?? ""),
  );
  const share = useShareResource(eventId);
  const revoke = useRevokeShare();
  const revokePending = useRevokePendingShare(eventId);
  const updateScope = useUpdatePermissionScope();
  const refresh = useRefreshEvent(eventId);
  const [principalEmail, setPrincipalEmail] = useState("");
  const [role, setRole] = useState<SharedRole>("viewer");

  // The share can be given again to the same address, so the notice offers
  // that as Undo; an account without an address gets no Undo.
  function removeShare(grant: ShareResponse) {
    revoke.mutate(grant.id, {
      onSuccess: () => {
        const email = grant.principal.email;
        post({
          message: done("shareRemoved"),
          ...(email === null
            ? {}
            : {
                action: {
                  label: done("undo"),
                  run: () =>
                    share.mutateAsync({
                      principalEmail: email,
                      role: grant.role,
                      ...(grant.scope === null ? {} : { scope: grant.scope }),
                    }),
                },
              }),
        });
      },
    });
  }
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

  const me = session.data?.user;
  const mine = me !== undefined && detail.event.createdBy === me.id;
  return (
    <div className="sharing-view">
      <section className="quiet-panel share-box sharing-panel">
        <header className="quiet-panel-head share-box-head">
          <h2>{detail.event.displayName}</h2>
        </header>
        <p className="share-sub">{tp("followsNote")}</p>

        <ShareWithPeople
          eventId={eventId}
          legend={t("sharePeople")}
          rows={rows}
        />

        <form className="share-group share-email" onSubmit={handleShare}>
          <span className="share-group-title">{t("byEmail")}</span>
          <div className="share-email-row">
            <label className="share-email-field">
              <span className="visually-hidden">{tp("collaboratorEmail")}</span>
              <input
                autoComplete="email"
                onChange={(input) => setPrincipalEmail(input.target.value)}
                placeholder="name@example.com"
                required
                type="email"
                value={principalEmail}
              />
            </label>
            <label className="share-email-role">
              <span className="visually-hidden">{tp("access")}</span>
              <select
                className="share-person-role"
                onChange={(input) => setRole(input.target.value as SharedRole)}
                value={role}
              >
                <option value="viewer">{tp("roles.viewer")}</option>
                <option value="editor">{tp("roles.editor")}</option>
              </select>
            </label>
            <button
              className="button button-secondary"
              disabled={share.isPending}
              type="submit"
            >
              {share.isPending ? tp("sharing") : tp("add")}
            </button>
          </div>
          {share.isError ? <ErrorNotice error={share.error} /> : null}
        </form>

        <div className="sharing-section access-section">
          <div className="section-title-row">
            <h3 className="share-group-title">{t("peopleWithAccess")}</h3>
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
          {!mine && shares.data?.items.length === 0 && pending.length === 0 ? (
            <EmptyState title={t("onlyYou")} />
          ) : null}
          <div className="share-list">
            {mine && me !== undefined ? (
              <article className="share-owner">
                <span
                  aria-hidden="true"
                  className="person-avatar person-avatar-linked"
                >
                  {personInitials(me.displayName)}
                </span>
                <div>
                  <strong>{me.displayName}</strong>
                  <span className="share-you">{tp("you")}</span>
                </div>
                <span className="share-role">{tp("roles.owner")}</span>
                <span />
              </article>
            ) : null}
            {listed.map((grant) => (
              <article key={grant.id}>
                <span
                  aria-hidden="true"
                  className="person-avatar person-avatar-linked"
                >
                  {personInitials(grant.principal.displayName)}
                </span>
                <div>
                  <strong>{grant.principal.displayName}</strong>
                  <span className="share-you">{grant.principal.email}</span>
                  {grant.scope === null ? (
                    <span className="share-grants">{access("grants")}</span>
                  ) : (
                    <span className="share-grants share-scope">
                      {scopeLine(grant)}
                    </span>
                  )}
                </div>
                <span className="share-role">
                  {tp(`roles.${grant.role}` as "roles.viewer")}
                </span>
                <ConfirmAction
                  className="link-button link-button-quiet"
                  disabled={revoke.isPending}
                  label={verbs("removeShare")}
                  onConfirm={() => removeShare(grant)}
                  pending={revoke.isPending}
                  question={confirm("removeShare", {
                    name: grant.principal.displayName,
                    resource: detail.event.displayName,
                  })}
                />
              </article>
            ))}
            {pending.map((item) => {
              const name = item.person?.displayName ?? item.email ?? "";
              return (
                <article className="share-pending" key={item.id}>
                  <span aria-hidden="true" className="person-avatar">
                    {personInitials(name)}
                  </span>
                  <div>
                    <strong>{name}</strong>
                    <span className="share-you">
                      {item.person === null ? t("accessFollows") : item.email}
                      {item.person === null
                        ? null
                        : ` \u00b7 ${t("accessFollows")}`}
                    </span>
                  </div>
                  <span className="share-role">
                    {t(`roles.${item.role}` as "roles.viewer")}
                  </span>
                  <button
                    className="link-button link-button-quiet"
                    disabled={revokePending.isPending}
                    onClick={() =>
                      revokePending.mutate(item.id, {
                        onSuccess: () =>
                          post({ message: done("shareRemoved") }),
                      })
                    }
                    type="button"
                  >
                    {verbs("removeShare")}
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
      </section>

      <section className="quiet-panel share-box">
        <header className="quiet-panel-head">
          <h2>{tp("inheritedResources")}</h2>
          <span className="quiet-panel-count">{resources.length}</span>
        </header>
        <p className="share-sub">{tp("inheritedNote")}</p>
        {resources.length === 0 ? (
          <p className="kv-empty">{tp("noResources")}</p>
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
      </section>
    </div>
  );
}
