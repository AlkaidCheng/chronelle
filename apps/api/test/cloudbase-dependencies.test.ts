import type { UserPrincipal } from "@chronelle/authorization";
import type { CloudBaseRdbClient, DatabaseConnection } from "@chronelle/db";
import { describe, expect, it, vi } from "vitest";

import {
  createAppDependencies,
  type AppDependencies,
} from "../src/dependencies.js";

const principal: UserPrincipal = {
  type: "user",
  userId: "00000000-0000-7000-8000-000000000001",
  workspaceId: "00000000-0000-7000-8000-000000000002",
};
const objectId = "00000000-0000-7000-8000-000000000003";

class GatewayTouched extends Error {
  constructor(readonly table: string) {
    super(`gateway select on ${table}`);
    this.name = "GatewayTouched";
  }
}

/** A transport double whose first select or rpc call fails loudly, which proves the read left PostgreSQL. */
function gateway(): CloudBaseRdbClient {
  return {
    capabilities: {
      transactions: false,
      nativeTcp: false,
      serverFunctions: true,
    },
    select: vi.fn(async (table: string) => {
      throw new GatewayTouched(table);
    }),
    rpc: vi.fn(async (functionName: string) => {
      throw new GatewayTouched(functionName);
    }),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
}

const connection = {
  db: {},
  sql: {},
  close: async () => {},
} as unknown as DatabaseConnection;

const reads: Record<
  string,
  (dependencies: AppDependencies) => Promise<unknown>
> = {
  "GET /api/objects/:id": (dependencies) =>
    dependencies.objects.getObject(principal, objectId),
  "GET /api/objects/:id/access": (dependencies) =>
    dependencies.objects.getAllowedActions(principal, objectId),
  "GET /api/objects/:id/relations": (dependencies) =>
    dependencies.relations.listForObject(principal, objectId),
  "GET /api/objects/:id/removed-relations": (dependencies) =>
    dependencies.relations.listRemoved(principal, objectId, { limit: 20 }),
  "GET /api/objects/:id/shares": (dependencies) =>
    dependencies.shares.list(principal, objectId),
  "GET /api/objects/:id/revisions": (dependencies) =>
    dependencies.revisions.list(principal, objectId, { limit: 25 }),
  "GET /api/objects/:id/revisions/:version": (dependencies) =>
    dependencies.revisions.get(principal, objectId, 1),
  "GET /api/trash": (dependencies) => dependencies.recovery.list(principal),
  "GET /api/objects/:id/recovery-preview": (dependencies) =>
    dependencies.recovery.preview(principal, objectId),
  "GET /api/commands": (dependencies) =>
    dependencies.commands.getState(principal),
  "GET /api/objects/:id/revisions/compare": (dependencies) =>
    dependencies.restoration.compare(principal, objectId, {
      fromVersion: 1,
      toVersion: 2,
    }),
  "GET /api/objects/:id/revisions/:version/restore-preview": (dependencies) =>
    dependencies.restoration.preview(principal, objectId, 1),
  "GET /api/workspace/storage-inventory": (dependencies) =>
    dependencies.storageInventory.get(principal),
  "GET /api/objects/:id/documents": (dependencies) =>
    dependencies.documents.listAttachments(principal, objectId),
  "GET /api/events/:id/layout": (dependencies) =>
    dependencies.eventLayouts.get(principal, objectId),
  "GET /api/events/:id/layout/history": (dependencies) =>
    dependencies.eventLayouts.history(principal, objectId, { limit: 10 }),
  "GET /api/workspaces (identity)": (dependencies) =>
    dependencies.identity.listAccessibleWorkspaces(
      principal.userId,
      principal.workspaceId,
    ),
  "Bearer credential (session resolve)": (dependencies) =>
    dependencies.sessions.authenticate("token"),
  "DELETE /api/auth/session": (dependencies) =>
    dependencies.sessions.revoke(
      "token",
      "00000000-0000-7000-8000-000000000005",
    ),
  "POST /api/auth/sign-in (credential lookup)": (dependencies) =>
    dependencies.passwordAuth.signIn(
      { email: "person@example.test", password: "correct horse battery" },
      "00000000-0000-7000-8000-000000000006",
    ),
};

describe("CloudBase read wiring", () => {
  it.each(Object.entries(reads))(
    "serves %s from the gateway when a CloudBase client is configured",
    async (_route, read) => {
      const dependencies = createAppDependencies(
        connection,
        { authenticate: async () => null },
        { cloudBaseRdb: gateway() },
      );
      await expect(read(dependencies)).rejects.toBeInstanceOf(GatewayTouched);
    },
  );

  it("keeps every mutation on PostgreSQL even with a CloudBase client", async () => {
    const client = gateway();
    const dependencies = createAppDependencies(
      connection,
      { authenticate: async () => null },
      { cloudBaseRdb: client },
    );
    // The stub connection has no transaction method, so a PostgreSQL write fails on it, not on the gateway.
    await expect(
      dependencies.recovery.recover(
        { principal, requestId: "00000000-0000-7000-8000-000000000004" },
        objectId,
        { expectedVersion: 1 },
      ),
    ).rejects.not.toBeInstanceOf(GatewayTouched);
    expect(client.select).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
