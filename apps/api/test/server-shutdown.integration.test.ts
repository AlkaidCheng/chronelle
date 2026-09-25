import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@livtales/db/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

// The entry point is exercised as a process because the behavior under test
// is whether the process ends. The CloudBase client is constructed with an
// opaque key so no gateway request is made; only its lingering timer matters.
const entryPoint = resolve(import.meta.dirname, "../src/server.ts");
const cloudBaseEnvironment = {
  CLOUDBASE_READS_ENABLED: "true",
  CLOUDBASE_ENV_ID: "shutdown-test",
  CLOUDBASE_APIKEY: "opaque-shutdown-key",
  ENABLE_DEVELOPMENT_AUTH: "true",
  LOCAL_STORAGE_ROOT: mkdtempSync(join(tmpdir(), "livtales-shutdown-")),
};

function randomPort(): string {
  return String(30_000 + Math.floor(Math.random() * 20_000));
}

let database: TestDatabase;
const processes: ChildProcess[] = [];

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
});

afterAll(async () => {
  await database?.close();
});

afterEach(() => {
  for (const child of processes.splice(0)) child.kill("SIGKILL");
});

function startServer(environment: Record<string, string>) {
  const child = spawn(process.execPath, ["--import", "tsx", entryPoint], {
    cwd: resolve(import.meta.dirname, ".."),
    env: { ...process.env, ...cloudBaseEnvironment, ...environment },
    stdio: ["ignore", "pipe", "pipe"],
  });
  processes.push(child);
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const exited = new Promise<number | null>((resolveExit) => {
    child.once("exit", (code) => resolveExit(code));
  });
  const listening = new Promise<number>((resolveListening, reject) => {
    child.stdout?.on("data", () => {
      const match = /Server listening at http:\/\/127\.0\.0\.1:(\d+)/u.exec(
        output,
      );
      if (match) resolveListening(Number(match[1]));
    });
    child.once("exit", () => reject(new Error(`exited early:\n${output}`)));
  });
  // A test that expects an early exit never awaits `listening`.
  listening.catch(() => undefined);
  return { child, exited, listening, output: () => output };
}

describe("API process shutdown with the CloudBase read client", () => {
  it("ends the process after a failed startup", async () => {
    const server = startServer({
      DATABASE_URL: "postgresql://nobody:nobody@127.0.0.1:1/unreachable",
      API_PORT: randomPort(),
    });
    const code = await Promise.race([
      server.exited,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("process did not exit")), 20_000),
      ),
    ]);
    expect(code).toBe(1);
    expect(server.output()).toContain("startup_failed");
  }, 30_000);

  it("refuses to serve from the gateway until the readiness function answers", async () => {
    // No DATABASE_URL: the CloudBase backend must not need one, and the
    // readiness call to an unreachable gateway ends the startup instead.
    const server = startServer({
      LIVTALES_BACKEND: "cloudbase",
      CLOUDBASE_REQUEST_TIMEOUT_MS: "2000",
      API_PORT: randomPort(),
    });
    const code = await Promise.race([
      server.exited,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("process did not exit")), 20_000),
      ),
    ]);
    expect(code).toBe(1);
    expect(server.output()).toContain("startup_failed");
    expect(server.output()).toContain(
      "chronelle_backend_readiness is not callable",
    );
    expect(server.output()).not.toContain("DATABASE_URL");
  }, 30_000);

  it("ends the process after SIGTERM closes a running server", async () => {
    const server = startServer({
      DATABASE_URL: database.databaseUrl,
      API_HOST: "127.0.0.1",
      API_PORT: randomPort(),
    });
    await server.listening;
    server.child.kill("SIGTERM");
    const code = await Promise.race([
      server.exited,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("process did not exit")), 20_000),
      ),
    ]);
    expect(code).toBe(0);
  }, 40_000);
});
