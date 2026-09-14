import { createHash } from "node:crypto";

import { AuthorizationDeniedError } from "@chronelle/authorization";
import {
  auditEvents,
  createId,
  documents,
  documentTransferAuthorizations,
  objectRevisions,
  objects,
  users,
  workspaceMembers,
} from "@chronelle/db";
import { StorageInventoryUnavailableError } from "@chronelle/storage";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseStorageInventoryReadRepository } from "../src/cloudbase-storage-inventory-read-repository.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import {
  PostgresStorageInventoryReadRepository,
  type StorageInventoryReadRepository,
} from "../src/storage-inventory-reads.js";
import { liveReader } from "./cloudbase-read-double.js";
import {
  createWriteHarness,
  failure,
  mutationContext,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// chronelle_storage_references must yield the classification the PostgreSQL
// read yields for one provider: live document keys, keys named only by
// document snapshots, and upload transfers with whether they can still
// finalize; and both must refuse non-Owners and oversized workspaces.

const provider = "local-filesystem";
const observedAt = new Date("2030-06-01T12:00:00.000Z");

let harness: WriteHarness;
let editorId: string;
let reference: StorageInventoryReadRepository;
let cloudbase: StorageInventoryReadRepository;
let keys: Record<string, string>;

const key = (workspaceId: string) =>
  `workspaces/${workspaceId}/documents/${createId()}`;

/** A document object with its creation revision, whose snapshot may name another key. */
async function document(
  displayName: string,
  storageProvider: string,
  storageKey: string,
  snapshotKey = storageKey,
  snapshotSchemaVersion = 1,
) {
  const db = harness.database.connection.db;
  const id = createId();
  const auditEventId = createId();
  const requestId = createId();
  await db.transaction(async (transaction) => {
    await transaction.insert(objects).values({
      id,
      workspaceId: harness.workspaceId,
      objectType: "document",
      displayName,
      createdBy: harness.ownerId,
      permissionScopeId: id,
    });
    await transaction.insert(documents).values({
      objectId: id,
      workspaceId: harness.workspaceId,
      storageProvider,
      storageKey,
      originalFilename: displayName,
      mimeType: "text/plain",
      sizeBytes: 12n,
      checksumSha256: "a".repeat(64),
    });
    await transaction.insert(auditEvents).values({
      id: auditEventId,
      workspaceId: harness.workspaceId,
      resourceId: id,
      actorType: "user",
      actorId: harness.ownerId,
      requestId,
      action: "document.created",
      metadata: {},
    });
    await transaction.insert(objectRevisions).values({
      id: createId(),
      workspaceId: harness.workspaceId,
      objectId: id,
      objectVersion: 1,
      mutationKind: "created",
      actorType: "user",
      actorId: harness.ownerId,
      requestId,
      auditEventId,
      snapshotSchemaVersion,
      snapshot: {
        id,
        workspaceId: harness.workspaceId,
        objectType: "document",
        version: 1,
        displayName,
        storageProvider,
        storageKey: snapshotKey,
      },
    });
  });
  return id;
}

/** An upload transfer for the parent Event, with its expiry and consumption. */
async function upload(
  parentId: string,
  storageKey: string,
  expiresAt: Date,
  consumedAt: Date | null,
) {
  await harness.database.connection.db
    .insert(documentTransferAuthorizations)
    .values({
      id: createId(),
      workspaceId: harness.workspaceId,
      operation: "upload",
      tokenHash: createHash("sha256").update(storageKey).digest("hex"),
      resourceId: parentId,
      storageProvider: provider,
      storageKey,
      originalFilename: "upload.txt",
      mimeType: "text/plain",
      sizeBytes: 3n,
      checksumSha256: "b".repeat(64),
      authorizedBy: harness.ownerId,
      expiresAt,
      consumedAt,
    });
}

beforeAll(async () => {
  harness = await createWriteHarness("Storage references");
  const db = harness.database.connection.db;
  editorId = createId();
  await db.insert(users).values({
    id: editorId,
    identityProvider: "test",
    providerSubject: editorId,
    displayName: "Editor",
  });
  await db.insert(workspaceMembers).values({
    workspaceId: harness.workspaceId,
    userId: editorId,
    role: "editor",
  });
  reference = new PostgresStorageInventoryReadRepository(db);
  cloudbase = new CloudBaseStorageInventoryReadRepository({
    ...liveReader(db),
    rpc: harness.rpc,
  });
  const workspaceId = harness.workspaceId;
  keys = {
    canonical: key(workspaceId),
    moved: key(workspaceId),
    previous: key(workspaceId),
    otherProvider: key(workspaceId),
    pending: key(workspaceId),
    expired: key(workspaceId),
    consumed: key(workspaceId),
  };
  await document("Plan.txt", provider, keys.canonical as string);
  await document(
    "Moved.txt",
    provider,
    keys.moved as string,
    keys.previous as string,
  );
  await document("Elsewhere.txt", "s3", keys.otherProvider as string);
  const parent = (
    await new EventPlanningObjectService(db).createEvent(
      mutationContext(harness),
      { displayName: "Uploads" },
    )
  ).id;
  await upload(
    parent,
    keys.pending as string,
    new Date("2030-06-02T00:00:00.000Z"),
    null,
  );
  await upload(
    parent,
    keys.expired as string,
    new Date("2030-05-01T00:00:00.000Z"),
    null,
  );
  await upload(
    parent,
    keys.consumed as string,
    new Date("2030-05-01T00:00:00.000Z"),
    new Date("2030-04-30T00:00:00.000Z"),
  );
});

afterAll(async () => {
  await harness?.database.close();
});

const principal = (userId?: string) =>
  mutationContext(harness, userId).principal;

const backends = () =>
  [
    ["postgres", reference],
    ["cloudbase", cloudbase],
  ] as const;

describe.sequential("CloudBase storage inventory reads", () => {
  it("classifies the same references for the provider", async () => {
    const results = [];
    for (const [, repository] of backends()) {
      const references = await repository.loadReferences(
        principal(),
        provider,
        observedAt,
        10_000,
      );
      results.push({
        canonical: [...references.canonical].sort(),
        historical: [...references.historical].sort(),
        uploads: [...references.uploads.entries()].sort(),
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toEqual({
      canonical: [keys.canonical, keys.moved].sort(),
      historical: [keys.previous],
      uploads: [
        [keys.consumed, true],
        [keys.expired, false],
        [keys.pending, true],
      ].sort(),
    });
  });

  it("refuses the same principals and bounds", async () => {
    const outcomes = [];
    for (const [, repository] of backends()) {
      const seen: string[] = [];
      const record = (error: Error) => seen.push(error.constructor.name);
      await repository.assertWorkspaceOwner(principal());
      record(
        await failure(() =>
          repository.assertWorkspaceOwner(principal(editorId)),
        ),
      );
      record(
        await failure(() =>
          repository.assertWorkspaceOwner(principal(harness.viewerId)),
        ),
      );
      record(
        await failure(() =>
          repository.loadReferences(
            principal(editorId),
            provider,
            observedAt,
            10_000,
          ),
        ),
      );
      record(
        await failure(() =>
          repository.loadReferences(principal(), provider, observedAt, 2),
        ),
      );
      outcomes.push(seen);
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual([
      AuthorizationDeniedError.name,
      AuthorizationDeniedError.name,
      AuthorizationDeniedError.name,
      StorageInventoryUnavailableError.name,
    ]);
  });

  it("refuses a document revision it cannot classify", async () => {
    await document(
      "Unreadable.txt",
      provider,
      key(harness.workspaceId),
      undefined,
      2,
    );
    for (const [, repository] of backends()) {
      await expect(
        repository.loadReferences(principal(), provider, observedAt, 10_000),
      ).rejects.toBeInstanceOf(StorageInventoryUnavailableError);
    }
  });
});
