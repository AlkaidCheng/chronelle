import { describe, expect, it } from "vitest";

import { createId } from "../src/ids.js";

describe("createId", () => {
  it("creates unique, naturally ordered UUIDv7 identifiers", () => {
    const identifiers = Array.from({ length: 64 }, createId);

    expect(new Set(identifiers).size).toBe(identifiers.length);
    expect([...identifiers].sort()).toEqual(identifiers);
    expect(identifiers).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
      ]),
    );
  });
});
