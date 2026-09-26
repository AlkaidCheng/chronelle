"use client";

import type { SessionResponse } from "@livtales/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { useSessionQuery } from "../../lib/queries";
import { useWorkspaceIdentity } from "../../lib/use-workspace-identity";

/**
 * The event's place above its title: the space it belongs to as plain
 * text, then the link back to Events. An event reached through a share
 * alone reads "Shared with me"; without a known event only the link shows.
 */
export function EventBreadcrumb({
  workspaceId,
}: {
  readonly workspaceId?: string;
}) {
  const t = useTranslations("event");
  const nav = useTranslations("nav");
  const session = useSessionQuery().data;
  return (
    <nav aria-label={t("breadcrumb")} className="event-crumbs">
      {workspaceId === undefined || session === undefined ? null : (
        <>
          <SpaceName session={session} workspaceId={workspaceId} />
          <span aria-hidden="true" className="event-crumbs-separator">
            /
          </span>
        </>
      )}
      <Link
        aria-label={t("allEvents")}
        className="event-crumbs-link"
        href="/events"
      >
        {nav("events")}
      </Link>
    </nav>
  );
}

function SpaceName({
  session,
  workspaceId,
}: {
  readonly session: SessionResponse;
  readonly workspaceId: string;
}) {
  const t = useTranslations("event");
  const identityOf = useWorkspaceIdentity(session);
  const membership = session.availableWorkspaces.find(
    (workspace) => workspace.id === workspaceId && workspace.role !== null,
  );
  return (
    <span className="event-crumbs-space">
      {membership === undefined
        ? t("sharedWithMe")
        : identityOf(membership).title}
    </span>
  );
}
