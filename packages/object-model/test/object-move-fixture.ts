import { createId } from "@livtales/db";
import type { TestDatabase } from "@livtales/db/testing";
import type { EventPage } from "@livtales/schemas";

import { ReversibleCommandService } from "../src/command-service.js";
import { EventLayoutService } from "../src/event-layout-service.js";
import { EventPlanningObjectService } from "../src/object-service.js";
import { ObjectRelationService } from "../src/relation-service.js";
import type { MutationContext } from "../src/types.js";

// One Event planned in a space, with everything a move carries, drops, and
// changes: a schedule item, a to-do assigned to a People card of the space
// with two labels (one the target has, one it lacks) and a subtask, a to-do
// in Trash assigned to another card, a note, a file with a transfer
// authorization, a section, two layout pages, a guest's share and a share
// the target's membership covers, two shares waiting on an invitation (one
// whose sharer is not in the target), links to a People card, another
// Event, and a card scoped to the Event, an incoming reminder link, a
// removed link, a link inside the scope, and an undo entry for the Event
// beside one for a record that stays. Built through the PostgreSQL services
// so that both backends move the same kind of history.

export const pages: EventPage[] = [
  {
    id: "00000000-0000-7000-8000-0000000000a1",
    name: "Overview",
    components: [
      { id: "00000000-0000-7000-8000-0000000000b1", kind: "calendar" },
    ],
  },
  {
    id: "00000000-0000-7000-8000-0000000000a2",
    name: "Logistics",
    components: [{ id: "00000000-0000-7000-8000-0000000000b2", kind: "todos" }],
  },
];

export interface MoveFixture {
  /** The space the Event is in, the target, one where the owner only views, and one they are not in. */
  readonly spaces: {
    readonly from: string;
    readonly to: string;
    readonly viewing: string;
    readonly foreign: string;
    readonly personal: string;
  };
  readonly users: {
    readonly owner: string;
    readonly coOwner: string;
    readonly editor: string;
    readonly guest: string;
    readonly covered: string;
    readonly targetViewer: string;
    readonly stranger: string;
  };
  readonly records: {
    readonly event: string;
    readonly scheduleItem: string;
    readonly assigned: string;
    readonly subtask: string;
    readonly trashed: string;
    readonly note: string;
    readonly document: string;
    readonly ana: string;
    readonly cleo: string;
    readonly ben: string;
    readonly reminder: string;
    readonly dinner: string;
  };
  readonly commands: { readonly event: string; readonly dinner: string };
  readonly storageKey: string;
  /** Every id the fixture made, by name, for comparing two fixtures. */
  readonly names: ReadonlyMap<string, string>;
  /** A request of a user in a space. */
  context(userId?: string, workspaceId?: string): MutationContext;
}

export async function buildMoveFixture(
  database: TestDatabase,
  label: string,
): Promise<MoveFixture> {
  const db = database.connection.db;
  const sql = database.connection.sql;
  const names = new Map<string, string>();
  const named = (name: string, id: string) => {
    names.set(id, name);
    return id;
  };

  const users = {
    owner: named("owner", createId()),
    coOwner: named("coOwner", createId()),
    editor: named("editor", createId()),
    guest: named("guest", createId()),
    covered: named("covered", createId()),
    targetViewer: named("targetViewer", createId()),
    stranger: named("stranger", createId()),
    friend: named("friend", createId()),
    otherFriend: named("otherFriend", createId()),
  };
  const displayNames: Record<keyof typeof users, string> = {
    owner: "Olivia",
    coOwner: "Jane",
    editor: "Dan",
    guest: "Gus",
    covered: "Cora",
    targetViewer: "Eve",
    stranger: "Sam",
    friend: "Fay",
    otherFriend: "Finn",
  };
  for (const [key, id] of Object.entries(users))
    await sql`
      INSERT INTO users (id, identity_provider, provider_subject, display_name)
      VALUES (${id}, 'test', ${id}, ${displayNames[key as keyof typeof users]})
    `;

  const spaces = {
    personal: named("personal", createId()),
    from: named("from", createId()),
    to: named("to", createId()),
    viewing: named("viewing", createId()),
    foreign: named("foreign", createId()),
  };
  await sql`
    INSERT INTO workspaces (id, display_name, created_by, personal_owner_id)
    VALUES (${spaces.personal}, 'Personal', ${users.owner}, ${users.owner}),
      (${spaces.from}, ${`Home ${label}`}, ${users.owner}, NULL),
      (${spaces.to}, ${`Our wedding ${label}`}, ${users.owner}, NULL),
      (${spaces.viewing}, ${`Book club ${label}`}, ${users.stranger}, NULL),
      (${spaces.foreign}, ${`Studio ${label}`}, ${users.stranger}, NULL)
  `;
  const members: [string, string, string][] = [
    [spaces.personal, users.owner, "owner"],
    [spaces.from, users.owner, "owner"],
    [spaces.from, users.coOwner, "owner"],
    [spaces.from, users.editor, "editor"],
    [spaces.to, users.owner, "owner"],
    [spaces.to, users.covered, "editor"],
    [spaces.to, users.targetViewer, "viewer"],
    [spaces.viewing, users.stranger, "owner"],
    [spaces.viewing, users.owner, "viewer"],
    [spaces.foreign, users.stranger, "owner"],
  ];
  for (const [workspaceId, userId, role] of members)
    await sql`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES (${workspaceId}, ${userId}, ${role})
    `;

  const labelIds = {
    venue: createId(),
    catering: createId(),
    targetVenue: createId(),
  };
  await sql`
    INSERT INTO labels (id, workspace_id, name, created_by)
    VALUES (${labelIds.venue}, ${spaces.from}, 'Venue', ${users.owner}),
      (${labelIds.catering}, ${spaces.from}, 'Catering', ${users.owner}),
      (${labelIds.targetVenue}, ${spaces.to}, 'venue', ${users.owner})
  `;

  const context = (
    userId: string = users.owner,
    workspaceId: string = spaces.from,
  ): MutationContext => ({
    principal: { type: "user", userId, workspaceId },
    requestId: createId(),
  });
  const objectService = new EventPlanningObjectService(db);
  const relations = new ObjectRelationService(db);
  const commands = new ReversibleCommandService(db);
  const layouts = new EventLayoutService(db);

  const event = await objectService.createEvent(context(), {
    displayName: "Gala",
    startsOn: "2030-10-16",
    isAllDay: true,
  });
  const scheduleItem = await objectService.createEvent(context(), {
    displayName: "Rehearsal",
    startsOn: "2030-10-15",
    isAllDay: true,
    permissionScopeId: event.id,
  });
  const ana = await objectService.createPerson(context(), {
    displayName: "Ana",
  });
  const cleo = await objectService.createPerson(context(), {
    displayName: "Cleo",
  });
  const ben = await objectService.createPerson(context(), {
    displayName: "Ben",
    permissionScopeId: event.id,
  });
  const assigned = await objectService.createTask(context(), {
    displayName: "Book the venue",
    permissionScopeId: event.id,
    assigneeId: ana.id,
    labelIds: [labelIds.venue, labelIds.catering],
  });
  const subtask = await objectService.createTask(context(), {
    displayName: "Sign the contract",
    permissionScopeId: event.id,
    parentTaskId: assigned.id,
  });
  const trashed = await objectService.createTask(context(), {
    displayName: "Hire a band",
    permissionScopeId: event.id,
    assigneeId: cleo.id,
  });
  await objectService.softDelete(context(), trashed.id, 1);
  const note = await objectService.createNote(context(), {
    displayName: "Menu",
    body: "Dumplings",
    permissionScopeId: event.id,
  });
  const reminder = await objectService.createReminder(context(), {
    displayName: "Call the hall",
    remindAt: new Date("2030-10-01T09:00:00.000Z"),
  });
  const dinner = await objectService.createEvent(context(), {
    displayName: "Dinner",
    startsOn: "2030-10-17",
    isAllDay: true,
  });

  const document = createId();
  const storageKey = `workspaces/${spaces.from}/documents/${createId()}`;
  await sql.begin(async (transaction) => {
    const auditEventId = createId();
    const requestId = createId();
    await transaction`
      INSERT INTO objects (id, workspace_id, object_type, display_name, created_by, permission_scope_id)
      VALUES (${document}, ${spaces.from}, 'document', 'Floor plan.pdf', ${users.owner}, ${event.id})
    `;
    await transaction`
      INSERT INTO documents (object_id, workspace_id, storage_provider, storage_key, original_filename,
        mime_type, size_bytes, checksum_sha256)
      VALUES (${document}, ${spaces.from}, 'local-filesystem', ${storageKey}, 'Floor plan.pdf',
        'application/pdf', 12, ${"a".repeat(64)})
    `;
    await transaction`
      INSERT INTO audit_events (id, workspace_id, actor_type, actor_id, action, resource_id, request_id)
      VALUES (${auditEventId}, ${spaces.from}, 'user', ${users.owner}, 'document.created', ${document}, ${requestId})
    `;
    await transaction`
      INSERT INTO object_revisions (id, workspace_id, object_id, object_version, mutation_kind,
        actor_type, actor_id, request_id, audit_event_id, snapshot_schema_version, snapshot)
      VALUES (${createId()}, ${spaces.from}, ${document}, 1, 'created', 'user', ${users.owner},
        ${requestId}, ${auditEventId}, 1,
        ${JSON.stringify({
          id: document,
          workspaceId: spaces.from,
          objectType: "document",
          version: 1,
        })}::jsonb)
    `;
    await transaction`
      INSERT INTO document_transfer_authorizations (id, workspace_id, operation, token_hash, resource_id,
        storage_provider, storage_key, original_filename, mime_type, size_bytes, checksum_sha256,
        authorized_by, expires_at)
      VALUES (${createId()}, ${spaces.from}, 'download', ${createId().replaceAll("-", "").repeat(2)},
        ${document}, 'local-filesystem', ${storageKey}, 'Floor plan.pdf', 'application/pdf', 12,
        ${"a".repeat(64)}, ${users.owner}, now() + interval '1 hour')
    `;
    await transaction`
      INSERT INTO sections (id, workspace_id, event_id, view, name, rank, created_by)
      VALUES (${createId()}, ${spaces.from}, ${event.id}, 'todos', 'Day one', '00000001000', ${users.owner})
    `;
  });
  await layouts.update(context(), event.id, { expectedVersion: 0, pages });

  const link = async (
    name: string,
    sourceObjectId: string,
    relationType: "includes" | "reminds_about" | "related_to",
    targetObjectId: string,
  ) =>
    named(
      name,
      (
        await relations.create(context(), {
          sourceObjectId,
          relationType,
          targetObjectId,
        })
      ).id,
    );
  await link("inside", event.id, "includes", scheduleItem.id);
  await link("toAna", event.id, "includes", ana.id);
  await link("toDinner", event.id, "related_to", dinner.id);
  await link("fromReminder", reminder.id, "reminds_about", event.id);
  await link("toBen", event.id, "includes", ben.id);
  const removed = await link("toCleo", event.id, "includes", cleo.id);
  await relations.softDelete(context(), removed, 1);

  await sql`
    INSERT INTO resource_grants (id, workspace_id, resource_id, principal_id, role, granted_by)
    VALUES (${named("guestGrant", createId())}, ${spaces.from}, ${event.id}, ${users.guest}, 'viewer', ${users.owner}),
      (${named("coveredGrant", createId())}, ${spaces.from}, ${event.id}, ${users.covered}, 'editor', ${users.owner})
  `;
  const connection = createId();
  const otherConnection = createId();
  await sql`
    INSERT INTO user_connections (id, requester_id, addressee_id, status)
    VALUES (${connection}, ${users.owner}, ${users.friend}, 'pending'),
      (${otherConnection}, ${users.coOwner}, ${users.otherFriend}, 'pending')
  `;
  await sql`
    INSERT INTO pending_shares (id, workspace_id, resource_id, person_id, connection_id, role, granted_by)
    VALUES (${named("ownerShare", createId())}, ${spaces.from}, ${event.id}, ${ana.id}, ${connection}, 'viewer', ${users.owner}),
      (${named("coOwnerShare", createId())}, ${spaces.from}, ${event.id}, NULL, ${otherConnection}, 'editor', ${users.coOwner})
  `;

  const principal = context().principal;
  let stack = await commands.getState(principal);
  const onEvent = await commands.execute(context(), {
    operationId: createId(),
    expectedStackVersion: stack.version,
    edits: [
      {
        objectType: "event",
        objectId: event.id,
        patch: { expectedVersion: 1, displayName: "Gala night" },
      },
    ],
  });
  stack = await commands.getState(principal);
  const onDinner = await commands.execute(context(), {
    operationId: createId(),
    expectedStackVersion: stack.version,
    edits: [
      {
        objectType: "event",
        objectId: dinner.id,
        patch: { expectedVersion: 1, displayName: "Dinner out" },
      },
    ],
  });

  const records = {
    event: named("event", event.id),
    scheduleItem: named("scheduleItem", scheduleItem.id),
    assigned: named("assigned", assigned.id),
    subtask: named("subtask", subtask.id),
    trashed: named("trashed", trashed.id),
    note: named("note", note.id),
    document: named("document", document),
    ana: named("ana", ana.id),
    cleo: named("cleo", cleo.id),
    ben: named("ben", ben.id),
    reminder: named("reminder", reminder.id),
    dinner: named("dinner", dinner.id),
  };
  return {
    spaces,
    users,
    records,
    commands: {
      event: named("eventCommand", onEvent.commandId),
      dinner: named("dinnerCommand", onDinner.commandId),
    },
    storageKey,
    names,
    context,
  };
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;
const instantPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/u;

/**
 * A value with the fixture's ids replaced by their names (in keys too),
 * label ids by their space and name, other ids by "<id>", and instants by
 * "<instant>", so that two fixtures' rows compare equal.
 */
export function normalized(
  fixture: MoveFixture,
  labelNames: ReadonlyMap<string, string>,
  value: unknown,
): unknown {
  if (typeof value === "string") {
    if (uuidPattern.test(value))
      return (
        fixture.names.get(value.toLowerCase()) ??
        labelNames.get(value.toLowerCase()) ??
        "<id>"
      );
    if (instantPattern.test(value)) return "<instant>";
    return value.replaceAll(fixture.spaces.from, "<from>");
  }
  if (value instanceof Date) return "<instant>";
  if (Array.isArray(value))
    return value.map((item) => normalized(fixture, labelNames, item));
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        uuidPattern.test(key) ? normalized(fixture, labelNames, key) : key,
        normalized(fixture, labelNames, item),
      ]),
    );
  return value;
}

/** Every label of the fixture's spaces, by id, as "label:<space>:<name>". */
export async function fixtureLabels(
  database: TestDatabase,
  fixture: MoveFixture,
): Promise<Map<string, string>> {
  const rows = await database.connection.sql<
    { id: string; workspace_id: string; name: string }[]
  >`
    SELECT id, workspace_id, name FROM labels
    WHERE workspace_id IN (${fixture.spaces.from}, ${fixture.spaces.to})
  `;
  return new Map(
    rows.map((row) => [
      row.id,
      `label:${fixture.names.get(row.workspace_id)}:${row.name}`,
    ]),
  );
}

/**
 * The rows a move leaves for the fixture, normalized: where each record is
 * with its version and scope, the relations, assignees, labels, shares,
 * waiting shares, sections, the file and its transfer, the owner's stack
 * in the old space, and the audit events and revisions the move wrote.
 */
export async function movedRows(
  database: TestDatabase,
  fixture: MoveFixture,
  requestId: string,
) {
  const sql = database.connection.sql;
  const ids = sql.array([...Object.values(fixture.records)]);
  const labelNames = await fixtureLabels(database, fixture);
  const rows = {
    objects: await sql`
      SELECT id, workspace_id, version, permission_scope_id, deleted_at IS NOT NULL AS trashed
      FROM objects WHERE id = ANY(${ids}::uuid[]) ORDER BY id
    `,
    relations: await sql`
      SELECT workspace_id, source_object_id, relation_type, target_object_id, deleted_at IS NOT NULL AS removed, version
      FROM object_relations
      WHERE source_object_id = ANY(${ids}::uuid[]) OR target_object_id = ANY(${ids}::uuid[])
      ORDER BY id
    `,
    tasks: await sql`
      SELECT object_id, workspace_id, assignee_person_id, parent_task_id FROM tasks
      WHERE object_id = ANY(${ids}::uuid[]) ORDER BY object_id
    `,
    taskLabels: await sql`
      SELECT tl.task_id, tl.workspace_id, tl.label_id FROM task_labels tl
      WHERE tl.task_id = ANY(${ids}::uuid[]) ORDER BY tl.task_id, tl.label_id
    `,
    labels: await sql`
      SELECT workspace_id, name, created_by FROM labels
      WHERE workspace_id IN (${fixture.spaces.from}, ${fixture.spaces.to}) ORDER BY workspace_id, name
    `,
    grants: await sql`
      SELECT id, workspace_id, resource_id, principal_id, role FROM resource_grants
      WHERE resource_id = ANY(${ids}::uuid[]) ORDER BY principal_id
    `,
    pendingShares: await sql`
      SELECT id, workspace_id, resource_id, person_id, status FROM pending_shares
      WHERE resource_id = ANY(${ids}::uuid[]) ORDER BY granted_by
    `,
    sections: await sql`
      SELECT workspace_id, name FROM sections WHERE event_id = ${fixture.records.event}
    `,
    documents: await sql`
      SELECT workspace_id, storage_key = ${fixture.storageKey} AS same_key FROM documents
      WHERE object_id = ${fixture.records.document}
    `,
    transfers: await sql`
      SELECT workspace_id FROM document_transfer_authorizations WHERE resource_id = ${fixture.records.document}
    `,
    stacks: await sql`
      SELECT workspace_id, version, undo_ids, redo_ids, expected_versions FROM command_stacks
      WHERE user_id = ${fixture.users.owner} ORDER BY workspace_id
    `,
    audit: await sql`
      SELECT workspace_id, action, resource_id, metadata FROM audit_events
      WHERE request_id = ${requestId}
      ORDER BY workspace_id = ${fixture.spaces.to}, action, resource_id, metadata ->> 'relationId'
    `,
    revisions: await sql`
      SELECT r.workspace_id, r.object_id, r.object_version, r.mutation_kind, r.snapshot - 'createdAt' - 'updatedAt' AS snapshot,
        a.action, a.metadata
      FROM object_revisions r JOIN audit_events a ON a.id = r.audit_event_id
      WHERE r.request_id = ${requestId}
      ORDER BY r.object_id
    `,
  };
  return normalized(fixture, labelNames, rows) as Record<
    keyof typeof rows,
    Record<string, unknown>[]
  >;
}

/** Every ledger row written in the old space before the move, whole. */
export function oldSpaceLedgers(database: TestDatabase, fixture: MoveFixture) {
  const sql = database.connection.sql;
  return sql<{ ledger: string; row: Record<string, unknown> }[]>`
    SELECT ledger, row FROM (
      SELECT 'audit_events' AS ledger, to_jsonb(a) AS row FROM audit_events a WHERE a.workspace_id = ${fixture.spaces.from}
      UNION ALL SELECT 'object_revisions', to_jsonb(r) FROM object_revisions r WHERE r.workspace_id = ${fixture.spaces.from}
      UNION ALL SELECT 'command_changes', to_jsonb(c) FROM command_changes c WHERE c.workspace_id = ${fixture.spaces.from}
      UNION ALL SELECT 'command_receipts', to_jsonb(c) FROM command_receipts c WHERE c.workspace_id = ${fixture.spaces.from}
      UNION ALL SELECT 'event_page_revisions', to_jsonb(p) FROM event_page_revisions p WHERE p.workspace_id = ${fixture.spaces.from}
      UNION ALL SELECT 'event_context_commands', to_jsonb(c) FROM event_context_commands c WHERE c.workspace_id = ${fixture.spaces.from}
      UNION ALL SELECT 'object_create_commands', to_jsonb(c) FROM object_create_commands c WHERE c.workspace_id = ${fixture.spaces.from}
    ) ledgers
    ORDER BY ledger, row::text
  `;
}
