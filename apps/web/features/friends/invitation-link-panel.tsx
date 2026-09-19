"use client";

import type { SentInvitation } from "@chronelle/schemas";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { QrCode } from "../../components/qr-code";
import { copyText } from "../../lib/copy-text";
import { useDisplayPreferences } from "../../lib/use-display-preferences";

/**
 * An invitation link as the dialog shows it once made: the link, its QR
 * code, when it stops working, and how to pass it on (or that it was
 * emailed), with Copy link.
 */
export function InvitationLinkPanel({
  item,
}: {
  readonly item: Pick<
    SentInvitation,
    "channel" | "email" | "expiresAt" | "inviteUrl"
  >;
}) {
  const t = useTranslations("friends");
  const { locale, instant } = useDisplayPreferences();
  const [copied, setCopied] = useState("");
  const link = item.inviteUrl ?? "";
  const until =
    item.expiresAt === null
      ? ""
      : new Intl.DateTimeFormat(locale, {
          day: "numeric",
          month: "short",
          year: "numeric",
          ...(instant.timeZone !== undefined && {
            timeZone: instant.timeZone,
          }),
        }).format(new Date(item.expiresAt));

  async function copy() {
    setCopied((await copyText(link)) ? t("linkCopied") : t("linkNotCopied"));
  }

  return (
    <div className="invite-link">
      {item.channel === "email" && item.email !== null ? (
        <p className="field-hint">{t("emailedTo", { email: item.email })}</p>
      ) : (
        <p className="field-hint">{t("sendYourself")}</p>
      )}
      <div className="your-code-card invite-link-card">
        <QrCode label={t("linkQr")} value={link} />
        <p className="your-code-link invite-link-url">{link}</p>
        <p className="invite-link-until">{t("validUntil", { date: until })}</p>
      </div>
      <p className="visually-hidden" role="status">
        {copied}
      </p>
      <button
        className="button button-secondary invite-link-copy"
        onClick={copy}
        type="button"
      >
        {t("copyLink")}
      </button>
    </div>
  );
}
