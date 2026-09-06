import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const objectTypes = [
  "event",
  "task",
  "expense",
  "reminder",
  "document",
] as const;
export type ObjectType = (typeof objectTypes)[number];

export const roles = ["owner", "editor", "viewer"] as const;
export type Role = (typeof roles)[number];

export const principalTypes = ["user"] as const;
export type PrincipalType = (typeof principalTypes)[number];

export const relationTypes = [
  "includes",
  "reminds_about",
  "attached_to",
  "related_to",
] as const;
export type RelationType = (typeof relationTypes)[number];

export const actorTypes = [
  "user",
  "assistant",
  "service_account",
  "system",
] as const;
export type ActorType = (typeof actorTypes)[number];

export const documentTransferOperations = ["upload", "download"] as const;
export type DocumentTransferOperation =
  (typeof documentTransferOperations)[number];

export const taskStatuses = [
  "todo",
  "in_progress",
  "done",
  "cancelled",
] as const;
export type TaskStatus = (typeof taskStatuses)[number];

export const reminderStatuses = [
  "pending",
  "triggered",
  "dismissed",
  "cancelled",
] as const;
export type ReminderStatus = (typeof reminderStatuses)[number];

const createCreatedAtColumn = () =>
  timestamp("created_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow();
const createUpdatedAtColumn = () =>
  timestamp("updated_at", { mode: "date", withTimezone: true })
    .notNull()
    .defaultNow();
const createMetadataColumn = () =>
  jsonb("metadata")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`);

export const users = pgTable("users", {
  id: uuid("id").primaryKey(),
  identityProvider: text("identity_provider").notNull(),
  providerSubject: text("provider_subject").notNull(),
  email: text("email"),
  displayName: text("display_name").notNull(),
  createdAt: createCreatedAtColumn(),
  updatedAt: createUpdatedAtColumn(),
});

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey(),
  displayName: text("display_name").notNull(),
  createdBy: uuid("created_by").notNull(),
  personalOwnerId: uuid("personal_owner_id"),
  createdAt: createCreatedAtColumn(),
  updatedAt: createUpdatedAtColumn(),
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    role: text("role").$type<Role>().notNull(),
    createdAt: createCreatedAtColumn(),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const objects = pgTable("objects", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  objectType: text("object_type").$type<ObjectType>().notNull(),
  displayName: text("display_name").notNull(),
  createdBy: uuid("created_by").notNull(),
  permissionScopeId: uuid("permission_scope_id").notNull(),
  createdAt: createCreatedAtColumn(),
  updatedAt: createUpdatedAtColumn(),
  version: integer("version").notNull().default(1),
  archivedAt: timestamp("archived_at", {
    mode: "date",
    withTimezone: true,
  }),
  deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
  customProperties: jsonb("custom_properties")
    .$type<Record<string, unknown>>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  metadata: createMetadataColumn(),
});

export const objectRelations = pgTable("object_relations", {
  version: integer("version").notNull().default(1),
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  sourceObjectId: uuid("source_object_id").notNull(),
  relationType: text("relation_type").$type<RelationType>().notNull(),
  targetObjectId: uuid("target_object_id").notNull(),
  metadata: createMetadataColumn(),
  createdBy: uuid("created_by").notNull(),
  createdAt: createCreatedAtColumn(),
  deletedAt: timestamp("deleted_at", { mode: "date", withTimezone: true }),
});

export const resourceGrants = pgTable("resource_grants", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  resourceId: uuid("resource_id").notNull(),
  principalType: text("principal_type")
    .$type<PrincipalType>()
    .notNull()
    .default("user"),
  principalId: uuid("principal_id").notNull(),
  role: text("role").$type<Role>().notNull(),
  grantedBy: uuid("granted_by").notNull(),
  createdAt: createCreatedAtColumn(),
  expiresAt: timestamp("expires_at", { mode: "date", withTimezone: true }),
});

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  actorType: text("actor_type").$type<ActorType>().notNull(),
  actorId: uuid("actor_id"),
  action: text("action").notNull(),
  resourceId: uuid("resource_id"),
  requestId: uuid("request_id").notNull(),
  metadata: createMetadataColumn(),
  createdAt: createCreatedAtColumn(),
});

export const revisionKinds = [
  "recovered",
  "restored",
  "baseline",
  "created",
  "updated",
  "permission_scope_updated",
  "deleted",
] as const;
export type RevisionKind = (typeof revisionKinds)[number];

export const objectRevisions = pgTable("object_revisions", {
  sourceRevisionId: uuid("source_revision_id"),
  id: uuid("id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  objectId: uuid("object_id").notNull(),
  objectVersion: integer("object_version").notNull(),
  mutationKind: text("mutation_kind").$type<RevisionKind>().notNull(),
  actorType: text("actor_type").$type<ActorType>().notNull(),
  actorId: uuid("actor_id"),
  requestId: uuid("request_id").notNull(),
  auditEventId: uuid("audit_event_id").notNull(),
  snapshotSchemaVersion: integer("snapshot_schema_version").notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  createdAt: createCreatedAtColumn(),
});

export const eventContextCommands = pgTable(
  "event_context_commands",
  {
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    commandId: uuid("command_id").notNull(),
    requestId: uuid("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    contextObjectId: uuid("context_object_id").notNull(),
    objectId: uuid("object_id").notNull(),
    relationId: uuid("relation_id").notNull(),
    createdAt: createCreatedAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId, table.commandId] }),
  ],
);

export const commandStacks = pgTable(
  "command_stacks",
  {
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    version: integer("version").notNull().default(0),
    undoIds: uuid("undo_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    redoIds: uuid("redo_ids")
      .array()
      .notNull()
      .default(sql`'{}'`),
    expectedVersions: jsonb("expected_versions")
      .$type<Record<string, number>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [primaryKey({ columns: [table.workspaceId, table.userId] })],
);

export const reversibleCommands = pgTable(
  "reversible_commands",
  {
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    id: uuid("id").notNull(),
    createdAt: createCreatedAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId, table.id] }),
  ],
);

export const commandChanges = pgTable(
  "command_changes",
  {
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    commandId: uuid("command_id").notNull(),
    objectId: uuid("object_id").notNull(),
    beforeVersion: integer("before_version").notNull(),
    afterVersion: integer("after_version").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [
        table.workspaceId,
        table.userId,
        table.commandId,
        table.objectId,
      ],
    }),
  ],
);

export const commandReceipts = pgTable(
  "command_receipts",
  {
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    operationId: uuid("operation_id").notNull(),
    commandId: uuid("command_id").notNull(),
    requestHash: text("request_hash").notNull(),
    auditEventId: uuid("audit_event_id").notNull(),
    receipt: jsonb("receipt").$type<Record<string, unknown>>().notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.workspaceId, table.userId, table.operationId],
    }),
  ],
);

export const events = pgTable("events", {
  objectId: uuid("object_id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  objectType: text("object_type").$type<"event">().notNull().default("event"),
  startsAt: timestamp("starts_at", { mode: "date", withTimezone: true }),
  endsAt: timestamp("ends_at", { mode: "date", withTimezone: true }),
  timezone: text("timezone"),
  isAllDay: boolean("is_all_day").notNull().default(false),
});

export const tasks = pgTable("tasks", {
  objectId: uuid("object_id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  objectType: text("object_type").$type<"task">().notNull().default("task"),
  status: text("status").$type<TaskStatus>().notNull().default("todo"),
  dueAt: timestamp("due_at", { mode: "date", withTimezone: true }),
  completedAt: timestamp("completed_at", {
    mode: "date",
    withTimezone: true,
  }),
});

export const expenses = pgTable("expenses", {
  objectId: uuid("object_id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  objectType: text("object_type")
    .$type<"expense">()
    .notNull()
    .default("expense"),
  amount: numeric("amount", { precision: 19, scale: 4 }).notNull(),
  currency: text("currency").notNull(),
  occurredAt: timestamp("occurred_at", {
    mode: "date",
    withTimezone: true,
  }).notNull(),
});

export const reminders = pgTable("reminders", {
  objectId: uuid("object_id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  objectType: text("object_type")
    .$type<"reminder">()
    .notNull()
    .default("reminder"),
  remindAt: timestamp("remind_at", {
    mode: "date",
    withTimezone: true,
  }).notNull(),
  status: text("status").$type<ReminderStatus>().notNull().default("pending"),
});

export const documents = pgTable("documents", {
  objectId: uuid("object_id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  objectType: text("object_type")
    .$type<"document">()
    .notNull()
    .default("document"),
  storageProvider: text("storage_provider").notNull(),
  storageKey: text("storage_key").notNull(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
  checksumSha256: text("checksum_sha256").notNull(),
  encryptionMode: text("encryption_mode").notNull().default("provider"),
});

export const documentTransferAuthorizations = pgTable(
  "document_transfer_authorizations",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    operation: text("operation").$type<DocumentTransferOperation>().notNull(),
    tokenHash: text("token_hash").notNull(),
    resourceId: uuid("resource_id").notNull(),
    storageProvider: text("storage_provider").notNull(),
    storageKey: text("storage_key").notNull(),
    originalFilename: text("original_filename").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    authorizedBy: uuid("authorized_by").notNull(),
    createdAt: createCreatedAtColumn(),
    expiresAt: timestamp("expires_at", {
      mode: "date",
      withTimezone: true,
    }).notNull(),
    consumedAt: timestamp("consumed_at", {
      mode: "date",
      withTimezone: true,
    }),
    finalizedAt: timestamp("finalized_at", {
      mode: "date",
      withTimezone: true,
    }),
  },
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type WorkspaceRow = typeof workspaces.$inferSelect;
export type NewWorkspaceRow = typeof workspaces.$inferInsert;
export type WorkspaceMemberRow = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMemberRow = typeof workspaceMembers.$inferInsert;
export type ObjectRow = typeof objects.$inferSelect;
export type NewObjectRow = typeof objects.$inferInsert;
export type ObjectRelationRow = typeof objectRelations.$inferSelect;
export type NewObjectRelationRow = typeof objectRelations.$inferInsert;
export type ResourceGrantRow = typeof resourceGrants.$inferSelect;
export type NewResourceGrantRow = typeof resourceGrants.$inferInsert;
export type AuditEventRow = typeof auditEvents.$inferSelect;
export type NewAuditEventRow = typeof auditEvents.$inferInsert;
export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
export type TaskRow = typeof tasks.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type ExpenseRow = typeof expenses.$inferSelect;
export type NewExpenseRow = typeof expenses.$inferInsert;
export type ReminderRow = typeof reminders.$inferSelect;
export type NewReminderRow = typeof reminders.$inferInsert;
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;
export type DocumentTransferAuthorizationRow =
  typeof documentTransferAuthorizations.$inferSelect;
export type NewDocumentTransferAuthorizationRow =
  typeof documentTransferAuthorizations.$inferInsert;
