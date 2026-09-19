import type { ReactNode } from "react";

import { LocaleMenu } from "./locale-menu";
import { ThemeMenu } from "./theme-menu";

/**
 * The frame every account screen shares: the brand above one column, and a
 * footer with the language and theme menus (a screen that asks for the
 * language itself leaves the language menu out). A screen puts its form in
 * an `account-card` and anything below the card (a line pointing to the
 * other screen) in an `account-aside`.
 */
export function AccountPage({
  children,
  languageMenu = true,
}: {
  readonly children: ReactNode;
  readonly languageMenu?: boolean | undefined;
}) {
  return (
    <main className="account-page">
      <a className="brand account-brand" href="/sign-in">
        <span className="brand-mark">C</span>
        <span>Chronelle</span>
      </a>
      {children}
      <div className="account-foot">
        {languageMenu ? (
          <>
            <LocaleMenu labelled />
            <span aria-hidden="true" className="account-foot-dot">
              &middot;
            </span>
          </>
        ) : null}
        <ThemeMenu labelled />
      </div>
    </main>
  );
}
