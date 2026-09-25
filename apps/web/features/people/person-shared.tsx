"use client";

import type { PersonShare } from "@livtales/schemas";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { ErrorNotice, LoadingState } from "../../components/feedback";
import {
  BellIcon,
  CalendarIcon,
  PaperclipIcon,
  PeopleIcon,
  TasksIcon,
  WalletIcon,
} from "../../components/icons";
import { usePersonSharesQuery } from "../../lib/queries";

/** How many rows the Overview panel shows before pointing at the tab. */
const panelRows = 5;

const marks: Record<PersonShare["objectType"], ReactNode> = {
  event: <CalendarIcon />,
  task: <TasksIcon />,
  expense: <WalletIcon />,
  reminder: <BellIcon />,
  document: <PaperclipIcon />,
  person: <PeopleIcon />,
};

/** Where a shared record opens: events and people have pages of their own. */
function hrefOf(share: PersonShare): string | null {
  if (share.objectType === "event") return `/events/${share.resourceId}`;
  if (share.objectType === "person") return `/people/${share.resourceId}`;
  return null;
}

/**
 * What is shared each way with the person: on the Overview as a panel of
 * the newest few rows with a way to the rest, and as the Shared tab in
 * full. A row is the record's mark and name (a link when the record has a
 * page), the role, and who shared it: "you shared", "{name} shared", or
 * "queued" for a share waiting on the person's invitation.
 */
export function PersonShared({
  personId,
  personName,
  variant,
  onSeeAll,
}: {
  readonly personId: string;
  readonly personName: string;
  readonly variant: "panel" | "tab";
  readonly onSeeAll?: (() => void) | undefined;
}) {
  const t = useTranslations("personPage");
  const roles = useTranslations("access");
  const shares = usePersonSharesQuery(personId);
  const items = shares.data?.items ?? [];
  const shown = variant === "panel" ? items.slice(0, panelRows) : items;
  const list = shares.isPending ? (
    <LoadingState label={t("loadingShared")} />
  ) : shares.isError ? (
    <ErrorNotice error={shares.error} onRefresh={() => void shares.refetch()} />
  ) : items.length === 0 ? (
    <p className="kv-empty">{t("noShared")}</p>
  ) : (
    <ul aria-label={t("shared")} className="shared-list">
      {shown.map((share) => {
        const href = hrefOf(share);
        return (
          <li className="shared-row" key={share.id}>
            <span className="shared-mark">{marks[share.objectType]}</span>
            <span className="shared-name">
              {href === null ? (
                share.displayName
              ) : (
                <Link href={href}>{share.displayName}</Link>
              )}
            </span>
            <span className="shared-role">{roles(`roles.${share.role}`)}</span>
            <span className="shared-direction">
              {share.kind === "pending"
                ? t("queued")
                : share.direction === "outgoing"
                  ? t("youShared")
                  : t("theyShared", { name: personName })}
            </span>
          </li>
        );
      })}
    </ul>
  );
  if (variant === "tab") return <div className="person-shared">{list}</div>;
  return (
    <section aria-labelledby="person-shared" className="quiet-panel">
      <header className="quiet-panel-head">
        <h2 id="person-shared">{t("shared")}</h2>
        {items.length > 0 ? (
          <span className="quiet-panel-count">{items.length}</span>
        ) : null}
      </header>
      {list}
      {items.length > panelRows && onSeeAll ? (
        <button className="quiet-panel-more" onClick={onSeeAll} type="button">
          {t("allShared", { count: items.length })}
        </button>
      ) : null}
    </section>
  );
}
