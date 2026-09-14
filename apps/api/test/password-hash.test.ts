import { describe, expect, it } from "vitest";

import {
  hashPassword,
  verifyPassword,
} from "../src/authentication/password-hash.js";

describe("password hashing", () => {
  it("encodes the parameters, salt, and key, and verifies the password", async () => {
    const encoded = await hashPassword("correct horse battery staple");

    expect(encoded).toMatch(
      /^scrypt\$32768\$8\$1\$[A-Za-z0-9_-]{22}\$[A-Za-z0-9_-]{43}$/,
    );
    await expect(
      verifyPassword("correct horse battery staple", encoded),
    ).resolves.toBe(true);
    await expect(
      verifyPassword("correct horse battery stapl", encoded),
    ).resolves.toBe(false);
  });

  it("salts each hash", async () => {
    const [first, second] = await Promise.all([
      hashPassword("same password"),
      hashPassword("same password"),
    ]);

    expect(first).not.toBe(second);
  });

  it("compares the NFKC form, so composed and decomposed input agree", async () => {
    const encoded = await hashPassword("café au lait 12");

    await expect(verifyPassword("café au lait 12", encoded)).resolves.toBe(
      true,
    );
  });

  it("rejects a malformed or truncated stored hash without throwing", async () => {
    await expect(verifyPassword("anything", "plain")).resolves.toBe(false);
    await expect(
      verifyPassword("anything", "scrypt$32768$8$1$abc$short"),
    ).resolves.toBe(false);
  });
});
