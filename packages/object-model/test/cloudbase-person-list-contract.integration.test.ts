import { resolve } from "node:path";
import {
  createId,
  labels,
  objects,
  personContacts,
  personLabels,
  persons,
  resourceGrants,
  users,
  workspaceMembers,
  workspaces,
} from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBasePersonReadRepository } from "../src/cloudbase-person-read-repository.js";
import { PostgresPersonReadRepository } from "../src/person-list.js";
import { snapshotClient } from "./cloudbase-read-double.js";

let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
});

afterAll(async () => {
  await database?.close();
});

describe("CloudBase person list contract", () => {
  it("lists the same people in the same order for members and grantees", async () => {
    const db = database.connection.db;
    const workspaceId = createId();
    const ownerId = createId();
    const granteeId = createId();
    const strangerId = createId();
    await db.insert(users).values(
      [ownerId, granteeId, strangerId].map((id) => ({
        id,
        identityProvider: "test",
        providerSubject: id,
        displayName: "Contract principal",
      })),
    );
    await db.insert(workspaces).values({
      id: workspaceId,
      createdBy: ownerId,
      displayName: "People contract",
    });
    await db.insert(workspaceMembers).values({
      workspaceId,
      userId: ownerId,
      role: "owner",
    });
    // Four people: two own their scope, one inherits the scope shared with
    // the grantee, one is deleted. Names sort without regard to case.
    const sharedScopeId = createId();
    const zoe = createId();
    const adam = createId();
    const bea = createId();
    const gone = createId();
    await db.insert(objects).values([
      {
        id: sharedScopeId,
        workspaceId,
        objectType: "event" as const,
        permissionScopeId: sharedScopeId,
        displayName: "Shared trip",
        createdBy: ownerId,
      },
      ...[
        { id: zoe, permissionScopeId: zoe, displayName: "Zoe" },
        { id: adam, permissionScopeId: adam, displayName: "adam" },
        { id: bea, permissionScopeId: sharedScopeId, displayName: "Bea" },
        {
          id: gone,
          permissionScopeId: gone,
          displayName: "Gone",
          deletedAt: new Date("2030-01-01T00:00:00Z"),
        },
      ].map((row) => ({
        ...row,
        workspaceId,
        objectType: "person" as const,
        createdBy: ownerId,
      })),
    ]);
    await db.insert(persons).values([
      {
        objectId: zoe,
        workspaceId,
        userId: ownerId,
        nickname: "Zo",
        description: "Plans the trips.",
      },
      { objectId: adam, workspaceId },
      { objectId: bea, workspaceId },
      { objectId: gone, workspaceId },
    ]);
    // Zoe's contacts come in kept order and her labels in name order.
    const familyId = createId();
    const workId = createId();
    await db.insert(labels).values([
      { id: workId, workspaceId, name: "Work", createdBy: ownerId },
      { id: familyId, workspaceId, name: "family", createdBy: ownerId },
    ]);
    await db.insert(personContacts).values([
      {
        id: createId(),
        workspaceId,
        personId: zoe,
        kind: "phone",
        value: "+1 555 0100",
        position: 1,
      },
      {
        id: createId(),
        workspaceId,
        personId: zoe,
        kind: "email",
        value: "zoe@example.test",
        position: 0,
      },
    ]);
    await db.insert(personLabels).values([
      { workspaceId, personId: zoe, labelId: workId },
      { workspaceId, personId: zoe, labelId: familyId },
    ]);
    await db.insert(resourceGrants).values({
      id: createId(),
      workspaceId,
      resourceId: sharedScopeId,
      principalId: granteeId,
      role: "viewer",
      grantedBy: ownerId,
    });
    const clock = () => new Date("2030-01-01T00:00:00.000Z");
    const postgres = new PostgresPersonReadRepository(db);
    const cloudbase = new CloudBasePersonReadRepository(
      await snapshotClient(db),
      clock,
    );
    const ids = (page: {
      readonly items: readonly { readonly id: string }[];
    }) => page.items.map(({ id }) => id);

    const owner = { type: "user" as const, userId: ownerId, workspaceId };
    const grantee = { type: "user" as const, userId: granteeId, workspaceId };
    const stranger = { type: "user" as const, userId: strangerId, workspaceId };
    for (const [principal, expected] of [
      [owner, [adam, bea, zoe]],
      [grantee, [bea]],
      [stranger, []],
    ] as const) {
      const page = await postgres.listPersons(principal);
      expect(ids(page)).toEqual(expected);
      const cloudbasePage = await cloudbase.listPersons(principal);
      expect(cloudbasePage).toEqual(page);
    }
    const zoeOnly = await postgres.listPersons(owner, { query: "ZO" });
    expect(ids(zoeOnly)).toEqual([zoe]);
    expect(zoeOnly.items[0]).toMatchObject({
      userId: ownerId,
      nickname: "Zo",
      description: "Plans the trips.",
      contacts: [
        { kind: "email", value: "zoe@example.test" },
        { kind: "phone", value: "+1 555 0100" },
      ],
      labelIds: [familyId, workId],
    });
    expect(await cloudbase.listPersons(owner, { query: "ZO" })).toEqual(
      zoeOnly,
    );
    expect(ids(await postgres.listPersons(owner, { limit: 2 }))).toEqual([
      adam,
      bea,
    ]);
    expect(ids(await cloudbase.listPersons(owner, { limit: 2 }))).toEqual([
      adam,
      bea,
    ]);
  });
});
