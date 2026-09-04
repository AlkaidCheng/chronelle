import {
  AuthorizationDeniedError,
  type AuthorizationAction,
  type AuthorizationService,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  createId,
  documents,
  events,
  expenses,
  objects,
  reminders,
  runAuditedMutation,
  tasks,
  type Database,
  type DatabaseTransaction,
  type ObjectRow,
  type ObjectType,
} from "@chronelle/db";
import { and, eq, isNull, sql } from "drizzle-orm";

import { InvalidObjectStateError, ObjectConflictError } from "./errors.js";
import type {
  CanonicalObjectResource,
  CreateEventInput,
  CreateExpenseInput,
  CreateObjectFields,
  CreateReminderInput,
  CreateTaskInput,
  DocumentResource,
  EventPlanningResource,
  EventResource,
  ExpenseResource,
  MutationContext,
  ObjectDeletionResource,
  ReminderResource,
  TaskResource,
  UpdateEventInput,
  UpdateExpenseInput,
  UpdateObjectFields,
  UpdateReminderInput,
  UpdatePermissionScopeInput,
  UpdateTaskInput,
} from "./types.js";

type TypedInsert = (
  transaction: DatabaseTransaction,
  objectId: string,
) => Promise<void>;
type TypedUpdate = (transaction: DatabaseTransaction) => Promise<void>;

const currencyPattern = /^[A-Z]{3}$/;
const amountPattern = /^-?\d{1,15}(?:\.\d{1,4})?$/;

function assertValidDate(value: Date, fieldName: string): void {
  if (!Number.isFinite(value.getTime())) {
    throw new InvalidObjectStateError(`${fieldName} must be a valid date.`);
  }
}

function assertEventState(
  startsAt: Date | null,
  endsAt: Date | null,
  timezone: string | null,
): void {
  if (startsAt !== null) {
    assertValidDate(startsAt, "startsAt");
  }
  if (endsAt !== null) {
    assertValidDate(endsAt, "endsAt");
  }
  if (endsAt !== null && startsAt === null) {
    throw new InvalidObjectStateError("endsAt requires startsAt.");
  }
  if (startsAt !== null && endsAt !== null && endsAt < startsAt) {
    throw new InvalidObjectStateError("endsAt must not precede startsAt.");
  }
  if (timezone !== null) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
    } catch {
      throw new InvalidObjectStateError(
        "timezone must be a valid IANA time zone.",
      );
    }
  }
}

function assertTaskState(
  status: TaskResource["status"],
  dueAt: Date | null,
  completedAt: Date | null,
): void {
  if (dueAt !== null) {
    assertValidDate(dueAt, "dueAt");
  }
  if (completedAt !== null) {
    assertValidDate(completedAt, "completedAt");
  }
  if ((status === "done") !== (completedAt !== null)) {
    throw new InvalidObjectStateError(
      "completedAt must be set exactly when status is done.",
    );
  }
}

function assertExpenseState(
  amount: string,
  currency: string,
  occurredAt: Date,
): void {
  if (!amountPattern.test(amount)) {
    throw new InvalidObjectStateError(
      "amount must fit numeric(19,4) decimal notation.",
    );
  }
  if (!currencyPattern.test(currency)) {
    throw new InvalidObjectStateError(
      "currency must contain three uppercase letters.",
    );
  }
  assertValidDate(occurredAt, "occurredAt");
}

function canonicalFields(row: ObjectRow): CanonicalObjectResource {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    objectType: row.objectType,
    displayName: row.displayName,
    createdBy: row.createdBy,
    permissionScopeId: row.permissionScopeId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    version: row.version,
    archivedAt: row.archivedAt,
    deletedAt: row.deletedAt,
    customProperties: row.customProperties,
    metadata: row.metadata,
  };
}

export class EventPlanningObjectService {
  readonly #authorization: AuthorizationService;
  readonly #clock: () => Date;
  readonly #database: Database;

  constructor(
    database: Database,
    authorization: AuthorizationService,
    clock: () => Date = () => new Date(),
  ) {
    this.#database = database;
    this.#authorization = authorization;
    this.#clock = clock;
  }

  async createEvent(
    context: MutationContext,
    input: CreateEventInput,
  ): Promise<EventResource> {
    const startsAt = input.startsAt ?? null;
    const endsAt = input.endsAt ?? null;
    const timezone = input.timezone ?? null;
    assertEventState(startsAt, endsAt, timezone);

    const objectId = await this.#createObject(
      context,
      "event",
      input,
      async (transaction, createdObjectId) => {
        await transaction.insert(events).values({
          objectId: createdObjectId,
          workspaceId: context.principal.workspaceId,
          startsAt,
          endsAt,
          timezone,
          isAllDay: input.isAllDay ?? false,
        });
      },
    );
    return this.#getEventUnchecked(context.principal.workspaceId, objectId);
  }

  async createTask(
    context: MutationContext,
    input: CreateTaskInput,
  ): Promise<TaskResource> {
    const status = input.status ?? "todo";
    const dueAt = input.dueAt ?? null;
    const completedAt = input.completedAt ?? null;
    assertTaskState(status, dueAt, completedAt);

    const objectId = await this.#createObject(
      context,
      "task",
      input,
      async (transaction, createdObjectId) => {
        await transaction.insert(tasks).values({
          objectId: createdObjectId,
          workspaceId: context.principal.workspaceId,
          status,
          dueAt,
          completedAt,
        });
      },
    );
    return this.#getTaskUnchecked(context.principal.workspaceId, objectId);
  }

  async createExpense(
    context: MutationContext,
    input: CreateExpenseInput,
  ): Promise<ExpenseResource> {
    assertExpenseState(input.amount, input.currency, input.occurredAt);

    const objectId = await this.#createObject(
      context,
      "expense",
      input,
      async (transaction, createdObjectId) => {
        await transaction.insert(expenses).values({
          objectId: createdObjectId,
          workspaceId: context.principal.workspaceId,
          amount: input.amount,
          currency: input.currency,
          occurredAt: input.occurredAt,
        });
      },
    );
    return this.#getExpenseUnchecked(context.principal.workspaceId, objectId);
  }

  async createReminder(
    context: MutationContext,
    input: CreateReminderInput,
  ): Promise<ReminderResource> {
    assertValidDate(input.remindAt, "remindAt");

    const objectId = await this.#createObject(
      context,
      "reminder",
      input,
      async (transaction, createdObjectId) => {
        await transaction.insert(reminders).values({
          objectId: createdObjectId,
          workspaceId: context.principal.workspaceId,
          remindAt: input.remindAt,
          status: input.status ?? "pending",
        });
      },
    );
    return this.#getReminderUnchecked(context.principal.workspaceId, objectId);
  }

  async getObject(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<EventPlanningResource> {
    return this.#getObjectWithAction(principal, objectId, "view");
  }

  async listEvents(principal: UserPrincipal): Promise<EventResource[]> {
    const candidates = await this.#database
      .select({ id: objects.id })
      .from(objects)
      .where(
        and(
          eq(objects.workspaceId, principal.workspaceId),
          eq(objects.objectType, "event"),
          eq(objects.permissionScopeId, objects.id),
          isNull(objects.deletedAt),
        ),
      );

    const visibleEvents = await Promise.all(
      candidates.map(async ({ id }) => {
        try {
          return await this.getEvent(principal, id);
        } catch (error) {
          if (error instanceof AuthorizationDeniedError) {
            return null;
          }
          throw error;
        }
      }),
    );

    return visibleEvents
      .filter((event): event is EventResource => event !== null)
      .sort(
        (first, second) =>
          (first.startsAt?.getTime() ?? Number.POSITIVE_INFINITY) -
            (second.startsAt?.getTime() ?? Number.POSITIVE_INFINITY) ||
          first.id.localeCompare(second.id),
      );
  }

  async getEvent(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<EventResource> {
    const resource = await this.#getObjectWithAction(
      principal,
      objectId,
      "view",
    );
    return this.#requireType(resource, "event");
  }

  async getTask(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<TaskResource> {
    const resource = await this.#getObjectWithAction(
      principal,
      objectId,
      "view",
    );
    return this.#requireType(resource, "task");
  }

  async getExpense(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<ExpenseResource> {
    const resource = await this.#getObjectWithAction(
      principal,
      objectId,
      "view",
    );
    return this.#requireType(resource, "expense");
  }

  async getReminder(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<ReminderResource> {
    const resource = await this.#getObjectWithAction(
      principal,
      objectId,
      "view",
    );
    return this.#requireType(resource, "reminder");
  }

  async getDocument(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<DocumentResource> {
    const resource = await this.#getObjectWithAction(
      principal,
      objectId,
      "view",
    );
    return this.#requireType(resource, "document");
  }

  async updateEvent(
    context: MutationContext,
    objectId: string,
    input: UpdateEventInput,
  ): Promise<EventResource> {
    const current = this.#requireType(
      await this.#getObjectWithAction(context.principal, objectId, "edit"),
      "event",
    );
    const startsAt =
      input.startsAt === undefined ? current.startsAt : input.startsAt;
    const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt;
    const timezone =
      input.timezone === undefined ? current.timezone : input.timezone;
    assertEventState(startsAt, endsAt, timezone);

    await this.#updateObject(context, current, input, async (transaction) => {
      const changes = {
        ...(input.startsAt !== undefined && { startsAt: input.startsAt }),
        ...(input.endsAt !== undefined && { endsAt: input.endsAt }),
        ...(input.timezone !== undefined && { timezone: input.timezone }),
        ...(input.isAllDay !== undefined && { isAllDay: input.isAllDay }),
      };
      if (Object.keys(changes).length > 0) {
        await transaction
          .update(events)
          .set(changes)
          .where(
            and(
              eq(events.workspaceId, context.principal.workspaceId),
              eq(events.objectId, objectId),
            ),
          );
      }
    });
    return this.#getEventUnchecked(context.principal.workspaceId, objectId);
  }

  async updateTask(
    context: MutationContext,
    objectId: string,
    input: UpdateTaskInput,
  ): Promise<TaskResource> {
    const current = this.#requireType(
      await this.#getObjectWithAction(context.principal, objectId, "edit"),
      "task",
    );
    const status = input.status ?? current.status;
    const dueAt = input.dueAt === undefined ? current.dueAt : input.dueAt;
    const completedAt =
      input.completedAt === undefined ? current.completedAt : input.completedAt;
    assertTaskState(status, dueAt, completedAt);

    await this.#updateObject(context, current, input, async (transaction) => {
      const changes = {
        ...(input.status !== undefined && { status: input.status }),
        ...(input.dueAt !== undefined && { dueAt: input.dueAt }),
        ...(input.completedAt !== undefined && {
          completedAt: input.completedAt,
        }),
      };
      if (Object.keys(changes).length > 0) {
        await transaction
          .update(tasks)
          .set(changes)
          .where(
            and(
              eq(tasks.workspaceId, context.principal.workspaceId),
              eq(tasks.objectId, objectId),
            ),
          );
      }
    });
    return this.#getTaskUnchecked(context.principal.workspaceId, objectId);
  }

  async updateExpense(
    context: MutationContext,
    objectId: string,
    input: UpdateExpenseInput,
  ): Promise<ExpenseResource> {
    const current = this.#requireType(
      await this.#getObjectWithAction(context.principal, objectId, "edit"),
      "expense",
    );
    const amount = input.amount ?? current.amount;
    const currency = input.currency ?? current.currency;
    const occurredAt = input.occurredAt ?? current.occurredAt;
    assertExpenseState(amount, currency, occurredAt);

    await this.#updateObject(context, current, input, async (transaction) => {
      const changes = {
        ...(input.amount !== undefined && { amount: input.amount }),
        ...(input.currency !== undefined && { currency: input.currency }),
        ...(input.occurredAt !== undefined && {
          occurredAt: input.occurredAt,
        }),
      };
      if (Object.keys(changes).length > 0) {
        await transaction
          .update(expenses)
          .set(changes)
          .where(
            and(
              eq(expenses.workspaceId, context.principal.workspaceId),
              eq(expenses.objectId, objectId),
            ),
          );
      }
    });
    return this.#getExpenseUnchecked(context.principal.workspaceId, objectId);
  }

  async updateReminder(
    context: MutationContext,
    objectId: string,
    input: UpdateReminderInput,
  ): Promise<ReminderResource> {
    const current = this.#requireType(
      await this.#getObjectWithAction(context.principal, objectId, "edit"),
      "reminder",
    );
    const remindAt = input.remindAt ?? current.remindAt;
    assertValidDate(remindAt, "remindAt");

    await this.#updateObject(context, current, input, async (transaction) => {
      const changes = {
        ...(input.remindAt !== undefined && { remindAt: input.remindAt }),
        ...(input.status !== undefined && { status: input.status }),
      };
      if (Object.keys(changes).length > 0) {
        await transaction
          .update(reminders)
          .set(changes)
          .where(
            and(
              eq(reminders.workspaceId, context.principal.workspaceId),
              eq(reminders.objectId, objectId),
            ),
          );
      }
    });
    return this.#getReminderUnchecked(context.principal.workspaceId, objectId);
  }

  async softDelete(
    context: MutationContext,
    objectId: string,
    expectedVersion: number,
  ): Promise<ObjectDeletionResource> {
    const current = await this.#getObjectWithAction(
      context.principal,
      objectId,
      "delete",
    );
    const deletedAt = this.#clock();

    const version = await runAuditedMutation(
      this.#database,
      async (transaction) => {
        const [updated] = await transaction
          .update(objects)
          .set({
            deletedAt,
            updatedAt: deletedAt,
            version: sql`${objects.version} + 1`,
          })
          .where(
            and(
              eq(objects.workspaceId, context.principal.workspaceId),
              eq(objects.id, objectId),
              eq(objects.version, expectedVersion),
              isNull(objects.deletedAt),
            ),
          )
          .returning({ version: objects.version });
        if (updated === undefined) {
          throw new ObjectConflictError();
        }

        return {
          value: updated.version,
          audit: {
            workspaceId: context.principal.workspaceId,
            actorType: "user",
            actorId: context.principal.userId,
            action: `${current.objectType}.deleted`,
            resourceId: objectId,
            requestId: context.requestId,
            metadata: { version: updated.version },
          },
        };
      },
    );

    return { id: objectId, version, deletedAt };
  }

  async updatePermissionScope(
    context: MutationContext,
    objectId: string,
    input: UpdatePermissionScopeInput,
  ): Promise<EventPlanningResource> {
    const current = await this.#getObjectWithAction(
      context.principal,
      objectId,
      "share",
    );
    if (current.permissionScopeId === input.permissionScopeId) {
      throw new InvalidObjectStateError(
        "permissionScopeId must change the current permission scope.",
      );
    }

    if (input.permissionScopeId !== objectId) {
      const scope = await this.#getObjectWithAction(
        context.principal,
        input.permissionScopeId,
        "share",
      );
      if (
        scope.objectType !== "event" ||
        scope.permissionScopeId !== scope.id
      ) {
        throw new InvalidObjectStateError(
          "permissionScopeId must reference a self-scoped Event.",
        );
      }
    }

    const updatedAt = this.#clock();
    await runAuditedMutation(this.#database, async (transaction) => {
      const [updated] = await transaction
        .update(objects)
        .set({
          permissionScopeId: input.permissionScopeId,
          updatedAt,
          version: sql`${objects.version} + 1`,
        })
        .where(
          and(
            eq(objects.workspaceId, context.principal.workspaceId),
            eq(objects.id, objectId),
            eq(objects.version, input.expectedVersion),
            isNull(objects.deletedAt),
          ),
        )
        .returning({ version: objects.version });
      if (updated === undefined) {
        throw new ObjectConflictError();
      }

      return {
        value: undefined,
        audit: {
          workspaceId: context.principal.workspaceId,
          actorType: "user",
          actorId: context.principal.userId,
          action: "object.permission_scope_updated",
          resourceId: objectId,
          requestId: context.requestId,
          metadata: {
            permissionScopeId: input.permissionScopeId,
            previousPermissionScopeId: current.permissionScopeId,
            previousVersion: input.expectedVersion,
            version: updated.version,
          },
        },
      };
    });

    return this.#getObjectUnchecked(context.principal.workspaceId, objectId);
  }

  async #createObject(
    context: MutationContext,
    objectType: ObjectType,
    input: CreateObjectFields,
    insertTyped: TypedInsert,
  ): Promise<string> {
    if (input.permissionScopeId === undefined) {
      await this.#authorization.assertCanCreateInWorkspace(context.principal);
    } else {
      await this.#authorization.assertCan(context.principal, "edit", {
        id: input.permissionScopeId,
        workspaceId: context.principal.workspaceId,
      });
    }

    const objectId = createId();
    const permissionScopeId = input.permissionScopeId ?? objectId;
    return runAuditedMutation(this.#database, async (transaction) => {
      await transaction.insert(objects).values({
        id: objectId,
        workspaceId: context.principal.workspaceId,
        objectType,
        displayName: input.displayName,
        createdBy: context.principal.userId,
        permissionScopeId,
        customProperties: input.customProperties ?? {},
        metadata: input.metadata ?? {},
      });
      await insertTyped(transaction, objectId);

      return {
        value: objectId,
        audit: {
          workspaceId: context.principal.workspaceId,
          actorType: "user",
          actorId: context.principal.userId,
          action: `${objectType}.created`,
          resourceId: objectId,
          requestId: context.requestId,
          metadata: { permissionScopeId },
        },
      };
    });
  }

  async #updateObject(
    context: MutationContext,
    current: EventPlanningResource,
    input: UpdateObjectFields,
    updateTyped: TypedUpdate,
  ): Promise<void> {
    const updatedAt = this.#clock();
    await runAuditedMutation(this.#database, async (transaction) => {
      const [updated] = await transaction
        .update(objects)
        .set({
          ...(input.displayName !== undefined && {
            displayName: input.displayName,
          }),
          ...(input.customProperties !== undefined && {
            customProperties: input.customProperties,
          }),
          ...(input.metadata !== undefined && { metadata: input.metadata }),
          updatedAt,
          version: sql`${objects.version} + 1`,
        })
        .where(
          and(
            eq(objects.workspaceId, context.principal.workspaceId),
            eq(objects.id, current.id),
            eq(objects.objectType, current.objectType),
            eq(objects.version, input.expectedVersion),
            isNull(objects.deletedAt),
          ),
        )
        .returning({ version: objects.version });
      if (updated === undefined) {
        throw new ObjectConflictError();
      }
      await updateTyped(transaction);

      return {
        value: undefined,
        audit: {
          workspaceId: context.principal.workspaceId,
          actorType: "user",
          actorId: context.principal.userId,
          action: `${current.objectType}.updated`,
          resourceId: current.id,
          requestId: context.requestId,
          metadata: {
            previousVersion: input.expectedVersion,
            version: updated.version,
          },
        },
      };
    });
  }

  async #getObjectWithAction(
    principal: UserPrincipal,
    objectId: string,
    action: AuthorizationAction,
  ): Promise<EventPlanningResource> {
    await this.#authorization.assertCan(principal, action, {
      id: objectId,
      workspaceId: principal.workspaceId,
    });
    return this.#getObjectUnchecked(principal.workspaceId, objectId);
  }

  async #getObjectUnchecked(
    workspaceId: string,
    objectId: string,
  ): Promise<EventPlanningResource> {
    const [row] = await this.#database
      .select()
      .from(objects)
      .where(
        and(
          eq(objects.workspaceId, workspaceId),
          eq(objects.id, objectId),
          isNull(objects.deletedAt),
        ),
      )
      .limit(1);
    if (row === undefined) {
      throw new AuthorizationDeniedError();
    }

    switch (row.objectType) {
      case "event":
        return this.#getEventUnchecked(workspaceId, objectId, row);
      case "task":
        return this.#getTaskUnchecked(workspaceId, objectId, row);
      case "expense":
        return this.#getExpenseUnchecked(workspaceId, objectId, row);
      case "reminder":
        return this.#getReminderUnchecked(workspaceId, objectId, row);
      case "document":
        return this.#getDocumentUnchecked(workspaceId, objectId, row);
    }
  }

  async #getEventUnchecked(
    workspaceId: string,
    objectId: string,
    objectRow?: ObjectRow,
  ): Promise<EventResource> {
    const row = objectRow ?? (await this.#getObjectRow(workspaceId, objectId));
    const [event] = await this.#database
      .select()
      .from(events)
      .where(
        and(eq(events.workspaceId, workspaceId), eq(events.objectId, objectId)),
      )
      .limit(1);
    if (event === undefined || row.objectType !== "event") {
      throw new AuthorizationDeniedError();
    }
    return {
      ...canonicalFields(row),
      objectType: "event",
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: event.timezone,
      isAllDay: event.isAllDay,
    };
  }

  async #getTaskUnchecked(
    workspaceId: string,
    objectId: string,
    objectRow?: ObjectRow,
  ): Promise<TaskResource> {
    const row = objectRow ?? (await this.#getObjectRow(workspaceId, objectId));
    const [task] = await this.#database
      .select()
      .from(tasks)
      .where(
        and(eq(tasks.workspaceId, workspaceId), eq(tasks.objectId, objectId)),
      )
      .limit(1);
    if (task === undefined || row.objectType !== "task") {
      throw new AuthorizationDeniedError();
    }
    return {
      ...canonicalFields(row),
      objectType: "task",
      status: task.status,
      dueAt: task.dueAt,
      completedAt: task.completedAt,
    };
  }

  async #getExpenseUnchecked(
    workspaceId: string,
    objectId: string,
    objectRow?: ObjectRow,
  ): Promise<ExpenseResource> {
    const row = objectRow ?? (await this.#getObjectRow(workspaceId, objectId));
    const [expense] = await this.#database
      .select()
      .from(expenses)
      .where(
        and(
          eq(expenses.workspaceId, workspaceId),
          eq(expenses.objectId, objectId),
        ),
      )
      .limit(1);
    if (expense === undefined || row.objectType !== "expense") {
      throw new AuthorizationDeniedError();
    }
    return {
      ...canonicalFields(row),
      objectType: "expense",
      amount: expense.amount,
      currency: expense.currency,
      occurredAt: expense.occurredAt,
    };
  }

  async #getReminderUnchecked(
    workspaceId: string,
    objectId: string,
    objectRow?: ObjectRow,
  ): Promise<ReminderResource> {
    const row = objectRow ?? (await this.#getObjectRow(workspaceId, objectId));
    const [reminder] = await this.#database
      .select()
      .from(reminders)
      .where(
        and(
          eq(reminders.workspaceId, workspaceId),
          eq(reminders.objectId, objectId),
        ),
      )
      .limit(1);
    if (reminder === undefined || row.objectType !== "reminder") {
      throw new AuthorizationDeniedError();
    }
    return {
      ...canonicalFields(row),
      objectType: "reminder",
      remindAt: reminder.remindAt,
      status: reminder.status,
    };
  }

  async #getDocumentUnchecked(
    workspaceId: string,
    objectId: string,
    objectRow?: ObjectRow,
  ): Promise<DocumentResource> {
    const row = objectRow ?? (await this.#getObjectRow(workspaceId, objectId));
    const [document] = await this.#database
      .select()
      .from(documents)
      .where(
        and(
          eq(documents.workspaceId, workspaceId),
          eq(documents.objectId, objectId),
        ),
      )
      .limit(1);
    if (document === undefined || row.objectType !== "document") {
      throw new AuthorizationDeniedError();
    }
    return {
      ...canonicalFields(row),
      objectType: "document",
      storageProvider: document.storageProvider,
      storageKey: document.storageKey,
      originalFilename: document.originalFilename,
      mimeType: document.mimeType,
      sizeBytes: document.sizeBytes,
      checksumSha256: document.checksumSha256,
      encryptionMode: document.encryptionMode,
    };
  }

  async #getObjectRow(
    workspaceId: string,
    objectId: string,
  ): Promise<ObjectRow> {
    const [row] = await this.#database
      .select()
      .from(objects)
      .where(
        and(
          eq(objects.workspaceId, workspaceId),
          eq(objects.id, objectId),
          isNull(objects.deletedAt),
        ),
      )
      .limit(1);
    if (row === undefined) {
      throw new AuthorizationDeniedError();
    }
    return row;
  }

  #requireType<Type extends EventPlanningResource["objectType"]>(
    resource: EventPlanningResource,
    objectType: Type,
  ): Extract<EventPlanningResource, { objectType: Type }> {
    if (resource.objectType !== objectType) {
      throw new AuthorizationDeniedError();
    }
    return resource as Extract<EventPlanningResource, { objectType: Type }>;
  }
}
