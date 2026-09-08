import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#f5f0e6",
    description: "Your life, connected across time.",
    display: "standalone",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
    name: "Chronelle",
    short_name: "Chronelle",
    start_url: "/",
    theme_color: "#f5f0e6",
  };
}
