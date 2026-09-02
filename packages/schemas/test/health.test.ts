import { describe, expect, it } from "vitest";

import { healthStatusSchema } from "../src/index.js";

describe("healthStatusSchema", () => {
  it("accepts a valid API health response", () => {
    const healthStatus = {
      service: "chronelle-api",
      status: "ok",
      timestamp: "2026-09-01T12:00:00.000Z",
    };

    expect(healthStatusSchema.parse(healthStatus)).toEqual(healthStatus);
  });

  it("rejects a response without an ISO timestamp", () => {
    const parseResult = healthStatusSchema.safeParse({
      service: "chronelle-api",
      status: "ok",
      timestamp: "today",
    });

    expect(parseResult.success).toBe(false);
  });
});
