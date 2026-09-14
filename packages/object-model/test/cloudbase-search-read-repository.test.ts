import { AuthorizationDeniedError } from "@chronelle/authorization";
import { CloudBaseRpcError } from "@chronelle/db";
import { describe, expect, it, vi } from "vitest";

import { CloudBaseSearchReadRepository } from "../src/cloudbase-search-read-repository.js";
import { InvalidObjectStateError } from "../src/errors.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
const userId = "00000000-0000-7000-8000-000000000002";
const firstId = "00000000-0000-7000-8000-000000000003";
const secondId = "00000000-0000-7000-8000-000000000004";
const principal = { type: "user" as const, userId, workspaceId };

const page = {
  items: [
    {
      id: firstId,
      objectType: "task",
      displayName: "Plan plan plan",
      permissionScopeId: firstId,
      updatedAt: "2030-01-01T00:00:00.123Z",
      version: 3,
    },
    {
      id: secondId,
      objectType: "event",
      displayName: "Plan the trip",
      permissionScopeId: secondId,
      updatedAt: "2030-01-02T00:00:00.000Z",
      version: 1,
    },
  ],
  next: {
    id: secondId,
    rank: 0.06079271,
    updatedAt: "2030-01-02T00:00:00.000456Z",
  },
};

const principalArguments = { workspace_id: workspaceId, user_id: userId };

describe("CloudBaseSearchReadRepository", () => {
  it("passes the query, type, limit, and decoded position to the function", async () => {
    const rpc = vi.fn().mockResolvedValue(page);
    const result = await new CloudBaseSearchReadRepository({ rpc }).search(
      principal,
      {
        query: "Plan",
        objectType: "task",
        limit: 2,
        after: {
          id: firstId,
          rank: 0.5,
          updatedAt: "2030-01-01T00:00:00.000001Z",
        },
      },
    );
    expect(rpc).toHaveBeenCalledWith("chronelle_object_search", {
      ...principalArguments,
      query: "Plan",
      object_type: "task",
      page_limit: 2,
      after_rank: 0.5,
      after_updated_at: "2030-01-01T00:00:00.000001Z",
      after_id: firstId,
    });
    expect(result).toEqual({
      items: [
        {
          id: firstId,
          objectType: "task",
          displayName: "Plan plan plan",
          permissionScopeId: firstId,
          updatedAt: new Date("2030-01-01T00:00:00.123Z"),
          version: 3,
        },
        {
          id: secondId,
          objectType: "event",
          displayName: "Plan the trip",
          permissionScopeId: secondId,
          updatedAt: new Date("2030-01-02T00:00:00.000Z"),
          version: 1,
        },
      ],
      next: page.next,
    });
  });

  it("sends nulls for an absent type and first page, and keeps a zero rank", async () => {
    const rpc = vi.fn().mockResolvedValue({ items: [], next: null });
    const repository = new CloudBaseSearchReadRepository({ rpc });
    const first = await repository.search(principal, {
      query: "Plan",
      limit: 20,
    });
    expect(rpc).toHaveBeenLastCalledWith("chronelle_object_search", {
      ...principalArguments,
      query: "Plan",
      object_type: null,
      page_limit: 20,
      after_rank: null,
      after_updated_at: null,
      after_id: null,
    });
    expect(first).toEqual({ items: [], next: null });

    await repository.search(principal, {
      query: "Plan",
      limit: 20,
      after: { id: firstId, rank: 0, updatedAt: "2030-01-01T00:00:00.000000Z" },
    });
    expect(rpc.mock.calls[1]?.[1]).toMatchObject({ after_rank: 0 });
  });

  it.each([
    [
      "DATABASE_PT403",
      "The resource is unavailable.",
      AuthorizationDeniedError,
    ],
    [
      "DATABASE_PT422",
      "The search cursor is invalid for this query.",
      InvalidObjectStateError,
    ],
  ])("maps %s to the service error", async (code, message, expected) => {
    const repository = new CloudBaseSearchReadRepository({
      rpc: vi.fn().mockRejectedValue(new CloudBaseRpcError(400, code, message)),
    });
    const error = await repository
      .search(principal, { query: "Plan", limit: 20 })
      .then(() => {
        throw new Error("expected a rejection");
      })
      .catch((failure: Error) => failure);
    expect(error).toBeInstanceOf(expected);
    if (expected === InvalidObjectStateError)
      expect(error.message).toBe(message);
  });

  it("passes other failures through unchanged", async () => {
    const failure = new Error("gateway unreachable");
    const repository = new CloudBaseSearchReadRepository({
      rpc: vi.fn().mockRejectedValue(failure),
    });
    await expect(
      repository.search(principal, { query: "Plan", limit: 20 }),
    ).rejects.toBe(failure);
  });

  it.each([
    ["a non-object result", "[]"],
    ["a missing items list", { next: null }],
    [
      "an item with an unknown object type",
      { items: [{ ...page.items[0], objectType: "note" }], next: null },
    ],
    [
      "an item with a non-positive version",
      { items: [{ ...page.items[0], version: 0 }], next: null },
    ],
    [
      "an item whose updatedAt is not an instant",
      { items: [{ ...page.items[0], updatedAt: "2030-01-01" }], next: null },
    ],
    [
      "a position with a millisecond timestamp",
      {
        items: [],
        next: { ...page.next, updatedAt: "2030-01-02T00:00:00.000Z" },
      },
    ],
    [
      "a position with a negative rank",
      { items: [], next: { ...page.next, rank: -1 } },
    ],
    ["an undefined position", { items: [] }],
  ])("rejects %s", async (_label, result) => {
    const repository = new CloudBaseSearchReadRepository({
      rpc: vi.fn().mockResolvedValue(result),
    });
    await expect(
      repository.search(principal, { query: "Plan", limit: 20 }),
    ).rejects.toThrow("CloudBase returned an invalid search page.");
  });
});
