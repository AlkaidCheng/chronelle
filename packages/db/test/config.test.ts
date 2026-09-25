import { describe, expect, it } from "vitest";

import { assertRenamedVariable } from "../src/config.js";

const check = (environment: Record<string, string>) => () =>
  assertRenamedVariable(environment, "LIVTALES_SETTING", "CHRONELLE_SETTING");

describe("assertRenamedVariable", () => {
  it("accepts the new name alone, neither name, or both with one value", () => {
    expect(check({})).not.toThrow();
    expect(check({ LIVTALES_SETTING: "a" })).not.toThrow();
    expect(
      check({ LIVTALES_SETTING: "a", CHRONELLE_SETTING: "a" }),
    ).not.toThrow();
  });

  it("names the replacement when only the legacy name is set", () => {
    expect(check({ CHRONELLE_SETTING: "a" })).toThrow(
      "CHRONELLE_SETTING was renamed to LIVTALES_SETTING. Set LIVTALES_SETTING instead.",
    );
    expect(check({ CHRONELLE_SETTING: "" })).toThrow(
      "Set LIVTALES_SETTING instead.",
    );
  });

  it("refuses both names set to different values", () => {
    const run = check({ LIVTALES_SETTING: "a", CHRONELLE_SETTING: "b" });
    expect(run).toThrow(
      "CHRONELLE_SETTING was renamed to LIVTALES_SETTING, and the two are set to different values. Remove CHRONELLE_SETTING.",
    );
  });
});
