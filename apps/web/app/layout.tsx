import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./styles.css";
import "./collections.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  description:
    "A thoughtful home for your events, plans, and everyday details.",
  title: { default: "Chronelle", template: "%s | Chronelle" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#203e32",
};

interface RootLayoutProps {
  children: ReactNode;
}

export default function RootLayout({ children }: RootLayoutProps) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
