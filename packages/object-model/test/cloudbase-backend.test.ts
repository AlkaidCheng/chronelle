import { CloudBaseRpcError } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";

import {
  assertCloudBaseBackendReady,
  CloudBaseBackendNotReadyError,
  cloudBaseObjectModelFunctions,
} from "../src/cloudbase-backend.js";

describe("assertCloudBaseBackendReady", () => {
  it("passes when every required function is installed and the baseline holds", async () => {
    const rpc = vi.fn().mockResolvedValue({
      functions: [...cloudBaseObjectModelFunctions, "chronelle_uuidv7"],
      objectsWithoutBaseline: 0,
    });
    await expect(assertCloudBaseBackendReady({ rpc })).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("chronelle_backend_readiness", {});
  });

  it("names the missing functions", async () => {
    const rpc = vi.fn().mockResolvedValue({
      functions: cloudBaseObjectModelFunctions.filter(
        (name) => name !== "chronelle_command_execute",
      ),
      objectsWithoutBaseline: 0,
    });
    await expect(assertCloudBaseBackendReady({ rpc })).rejects.toThrow(
      new CloudBaseBackendNotReadyError(
        "The CloudBase environment lacks required functions: chronelle_command_execute.",
      ),
    );
  });

  it("refuses a missing revision baseline and an absent readiness function", async () => {
    await expect(
      assertCloudBaseBackendReady({
        rpc: vi.fn().mockResolvedValue({
          functions: cloudBaseObjectModelFunctions,
          objectsWithoutBaseline: 3,
        }),
      }),
    ).rejects.toThrow("Object revision baseline is missing");
    await expect(
      assertCloudBaseBackendReady({
        rpc: vi
          .fn()
          .mockRejectedValue(
            new CloudBaseRpcError(404, "PGRST202", "function not found"),
          ),
      }),
    ).rejects.toThrow("apply the migrations through 0029 first");
  });
});
