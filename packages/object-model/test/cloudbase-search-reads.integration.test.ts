import { Buffer } from "node:buffer";

import type { UserPrincipal } from "@livtales/authorization";
import {
  CloudBaseRpcError,
  createId,
  objects,
  resourceGrants,
  users,
  workspaceMembers,
  workspaces,
} from "@livtales/db";
import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { CloudBaseSearchReadRepository } from "../src/cloudbase-search-read-repository.js";
import { InvalidObjectStateError } from "../src/errors.js";
import { CanonicalObjectSearchService } from "../src/search-service.js";
import type { ObjectSearchInput, ObjectSearchPage } from "../src/types.js";
import {
  createWriteHarness,
  failure,
  type WriteHarness,
} from "./cloudbase-write-harness.js";

// chronelle_object_search must return what CanonicalObjectSearchService
// returns over the PostgreSQL query: the same matches in the same rank and
// keyset order, the same pages and cursors, the same visibility for a member
// and for a grant-only viewer, and the same rejections.

const id = (suffix: string) => `00000000-0000-7000-8000-0000000000${suffix}`;
const rootId = id("0a");
const tripleId = id("0b");
const dinnerId = id("0c");
const lunchId = id("0d");
const breakfastId = id("09");
const budgetId = id("0f");
const reminderId = id("10");
const deletedId = id("11");
const privateId = id("12");
const documentId = id("13");
const elsewhereId = id("14");

let harness: WriteHarness;
let reference: CanonicalObjectSearchService;
let cloudbase: CanonicalObjectSearchService;
let owner: UserPrincipal;
let viewer: UserPrincipal;
let stranger: UserPrincipal;

const backends = () =>
  [
    ["postgres", reference],
    ["cloudbase", cloudbase],
  ] as const;

async function seed() {
  const db = harness.database.connection.db;
  const { workspaceId, ownerId, viewerId } = harness;
  const strangerId = createId();
  const otherWorkspaceId = createId();
  await db.insert(users).values({
    id: strangerId,
    identityProvider: "test",
    providerSubject: strangerId,
    displayName: "Stranger",
  });
  await db.insert(workspaces).values({
    id: otherWorkspaceId,
    createdBy: ownerId,
    displayName: "Other workspace",
  });
  await db.insert(workspaceMembers).values({
    workspaceId: otherWorkspaceId,
    userId: ownerId,
    role: "owner",
  });
  const object = (
    objectId: string,
    objectType: "event" | "task" | "expense" | "reminder" | "document",
    displayName: string,
    permissionScopeId: string,
    updatedAt: string,
    extra: { deletedAt?: Date; workspaceId?: string } = {},
  ) => ({
    id: objectId,
    workspaceId: extra.workspaceId ?? workspaceId,
    objectType,
    displayName,
    createdBy: ownerId,
    permissionScopeId,
    updatedAt: sql`${updatedAt}::timestamptz`,
    ...(extra.deletedAt !== undefined && { deletedAt: extra.deletedAt }),
  });
  // Ranks: the tripled name outranks every single mention. Times: the three
  // scoped tasks tie at millisecond precision, with the breakfast task a
  // microsecond earlier and an id that sorts before the other two.
  await db
    .insert(objects)
    .values([
      object(rootId, "event", "Plan the trip", rootId, "2030-01-05T00:00:00Z"),
      object(
        privateId,
        "event",
        "Plan private",
        privateId,
        "2030-01-06T00:00:00Z",
      ),
      object(
        budgetId,
        "expense",
        "Plan budget",
        budgetId,
        "2030-01-04T00:00:00Z",
      ),
      object(
        reminderId,
        "reminder",
        "Plan reminder",
        reminderId,
        "2030-01-02T00:00:00Z",
      ),
      object(
        documentId,
        "document",
        "Plan document",
        documentId,
        "2030-01-01T12:00:00Z",
      ),
    ]);
  await db.insert(objects).values([
    object(tripleId, "task", "Plan plan plan", rootId, "2030-01-01T00:00:00Z"),
    object(
      dinnerId,
      "task",
      "Plan dinner",
      rootId,
      "2030-01-03T00:00:00.000005Z",
    ),
    object(
      lunchId,
      "task",
      "Plan lunch",
      rootId,
      "2030-01-03T00:00:00.000005Z",
    ),
    object(
      breakfastId,
      "task",
      "Plan breakfast",
      rootId,
      "2030-01-03T00:00:00.000004Z",
    ),
    object(deletedId, "task", "Plan deleted", rootId, "2030-01-07T00:00:00Z", {
      deletedAt: new Date("2030-01-08T00:00:00Z"),
    }),
    object(
      elsewhereId,
      "event",
      "Plan elsewhere",
      elsewhereId,
      "2030-01-09T00:00:00Z",
      {
        workspaceId: otherWorkspaceId,
      },
    ),
  ]);
  await db.insert(resourceGrants).values([
    {
      id: createId(),
      workspaceId,
      resourceId: rootId,
      principalId: viewerId,
      role: "viewer",
      grantedBy: ownerId,
    },
    {
      id: createId(),
      workspaceId,
      resourceId: budgetId,
      principalId: viewerId,
      role: "editor",
      grantedBy: ownerId,
      expiresAt: new Date("2099-01-01T00:00:00Z"),
    },
    {
      id: createId(),
      workspaceId,
      resourceId: reminderId,
      principalId: viewerId,
      role: "owner",
      grantedBy: ownerId,
      createdAt: new Date("2020-01-01T00:00:00Z"),
      expiresAt: new Date("2020-01-02T00:00:00Z"),
    },
  ]);
  owner = { type: "user", userId: ownerId, workspaceId };
  viewer = { type: "user", userId: viewerId, workspaceId };
  stranger = { type: "user", userId: strangerId, workspaceId };
}

beforeAll(async () => {
  harness = await createWriteHarness("Search reads");
  const db = harness.database.connection.db;
  reference = new CanonicalObjectSearchService(db);
  cloudbase = new CanonicalObjectSearchService(
    db,
    new CloudBaseSearchReadRepository(harness),
  );
  await seed();
});

afterAll(async () => {
  await harness?.database.close();
});

/** The page from both backends, which must be identical. */
async function both(
  principal: UserPrincipal,
  input: ObjectSearchInput,
): Promise<ObjectSearchPage> {
  const [first, second] = await Promise.all(
    backends().map(([, service]) => service.search(principal, input)),
  );
  expect(second).toEqual(first);
  return first as ObjectSearchPage;
}

/** Every page of one backend, following its own cursors. */
async function walk(
  service: CanonicalObjectSearchService,
  principal: UserPrincipal,
  input: ObjectSearchInput,
): Promise<ObjectSearchPage[]> {
  const pages: ObjectSearchPage[] = [];
  let cursor: string | undefined;
  do {
    const page = await service.search(principal, { ...input, cursor });
    pages.push(page);
    cursor = page.nextCursor ?? undefined;
  } while (cursor !== undefined && pages.length < 20);
  return pages;
}

const ids = (page: ObjectSearchPage) => page.items.map((item) => item.id);

describe.sequential("CloudBase search reads", () => {
  it("returns the member's matches in rank, time, and id order", async () => {
    const page = await both(owner, { query: "Plan", limit: 50 });
    expect(ids(page)).toEqual([
      tripleId,
      privateId,
      rootId,
      budgetId,
      dinnerId,
      lunchId,
      breakfastId,
      reminderId,
      documentId,
    ]);
    expect(page.nextCursor).toBeNull();
    expect(page.items[0]).toEqual({
      id: tripleId,
      objectType: "task",
      displayName: "Plan plan plan",
      permissionScopeId: rootId,
      updatedAt: new Date("2030-01-01T00:00:00.000Z"),
      version: 1,
    });
  });

  it.each(["plan trip", "plan -trip", '"plan the"', "Budget OR lunch"])(
    "agrees on the web search query %s",
    async (query) => {
      const page = await both(owner, { query, limit: 50 });
      expect(page.items.length).toBeGreaterThan(0);
    },
  );

  it("applies the object type filter", async () => {
    const tasks = await both(owner, {
      query: "Plan",
      objectType: "task",
      limit: 50,
    });
    expect(ids(tasks)).toEqual([tripleId, dinnerId, lunchId, breakfastId]);
    const events = await both(owner, {
      query: "Plan",
      objectType: "event",
      limit: 50,
    });
    expect(ids(events)).toEqual([privateId, rootId]);
  });

  it.each([1, 2, 4])(
    "pages identically with a limit of %i and interchangeable cursors",
    async (limit) => {
      const [postgres, cloud] = await Promise.all(
        backends().map(([, service]) =>
          walk(service, owner, { query: "Plan", limit }),
        ),
      );
      expect(cloud).toEqual(postgres);
      expect(postgres?.flatMap(ids)).toEqual([
        tripleId,
        privateId,
        rootId,
        budgetId,
        dinnerId,
        lunchId,
        breakfastId,
        reminderId,
        documentId,
      ]);
      expect(postgres?.at(-1)?.nextCursor).toBeNull();
      // A cursor from one backend continues the search on the other.
      for (const [index, page] of (postgres ?? []).entries()) {
        if (page.nextCursor === null) continue;
        const next = { query: "Plan", limit, cursor: page.nextCursor };
        expect(await cloudbase.search(owner, next)).toEqual(
          postgres?.[index + 1],
        );
        expect(await reference.search(owner, next)).toEqual(cloud?.[index + 1]);
      }
    },
  );

  it("continues across the microsecond tie boundary from either backend", async () => {
    // Two pages of two end on the lunch task, whose time ties the dinner task
    // and is one microsecond after the breakfast task; the breakfast task's id
    // sorts before both, so only the microsecond position keeps it next.
    const second = { query: "Plan", limit: 2 };
    const first = await both(owner, { query: "Plan", limit: 4 });
    expect(ids(first)).toEqual([tripleId, privateId, rootId, budgetId]);
    const tie = await both(owner, {
      ...second,
      cursor: first.nextCursor ?? undefined,
    });
    expect(ids(tie)).toEqual([dinnerId, lunchId]);
    const afterTie = await both(owner, {
      ...second,
      cursor: tie.nextCursor ?? undefined,
    });
    expect(ids(afterTie)).toEqual([breakfastId, reminderId]);
  });

  it("shows a grant-only viewer the inherited and unexpired direct matches", async () => {
    const page = await both(viewer, { query: "Plan", limit: 50 });
    expect(ids(page)).toEqual([
      tripleId,
      rootId,
      budgetId,
      dinnerId,
      lunchId,
      breakfastId,
    ]);
    const [postgres, cloud] = await Promise.all(
      backends().map(([, service]) =>
        walk(service, viewer, { query: "Plan", limit: 2 }),
      ),
    );
    expect(cloud).toEqual(postgres);
    expect(postgres?.flatMap(ids)).toEqual(ids(page));
    expect(
      await both(viewer, { query: "Plan", objectType: "reminder", limit: 50 }),
    ).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("returns an empty page to a principal without membership or grants", async () => {
    expect(await both(stranger, { query: "Plan", limit: 50 })).toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it("rejects the same invalid cursors with the same error", async () => {
    const first = await both(owner, { query: "Plan", limit: 1 });
    if (first.nextCursor === null) throw new Error("expected a cursor");
    const payload = JSON.parse(
      Buffer.from(first.nextCursor, "base64url").toString("utf8"),
    ) as Record<string, unknown>;
    const encode = (changes: Record<string, unknown>) =>
      Buffer.from(JSON.stringify({ ...payload, ...changes })).toString(
        "base64url",
      );
    const attempts: [UserPrincipal, ObjectSearchInput][] = [
      [owner, { query: "Plan", limit: 1, cursor: "!" }],
      [owner, { query: "Plan", limit: 1, cursor: encode({ rank: -1 }) }],
      [
        owner,
        {
          query: "Plan",
          limit: 1,
          cursor: encode({ updatedAt: "2030-01-01T00:00:00.000Z" }),
        },
      ],
      [owner, { query: "Other", limit: 1, cursor: first.nextCursor }],
      [
        owner,
        {
          query: "Plan",
          objectType: "task",
          limit: 1,
          cursor: first.nextCursor,
        },
      ],
      [viewer, { query: "Plan", limit: 1, cursor: first.nextCursor }],
    ];
    for (const [principal, input] of attempts) {
      const errors = await Promise.all(
        backends().map(([, service]) =>
          failure(() => service.search(principal, input)),
        ),
      );
      for (const error of errors) {
        expect(error).toBeInstanceOf(InvalidObjectStateError);
        expect(error.message).toBe(
          "The search cursor is invalid for this query.",
        );
      }
    }
  });

  it("rejects an incomplete position and missing principal in the function", async () => {
    const call = (args: Record<string, unknown>) =>
      failure(() =>
        harness.rpc("chronelle_object_search", {
          workspace_id: harness.workspaceId,
          user_id: harness.ownerId,
          query: "Plan",
          ...args,
        }),
      );
    const partial = await call({ after_rank: 0.5 });
    expect(partial).toBeInstanceOf(CloudBaseRpcError);
    expect(partial).toMatchObject({
      code: "DATABASE_PT422",
      message: "The search cursor is invalid for this query.",
    });
    for (const [args, message] of [
      [{ page_limit: 0 }, "The page limit is invalid."],
      [{ page_limit: 51 }, "The page limit is invalid."],
      [{ object_type: "recipe" }, "The object type is invalid."],
      [{ query: "   " }, "The search query is invalid."],
    ] as const) {
      expect(await call(args)).toMatchObject({
        code: "DATABASE_PT422",
        message,
      });
    }
    expect(await call({ workspace_id: null })).toMatchObject({
      code: "DATABASE_PT403",
    });
    const repository = new CloudBaseSearchReadRepository(harness);
    await expect(
      repository.search(owner, { query: "Plan", limit: 0 }),
    ).rejects.toBeInstanceOf(InvalidObjectStateError);
  });

  it("drops matches that are deleted or lose their scope", async () => {
    const db = harness.database.connection.db;
    const deletedAt = new Date("2030-02-01T00:00:00Z");
    await db.update(objects).set({ deletedAt }).where(eq(objects.id, dinnerId));
    expect(ids(await both(viewer, { query: "Plan", limit: 50 }))).toEqual([
      tripleId,
      rootId,
      budgetId,
      lunchId,
      breakfastId,
    ]);
    // Deleting the scope holder hides the inherited children from the viewer
    // while the member still sees them.
    await db.update(objects).set({ deletedAt }).where(eq(objects.id, rootId));
    expect(ids(await both(viewer, { query: "Plan", limit: 50 }))).toEqual([
      budgetId,
    ]);
    expect(ids(await both(owner, { query: "Plan", limit: 50 }))).toEqual([
      tripleId,
      privateId,
      budgetId,
      lunchId,
      breakfastId,
      reminderId,
      documentId,
    ]);
    await db
      .update(objects)
      .set({ deletedAt: null })
      .where(inArray(objects.id, [dinnerId, rootId]));
  });
});
