import type { Role } from "@livtales/db";
import { sql } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import type {
  AuthorizationStore,
  ResourceRolesQuery,
} from "../src/authorization.js";
import { ReadSnapshotAuthorizationStore } from "../src/read-snapshot-authorization-store.js";

const evaluatedAt = new Date("2030-01-01T00:00:00.000Z");
const query = (resourceIds: readonly string[]): ResourceRolesQuery => ({
  evaluatedAt,
  resourceIds,
  userId: "user-1",
  workspaceId: "workspace-1",
});

function store(
  findResourceRoles: AuthorizationStore["findResourceRoles"],
): AuthorizationStore {
  return {
    findGrantNarrowing: vi.fn(),
    findRecoverableResourceIds: vi.fn(),
    findResourceRoles,
    findWorkspaceRole: vi.fn(),
    hasWorkspaceAccess: vi.fn(),
    listAccessibleWorkspaceIds: vi.fn(),
    memberPredicate: vi.fn(() => sql`true`),
    resourcePredicate: vi.fn(() => sql`true`),
    sharedPredicate: vi.fn(() => sql`true`),
  };
}

describe("ReadSnapshotAuthorizationStore", () => {
  it("reuses resolved and absent roles while fetching only new resources", async () => {
    const findResourceRoles = vi.fn(
      async ({ resourceIds }: ResourceRolesQuery) =>
        new Map(
          resourceIds.flatMap((id) =>
            id === "missing" ? [] : [[id, ["viewer"] as const]],
          ),
        ),
    );
    const cached = new ReadSnapshotAuthorizationStore(store(findResourceRoles));

    await expect(
      cached.findResourceRoles(query(["first", "missing"])),
    ).resolves.toEqual(new Map([["first", ["viewer"]]]));
    await expect(
      cached.findResourceRoles(query(["missing", "second", "first"])),
    ).resolves.toEqual(
      new Map([
        ["second", ["viewer"]],
        ["first", ["viewer"]],
      ]),
    );
    expect(findResourceRoles).toHaveBeenCalledTimes(2);
    expect(
      findResourceRoles.mock.calls.map(([input]) => input.resourceIds),
    ).toEqual([["first", "missing"], ["second"]]);
  });

  it("shares concurrent reads for the same resource", async () => {
    const pending =
      Promise.withResolvers<ReadonlyMap<string, readonly Role[]>>();
    const findResourceRoles = vi.fn(() => pending.promise);
    const cached = new ReadSnapshotAuthorizationStore(store(findResourceRoles));

    const first = cached.findResourceRoles(query(["resource"]));
    const second = cached.findResourceRoles(query(["resource"]));
    expect(findResourceRoles).toHaveBeenCalledTimes(1);
    pending.resolve(new Map([["resource", ["editor"]]]));

    await expect(first).resolves.toEqual(new Map([["resource", ["editor"]]]));
    await expect(second).resolves.toEqual(new Map([["resource", ["editor"]]]));
  });

  it("partitions entries by principal, workspace, and evaluation instant", async () => {
    const findResourceRoles = vi
      .fn<AuthorizationStore["findResourceRoles"]>()
      .mockResolvedValue(new Map([["resource", ["viewer"]]]));
    const cached = new ReadSnapshotAuthorizationStore(store(findResourceRoles));
    const base = query(["resource"]);

    await cached.findResourceRoles(base);
    await cached.findResourceRoles({ ...base, userId: "user-2" });
    await cached.findResourceRoles({ ...base, workspaceId: "workspace-2" });
    await cached.findResourceRoles({
      ...base,
      evaluatedAt: new Date(evaluatedAt.getTime() + 1),
    });

    expect(findResourceRoles).toHaveBeenCalledTimes(4);
  });

  it("evicts a failed read so the next decision retries storage", async () => {
    const failure = new Error("policy storage unavailable");
    const findResourceRoles = vi
      .fn<AuthorizationStore["findResourceRoles"]>()
      .mockRejectedValueOnce(failure)
      .mockResolvedValueOnce(new Map([["resource", ["owner"]]]));
    const cached = new ReadSnapshotAuthorizationStore(store(findResourceRoles));

    await expect(cached.findResourceRoles(query(["resource"]))).rejects.toBe(
      failure,
    );
    await expect(
      cached.findResourceRoles(query(["resource"])),
    ).resolves.toEqual(new Map([["resource", ["owner"]]]));
    expect(findResourceRoles).toHaveBeenCalledTimes(2);
  });
});
