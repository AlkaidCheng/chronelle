"use client";

import { useTranslations } from "next-intl";
import { useId, useState } from "react";

import { QrCode } from "../../components/qr-code";
import { useSessionQuery } from "../../lib/queries";
import { useSessionDialog } from "../../lib/use-session-dialog";

/** Where a code opens: the account's profile link, on this deployment. */
export function profileLink(username: string): string {
  return `${window.location.origin}/u/${encodeURIComponent(username)}`;
}

/**
 * Your code: the QR code and link of the account's profile, which anyone
 * may scan or open to send a friend request.
 */
export function YourCodeDialog({ onClose }: { readonly onClose: () => void }) {
  const t = useTranslations("friends");
  const dialog = useSessionDialog(onClose);
  const id = useId();
  const session = useSessionQuery();
  const user = session.data?.user;
  const [copied, setCopied] = useState("");
  const link = user === undefined ? null : profileLink(user.username);

  function copy() {
    if (link === null) return;
    navigator.clipboard
      ?.writeText(link)
      .then(() => setCopied(t("linkCopied")))
      .catch(() => setCopied(t("linkNotCopied")));
  }

  return (
    <dialog
      aria-labelledby={`${id}-title`}
      className="event-create-dialog your-code-dialog"
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        onClose();
      }}
      ref={dialog}
    >
      <header className="event-create-header">
        <h2 id={`${id}-title`}>{t("yourCode")}</h2>
        <button
          aria-label={t("closeCode")}
          className="dialog-close"
          onClick={onClose}
          type="button"
        >
          &#215;
        </button>
      </header>
      <div className="event-create-body your-code-body">
        {link === null || user === undefined ? null : (
          <>
            <p className="field-hint">{t("yourCodeNote")}</p>
            <div className="your-code-card">
              <QrCode label={t("codeLabel")} value={link} />
              <p className="your-code-handle">
                <strong className="your-code-name">{user.displayName}</strong>
                <span className="your-code-at">@{user.username}</span>
              </p>
              <p className="your-code-link">{link}</p>
            </div>
            <p className="visually-hidden" role="status">
              {copied}
            </p>
            <div className="form-actions">
              <button
                className="button button-quiet"
                onClick={onClose}
                type="button"
              >
                {t("cancel")}
              </button>
              <button
                className="button button-primary"
                onClick={copy}
                type="button"
              >
                {t("copyLink")}
              </button>
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}
