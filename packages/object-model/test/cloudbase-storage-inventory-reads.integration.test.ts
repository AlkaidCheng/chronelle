import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { AuthorizationDeniedError } from "@livtales/authorization";
import {
  auditEvents,
  createId,
  documents,
  documentTransferAuthorizations,
  objectRevisions,
  objects,
  users,
  workspaceMembers,
  workspaces,
} from "@livtales/db";
import {
  LocalFilesystemStorageProvider,
  StorageInventoryUnavailableError,
} from "@livtales/storage";
import { inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseStorageInventoryReadRepository } from "../src/cloudbase-storage-inventory-read-repository.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import {
  PostgresStorageInventoryReadRepository,
  type StorageInventoryReadRepository,
} from "../src/storage-inventory-reads.js";
import { StorageInventoryService } from "../src/storage-inventory-service.js";
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
// finalize; and both must refuse non-Owners and oversized workspaces. Keys
// follow the records that name them: a record moved to another workspace
// keeps the key its first workspace minted, and both backends must count it
// in the workspace the record lives in.

const provider = "local-filesystem";
const observedAt = new Date("2030-06-01T12:00:00.000Z");

let harness: WriteHarness;
let editorId: string;
let reference: StorageInventoryReadRepository;
let cloudbase: StorageInventoryReadRepository;
let keys: Record<string, string>;

/** A workspace and its Owner. */
interface Space {
  readonly workspaceId: string;
  readonly ownerId: string;
}

/** A second workspace, to which records holding files move from the harness workspace. */
let destination: Space;
/** Keys under the harness workspace's prefix: of a moved document, of a moved upload, and of nothing. */
let movedKeys: {
  readonly document: string;
  readonly upload: string;
  readonly orphan: string;
};

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

/** A workspace with its Owner. */
async function createSpace(name: string): Promise<Space> {
  const db = harness.database.connection.db;
  const space = { workspaceId: createId(), ownerId: createId() };
  await db.insert(users).values({
    id: space.ownerId,
    identityProvider: "test",
    providerSubject: space.ownerId,
    displayName: name,
  });
  await db.insert(workspaces).values({
    id: space.workspaceId,
    createdBy: space.ownerId,
    displayName: name,
  });
  await db.insert(workspaceMembers).values({
    workspaceId: space.workspaceId,
    userId: space.ownerId,
    role: "owner",
  });
  return space;
}

function spacePrincipal(space: Space) {
  return {
    type: "user" as const,
    userId: space.ownerId,
    workspaceId: space.workspaceId,
  };
}

/**
 * An Event of the harness workspace holding a Document and a consumed
 * upload under keys the workspace minted, as raw rows without history,
 * moved to the destination by the one UPDATE of objects.workspace_id a
 * move is made of; the typed and transfer rows follow it.
 */
async function moveRecordsWithFiles() {
  const db = harness.database.connection.db;
  const eventId = createId();
  const documentId = createId();
  await db.insert(objects).values(
    [
      { id: eventId, objectType: "event" as const, displayName: "Moved" },
      { id: documentId, objectType: "document" as const, displayName: "In" },
    ].map((object) => ({
      ...object,
      workspaceId: harness.workspaceId,
      createdBy: harness.ownerId,
      permissionScopeId: eventId,
    })),
  );
  await db.insert(documents).values({
    objectId: documentId,
    workspaceId: harness.workspaceId,
    storageProvider: provider,
    storageKey: movedKeys.document,
    originalFilename: "In.txt",
    mimeType: "text/plain",
    sizeBytes: 12n,
    checksumSha256: "a".repeat(64),
  });
  await upload(
    eventId,
    movedKeys.upload,
    new Date("2030-05-01T00:00:00.000Z"),
    new Date("2030-04-30T00:00:00.000Z"),
  );
  await db
    .update(objects)
    .set({ workspaceId: destination.workspaceId })
    .where(inArray(objects.id, [eventId, documentId]));
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
  destination = await createSpace("Destination");
  movedKeys = {
    document: key(workspaceId),
    upload: key(workspaceId),
    orphan: key(workspaceId),
  };
  await moveRecordsWithFiles();
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

  it("classifies a key another workspace minted where its record lives", async () => {
    const results = [];
    for (const [, repository] of backends()) {
      const references = await repository.loadReferences(
        spacePrincipal(destination),
        provider,
        observedAt,
        10_000,
      );
      results.push({
        canonical: [...references.canonical],
        historical: [...references.historical],
        uploads: [...references.uploads.entries()],
      });
    }
    expect(results[1]).toEqual(results[0]);
    expect(results[0]).toEqual({
      canonical: [movedKeys.document],
      historical: [],
      uploads: [[movedKeys.upload, true]],
    });
  });

  it("finds the same keys under the Owner's prefix that another workspace names", async () => {
    const outcomes = [];
    for (const [, repository] of backends()) {
      const find = (
        caller: ReturnType<typeof principal>,
        storageProvider: string,
        candidates: readonly string[],
      ) =>
        repository.findReferencedElsewhere(caller, storageProvider, candidates);
      const lookedUp = [
        movedKeys.document,
        movedKeys.upload,
        movedKeys.orphan,
        keys.canonical as string,
      ];
      outcomes.push({
        found: [...(await find(principal(), provider, lookedUp))].sort(),
        otherProvider: [...(await find(principal(), "s3", lookedUp))],
        none: [...(await find(principal(), provider, []))],
        editor: (
          await failure(() => find(principal(editorId), provider, lookedUp))
        ).constructor.name,
        otherPrefix: (
          await failure(() =>
            find(spacePrincipal(destination), provider, lookedUp),
          )
        ).constructor.name,
      });
    }
    expect(outcomes[1]).toEqual(outcomes[0]);
    expect(outcomes[0]).toEqual({
      found: [movedKeys.document, movedKeys.upload].sort(),
      otherProvider: [],
      none: [],
      editor: AuthorizationDeniedError.name,
      otherPrefix: StorageInventoryUnavailableError.name,
    });
  });

  it("reports the same inventory of both workspaces on both backends", async () => {
    const root = await mkdtemp(join(tmpdir(), "livtales-inventory-reads-"));
    try {
      for (const stored of [
        keys.canonical as string,
        movedKeys.document,
        movedKeys.upload,
        movedKeys.orphan,
      ]) {
        await mkdir(dirname(join(root, stored)), {
          recursive: true,
          mode: 0o700,
        });
        await writeFile(join(root, stored), "stored bytes");
      }
      const storage = new LocalFilesystemStorageProvider({ root });
      const reports = [];
      for (const [, reads] of backends()) {
        const service = new StorageInventoryService(
          harness.database.connection.db,
          storage,
          { reads, clock: () => observedAt },
        );
        const counts = async (caller: ReturnType<typeof principal>) => {
          const { references, entries } = await service.get(caller);
          return { references, entries };
        };
        reports.push({
          origin: await counts(principal()),
          destination: await counts(spacePrincipal(destination)),
        });
      }
      expect(reports[1]).toEqual(reports[0]);
      expect(reports[0]).toEqual({
        origin: {
          references: {
            canonical: 2,
            historicalOnly: 1,
            missingCanonical: 1,
            missingHistoricalOnly: 1,
          },
          entries: {
            canonical: 1,
            historicalOnly: 0,
            pendingUpload: 0,
            expiredUpload: 0,
            unreferenced: 1,
            unsupported: 0,
          },
        },
        destination: {
          references: {
            canonical: 1,
            historicalOnly: 0,
            missingCanonical: 0,
            missingHistoricalOnly: 0,
          },
          entries: {
            canonical: 1,
            historicalOnly: 0,
            pendingUpload: 1,
            expiredUpload: 0,
            unreferenced: 0,
            unsupported: 0,
          },
        },
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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
