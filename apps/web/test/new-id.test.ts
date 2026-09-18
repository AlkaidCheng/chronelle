import { afterEach, describe, expect, it, vi } from "vitest";
import { newId } from "../lib/new-id";

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

describe("newId", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses crypto.randomUUID where the context is secure", () => {
    expect(newId()).toMatch(uuid);
  });

  it("draws a version 4 id from getRandomValues where randomUUID is absent", () => {
    vi.spyOn(crypto, "randomUUID").mockImplementation(
      undefined as unknown as typeof crypto.randomUUID,
    );
    Object.defineProperty(crypto, "randomUUID", {
      configurable: true,
      value: undefined,
    });
    const ids = new Set(Array.from({ length: 50 }, () => newId()));
    for (const id of ids) expect(id).toMatch(uuid);
    expect(ids.size).toBe(50);
  });
});
