import { describe, expect, it } from "vitest";

import { DevelopmentAuthProvider } from "../src/authentication/development-auth-provider.js";

describe("DevelopmentAuthProvider", () => {
  it("issues opaque credentials and rejects them after expiry", async () => {
    let currentTime = new Date("2026-09-02T12:00:00Z");
    const provider = new DevelopmentAuthProvider(60_000, () => currentTime);
    const credential = provider.issueCredential({
      displayName: "Alex Example",
      email: "alex@example.com",
    });

    expect(credential.accessToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    await expect(
      provider.authenticate(credential.accessToken),
    ).resolves.toMatchObject({
      provider: "development",
      subject: "alex@example.com",
    });

    currentTime = new Date("2026-09-02T12:01:00Z");
    await expect(provider.authenticate(credential.accessToken)).resolves.toBe(
      null,
    );
  });

  it("revokes one credential without affecting another", async () => {
    const provider = new DevelopmentAuthProvider();
    const identity = {
      displayName: "Alex Example",
      email: "alex@example.com",
    };
    const first = provider.issueCredential(identity);
    const second = provider.issueCredential(identity);

    provider.revoke(first.accessToken);

    await expect(provider.authenticate(first.accessToken)).resolves.toBe(null);
    await expect(provider.authenticate(second.accessToken)).resolves.not.toBe(
      null,
    );
  });
});
