import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "../proxy";
import nextConfig from "../next.config";

afterEach(() => vi.unstubAllEnvs());

describe("script Content Security Policy", () => {
  it("replaces caller-supplied policy and nonce with a fresh server value", () => {
    vi.stubEnv("NODE_ENV", "production");
    const request = new NextRequest("https://web.example.test/sign-in", {
      headers: {
        "x-nonce": "attacker-nonce",
        "content-security-policy": "script-src 'unsafe-inline'",
        "next-router-prefetch": "1",
        purpose: "prefetch",
      },
    });
    const first = proxy(request);
    const second = proxy(request);
    const policy = first.headers.get("content-security-policy");
    const nonce = first.headers.get("x-middleware-request-x-nonce");
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/u);
    expect(second.headers.get("x-middleware-request-x-nonce")).not.toBe(nonce);
    expect(policy).toContain(`script-src 'nonce-${nonce}' 'strict-dynamic'`);
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).not.toContain("attacker-nonce");
    expect(policy).not.toMatch(/unsafe-inline|unsafe-eval/u);
    expect(
      first.headers.get("x-middleware-request-content-security-policy"),
    ).toBe(policy);
    expect(first.headers.has("x-nonce")).toBe(false);
  });

  it("permits eval only in the development server", () => {
    vi.stubEnv("NODE_ENV", "development");
    const policy = proxy(
      new NextRequest("http://web.example.test/sign-in"),
    ).headers.get("content-security-policy");
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).not.toContain("'unsafe-inline'");
  });

  it("preserves baseline protection on routes outside page middleware", async () => {
    const rules = await nextConfig.headers?.();
    const baseline = rules?.find((rule) => rule.source === "/:path*");
    const policy = baseline?.headers.find(
      (header) => header.key === "Content-Security-Policy",
    )?.value;
    for (const directive of [
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ]) {
      expect(policy).toContain(directive);
      expect(
        proxy(new NextRequest("https://web.example.test/sign-in")).headers.get(
          "content-security-policy",
        ),
      ).toContain(directive);
    }
    expect(baseline?.headers).toContainEqual({
      key: "X-Content-Type-Options",
      value: "nosniff",
    });
  });
});
