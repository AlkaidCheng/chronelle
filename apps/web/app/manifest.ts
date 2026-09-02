import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    background_color: "#f4f0e8",
    description: "Your life, connected across time.",
    display: "standalone",
    name: "Chronelle",
    short_name: "Chronelle",
    start_url: "/",
    theme_color: "#f4f0e8",
  };
}
