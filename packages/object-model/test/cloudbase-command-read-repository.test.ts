import { CloudBaseRpcError } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";

import { CloudBaseCommandReadRepository } from "../src/cloudbase-command-read-repository.js";
import { CommandStackConflictError } from "../src/errors.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
const userId = "00000000-0000-7000-8000-000000000005";
const commandId = "00000000-0000-7000-8000-000000000010";
const principal = { type: "user" as const, userId, workspaceId };

describe("CloudBaseCommandReadRepository", () => {
  it("reads the state through the function and parses it", async () => {
    const state = {
      version: 3,
      undo: { commandId, available: false },
      redo: null,
    };
    const rpc = vi.fn().mockResolvedValue(state);
    const repository = new CloudBaseCommandReadRepository({ rpc });

    await expect(repository.getState(principal)).resolves.toEqual(state);
    expect(rpc).toHaveBeenCalledWith("chronelle_command_state", {
      workspace_id: workspaceId,
      user_id: userId,
    });
  });

  it("rejects a malformed state", async () => {
    const repository = new CloudBaseCommandReadRepository({
      rpc: vi.fn().mockResolvedValue({ version: 1, undo: { commandId } }),
    });
    await expect(repository.getState(principal)).rejects.toThrow();
  });

  it("maps the stack conflict by the service's message", async () => {
    const repository = new CloudBaseCommandReadRepository({
      rpc: vi
        .fn()
        .mockRejectedValue(
          new CloudBaseRpcError(
            409,
            "DATABASE_PT409",
            new CommandStackConflictError().message,
          ),
        ),
    });
    await expect(repository.getState(principal)).rejects.toThrow(
      CommandStackConflictError,
    );
  });
});
