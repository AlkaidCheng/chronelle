import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import "./styles.css";
import "./collections.css";
import { Providers } from "./providers";
import { appearanceBootstrap } from "../lib/appearance-preference";

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
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script nonce={nonce}>{appearanceBootstrap}</script>
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
