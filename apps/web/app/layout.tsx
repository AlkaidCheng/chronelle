import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { NextIntlClientProvider } from "next-intl";
import { getLocale } from "next-intl/server";
import type { ReactNode } from "react";

import "./styles.css";
import "./collections.css";
import "./print.css";
import { Providers } from "./providers";
import { LocaleSync } from "../i18n/locale-sync";
import { displayBootstrap } from "../lib/display-preferences";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  description:
    "A thoughtful home for your events, plans, and everyday details.",
  title: { default: "Chronelle", template: "%s | Chronelle" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f0e6" },
    { media: "(prefers-color-scheme: dark)", color: "#1d1b19" },
  ],
};

interface RootLayoutProps {
  children: ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const locale = await getLocale();
  return (
    <html lang={locale} suppressHydrationWarning>
      <head>
        <script nonce={nonce}>{displayBootstrap}</script>
      </head>
      <body>
        <NextIntlClientProvider>
          <LocaleSync />
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
