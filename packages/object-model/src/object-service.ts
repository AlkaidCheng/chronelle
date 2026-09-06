import {
  AuthorizationDeniedError,
  withStableAuthorization,
  type AuthorizationAction,
  type AuthorizationService,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  createId,
  events,
  expenses,
  objects,
  reminders,
  tasks,
  type Database,
  type DatabaseTransaction,
  type ObjectType,
} from "@chronelle/db";
import { and, eq, isNull, sql } from "drizzle-orm";

import { InvalidObjectStateError, ObjectConflictError } from "./errors.js";
import { readObjectState } from "./object-state.js";
import { recordObjectRevision } from "./object-revisions.js";
import type {
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

export class EventPlanningObjectService {
  readonly #authorization: AuthorizationService;
  readonly #clock: () => Date;
  readonly #database: Database | DatabaseTransaction;

  constructor(
    database: Database | DatabaseTransaction,
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

    const resource = await this.#createObject(
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
    return this.#requireType(resource, "event");
  }

  async createTask(
    context: MutationContext,
    input: CreateTaskInput,
  ): Promise<TaskResource> {
    const status = input.status ?? "todo";
    const dueAt = input.dueAt ?? null;
    const completedAt = input.completedAt ?? null;
    assertTaskState(status, dueAt, completedAt);

    const resource = await this.#createObject(
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
    return this.#requireType(resource, "task");
  }

  async createExpense(
    context: MutationContext,
    input: CreateExpenseInput,
  ): Promise<ExpenseResource> {
    assertExpenseState(input.amount, input.currency, input.occurredAt);

    const resource = await this.#createObject(
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
    return this.#requireType(resource, "expense");
  }

  async createReminder(
    context: MutationContext,
    input: CreateReminderInput,
  ): Promise<ReminderResource> {
    assertValidDate(input.remindAt, "remindAt");

    const resource = await this.#createObject(
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
    return this.#requireType(resource, "reminder");
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

    const resource = await this.#updateObject(
      context,
      current,
      input,
      async (transaction) => {
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
      },
    );
    return this.#requireType(resource, "event");
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

    const resource = await this.#updateObject(
      context,
      current,
      input,
      async (transaction) => {
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
      },
    );
    return this.#requireType(resource, "task");
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

    const resource = await this.#updateObject(
      context,
      current,
      input,
      async (transaction) => {
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
      },
    );
    return this.#requireType(resource, "expense");
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

    const resource = await this.#updateObject(
      context,
      current,
      input,
      async (transaction) => {
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
      },
    );
    return this.#requireType(resource, "reminder");
  }

  async softDelete(
    context: MutationContext,
    objectId: string,
    expectedVersion: number,
  ): Promise<ObjectDeletionResource> {
    const deletedAt = this.#clock();

    const resource = await withStableAuthorization(
      this.#database,
      context.principal.workspaceId,
      async (transaction, authorization) => {
        await authorization.assertCan(context.principal, "delete", {
          id: objectId,
          workspaceId: context.principal.workspaceId,
        });
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

        const resource = await readObjectState(
          transaction,
          context.principal.workspaceId,
          objectId,
        );
        return recordObjectRevision(
          transaction,
          resource,
          {
            actorId: context.principal.userId,
            actorType: "user",
            requestId: context.requestId,
          },
          "deleted",
        );
      },
    );

    return { id: objectId, version: resource.version, deletedAt };
  }

  async updatePermissionScope(
    context: MutationContext,
    objectId: string,
    input: UpdatePermissionScopeInput,
  ): Promise<EventPlanningResource> {
    return withStableAuthorization(
      this.#database,
      context.principal.workspaceId,
      async (transaction, authorization) => {
        await authorization.assertCan(context.principal, "share", {
          id: objectId,
          workspaceId: context.principal.workspaceId,
        });
        const current = await readObjectState(
          transaction,
          context.principal.workspaceId,
          objectId,
        );
        if (current.version !== input.expectedVersion)
          throw new ObjectConflictError();
        if (current.permissionScopeId === input.permissionScopeId) {
          throw new InvalidObjectStateError(
            "permissionScopeId must change the current permission scope.",
          );
        }

        if (input.permissionScopeId !== objectId) {
          await authorization.assertCan(context.principal, "share", {
            id: input.permissionScopeId,
            workspaceId: context.principal.workspaceId,
          });
          const scope = await readObjectState(
            transaction,
            context.principal.workspaceId,
            input.permissionScopeId,
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

        const resource = await readObjectState(
          transaction,
          context.principal.workspaceId,
          objectId,
        );
        return recordObjectRevision(
          transaction,
          resource,
          {
            actorId: context.principal.userId,
            actorType: "user",
            requestId: context.requestId,
          },
          "permission_scope_updated",
          {
            permissionScopeId: input.permissionScopeId,
            previousPermissionScopeId: current.permissionScopeId,
            previousVersion: input.expectedVersion,
          },
        );
      },
    );
  }

  async #createObject(
    context: MutationContext,
    objectType: ObjectType,
    input: CreateObjectFields,
    insertTyped: TypedInsert,
  ): Promise<EventPlanningResource> {
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
    return this.#database.transaction(async (transaction) => {
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

      const resource = await readObjectState(
        transaction,
        context.principal.workspaceId,
        objectId,
      );
      return recordObjectRevision(
        transaction,
        resource,
        {
          actorId: context.principal.userId,
          actorType: "user",
          requestId: context.requestId,
        },
        "created",
        { permissionScopeId },
      );
    });
  }

  async #updateObject(
    context: MutationContext,
    current: EventPlanningResource,
    input: UpdateObjectFields,
    updateTyped: TypedUpdate,
  ): Promise<EventPlanningResource> {
    const updatedAt = this.#clock();
    if (current.version !== input.expectedVersion)
      throw new ObjectConflictError();
    return this.#database.transaction(async (transaction) => {
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

      const resource = await readObjectState(
        transaction,
        context.principal.workspaceId,
        current.id,
      );
      return recordObjectRevision(
        transaction,
        resource,
        {
          actorId: context.principal.userId,
          actorType: "user",
          requestId: context.requestId,
        },
        "updated",
        {
          previousVersion: input.expectedVersion,
          ...(context.command !== undefined && { command: context.command }),
        },
      );
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
    const resource = await readObjectState(
      this.#database,
      principal.workspaceId,
      objectId,
    );
    if (resource.deletedAt !== null) throw new AuthorizationDeniedError();
    return resource;
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
