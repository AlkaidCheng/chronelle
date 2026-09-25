import { Buffer } from "node:buffer";

import type { AuthorizationDatabase } from "@livtales/authorization";
import { describe, expect, it, vi } from "vitest";

import { InvalidObjectStateError } from "../src/errors.js";
import {
  CanonicalObjectSearchService,
  type SearchReadPage,
} from "../src/search-service.js";

const workspaceId = "00000000-0000-7000-8000-000000000001";
const userId = "00000000-0000-7000-8000-000000000002";
const objectId = "00000000-0000-7000-8000-000000000003";
const principal = { type: "user" as const, userId, workspaceId };
const position = {
  id: objectId,
  rank: 0.06079271,
  updatedAt: "2030-01-02T00:00:00.000456Z",
};
const item = {
  id: objectId,
  objectType: "task" as const,
  displayName: "Plan",
  permissionScopeId: objectId,
  updatedAt: new Date("2030-01-02T00:00:00.000Z"),
  version: 1,
};

// The repository never sees the database when one is injected.
const database = {} as AuthorizationDatabase;

function decode(cursor: string) {
  return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
}

describe("CanonicalObjectSearchService with an injected repository", () => {
  it("decodes the cursor into the position and encodes the next position", async () => {
    const search = vi.fn<() => Promise<SearchReadPage>>();
    search.mockResolvedValueOnce({ items: [item], next: position });
    search.mockResolvedValueOnce({ items: [], next: null });
    const service = new CanonicalObjectSearchService(database, { search });

    const first = await service.search(principal, {
      query: " Plan ",
      objectType: "task",
      limit: 1,
    });
    expect(search).toHaveBeenLastCalledWith(principal, {
      after: undefined,
      limit: 1,
      objectType: "task",
      query: " Plan ",
    });
    expect(first.items).toEqual([item]);
    if (first.nextCursor === null) throw new Error("expected a cursor");
    expect(decode(first.nextCursor)).toEqual({
      formatVersion: 1,
      userId,
      workspaceId,
      query: "Plan",
      objectType: "task",
      ...position,
    });

    const rest = await service.search(principal, {
      query: "Plan",
      objectType: "task",
      limit: 1,
      cursor: first.nextCursor,
    });
    expect(search).toHaveBeenLastCalledWith(principal, {
      after: position,
      limit: 1,
      objectType: "task",
      query: "Plan",
    });
    expect(rest).toEqual({ items: [], nextCursor: null });
  });

  it("rejects a cursor for another query before reaching the repository", async () => {
    const search = vi.fn<() => Promise<SearchReadPage>>();
    search.mockResolvedValue({ items: [item], next: position });
    const service = new CanonicalObjectSearchService(database, { search });
    const first = await service.search(principal, { query: "Plan", limit: 1 });
    await expect(
      service.search(principal, {
        query: "Other",
        limit: 1,
        cursor: first.nextCursor ?? undefined,
      }),
    ).rejects.toBeInstanceOf(InvalidObjectStateError);
    expect(search).toHaveBeenCalledTimes(1);
  });
});
