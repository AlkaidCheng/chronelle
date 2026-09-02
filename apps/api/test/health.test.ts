import { afterEach, describe, expect, it } from "vitest";

import { healthStatusSchema } from "@chronelle/schemas";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../src/app.js";

const apps: FastifyInstance[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe("GET /api/health", () => {
  it("returns the typed service status", async () => {
    const app = buildApp();
    apps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/health",
    });

    expect(response.statusCode).toBe(200);
    expect(healthStatusSchema.parse(response.json())).toMatchObject({
      service: "chronelle-api",
      status: "ok",
    });
  });
});
