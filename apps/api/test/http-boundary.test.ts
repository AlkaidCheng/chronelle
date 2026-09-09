import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConnection } from "node:net";
import type { FastifyInstance } from "fastify";
import { connectDatabase } from "@chronelle/db";
import { DocumentTransferUnavailableError } from "@chronelle/object-model";

import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

let app: FastifyInstance;
let logs: string[];
let dependencies: ReturnType<typeof createDevelopmentAppDependencies>;
const privateValue = "synthetic-private-content";
const token = "synthetic-transfer-credential-123456789";

beforeEach(() => {
  logs = [];
  const database = connectDatabase(
    "postgresql://chronelle:chronelle_dev@localhost:5432/unused",
  );
  dependencies = createDevelopmentAppDependencies(database);
  vi.spyOn(dependencies.documents, "consumeDownload").mockRejectedValue(
    new DocumentTransferUnavailableError(),
  );
  app = buildApp(dependencies, {
    logger: { level: "trace", stream: { write: (line) => logs.push(line) } },
  });
  app.addHook("onClose", async () => database.close());
  app.post("/api/probe", async () => ({ ok: true }));
  app.get("/api/failure", async () => {
    throw Object.assign(new Error(privateValue), {
      statusCode: 400,
      code: privateValue,
      cause: new Error(privateValue),
      details: { authorization: privateValue },
    });
  });
});

afterEach(async () => {
  await app.close();
  vi.restoreAllMocks();
});

describe("HTTP privacy and error boundary", () => {
  it.each([
    ["invalid header", `bad header ${privateValue}`, 400],
    ["header overflow", `X-Large: ${"x".repeat(32_768)}${privateValue}`, 431],
  ] as const)(
    "rejects %s over a real socket without logging raw packets",
    async (_name, header, status) => {
      await app.listen({ host: "localhost", port: 0 });
      const address = app.server.address();
      if (address === null || typeof address === "string")
        throw new Error("TCP listener unavailable");
      const response = await new Promise<string>((resolve, reject) => {
        const socket = createConnection({
          host: address.address,
          port: address.port,
        });
        let received = "";
        socket.setTimeout(2_000, () =>
          socket.destroy(new Error("HTTP error response did not close")),
        );
        socket.on("connect", () =>
          socket.write(
            `GET /api/health?q=${privateValue} HTTP/1.1\r\nHost: localhost\r\n${header}\r\n\r\n`,
          ),
        );
        socket.on("data", (chunk) => {
          received += chunk.toString();
        });
        socket.on("end", () => {
          socket.destroy();
          resolve(received);
        });
        socket.on("error", reject);
      });
      expect(response).toContain(`HTTP/1.1 ${status}`);
      expect(response).toContain("Cache-Control: private, no-store");
      expect(response + logs.join("")).not.toContain(privateValue);
    },
  );

  it("keeps successful download content and filename out of logs", async () => {
    vi.mocked(dependencies.documents.consumeDownload).mockResolvedValue({
      bytes: new TextEncoder().encode(privateValue),
      mimeType: "application/octet-stream",
      originalFilename: `${privateValue}.bin`,
    });
    const response = await app.inject({
      url: `/api/document-transfers/download/${token}`,
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe(privateValue);
    expect(response.headers["content-disposition"]).toContain(privateValue);
    expect(logs.join("")).not.toContain(privateValue);
    expect(logs.join("")).not.toContain(token);
  });

  it("overrides a route's public cache policy at the API boundary", async () => {
    app.get("/api/cache-probe", (_request, reply) =>
      reply
        .header("cache-control", "public, max-age=3600")
        .send({ private: true }),
    );
    const response = await app.inject({ url: "/api/cache-probe" });
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
  it.each([
    ["malformed JSON", "application/json", '{"secret":', {}, 400],
    ["empty JSON", "application/json", "", {}, 400],
    ["prototype property", "application/json", '{"__proto__":{}}', {}, 400],
    ["unsupported media", "application/xml", privateValue, {}, 415],
    [
      "incorrect length",
      "application/json",
      "{}",
      { "content-length": "1" },
      400,
    ],
    [
      "oversized JSON",
      "application/json",
      " ".repeat(1024 * 1024 + 1),
      {},
      413,
    ],
  ] as const)(
    "maps %s to a safe client error",
    async (_name, contentType, payload, headers, status) => {
      const response = await app.inject({
        method: "POST",
        url: "/api/probe",
        payload,
        headers: { ...headers, "content-type": contentType },
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({
        error: { code: expect.any(String), message: expect.any(String) },
      });
      expect(response.headers["cache-control"]).toBe("private, no-store");
      expect(logs.join("")).not.toContain(privateValue);
    },
  );

  it("logs stable request metadata without transfer tokens, headers, or query values", async () => {
    const response = await app.inject({
      method: "GET",
      url: `/api/document-transfers/download/${token}?q=${privateValue}`,
      headers: {
        authorization: `Bearer ${privateValue}`,
        cookie: privateValue,
        "x-request-id": privateValue,
      },
    });
    expect(response.statusCode).toBe(404);
    const output = logs.join("");
    expect(output).not.toContain(token);
    expect(output).not.toContain(privateValue);
    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(logs.map((line) => JSON.parse(line))).toContainEqual(
      expect.objectContaining({
        reqId: response.headers["x-request-id"],
        method: "GET",
        route: "/api/document-transfers/download/:token",
        statusCode: 404,
        responseTime: expect.any(Number),
      }),
    );
  });

  it("does not reflect unknown URLs in error bodies or logs", async () => {
    const response = await app.inject({
      url: `/api/missing/${token}?q=${privateValue}`,
    });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: {
        code: "resource_unavailable",
        message: "The requested resource is unavailable.",
      },
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body + logs.join("")).not.toContain(token);
    expect(response.body + logs.join("")).not.toContain(privateValue);
  });

  it("handles malformed URL components without exposing the requested path", async () => {
    const response = await app.inject({
      url: `/api/events/%ZZ${privateValue}`,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: { code: "invalid_request", message: "The request is invalid." },
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.body + logs.join("")).not.toContain(privateValue);
  });

  it("keeps unknown exceptions internal even when they carry a status code", async () => {
    const response = await app.inject({ url: "/api/failure" });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toEqual({
      error: {
        code: "internal_error",
        message: "The request could not be completed.",
      },
    });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(logs.join("")).not.toContain(privateValue);
  });

  it("prevents private caching for successful responses and authentication failures", async () => {
    const health = await app.inject({ url: "/api/health" });
    const unauthenticated = await app.inject({ url: "/api/events" });
    expect(health.statusCode).toBe(200);
    expect(unauthenticated.statusCode).toBe(401);
    for (const response of [health, unauthenticated]) {
      expect(response.headers["cache-control"]).toBe("private, no-store");
    }
  });
});
