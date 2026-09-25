import type { Database } from "@livtales/db";
import { describe, expect, it, vi } from "vitest";

import type { UserPrincipal } from "../src/authorization.js";
import type { GrantReadRepository } from "../src/grant-reads.js";
import { ResourceGrantService } from "../src/grant-service.js";

describe("grant read repository boundary", () => {
  it("delegates grant listing without changing the service contract", async () => {
    const principal: UserPrincipal = {
      type: "user",
      userId: "00000000-0000-7000-8000-000000000001",
      workspaceId: "00000000-0000-7000-8000-000000000002",
    };
    const grants = [
      {
        id: "00000000-0000-7000-8000-000000000003",
        workspaceId: principal.workspaceId,
        resourceId: "00000000-0000-7000-8000-000000000004",
        role: "viewer" as const,
        grantedBy: principal.userId,
        createdAt: new Date("2030-01-01T00:00:00.000Z"),
        expiresAt: null,
        principal: {
          id: "00000000-0000-7000-8000-000000000005",
          displayName: "Reader",
          email: null,
        },
      },
    ];
    const listGrants = vi.fn().mockResolvedValue(grants);
    const repository: GrantReadRepository = { listGrants };
    const service = new ResourceGrantService(
      {} as Database,
      () => new Date("2030-01-01T00:00:00.000Z"),
      undefined,
      repository,
    );

    await expect(
      service.list(principal, grants[0]?.resourceId as string),
    ).resolves.toBe(grants);
    expect(listGrants).toHaveBeenCalledExactlyOnceWith(
      principal,
      grants[0]?.resourceId,
    );
  });
});
