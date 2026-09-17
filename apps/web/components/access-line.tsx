"use client";

import type { AccessSource } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { ShareIcon } from "./icons";

/**
 * One quiet line naming where the caller's access to a record comes from,
 * shown only when it is not their own workspace: a grant on the record
 * ("Shared with you by Mei as editor"), or a grant on the Event whose
 * scope the record inherits ("Through Kyoto in November, shared by Mei").
 * The inherited line opens that Event, at its Sharing view when the role
 * allows sharing; the direct line opens the Sharing view of the record
 * itself when the page offers one.
 */
export function AccessLine({
  source,
  onOpenSharing,
}: {
  readonly source: AccessSource | undefined;
  /** Opens the record's own Sharing view; offered only where one exists and the caller may share. */
  readonly onOpenSharing?: (() => void) | undefined;
}) {
  const t = useTranslations("access");
  if (source === undefined || source.kind === "own") return null;
  if (source.kind === "direct") {
    const text = t("sharedBy", {
      name: source.grantedBy.displayName,
      role: t(`roles.${source.role}`),
    });
    return onOpenSharing === undefined ? (
      <p className="access-line">
        <ShareIcon />
        <span>{text}</span>
      </p>
    ) : (
      <p className="access-line">
        <ShareIcon />
        <button
          className="access-line-link"
          onClick={onOpenSharing}
          type="button"
        >
          {text}
        </button>
      </p>
    );
  }
  const href = `/events/${source.through.id}${source.role === "owner" ? "?view=sharing" : ""}`;
  return (
    <p className="access-line">
      <ShareIcon />
      <Link className="access-line-link" href={href}>
        {t("throughEvent", {
          event: source.through.displayName,
          name: source.grantedBy.displayName,
        })}
      </Link>
    </p>
  );
}
