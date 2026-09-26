import { resolve } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createId } from "../src/ids.js";
import {
  applyMigrations,
  createTestDatabase,
  type TestDatabase,
} from "../src/testing.js";

const migrationDirectory = resolve(
  import.meta.dirname,
  "../../../infrastructure/migrations",
);
let database: TestDatabase;

beforeAll(async () => {
  database = await createTestDatabase();
  await applyMigrations(
    { DATABASE_URL: database.databaseUrl },
    migrationDirectory,
  );
});

afterAll(async () => {
  await database?.close();
});

/** Keys that follow an object to another workspace. */
const carriedKeys = [
  "document_transfers_resource_workspace_fk",
  "documents_canonical_object_fk",
  "events_canonical_object_fk",
  "expenses_canonical_object_fk",
  "notes_canonical_object_fk",
  "object_relations_source_workspace_fk",
  "object_relations_target_workspace_fk",
  "pending_shares_resource_workspace_fk",
  "reminders_canonical_object_fk",
  "resource_grants_resource_workspace_fk",
  "tasks_canonical_object_fk",
];

/** Keys by which a ledger names an object or a revision, by id alone. */
const ledgerKeys = {
  audit_events_resource_fk:
    "FOREIGN KEY (resource_id) REFERENCES objects(id) ON DELETE RESTRICT",
  command_changes_after_revision_fk:
    "FOREIGN KEY (object_id, after_version) REFERENCES object_revisions(object_id, object_version) ON DELETE RESTRICT",
  command_changes_before_revision_fk:
    "FOREIGN KEY (object_id, before_version) REFERENCES object_revisions(object_id, object_version) ON DELETE RESTRICT",
  event_context_commands_context_object_fk:
    "FOREIGN KEY (context_object_id) REFERENCES objects(id) ON DELETE RESTRICT",
  event_context_commands_object_fk:
    "FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE RESTRICT",
  object_create_commands_object_fk:
    "FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE RESTRICT",
  object_revisions_object_fk:
    "FOREIGN KEY (object_id) REFERENCES objects(id) ON DELETE RESTRICT",
  object_revisions_source_revision_id_fkey:
    "FOREIGN KEY (source_revision_id) REFERENCES object_revisions(id) ON DELETE RESTRICT",
};

const ledgerTables = [
  "audit_events",
  "command_changes",
  "command_receipts",
  "event_context_commands",
  "event_page_revisions",
  "object_create_commands",
  "object_revisions",
];

interface Spaces {
  readonly ownerId: string;
  readonly guestId: string;
  readonly from: string;
  readonly to: string;
}

async function createSpaces(): Promise<Spaces> {
  const sql = database.connection.sql;
  const ownerId = createId();
  const guestId = createId();
  const from = createId();
  const to = createId();
  await sql`
    INSERT INTO users (id, identity_provider, provider_subject, display_name)
    VALUES (${ownerId}, 'test', ${ownerId}, 'Owner'),
      (${guestId}, 'test', ${guestId}, 'Guest')
  `;
  await sql`
    INSERT INTO workspaces (id, display_name, created_by)
    VALUES (${from}, 'From', ${ownerId}), (${to}, 'To', ${ownerId})
  `;
  return { ownerId, guestId, from, to };
}

async function insertObject(
  spaces: Spaces,
  objectType: string,
  scopeId?: string,
  options: { deleted?: boolean } = {},
): Promise<string> {
  const id = createId();
  await database.connection.sql`
    INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id, deleted_at)
    VALUES (${id}, ${spaces.from}, ${objectType}, ${`A ${objectType}`}, ${spaces.ownerId},
      ${scopeId ?? id}, CASE WHEN ${options.deleted ?? false}::boolean THEN now() END)
  `;
  return id;
}

async function insertSection(
  workspaceId: string,
  eventId: string,
  view: "todos" | "expenses",
  createdBy: string,
): Promise<string> {
  const id = createId();
  await database.connection.sql`
    INSERT INTO sections (id, workspace_id, event_id, view, name, rank, created_by)
    VALUES (${id}, ${workspaceId}, ${eventId}, ${view}, 'A section', '00000001000', ${createdBy})
  `;
  return id;
}

async function insertRelation(
  spaces: Spaces,
  sourceId: string,
  relationType: string,
  targetId: string,
): Promise<string> {
  const id = createId();
  await database.connection.sql`
    INSERT INTO object_relations (id, workspace_id, source_object_id, relation_type, target_object_id, created_by)
    VALUES (${id}, ${spaces.from}, ${sourceId}, ${relationType}, ${targetId}, ${spaces.ownerId})
  `;
  return id;
}

function insertGrant(
  spaces: Spaces,
  resourceId: string,
  scope: string,
  sectionId: string | null = null,
) {
  return database.connection.sql`
    INSERT INTO resource_grants (id, workspace_id, resource_id, principal_id, role, granted_by, scope, section_id)
    VALUES (${createId()}, ${spaces.from}, ${resourceId}, ${spaces.guestId}, 'editor', ${spaces.ownerId},
      ${scope}, ${sectionId})
  `;
}

/** Moves the named objects with the one UPDATE a move is made of. */
function move(ids: readonly string[], workspaceId: string) {
  const sql = database.connection.sql;
  return sql`
    UPDATE objects SET workspace_id = ${workspaceId}
    WHERE id = ANY(${sql.array([...ids])}::uuid[])
  `;
}

/**
 * Every row that lives with an Event's scope, with its workspace apart
 * from the rest of the row.
 */
function scopeRows(eventId: string) {
  return database.connection.sql<
    { kind: string; workspace_id: string; body: unknown }[]
  >`
    WITH scope AS (SELECT id FROM objects WHERE permission_scope_id = ${eventId})
    SELECT kind, workspace_id, carried - 'workspace_id' AS body
    FROM (
      SELECT 'objects' AS kind, o.workspace_id, to_jsonb(o) AS carried FROM objects o WHERE o.id IN (SELECT id FROM scope)
      UNION ALL SELECT 'events', e.workspace_id, to_jsonb(e) FROM events e WHERE e.object_id IN (SELECT id FROM scope)
      UNION ALL SELECT 'tasks', t.workspace_id, to_jsonb(t) FROM tasks t WHERE t.object_id IN (SELECT id FROM scope)
      UNION ALL SELECT 'expenses', x.workspace_id, to_jsonb(x) FROM expenses x WHERE x.object_id IN (SELECT id FROM scope)
      UNION ALL SELECT 'reminders', r.workspace_id, to_jsonb(r) FROM reminders r WHERE r.object_id IN (SELECT id FROM scope)
      UNION ALL SELECT 'notes', n.workspace_id, to_jsonb(n) FROM notes n WHERE n.object_id IN (SELECT id FROM scope)
      UNION ALL SELECT 'documents', d.workspace_id, to_jsonb(d) FROM documents d WHERE d.object_id IN (SELECT id FROM scope)
      UNION ALL SELECT 'object_relations', r.workspace_id, to_jsonb(r) FROM object_relations r WHERE r.source_object_id IN (SELECT id FROM scope)
      UNION ALL SELECT 'resource_grants', g.workspace_id, to_jsonb(g) FROM resource_grants g WHERE g.resource_id IN (SELECT id FROM scope)
      UNION ALL SELECT 'pending_shares', p.workspace_id, to_jsonb(p) FROM pending_shares p WHERE p.resource_id IN (SELECT id FROM scope)
      UNION ALL SELECT 'document_transfer_authorizations', a.workspace_id, to_jsonb(a) FROM document_transfer_authorizations a WHERE a.resource_id IN (SELECT id FROM scope)
      UNION ALL SELECT 'sections', s.workspace_id, to_jsonb(s) FROM sections s WHERE s.event_id = ${eventId}
    ) rows
    ORDER BY kind, carried ->> 'id', carried ->> 'object_id'
  `;
}

function tally(rows: readonly { kind: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const { kind } of rows) counts[kind] = (counts[kind] ?? 0) + 1;
  return counts;
}

/** An Event's revision at a version, with its audit event, written in one workspace. */
function insertRevision(
  workspaceId: string,
  eventId: string,
  actorId: string,
  version: number,
) {
  return database.connection.sql.begin(async (sql) => {
    const auditEventId = createId();
    const requestId = createId();
    await sql`
      INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id)
      VALUES (${auditEventId}, ${workspaceId}, 'user', ${actorId},
        ${version === 1 ? "event.created" : "event.updated"}, ${eventId}, ${requestId})
    `;
    await sql`
      INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind,
        actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot)
      VALUES (${createId()}, ${workspaceId}, ${eventId}, ${version},
        ${version === 1 ? "created" : "updated"}, 'user', ${actorId}, ${requestId}, ${auditEventId}, 1,
        ${JSON.stringify({ id: eventId, workspaceId, version, objectType: "event" })}::jsonb)
    `;
  });
}

/** An Event's layout revision at a version, with its audit event, written in one workspace. */
function insertLayout(
  workspaceId: string,
  eventId: string,
  actorId: string,
  version: number,
) {
  return database.connection.sql.begin(async (sql) => {
    const auditEventId = createId();
    await sql`
      INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id)
      VALUES (${auditEventId}, ${workspaceId}, 'user', ${actorId}, 'event.layout_updated', ${eventId}, ${createId()})
    `;
    await sql`
      INSERT INTO event_page_revisions (workspace_id, event_id, version, pages, audit_event_id)
      VALUES (${workspaceId}, ${eventId}, ${version}, '[]'::jsonb, ${auditEventId})
    `;
  });
}

describe.sequential("keys that carry rows to another workspace", () => {
  it("cascades the carried keys and keeps the scope and person keys", async () => {
    const rows = await database.connection.sql<
      {
        conname: string;
        definition: string;
        confupdtype: string;
        confdeltype: string;
        convalidated: boolean;
        condeferrable: boolean;
      }[]
    >`
      SELECT conname, pg_get_constraintdef(oid) AS definition,
        confupdtype, confdeltype, convalidated, condeferrable
      FROM pg_constraint
      WHERE contype = 'f' AND confrelid = 'objects'::regclass
    `;
    const keys = new Map(rows.map(({ conname, ...key }) => [conname, key]));
    const settled = { convalidated: true, condeferrable: false };
    for (const name of carriedKeys) {
      expect(keys.get(name), name).toMatchObject({
        confupdtype: "c",
        confdeltype: "r",
        ...settled,
      });
    }
    expect(keys.get("sections_event_workspace_fk")).toEqual({
      definition:
        "FOREIGN KEY (workspace_id, event_id) REFERENCES objects(workspace_id, id) ON UPDATE CASCADE ON DELETE CASCADE",
      confupdtype: "c",
      confdeltype: "c",
      ...settled,
    });
    expect(keys.has("sections_event_id_fkey")).toBe(false);
    for (const name of [
      "objects_permission_scope_workspace_fk",
      "persons_canonical_object_fk",
    ]) {
      expect(keys.get(name), name).toMatchObject({
        confupdtype: "a",
        confdeltype: "r",
        ...settled,
      });
    }
  });

  it("carries an Event's scope and the rows that live with it in one update", async () => {
    const sql = database.connection.sql;
    const spaces = await createSpaces();
    const eventId = await insertObject(spaces, "event");
    const taskId = await insertObject(spaces, "task", eventId);
    const subtaskId = await insertObject(spaces, "task", eventId);
    const trashedTaskId = await insertObject(spaces, "task", eventId, {
      deleted: true,
    });
    const expenseId = await insertObject(spaces, "expense", eventId);
    const reminderId = await insertObject(spaces, "reminder", eventId);
    const noteId = await insertObject(spaces, "note", eventId);
    const documentId = await insertObject(spaces, "document", eventId);
    const personId = await insertObject(spaces, "person");
    const todos = await insertSection(
      spaces.from,
      eventId,
      "todos",
      spaces.ownerId,
    );
    const expenses = await insertSection(
      spaces.from,
      eventId,
      "expenses",
      spaces.ownerId,
    );
    await sql`INSERT INTO events (object_id, workspace_id) VALUES (${eventId}, ${spaces.from})`;
    await sql`
      INSERT INTO tasks (object_id, workspace_id, section_id, parent_task_id)
      VALUES (${taskId}, ${spaces.from}, ${todos}, NULL),
        (${subtaskId}, ${spaces.from}, NULL, ${taskId}),
        (${trashedTaskId}, ${spaces.from}, NULL, NULL)
    `;
    await sql`
      INSERT INTO expenses (object_id, workspace_id, amount, currency, occurred_at, section_id)
      VALUES (${expenseId}, ${spaces.from}, 120, 'USD', now(), ${expenses})
    `;
    await sql`INSERT INTO reminders (object_id, workspace_id, remind_at) VALUES (${reminderId}, ${spaces.from}, now())`;
    await sql`INSERT INTO notes (object_id, workspace_id) VALUES (${noteId}, ${spaces.from})`;
    await sql`
      INSERT INTO documents (object_id, workspace_id, storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum_sha256)
      VALUES (${documentId}, ${spaces.from}, 'local', ${`${spaces.from}/${documentId}`}, 'plan.pdf', 'application/pdf', 3,
        ${"a".repeat(64)})
    `;
    await sql`INSERT INTO persons (object_id, workspace_id) VALUES (${personId}, ${spaces.from})`;
    await insertRelation(spaces, eventId, "includes", taskId);
    await insertRelation(spaces, documentId, "attached_to", eventId);
    const removedRelationId = await insertRelation(
      spaces,
      eventId,
      "includes",
      trashedTaskId,
    );
    await sql`
      UPDATE object_relations SET deleted_at = now(), version = 2
      WHERE id = ${removedRelationId}
    `;
    await insertGrant(spaces, eventId, "all");
    await insertGrant(spaces, eventId, "todos", todos);
    const connectionId = createId();
    await sql`
      INSERT INTO user_connections (id, requester_id, addressee_id, status)
      VALUES (${connectionId}, ${spaces.ownerId}, ${spaces.guestId}, 'accepted')
    `;
    await sql`
      INSERT INTO pending_shares (id, workspace_id, resource_id, connection_id, role, granted_by)
      VALUES (${createId()}, ${spaces.from}, ${eventId}, ${connectionId}, 'viewer', ${spaces.ownerId})
    `;
    await sql`
      INSERT INTO document_transfer_authorizations (id, workspace_id, operation, token_hash, resource_id,
        storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum_sha256,
        authorized_by, expires_at)
      VALUES (${createId()}, ${spaces.from}, 'download', ${"b".repeat(64)}, ${documentId},
        'local', ${`${spaces.from}/${documentId}`}, 'plan.pdf', 'application/pdf', 3, ${"a".repeat(64)},
        ${spaces.ownerId}, now() + interval '1 hour')
    `;
    const before = await scopeRows(eventId);
    expect(tally(before)).toEqual({
      document_transfer_authorizations: 1,
      documents: 1,
      events: 1,
      expenses: 1,
      notes: 1,
      object_relations: 3,
      objects: 8,
      pending_shares: 1,
      reminders: 1,
      resource_grants: 2,
      sections: 2,
      tasks: 3,
    });
    expect(
      before.every(({ workspace_id }) => workspace_id === spaces.from),
    ).toBe(true);

    await move(
      [
        eventId,
        taskId,
        subtaskId,
        trashedTaskId,
        expenseId,
        reminderId,
        noteId,
        documentId,
      ],
      spaces.to,
    );

    expect(await scopeRows(eventId)).toEqual(
      before.map((row) => ({ ...row, workspace_id: spaces.to })),
    );
    expect(
      await sql`
        SELECT o.workspace_id AS object_workspace, p.workspace_id AS person_workspace
        FROM objects o JOIN persons p ON p.object_id = o.id WHERE o.id = ${personId}
      `,
    ).toEqual([
      { object_workspace: spaces.from, person_workspace: spaces.from },
    ]);
  });

  it("refuses an update that leaves a scoped record, a person, or a related record behind", async () => {
    const sql = database.connection.sql;
    const spaces = await createSpaces();
    const eventId = await insertObject(spaces, "event");
    const taskId = await insertObject(spaces, "task", eventId);
    await sql`INSERT INTO events (object_id, workspace_id) VALUES (${eventId}, ${spaces.from})`;
    await sql`INSERT INTO tasks (object_id, workspace_id) VALUES (${taskId}, ${spaces.from})`;
    const personId = await insertObject(spaces, "person");
    const guestCardId = await insertObject(spaces, "person");
    await sql`
      INSERT INTO persons (object_id, workspace_id)
      VALUES (${personId}, ${spaces.from}), (${guestCardId}, ${spaces.from})
    `;
    const partyId = await insertObject(spaces, "event");
    await insertRelation(spaces, partyId, "includes", guestCardId);

    await expect(move([eventId], spaces.to)).rejects.toMatchObject({
      code: "23503",
      constraint_name: "objects_permission_scope_workspace_fk",
    });
    await expect(move([personId], spaces.to)).rejects.toMatchObject({
      code: "23503",
      constraint_name: "persons_canonical_object_fk",
    });
    await expect(move([partyId], spaces.to)).rejects.toMatchObject({
      code: "23503",
      constraint_name: "object_relations_target_workspace_fk",
    });
    expect(
      await sql`
        SELECT DISTINCT workspace_id FROM (
          SELECT workspace_id FROM objects WHERE id IN (${eventId}, ${taskId}, ${personId}, ${partyId})
          UNION ALL SELECT workspace_id FROM events WHERE object_id = ${eventId}
          UNION ALL SELECT workspace_id FROM persons WHERE object_id = ${personId}
          UNION ALL SELECT workspace_id FROM object_relations WHERE source_object_id = ${partyId}
        ) rows
      `,
    ).toEqual([{ workspace_id: spaces.from }]);
  });

  it("keeps a section in its Event's workspace", async () => {
    const spaces = await createSpaces();
    const eventId = await insertObject(spaces, "event");
    await expect(
      insertSection(spaces.to, eventId, "todos", spaces.ownerId),
    ).rejects.toMatchObject({
      code: "23503",
      constraint_name: "sections_event_workspace_fk",
    });
  });

  it("still rejects unversioned relation changes and grants narrowed past their Event", async () => {
    const sql = database.connection.sql;
    const spaces = await createSpaces();
    const eventId = await insertObject(spaces, "event");
    const taskId = await insertObject(spaces, "task", eventId);
    const otherTaskId = await insertObject(spaces, "task", eventId);
    const relationId = await insertRelation(
      spaces,
      eventId,
      "includes",
      taskId,
    );
    const rejected = [
      sql`UPDATE object_relations SET deleted_at = now() WHERE id = ${relationId}`,
      sql`UPDATE object_relations SET target_object_id = ${otherTaskId}, version = 2 WHERE id = ${relationId}`,
      sql`UPDATE object_relations SET workspace_id = ${spaces.to}, version = 2 WHERE id = ${relationId}`,
      sql`UPDATE object_relations SET workspace_id = ${spaces.to}, metadata = '{"moved": true}' WHERE id = ${relationId}`,
    ];
    for (const update of rejected) {
      await expect(update).rejects.toMatchObject({ code: "23514" });
    }
    // The workspace alone may change, but only to where both objects are.
    await expect(
      sql`UPDATE object_relations SET workspace_id = ${spaces.to} WHERE id = ${relationId}`,
    ).rejects.toMatchObject({ code: "23503" });
    await sql`UPDATE object_relations SET deleted_at = now(), version = 2 WHERE id = ${relationId}`;

    const todos = await insertSection(
      spaces.from,
      eventId,
      "todos",
      spaces.ownerId,
    );
    const otherEventId = await insertObject(spaces, "event");
    const otherTodos = await insertSection(
      spaces.from,
      otherEventId,
      "todos",
      spaces.ownerId,
    );
    await expect(
      insertGrant(spaces, eventId, "todos", otherTodos),
    ).rejects.toMatchObject({ code: "PT422" });
    await expect(
      insertGrant(spaces, eventId, "expenses", todos),
    ).rejects.toMatchObject({ code: "PT422" });
    await expect(insertGrant(spaces, taskId, "todos")).rejects.toMatchObject({
      code: "PT422",
    });
    await insertGrant(spaces, eventId, "todos", todos);
    await expect(
      sql`UPDATE resource_grants SET section_id = ${otherTodos} WHERE section_id = ${todos}`,
    ).rejects.toMatchObject({ code: "PT422" });
  });
});

describe.sequential("keys that keep history where it was written", () => {
  it("names each ledger's object by id alone", async () => {
    const sql = database.connection.sql;
    const rows = await sql<
      {
        conname: string;
        definition: string;
        confupdtype: string;
        confdeltype: string;
        convalidated: boolean;
        condeferrable: boolean;
      }[]
    >`
      SELECT conname, pg_get_constraintdef(oid) AS definition,
        confupdtype, confdeltype, convalidated, condeferrable
      FROM pg_constraint
      WHERE contype = 'f'
        AND conrelid::regclass::text = ANY(${sql.array(ledgerTables)})
        AND confrelid IN ('objects'::regclass, 'object_revisions'::regclass)
    `;
    expect(
      Object.fromEntries(rows.map((row) => [row.conname, row.definition])),
    ).toEqual(ledgerKeys);
    for (const { conname, ...key } of rows) {
      expect(key, conname).toMatchObject({
        confupdtype: "a",
        confdeltype: "r",
        convalidated: true,
        condeferrable: false,
      });
    }
    const unique = await sql<{ conname: string; definition: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE contype IN ('u', 'p')
        AND conrelid IN ('object_revisions'::regclass, 'event_page_revisions'::regclass)
    `;
    expect(
      Object.fromEntries(unique.map((row) => [row.conname, row.definition])),
    ).toEqual({
      event_page_revisions_audit_event_id_key: "UNIQUE (audit_event_id)",
      event_page_revisions_event_version_unique: "UNIQUE (event_id, version)",
      event_page_revisions_pkey:
        "PRIMARY KEY (workspace_id, event_id, version)",
      object_revisions_audit_event_id_key: "UNIQUE (audit_event_id)",
      object_revisions_object_version_unique:
        "UNIQUE (object_id, object_version)",
      object_revisions_pkey: "PRIMARY KEY (id)",
    });
    expect(
      await sql`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE tablename = 'audit_events' AND indexname LIKE 'audit_events_resource%'
      `,
    ).toEqual([
      {
        indexname: "audit_events_resource_idx",
        indexdef: expect.stringContaining(
          "USING btree (resource_id, created_at DESC) WHERE (resource_id IS NOT NULL)",
        ),
      },
    ]);
  });

  it("leaves an object's history where it was written and continues it where it moves", async () => {
    const sql = database.connection.sql;
    const spaces = await createSpaces();
    const eventId = await insertObject(spaces, "event");
    await sql`INSERT INTO events (object_id, workspace_id) VALUES (${eventId}, ${spaces.from})`;
    await insertRevision(spaces.from, eventId, spaces.ownerId, 1);
    await insertLayout(spaces.from, eventId, spaces.ownerId, 1);
    const history = () => sql<{ kind: string; row: unknown }[]>`
      SELECT kind, row FROM (
        SELECT 'audit_events' AS kind, to_jsonb(a) AS row FROM audit_events a WHERE a.resource_id = ${eventId}
        UNION ALL SELECT 'object_revisions', to_jsonb(r) FROM object_revisions r WHERE r.object_id = ${eventId}
        UNION ALL SELECT 'event_page_revisions', to_jsonb(p) FROM event_page_revisions p WHERE p.event_id = ${eventId}
      ) ledgers
      ORDER BY kind, row::text
    `;
    const written = await history();
    expect(tally(written)).toEqual({
      audit_events: 2,
      event_page_revisions: 1,
      object_revisions: 1,
    });

    await move([eventId], spaces.to);
    expect(await history()).toEqual(written);

    // A version is one per object and a layout version one per Event,
    // whichever workspace writes it.
    await expect(
      insertRevision(spaces.to, eventId, spaces.ownerId, 1),
    ).rejects.toMatchObject({
      code: "23505",
      constraint_name: "object_revisions_object_version_unique",
    });
    await expect(
      insertLayout(spaces.to, eventId, spaces.ownerId, 1),
    ).rejects.toMatchObject({
      code: "23505",
      constraint_name: "event_page_revisions_event_version_unique",
    });
    // The next versions are written where the Event now is, and only there.
    await sql`UPDATE objects SET version = 2 WHERE id = ${eventId}`;
    await expect(
      insertRevision(spaces.from, eventId, spaces.ownerId, 2),
    ).rejects.toMatchObject({ code: "23514" });
    await insertRevision(spaces.to, eventId, spaces.ownerId, 2);
    await insertLayout(spaces.to, eventId, spaces.ownerId, 2);
    expect(
      await sql`
        SELECT workspace_id, object_version FROM object_revisions
        WHERE object_id = ${eventId} ORDER BY object_version
      `,
    ).toEqual([
      { workspace_id: spaces.from, object_version: 1 },
      { workspace_id: spaces.to, object_version: 2 },
    ]);
  });
});
