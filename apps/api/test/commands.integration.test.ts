import { resolve } from "node:path";
import { createId, resourceGrants } from "@chronelle/db";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "@chronelle/db/testing";
import { withStableAuthorization } from "@chronelle/authorization";
import { EventPlanningObjectService } from "@chronelle/object-model";
import {
  commandReceiptSchema,
  commandStateResponseSchema,
  developmentSignInResponseSchema,
  eventPlanningResourceResponseSchema,
  type CommandExecutePayload,
  type CommandTransitionRequest,
} from "@chronelle/schemas";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { createDevelopmentAppDependencies } from "../src/dependencies.js";

let database: TestDatabase;
let app: FastifyInstance;
beforeEach(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    resolve(import.meta.dirname, "../../../infrastructure/migrations"),
  );
  app = buildApp(createDevelopmentAppDependencies(database.connection));
});
afterEach(async () => {
  await app?.close();
  await database?.close();
});

async function signIn(email = "owner@example.com") {
  return developmentSignInResponseSchema.parse(
    (
      await app.inject({
        method: "POST",
        url: "/api/auth/development/sign-in",
        payload: { email, displayName: "Planner" },
      })
    ).json(),
  );
}
type Session = Awaited<ReturnType<typeof signIn>>;
function headers(session: Session, workspaceId = session.workspace.id) {
  return {
    authorization: `Bearer ${session.accessToken}`,
    "x-workspace-id": workspaceId,
  };
}
async function create(
  session: Session,
  type = "events",
  fields: Record<string, unknown> = {},
) {
  const response = await app.inject({
    method: "POST",
    url: `/api/${type}`,
    headers: headers(session),
    payload: { displayName: "Initial", ...fields },
  });
  expect(response.statusCode).toBe(201);
  return eventPlanningResourceResponseSchema.parse(response.json());
}
async function get(session: Session, id: string) {
  const response = await app.inject({
    url: `/api/objects/${id}`,
    headers: headers(session),
  });
  expect(response.statusCode).toBe(200);
  return eventPlanningResourceResponseSchema.parse(response.json());
}
async function state(session: Session, workspaceId = session.workspace.id) {
  const response = await app.inject({
    url: "/api/commands",
    headers: headers(session, workspaceId),
  });
  expect(response.statusCode).toBe(200);
  return commandStateResponseSchema.parse(response.json());
}
function execute(
  session: Session,
  input: CommandExecutePayload,
  workspaceId = session.workspace.id,
) {
  return app.inject({
    method: "POST",
    url: "/api/commands",
    headers: headers(session, workspaceId),
    payload: input,
  });
}
function transition(
  session: Session,
  direction: "undo" | "redo",
  input: CommandTransitionRequest,
  workspaceId = session.workspace.id,
) {
  return app.inject({
    method: "POST",
    url: `/api/commands/${direction}`,
    headers: headers(session, workspaceId),
    payload: input,
  });
}
function edit(
  objectId: string,
  version: number,
  displayName: string,
  objectType: "event" | "task" = "event",
): CommandExecutePayload["edits"][number] {
  return {
    objectId,
    objectType,
    patch: { expectedVersion: version, displayName },
  };
}
async function forward(
  session: Session,
  edits: CommandExecutePayload["edits"],
) {
  const input = {
    operationId: createId(),
    expectedStackVersion: (await state(session)).version,
    edits,
  };
  const response = await execute(session, input);
  expect(response.statusCode, response.body).toBe(200);
  return commandReceiptSchema.parse(response.json());
}
async function inverse(session: Session, direction: "undo" | "redo") {
  const stack = await state(session);
  const commandId = stack[direction]?.commandId;
  if (commandId === undefined)
    throw new Error("Expected a reversible command.");
  const response = await transition(session, direction, {
    operationId: createId(),
    commandId,
    expectedStackVersion: stack.version,
  });
  expect(response.statusCode, response.body).toBe(200);
  return commandReceiptSchema.parse(response.json());
}
async function patch(
  session: Session,
  id: string,
  expectedVersion: number,
  displayName: string,
) {
  const response = await app.inject({
    method: "PATCH",
    url: `/api/events/${id}`,
    headers: headers(session),
    payload: { expectedVersion, displayName },
  });
  expect(response.statusCode).toBe(200);
}
async function share(session: Session, id: string, role = "editor") {
  const response = await app.inject({
    method: "POST",
    url: "/api/shares",
    headers: headers(session),
    payload: {
      resourceId: id,
      principalEmail: "collaborator@example.com",
      role,
    },
  });
  expect(response.statusCode).toBe(201);
  return response.json<{ id: string }>();
}

describe("reversible content commands", () => {
  it("reverses date precision changes without inventing occurrence times", async () => {
    const owner = await signIn();
    const event = await create(owner, "events", {
      startsAt: "2030-07-03T12:00:00Z",
      endsAt: "2030-07-12T18:00:00Z",
    });
    await forward(owner, [
      {
        objectId: event.id,
        objectType: "event",
        patch: {
          expectedVersion: 1,
          startsAt: null,
          endsAt: null,
          startsOn: "2030-07-03",
          endsOn: "2030-07-12",
        },
      },
    ]);
    expect(await get(owner, event.id)).toMatchObject({
      version: 2,
      startsAt: null,
      endsAt: null,
      startsOn: "2030-07-03",
      endsOn: "2030-07-12",
    });
    await inverse(owner, "undo");
    expect(await get(owner, event.id)).toMatchObject({
      version: 3,
      startsAt: "2030-07-03T12:00:00.000Z",
      endsAt: "2030-07-12T18:00:00.000Z",
      startsOn: null,
      endsOn: null,
    });
    await inverse(owner, "redo");
    expect(await get(owner, event.id)).toMatchObject({
      version: 4,
      startsAt: null,
      endsAt: null,
      startsOn: "2030-07-03",
      endsOn: "2030-07-12",
    });
  });
  it("protects a collaborator's later edit even when each user has a reversible stack", async () => {
    const owner = await signIn();
    const collaborator = await signIn("collaborator@example.com");
    const event = await create(owner);
    await share(owner, event.id);
    const first = await forward(owner, [edit(event.id, 1, "Owner edit")]);
    const response = await execute(
      collaborator,
      {
        operationId: createId(),
        expectedStackVersion: 0,
        edits: [edit(event.id, 2, "Collaborator edit")],
      },
      owner.workspace.id,
    );
    expect(response.statusCode).toBe(200);
    expect(
      (
        await transition(owner, "undo", {
          operationId: createId(),
          commandId: first.commandId,
          expectedStackVersion: 1,
        })
      ).statusCode,
    ).toBe(409);
    expect(await get(owner, event.id)).toMatchObject({
      displayName: "Collaborator edit",
      version: 3,
    });
    expect((await state(owner)).version).toBe(1);
    expect((await state(collaborator, owner.workspace.id)).version).toBe(1);
  });

  it("rejects undo after a racing direct writer and preserves stack state", async () => {
    const owner = await signIn();
    const event = await create(owner);
    const command = await forward(owner, [edit(event.id, 1, "Command edit")]);
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const direct = withStableAuthorization(
      database.connection.db,
      owner.workspace.id,
      async (transaction, authorization) => {
        const objects = new EventPlanningObjectService({
          database: transaction,
          authorization,
        });
        await objects.updateEvent(
          {
            principal: {
              userId: owner.user.id,
              workspaceId: owner.workspace.id,
              type: "user",
            },
            requestId: createId(),
          },
          event.id,
          { expectedVersion: 2, displayName: "Direct edit" },
        );
        held.resolve();
        await release.promise;
      },
    );
    await held.promise;
    const waiting = transition(owner, "undo", {
      operationId: createId(),
      commandId: command.commandId,
      expectedStackVersion: 1,
    }).then((response) => response);
    try {
      await expect
        .poll(async () => {
          const [row] = await database.connection
            .sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%workspaces%'`;
          return row?.count ?? 0;
        })
        .toBeGreaterThan(0);
    } finally {
      release.resolve();
    }
    await direct;
    expect((await waiting).statusCode).toBe(409);
    expect(await get(owner, event.id)).toMatchObject({
      displayName: "Direct edit",
      version: 3,
    });
    expect((await state(owner)).version).toBe(1);
  });
  it("advances preconditions across consecutive undos and redos without duplicating canonical data", async () => {
    const owner = await signIn();
    const event = await create(owner, "events", {
      metadata: { source: "import" },
      customProperties: { room: "A" },
    });
    const first = await forward(owner, [edit(event.id, 1, "First")]);
    const second = await forward(owner, [edit(event.id, 2, "Second")]);
    for (const [direction, displayName, version] of [
      ["undo", "First", 4],
      ["undo", "Initial", 5],
      ["redo", "First", 6],
      ["redo", "Second", 7],
    ] as const) {
      await inverse(owner, direction);
      expect(await get(owner, event.id)).toMatchObject({
        id: event.id,
        displayName,
        version,
        metadata: { source: "import" },
        permissionScopeId: event.id,
      });
    }
    expect((await state(owner)).undo?.commandId).toBe(second.commandId);
    expect(await database.connection.sql`SELECT id FROM objects`).toHaveLength(
      1,
    );
    expect(
      await database.connection
        .sql`SELECT id FROM object_revisions WHERE object_id = ${event.id}`,
    ).toHaveLength(7);
    const audits = await database.connection
      .sql`SELECT metadata FROM audit_events WHERE action = 'event.updated' ORDER BY created_at, id`;
    expect(audits.map((row) => row.metadata.command.direction)).toEqual([
      "execute",
      "execute",
      "undo",
      "undo",
      "redo",
      "redo",
    ]);
    expect(audits[3]?.metadata.command.id).toBe(first.commandId);
    expect(
      await database.connection
        .sql`SELECT id FROM audit_events WHERE action LIKE 'command.%'`,
    ).toHaveLength(6);
  });

  it("reverses compound Event and Task edits atomically, including typed fields and removed custom keys", async () => {
    const owner = await signIn();
    const event = await create(owner);
    const task = await create(owner, "tasks", { permissionScopeId: event.id });
    await forward(owner, [
      {
        objectType: "event",
        objectId: event.id,
        patch: {
          expectedVersion: 1,
          startsAt: "2026-09-10T12:00:00.000Z",
          customProperties: { room: "A" },
        },
      },
      {
        objectType: "task",
        objectId: task.id,
        patch: {
          expectedVersion: 1,
          status: "done",
          completedAt: "2026-09-09T12:00:00.000Z",
        },
      },
    ]);
    await inverse(owner, "undo");
    expect(await get(owner, event.id)).toMatchObject({
      version: 3,
      startsAt: null,
      customProperties: {},
    });
    expect(await get(owner, task.id)).toMatchObject({
      version: 3,
      status: "todo",
      completedAt: null,
    });
    await inverse(owner, "redo");
    expect(await get(owner, task.id)).toMatchObject({
      version: 4,
      status: "done",
      completedAt: "2026-09-09T12:00:00.000Z",
    });
    expect(await get(owner, event.id)).toMatchObject({
      version: 4,
      startsAt: "2026-09-10T12:00:00.000Z",
      customProperties: { room: "A" },
    });
  });

  it("replays the same receipt after later mutations without replaying their effects", async () => {
    const owner = await signIn();
    const event = await create(owner);
    const input = {
      operationId: createId(),
      expectedStackVersion: 0,
      edits: [edit(event.id, 1, "First")],
    };
    const original = await execute(owner, input);
    const undoInput = {
      operationId: createId(),
      commandId: input.operationId,
      expectedStackVersion: 1,
    };
    const undone = await transition(owner, "undo", undoInput);
    expect(undone.statusCode).toBe(200);
    expect((await execute(owner, input)).json()).toEqual(original.json());
    expect((await transition(owner, "undo", undoInput)).json()).toEqual(
      undone.json(),
    );
    expect(await get(owner, event.id)).toMatchObject({
      displayName: "Initial",
      version: 3,
    });
    expect(
      (
        await execute(owner, {
          ...input,
          edits: [edit(event.id, 1, "Different")],
        })
      ).statusCode,
    ).toBe(409);
    expect((await transition(owner, "redo", undoInput)).statusCode).toBe(409);
    expect(
      await database.connection.sql`SELECT * FROM command_receipts`,
    ).toHaveLength(2);
  });

  it("applies concurrent retries once and rejects competing stack-head requests", async () => {
    const owner = await signIn();
    const event = await create(owner);
    const input = {
      operationId: createId(),
      expectedStackVersion: 0,
      edits: [edit(event.id, 1, "First")],
    };
    const responses = await Promise.all([
      execute(owner, input),
      execute(owner, input),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([
      200, 200,
    ]);
    expect(responses[0]?.json()).toEqual(responses[1]?.json());
    const undoInput = {
      operationId: createId(),
      commandId: input.operationId,
      expectedStackVersion: 1,
    };
    const attempts = await Promise.all([
      transition(owner, "undo", undoInput),
      transition(owner, "undo", { ...undoInput, operationId: createId() }),
    ]);
    expect(attempts.map((response) => response.statusCode).sort()).toEqual([
      200, 409,
    ]);
    expect(await get(owner, event.id)).toMatchObject({ version: 3 });
    expect(
      await database.connection.sql`SELECT * FROM command_receipts`,
    ).toHaveLength(2);
  });

  it("blocks undo after an untracked edit without changing any member of a compound command", async () => {
    const owner = await signIn();
    const event = await create(owner);
    const task = await create(owner, "tasks");
    const command = await forward(owner, [
      edit(event.id, 1, "First"),
      edit(task.id, 1, "Task", "task"),
    ]);
    await patch(owner, event.id, 2, "Newer");
    expect((await state(owner)).undo).toEqual({
      commandId: command.commandId,
      available: false,
    });
    expect(
      (
        await transition(owner, "undo", {
          operationId: createId(),
          commandId: command.commandId,
          expectedStackVersion: 1,
        })
      ).statusCode,
    ).toBe(409);
    expect(await get(owner, event.id)).toMatchObject({
      displayName: "Newer",
      version: 3,
    });
    expect(await get(owner, task.id)).toMatchObject({
      displayName: "Task",
      version: 2,
    });
    expect((await state(owner)).version).toBe(1);
  });

  it("never carries an old inverse across an untracked edit followed by a new command", async () => {
    const owner = await signIn();
    const event = await create(owner);
    await forward(owner, [edit(event.id, 1, "First")]);
    await patch(owner, event.id, 2, "Collaborator fact");
    await forward(owner, [edit(event.id, 3, "New command")]);
    await inverse(owner, "undo");
    expect(await get(owner, event.id)).toMatchObject({
      displayName: "Collaborator fact",
      version: 5,
    });
    expect((await state(owner)).undo).toBeNull();
  });

  it("drops redo on a new forward command and hides a redo made stale by a direct edit", async () => {
    const owner = await signIn();
    const event = await create(owner);
    const first = await forward(owner, [edit(event.id, 1, "First")]);
    await inverse(owner, "undo");
    await patch(owner, event.id, 3, "Newer");
    expect((await state(owner)).redo).toBeNull();
    expect(
      (
        await transition(owner, "redo", {
          operationId: createId(),
          commandId: first.commandId,
          expectedStackVersion: 2,
        })
      ).statusCode,
    ).toBe(409);
    await forward(owner, [edit(event.id, 4, "New branch")]);
    expect((await state(owner)).redo).toBeNull();
  });

  it("isolates stacks by user and workspace and requires current Editor permission", async () => {
    const owner = await signIn();
    const collaborator = await signIn("collaborator@example.com");
    const event = await create(owner);
    await share(owner, event.id, "viewer");
    const input = {
      operationId: createId(),
      expectedStackVersion: 0,
      edits: [edit(event.id, 1, "Denied")],
    };
    expect(
      (await execute(collaborator, input, owner.workspace.id)).statusCode,
    ).toBe(404);
    expect((await execute(collaborator, input)).statusCode).toBe(404);
    const command = await forward(owner, [edit(event.id, 1, "Owner edit")]);
    expect(await state(collaborator, owner.workspace.id)).toEqual({
      version: 0,
      undo: null,
      redo: null,
    });
    expect(
      (
        await transition(
          collaborator,
          "undo",
          {
            operationId: createId(),
            commandId: command.commandId,
            expectedStackVersion: 0,
          },
          owner.workspace.id,
        )
      ).statusCode,
    ).toBe(409);
    const grant = await share(owner, event.id);
    const editorInput = { ...input, edits: [edit(event.id, 2, "Editor edit")] };
    expect(
      (await execute(collaborator, editorInput, owner.workspace.id)).statusCode,
    ).toBe(200);
    await app.inject({
      method: "DELETE",
      url: `/api/shares/${grant.id}`,
      headers: headers(owner),
    });
    await share(owner, (await create(owner)).id, "viewer");
    expect((await state(collaborator, owner.workspace.id)).undo).toBeNull();
    expect(
      (await execute(collaborator, editorInput, owner.workspace.id)).statusCode,
    ).toBe(404);
    expect(
      (
        await transition(
          collaborator,
          "undo",
          {
            operationId: createId(),
            commandId: input.operationId,
            expectedStackVersion: 1,
          },
          owner.workspace.id,
        )
      ).statusCode,
    ).toBe(404);
  });

  it("rolls all edits, revisions, receipts, and stack advancement back if audit persistence fails", async () => {
    const owner = await signIn();
    const event = await create(owner);
    const task = await create(owner, "tasks");
    const command = await forward(owner, [
      edit(event.id, 1, "First"),
      edit(task.id, 1, "Task", "task"),
    ]);
    await database.connection.sql
      .unsafe(`CREATE FUNCTION fail_command_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action = 'command.undo' THEN RAISE EXCEPTION 'injected audit failure'; END IF; RETURN NEW; END; $$;
      CREATE TRIGGER fail_command_audit BEFORE INSERT ON audit_events FOR EACH ROW EXECUTE FUNCTION fail_command_audit();`);
    expect(
      (
        await transition(owner, "undo", {
          operationId: createId(),
          commandId: command.commandId,
          expectedStackVersion: 1,
        })
      ).statusCode,
    ).toBe(500);
    expect(await get(owner, event.id)).toMatchObject({
      version: 2,
      displayName: "First",
    });
    expect(await get(owner, task.id)).toMatchObject({
      version: 2,
      displayName: "Task",
    });
    expect((await state(owner)).version).toBe(1);
    expect(
      await database.connection.sql`SELECT * FROM command_receipts`,
    ).toHaveLength(1);
    expect(
      await database.connection.sql`SELECT * FROM object_revisions`,
    ).toHaveLength(4);
  });

  it("rolls an earlier edit back if a later typed patch is invalid", async () => {
    const owner = await signIn();
    const event = await create(owner);
    const task = await create(owner, "tasks");
    const response = await execute(owner, {
      operationId: createId(),
      expectedStackVersion: 0,
      edits: [
        edit(event.id, 1, "Changed"),
        {
          objectType: "task",
          objectId: task.id,
          patch: { expectedVersion: 1, status: "done" },
        },
      ],
    });
    expect(response.statusCode).toBe(400);
    expect(await get(owner, event.id)).toMatchObject({ version: 1 });
    expect(await state(owner)).toEqual({ version: 0, undo: null, redo: null });
    expect(
      await database.connection.sql`SELECT * FROM reversible_commands`,
    ).toHaveLength(0);
  });

  it("rejects unknown input and requires authentication", async () => {
    const owner = await signIn();
    const event = await create(owner);
    expect((await app.inject({ url: "/api/commands" })).statusCode).toBe(401);
    const response = await app.inject({
      method: "POST",
      url: "/api/commands",
      headers: headers(owner),
      payload: {
        operationId: createId(),
        expectedStackVersion: 0,
        edits: [
          {
            ...edit(event.id, 1, "Changed"),
            patch: { expectedVersion: 1, permissionScopeId: event.id },
          },
        ],
      },
    });
    expect(response.statusCode).toBe(400);
    expect(await get(owner, event.id)).toMatchObject({ version: 1 });
  });

  it("retains only 50 reachable commands without deleting durable history", async () => {
    const owner = await signIn();
    const event = await create(owner);
    for (let version = 1; version <= 51; version += 1)
      await forward(owner, [edit(event.id, version, `Edit ${version}`)]);
    const [stack] = await database.connection
      .sql`SELECT cardinality(undo_ids) AS count, expected_versions FROM command_stacks`;
    expect(stack?.count).toBe(50);
    expect(stack?.expected_versions).toEqual({ [event.id]: 52 });
    expect(
      await database.connection.sql`SELECT * FROM reversible_commands`,
    ).toHaveLength(51);
  }, 30_000);

  it("enforces immutable command history and same-workspace revision references in PostgreSQL", async () => {
    const owner = await signIn();
    const stranger = await signIn("stranger@example.com");
    const event = await create(owner);
    const other = await create(stranger);
    const command = await forward(owner, [edit(event.id, 1, "First")]);
    for (const table of [
      "reversible_commands",
      "command_changes",
      "command_receipts",
    ]) {
      await expect(
        database.connection.sql.unsafe(`DELETE FROM ${table}`),
      ).rejects.toMatchObject({ code: "55000" });
    }
    await expect(
      database.connection
        .sql`INSERT INTO command_changes (workspace_id, user_id, command_id, object_id, before_version, after_version) VALUES (${owner.workspace.id}, ${owner.user.id}, ${command.commandId}, ${other.id}, 1, 2)`,
    ).rejects.toMatchObject({ code: "23503" });
  });

  it("rechecks permissions after a concurrent grant revocation wins the workspace fence", async () => {
    const owner = await signIn();
    const collaborator = await signIn("collaborator@example.com");
    const event = await create(owner);
    const grant = await share(owner, event.id);
    await share(owner, (await create(owner)).id, "viewer");
    const input = {
      operationId: createId(),
      expectedStackVersion: 0,
      edits: [edit(event.id, 1, "Editor edit")],
    };
    expect(
      (await execute(collaborator, input, owner.workspace.id)).statusCode,
    ).toBe(200);
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const revocation = withStableAuthorization(
      database.connection.db,
      owner.workspace.id,
      async (transaction) => {
        await transaction
          .delete(resourceGrants)
          .where(eq(resourceGrants.id, grant.id));
        held.resolve();
        await release.promise;
      },
    );
    await held.promise;
    const waiting = transition(
      collaborator,
      "undo",
      {
        operationId: createId(),
        commandId: input.operationId,
        expectedStackVersion: 1,
      },
      owner.workspace.id,
    ).then((response) => response);
    try {
      await expect
        .poll(async () => {
          const [row] = await database.connection
            .sql`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock' AND query ILIKE '%workspaces%'`;
          return row?.count ?? 0;
        })
        .toBeGreaterThan(0);
    } finally {
      release.resolve();
    }
    await revocation;
    expect((await waiting).statusCode).toBe(404);
    expect(await get(owner, event.id)).toMatchObject({
      displayName: "Editor edit",
      version: 2,
    });
  });
});
