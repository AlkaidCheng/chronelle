import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { TaroRequest } from "../src/api/taro-transport";

const signInResponse = {
  accessToken: "password-session",
  tokenType: "Bearer",
  expiresAt: "2030-01-15T00:00:00.000Z",
  user: {
    id: "a4a2bd1c-6f2e-4b40-9d38-0f6c9d1f8a11",
    displayName: "Planner",
    email: "planner@example.test",
    username: "planner",
  },
  workspace: {
    id: "5b0c6f0e-2d4e-4c0a-8b8e-7f1f7b7b2c22",
    displayName: "Personal",
  },
};

/**
 * A Function constructor like the WeChat runtime's: an empty body is
 * accepted, but source code cannot be compiled.
 */
function FunctionWithoutCompilation(...source: string[]): () => undefined {
  if (source.some((part) => part.length > 0)) {
    throw new TypeError("Function compilation is unavailable.");
  }
  return () => undefined;
}

describe("Mini Program schema validation", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("validates API responses where functions cannot be compiled", async () => {
    vi.stubGlobal("Function", FunctionWithoutCompilation);
    await import("../src/runtime/validation");
    const { createWeChatApiClient } = await import("../src/api/client");
    const request: TaroRequest = () =>
      Object.assign(
        Promise.resolve({
          data: JSON.stringify(signInResponse),
          statusCode: 200,
        }),
        { abort: () => undefined },
      );
    const client = createWeChatApiClient({
      baseUrl: "https://api.example.test",
      request,
    });

    await expect(
      client.signInWithPassword({
        login: "planner",
        password: "sample-password",
      }),
    ).resolves.toMatchObject({ accessToken: "password-session" });
  });

  it("configures validation before the app entry imports anything else", () => {
    const source = readFileSync(
      new URL("../src/app.tsx", import.meta.url),
      "utf8",
    );

    expect(source.match(/^import\s[^;]*;/mu)?.[0]).toBe(
      'import "./runtime/validation";',
    );
  });
});
