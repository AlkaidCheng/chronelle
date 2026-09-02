import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./styles.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  description: "Your life, connected across time.",
  title: "Chronelle",
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#f4f0e8",
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
