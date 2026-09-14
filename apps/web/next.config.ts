import type { NextConfig } from "next";
import { baseContentSecurityPolicy } from "./lib/content-security-policy";

const nextConfig: NextConfig = {
  agentRules: false,
  // Development only: let phones and other devices on a private network load
  // the dev server's assets. Production builds ignore this setting.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "*.local"],
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            key: "Content-Security-Policy",
            value: baseContentSecurityPolicy,
          },
        ],
      },
    ];
  },
};

export default nextConfig;
