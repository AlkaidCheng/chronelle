import type { CloudBaseRdbClient } from "@livtales/db";
import { describe, expect, it } from "vitest";

import {
  cloudBaseBenchmarkClient,
  distribution,
} from "../src/cloudbase-benchmark.js";

describe("CloudBase benchmark metrics", () => {
  it("reports nearest-rank percentiles without mutating samples", () => {
    const values = [9, 1, 5, 3, 7];

    expect(distribution(values)).toEqual({
      minimum: 1,
      median: 5,
      p95: 9,
      maximum: 9,
    });
    expect(values).toEqual([9, 1, 5, 3, 7]);
  });

  it("rejects an empty measurement set", () => {
    expect(() => distribution([])).toThrow("Cannot summarize no samples");
  });

  it("allows only the read RPCs used by the benchmark", async () => {
    const rpcCalls: string[] = [];
    const client = cloudBaseBenchmarkClient({
      capabilities: {
        transactions: false,
        nativeTcp: false,
        serverFunctions: true,
      },
      select: async () => [],
      rpc: async <T>(functionName: string) => {
        rpcCalls.push(functionName);
        return [] as T;
      },
      insert: async () => [],
      update: async () => [],
      delete: async () => [],
    } satisfies CloudBaseRdbClient);

    await expect(
      client.rpc("chronelle_task_list_hydrate", {}),
    ).resolves.toEqual([]);
    await expect(
      client.rpc("chronelle_person_list_hydrate", {}),
    ).resolves.toEqual([]);
    expect(() => client.rpc("chronelle_event_create", {})).toThrow(
      "cannot perform mutations",
    );
    expect(() => client.insert("objects", [])).toThrow(
      "cannot perform mutations",
    );
    expect(rpcCalls).toEqual([
      "chronelle_task_list_hydrate",
      "chronelle_person_list_hydrate",
    ]);
  });
});
