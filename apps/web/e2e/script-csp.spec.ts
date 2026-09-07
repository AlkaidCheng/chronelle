import { expect, test } from "@playwright/test";

test("issues a fresh script nonce on every document response", async ({
  request,
}) => {
  const first = await request.get("/sign-in");
  const second = await request.get("/sign-in");
  const policy = first.headers()["content-security-policy"] ?? "";
  const nonce = policy.match(/'nonce-([^']+)'/u)?.[1];
  expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/u);
  expect(policy).toContain("'strict-dynamic'");
  expect(policy).not.toContain("'unsafe-inline'");
  expect(policy).not.toContain("'unsafe-eval'");
  expect(first.headers()["cache-control"]).toContain("no-store");
  expect(second.headers()["content-security-policy"]).not.toBe(policy);
  const html = await first.text();
  const scripts = [...html.matchAll(/<script\b[^>]*>/gu)];
  expect(scripts.length).toBeGreaterThan(0);
  for (const [script] of scripts) expect(script).toContain(`nonce="${nonce}"`);
  const asset = html.match(/src="([^"]*\/_next\/static\/[^"]+\.js)"/u)?.[1];
  expect(asset).toBeDefined();
  const bundle = await request.get(asset ?? "");
  expect(bundle.ok()).toBe(true);
  expect(bundle.headers()["cache-control"]).toContain("immutable");
  expect(bundle.headers()["cache-control"]).not.toContain("no-store");
  const unauthorized = await request.get("/api/events");
  expect(unauthorized.status()).toBe(401);
  expect(unauthorized.headers()["cache-control"]).toContain("no-store");
  expect(unauthorized.headers()["content-security-policy"]).not.toContain(
    "nonce-",
  );
});

test("protects document errors and ignores client-supplied policy and prefetch headers", async ({
  request,
}) => {
  for (const path of ["/events", "/search", "/trash", "/missing", "/api"]) {
    const response = await request.get(path, {
      headers: {
        "x-nonce": "forged-nonce",
        "content-security-policy": "script-src 'unsafe-inline'",
        "next-router-prefetch": "1",
        purpose: "prefetch",
        "x-middleware-subrequest": "proxy:proxy:proxy:proxy:proxy",
      },
    });
    expect(response.headers()["content-type"]).toContain("text/html");
    const policy = response.headers()["content-security-policy"] ?? "";
    const nonce = policy.match(/'nonce-([^']+)'/u)?.[1];
    expect(nonce ?? "", path).toMatch(/^[A-Za-z0-9+/]{22}==$/u);
    expect(policy).not.toContain("forged-nonce");
    expect(policy).not.toContain("unsafe-inline");
    expect(response.headers()["cache-control"], path).toContain("no-store");
    expect(await response.text(), path).toContain(`nonce="${nonce}"`);
  }
  const missingAsset = await request.get("/_next/static/missing.js");
  expect(missingAsset.status()).toBe(404);
  expect(missingAsset.headers()["content-type"]).toContain("text/plain");
  expect(missingAsset.headers()["x-content-type-options"]).toBe("nosniff");
  const prefetched = await request.get("/events", {
    headers: {
      rsc: "1",
      "next-router-prefetch": "1",
      "x-nonce": "forged-nonce",
      "content-security-policy": "script-src 'unsafe-inline'",
    },
  });
  expect(prefetched.headers()["content-type"]).toContain("text/x-component");
  expect(prefetched.headers()["content-security-policy"]).toMatch(
    /'nonce-[A-Za-z0-9+/]{22}=='/u,
  );
  expect(prefetched.headers()["content-security-policy"]).not.toContain(
    "forged-nonce",
  );
  expect(prefetched.headers()["cache-control"]).toContain("no-store");
});

test("blocks an injected parser script while hydrating the application", async ({
  page,
}) => {
  const staleResponse = await page.request.get("/sign-in");
  const staleNonce = staleResponse
    .headers()
    ["content-security-policy"]?.match(/'nonce-([^']+)'/u)?.[1];
  expect(staleNonce).toMatch(/^[A-Za-z0-9+/]{22}==$/u);
  let unexpectedFetches = 0;
  await page.route("**/csp-probe.js", async (route) => {
    unexpectedFetches += 1;
    await route.fulfill({
      contentType: "application/javascript",
      body: "document.documentElement.dataset.cspExternalProbe = 'executed'",
    });
  });
  await page.addInitScript(() => {
    const violations: string[] = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      violations.push(event.effectiveDirective);
      document.documentElement.dataset.cspViolations =
        JSON.stringify(violations);
    });
  });
  await page.route("**/sign-in", async (route) => {
    const response = await route.fetch();
    const html = await response.text();
    await route.fulfill({
      response,
      body: html
        .replace(
          "<head>",
          `<head><script>document.documentElement.dataset.cspProbe = 'executed'</script><script nonce="${staleNonce}">document.documentElement.dataset.cspStaleProbe = 'executed'</script><script src="/csp-probe.js"></script>`,
        )
        .replace(
          "<body>",
          "<body onload=\"document.documentElement.dataset.cspAttributeProbe = 'executed'\">",
        ),
    });
  });
  await page.goto("/sign-in");
  await expect(page.getByRole("button", { name: "Continue" })).toBeEnabled();
  for (const attribute of [
    "data-csp-probe",
    "data-csp-stale-probe",
    "data-csp-external-probe",
    "data-csp-attribute-probe",
  ]) {
    await expect(page.locator("html")).not.toHaveAttribute(attribute);
  }
  await expect(page.locator("html")).toHaveAttribute(
    "data-csp-violations",
    /script-src-elem/u,
  );
  await expect(page.locator("html")).toHaveAttribute(
    "data-csp-violations",
    /script-src-attr/u,
  );
  expect(unexpectedFetches).toBe(0);
});
