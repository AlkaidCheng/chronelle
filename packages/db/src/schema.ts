import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const objectTypes = [
  "event",
  "task",
  "expense",
  "reminder",
  "document",
  "person",
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

export const taskRepeatRules = [
  "daily",
  "weekdays",
  "weekly",
  "biweekly",
  "monthly",
  "yearly",
] as const;
export type TaskRepeatRule = (typeof taskRepeatRules)[number];

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
  /** Every account has one; an insert that leaves it empty gets one from the name in the database. */
  username: text("username")
    .notNull()
    .$defaultFn(() => ""),
  findByName: boolean("find_by_name").notNull().default(true),
  findByEmail: boolean("find_by_email").notNull().default(true),
  /** When the Welcome step was completed; null while it is due. */
  onboardedAt: timestamp("onboarded_at", { mode: "date", withTimezone: true }),
  locale: text("locale"),
  timeZone: text("time_zone"),
  hourCycle: text("hour_cycle"),
  weekStart: smallint("week_start"),
  rail: jsonb("rail")
    .$type<RailPreferenceRow>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  eventTabs: jsonb("event_tabs")
    .$type<EventTabsRow>()
    .notNull()
    .default(sql`'{}'::jsonb`),
  createdAt: createCreatedAtColumn(),
  updatedAt: createUpdatedAtColumn(),
});

/** How the rail lists the workspace collections: keys first to last, and keys left out. */
export interface RailPreferenceRow {
  readonly order?: readonly string[] | undefined;
  readonly hidden?: readonly string[] | undefined;
}

/**
 * How an event's tab strip lists its pages and views for the user: view
 * keys first to last, keys and page ids left out of the strip, and view
 * keys taken off the event.
 */
export interface EventTabsPreferenceRow {
  readonly order?: readonly string[] | undefined;
  readonly hidden?: readonly string[] | undefined;
  readonly removed?: readonly string[] | undefined;
}

/** Tab preferences keyed by event id. */
export type EventTabsRow = Readonly<Record<string, EventTabsPreferenceRow>>;

// Credential and session clocks carry millisecond precision so the API's comparisons agree with the functions'.
const createSessionInstantColumn = (name: string) =>
  timestamp(name, { mode: "date", withTimezone: true, precision: 3 });

export const userSessions = pgTable("user_sessions", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  tokenHash: text("token_hash").notNull(),
  identityProvider: text("identity_provider").notNull(),
  createdAt: createSessionInstantColumn("created_at").notNull().defaultNow(),
  expiresAt: createSessionInstantColumn("expires_at").notNull(),
  lastSeenAt: createSessionInstantColumn("last_seen_at").notNull().defaultNow(),
  revokedAt: createSessionInstantColumn("revoked_at"),
});

export const userCredentials = pgTable("user_credentials", {
  userId: uuid("user_id").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: createSessionInstantColumn("email_verified_at"),
  failedAttempts: integer("failed_attempts").notNull().default(0),
  lockedUntil: createSessionInstantColumn("locked_until"),
  createdAt: createSessionInstantColumn("created_at").notNull().defaultNow(),
  updatedAt: createSessionInstantColumn("updated_at").notNull().defaultNow(),
});

export const verificationPurposes = ["verify_email", "reset_password"] as const;
export type VerificationPurpose = (typeof verificationPurposes)[number];

export const emailVerifications = pgTable("email_verifications", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull(),
  purpose: text("purpose").$type<VerificationPurpose>().notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  createdAt: createSessionInstantColumn("created_at").notNull().defaultNow(),
  expiresAt: createSessionInstantColumn("expires_at").notNull(),
  consumedAt: createSessionInstantColumn("consumed_at"),
});

export const connectionStatuses = [
  "pending",
  "accepted",
  "declined",
  "withdrawn",
  "removed",
] as const;
export type ConnectionStatus = (typeof connectionStatuses)[number];

/** A friend request between two accounts, and the connection it becomes. */
export const userConnections = pgTable(
  "user_connections",
  {
    id: uuid("id").primaryKey(),
    requesterId: uuid("requester_id").notNull(),
    addresseeId: uuid("addressee_id").notNull(),
    status: text("status")
      .$type<ConnectionStatus>()
      .notNull()
      .default("pending"),
    message: text("message"),
    /** The requester's person card the invitation came from, in its workspace. */
    personId: uuid("person_id"),
    workspaceId: uuid("workspace_id"),
    createdAt: createSessionInstantColumn("created_at").notNull().defaultNow(),
    lastSentAt: createSessionInstantColumn("last_sent_at")
      .notNull()
      .defaultNow(),
    respondedAt: createSessionInstantColumn("responded_at"),
  },
  (table) => [
    uniqueIndex("user_connections_live_pair_idx")
      .on(
        sql`LEAST(${table.requesterId}, ${table.addresseeId})`,
        sql`GREATEST(${table.requesterId}, ${table.addresseeId})`,
      )
      .where(sql`${table.status} IN ('pending', 'accepted')`),
  ],
);

export const invitationStatuses = ["pending", "consumed", "withdrawn"] as const;
export type InvitationStatus = (typeof invitationStatuses)[number];

export const invitationChannels = ["email", "link"] as const;
export type InvitationChannel = (typeof invitationChannels)[number];

/**
 * An invitation for someone without an account: a link, kept as its token
 * (so it can be copied again) and the token's digest (the lookup key),
 * emailed to an address or handed on by the requester.
 */
export const userInvitations = pgTable(
  "user_invitations",
  {
    id: uuid("id").primaryKey(),
    requesterId: uuid("requester_id").notNull(),
    email: text("email"),
    channel: text("channel").$type<InvitationChannel>().notNull(),
    message: text("message"),
    personId: uuid("person_id"),
    workspaceId: uuid("workspace_id"),
    status: text("status")
      .$type<InvitationStatus>()
      .notNull()
      .default("pending"),
    token: text("token"),
    tokenDigest: text("token_digest").notNull(),
    createdAt: createSessionInstantColumn("created_at").notNull().defaultNow(),
    lastSentAt: createSessionInstantColumn("last_sent_at")
      .notNull()
      .defaultNow(),
    expiresAt: createSessionInstantColumn("expires_at").notNull(),
    consumedAt: createSessionInstantColumn("consumed_at"),
    consumedBy: uuid("consumed_by"),
  },
  (table) => [
    uniqueIndex("user_invitations_pending_idx")
      .on(table.requesterId, table.email)
      .where(sql`${table.status} = 'pending'`),
    uniqueIndex("user_invitations_pending_person_idx")
      .on(table.requesterId, table.workspaceId, table.personId)
      .where(
        sql`${table.status} = 'pending' AND ${table.personId} IS NOT NULL`,
      ),
    uniqueIndex("user_invitations_token_idx").on(table.tokenDigest),
  ],
);

export const pendingShareStatuses = [
  "pending",
  "granted",
  "revoked",
  "lapsed",
] as const;
export type PendingShareStatus = (typeof pendingShareStatuses)[number];

/**
 * A share waiting on a request or invitation the granting account sent:
 * granted to the other side when the request is accepted, lapsed when it
 * ends otherwise, revoked when taken back first.
 */
export const pendingShares = pgTable(
  "pending_shares",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    resourceId: uuid("resource_id").notNull(),
    /** The person card the share was ticked from, when there was one. */
    personId: uuid("person_id"),
    connectionId: uuid("connection_id"),
    invitationId: uuid("invitation_id"),
    role: text("role").$type<Role>().notNull(),
    status: text("status")
      .$type<PendingShareStatus>()
      .notNull()
      .default("pending"),
    grantedBy: uuid("granted_by").notNull(),
    grantId: uuid("grant_id"),
    createdAt: createSessionInstantColumn("created_at").notNull().defaultNow(),
    resolvedAt: createSessionInstantColumn("resolved_at"),
  },
  (table) => [
    uniqueIndex("pending_shares_live_idx")
      .on(
        table.workspaceId,
        table.resourceId,
        sql`COALESCE(${table.connectionId}, ${table.invitationId})`,
      )
      .where(sql`${table.status} = 'pending'`),
  ],
);

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
  /** The object whose deletion took this one to Trash, while it is there. */
  deletedWith: uuid("deleted_with"),
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

export const objectCreateCommands = pgTable(
  "object_create_commands",
  {
    workspaceId: uuid("workspace_id").notNull(),
    userId: uuid("user_id").notNull(),
    commandId: uuid("command_id").notNull(),
    requestId: uuid("request_id").notNull(),
    requestHash: text("request_hash").notNull(),
    objectType: text("object_type").$type<ObjectType>().notNull(),
    objectId: uuid("object_id").notNull(),
    createdAt: createCreatedAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.userId, table.commandId] }),
  ],
);

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
  startsOn: date("starts_on", { mode: "string" }),
  endsOn: date("ends_on", { mode: "string" }),
  endsAt: timestamp("ends_at", { mode: "date", withTimezone: true }),
  timezone: text("timezone"),
  isAllDay: boolean("is_all_day").notNull().default(false),
});

export const tasks = pgTable("tasks", {
  objectId: uuid("object_id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  objectType: text("object_type").$type<"task">().notNull().default("task"),
  status: text("status").$type<TaskStatus>().notNull().default("todo"),
  dueOn: date("due_on", { mode: "string" }),
  dueAt: timestamp("due_at", { mode: "date", withTimezone: true }),
  durationMinutes: integer("duration_minutes"),
  repeatRule: text("repeat_rule").$type<TaskRepeatRule>(),
  repeatUntil: date("repeat_until", { mode: "string" }),
  completedAt: timestamp("completed_at", {
    mode: "date",
    withTimezone: true,
  }),
  parentTaskId: uuid("parent_task_id"),
  assigneePersonId: uuid("assignee_person_id"),
  location: text("location"),
  rank: text("rank").notNull().default("00000001000"),
});

export const labels = pgTable(
  "labels",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    name: text("name").notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (table) => [
    uniqueIndex("labels_workspace_name_idx").on(
      table.workspaceId,
      sql`lower(${table.name})`,
    ),
  ],
);

export const taskLabels = pgTable(
  "task_labels",
  {
    workspaceId: uuid("workspace_id").notNull(),
    taskId: uuid("task_id").notNull(),
    labelId: uuid("label_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.taskId, table.labelId] })],
);

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
  rank: text("rank").notNull().default("00000001000"),
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

export const persons = pgTable("persons", {
  objectId: uuid("object_id").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  objectType: text("object_type").$type<"person">().notNull().default("person"),
  /** The workspace member this person is, when they have an account. */
  userId: uuid("user_id"),
  nickname: text("nickname"),
  description: text("description"),
});

export const personContactKinds = ["email", "phone", "other"] as const;
export type PersonContactKind = (typeof personContactKinds)[number];

export const personContacts = pgTable(
  "person_contacts",
  {
    id: uuid("id").primaryKey(),
    workspaceId: uuid("workspace_id").notNull(),
    personId: uuid("person_id").notNull(),
    kind: text("kind").$type<PersonContactKind>().notNull(),
    value: text("value").notNull(),
    position: integer("position").notNull(),
    createdAt: timestamp("created_at", { mode: "date", withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("person_contacts_position_unique").on(
      table.personId,
      table.position,
    ),
  ],
);

export const personLabels = pgTable(
  "person_labels",
  {
    workspaceId: uuid("workspace_id").notNull(),
    personId: uuid("person_id").notNull(),
    labelId: uuid("label_id").notNull(),
  },
  (table) => [primaryKey({ columns: [table.personId, table.labelId] })],
);

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

export const eventPageRevisions = pgTable(
  "event_page_revisions",
  {
    workspaceId: uuid("workspace_id").notNull(),
    eventId: uuid("event_id").notNull(),
    version: integer("version").notNull(),
    pages: jsonb("pages").$type<unknown[]>().notNull(),
    auditEventId: uuid("audit_event_id").notNull(),
    createdAt: createCreatedAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.workspaceId, table.eventId, table.version] }),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type UserSessionRow = typeof userSessions.$inferSelect;
export type NewUserSessionRow = typeof userSessions.$inferInsert;
export type UserCredentialRow = typeof userCredentials.$inferSelect;
export type EmailVerificationRow = typeof emailVerifications.$inferSelect;
export type UserConnectionRow = typeof userConnections.$inferSelect;
export type UserInvitationRow = typeof userInvitations.$inferSelect;
export type PendingShareRow = typeof pendingShares.$inferSelect;
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
export type LabelRow = typeof labels.$inferSelect;
export type TaskLabelRow = typeof taskLabels.$inferSelect;
export type NewTaskRow = typeof tasks.$inferInsert;
export type ExpenseRow = typeof expenses.$inferSelect;
export type NewExpenseRow = typeof expenses.$inferInsert;
export type ReminderRow = typeof reminders.$inferSelect;
export type NewReminderRow = typeof reminders.$inferInsert;
export type DocumentRow = typeof documents.$inferSelect;
export type NewDocumentRow = typeof documents.$inferInsert;
export type PersonRow = typeof persons.$inferSelect;
export type NewPersonRow = typeof persons.$inferInsert;
export type PersonContactRow = typeof personContacts.$inferSelect;
export type PersonLabelRow = typeof personLabels.$inferSelect;
export type DocumentTransferAuthorizationRow =
  typeof documentTransferAuthorizations.$inferSelect;
export type NewDocumentTransferAuthorizationRow =
  typeof documentTransferAuthorizations.$inferInsert;
