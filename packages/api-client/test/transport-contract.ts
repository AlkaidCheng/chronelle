import { describe, expect, it } from "vitest";

import {
  type HttpMethod,
  type JsonTransport,
  TransportError,
} from "../src/index.js";

export interface TransportContractCall {
  abortCount: number;
  readonly body: string | undefined;
  readonly headers: Readonly<Record<string, string>>;
  readonly method: HttpMethod;
  readonly timeoutMs: number;
  readonly url: string;
}

export interface TransportContractHarness {
  readonly calls: TransportContractCall[];
  readonly transport: JsonTransport;
}

export type TransportContractFactory = () => TransportContractHarness;

function input(
  path: string,
  options: {
    readonly signals?: readonly AbortSignal[];
    readonly timeoutMs?: number;
  } = {},
) {
  return {
    body: '{"name":"Chronelle"}',
    headers: {
      authorization: "Bearer opaque-session",
      "content-type": "application/json",
    },
    method: "POST" as const,
    signals: options.signals ?? [],
    timeoutMs: options.timeoutMs ?? 100,
    url: `https://api.example.test/${path}`,
  };
}

export function runJsonTransportContract(
  adapterName: string,
  createHarness: TransportContractFactory,
): void {
  describe(`${adapterName} JSON transport contract`, () => {
    it("forwards the request and returns parsed JSON without browser response types", async () => {
      const harness = createHarness();

      await expect(
        harness.transport.request(input("success")),
      ).resolves.toEqual({
        payload: { readable: true, value: { accepted: true } },
        status: 201,
      });
      expect(harness.calls).toEqual([
        {
          abortCount: 0,
          body: '{"name":"Chronelle"}',
          headers: {
            authorization: "Bearer opaque-session",
            "content-type": "application/json",
          },
          method: "POST",
          timeoutMs: 100,
          url: "https://api.example.test/success",
        },
      ]);
    });

    it("reports an unreadable JSON response without hiding its status", async () => {
      const harness = createHarness();

      await expect(
        harness.transport.request(input("invalid")),
      ).resolves.toEqual({
        payload: { readable: false },
        status: 502,
      });
    });

    it("classifies network failure and caller cancellation", async () => {
      const harness = createHarness();
      await expect(harness.transport.request(input("network"))).rejects.toEqual(
        expect.objectContaining<Partial<TransportError>>({ kind: "network" }),
      );

      const controller = new AbortController();
      const pending = harness.transport.request(
        input("wait", { signals: [controller.signal] }),
      );
      await Promise.resolve();
      controller.abort();
      await expect(pending).rejects.toEqual(
        expect.objectContaining<Partial<TransportError>>({
          kind: "aborted",
          name: "AbortError",
        }),
      );
      expect(harness.calls.at(-1)?.abortCount).toBe(1);
    });

    it("aborts and classifies requests that exceed their deadline", async () => {
      const harness = createHarness();
      await expect(
        harness.transport.request(input("wait", { timeoutMs: 5 })),
      ).rejects.toEqual(
        expect.objectContaining<Partial<TransportError>>({ kind: "timeout" }),
      );
      expect(harness.calls.at(-1)?.abortCount).toBe(1);
    });
  });
}
