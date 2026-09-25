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

const description =
  "A thoughtful home for your events, plans, and everyday details.";

const siteMetadata: Metadata = {
  applicationName: "LivTales",
  description,
  title: { default: "LivTales", template: "%s | LivTales" },
  robots: { index: false, follow: false },
  // A home-screen install on iOS opens as its own window, as the
  // manifest's standalone display asks elsewhere; the apple-prefixed tag
  // covers iOS before 17.4, which ignores the standard one Next emits.
  appleWebApp: { capable: true, title: "LivTales", statusBarStyle: "default" },
  other: { "apple-mobile-web-app-capable": "yes" },
  // A shared link previews as the site; the image is app/opengraph-image.jpg.
  openGraph: {
    description,
    siteName: "LivTales",
    title: "LivTales",
    type: "website",
  },
};

/**
 * The origin the page was asked for, which a link preview needs to reach
 * the Open Graph image: the forwarded host and scheme, the same Next.js
 * reads for the request's own URL (it fills them in when no proxy did).
 */
function requestOrigin(request: Headers): URL | null {
  const host = (request.get("x-forwarded-host") ?? request.get("host"))
    ?.split(",")[0]
    ?.trim();
  if (!host) return null;
  const scheme = request.get("x-forwarded-proto")?.includes("https")
    ? "https"
    : "http";
  try {
    return new URL(`${scheme}://${host}`);
  } catch {
    return null;
  }
}

export async function generateMetadata(): Promise<Metadata> {
  return { ...siteMetadata, metadataBase: requestOrigin(await headers()) };
}

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
