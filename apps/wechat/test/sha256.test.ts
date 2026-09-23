import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { sha256Hex } from "../src/files/sha256";

describe("native file checksum", () => {
  it.each([0, 1, 55, 56, 63, 64, 65, 4097, 9 * 1024 * 1024])(
    "matches SHA-256 for %i bytes",
    (length) => {
      const bytes = Uint8Array.from(
        { length },
        (_, index) => (index * 37 + 11) % 256,
      );
      expect(sha256Hex(bytes.buffer)).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
    },
  );
});
