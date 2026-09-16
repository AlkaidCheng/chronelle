import {
  AuthorizationDeniedError,
  withStableAuthorization,
  type AuthorizationDatabase,
  type UserPrincipal,
} from "@chronelle/authorization";
import {
  createId,
  events,
  expenses,
  labels,
  objectCreateCommands,
  objects,
  persons,
  reminders,
  taskLabels,
  tasks,
  workspaceMembers,
  type DatabaseTransaction,
  type ObjectType,
} from "@chronelle/db";
import { and, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import {
  eventCalendarDatesSchema,
  type EventListQueryInput,
  type PersonListQueryInput,
  type TaskListQueryInput,
} from "@chronelle/schemas";
import {
  PostgresEventReadRepository,
  type EventPage,
  type EventReadRepository,
} from "./event-list.js";
import {
  PostgresObjectReadRepository,
  readAuthorizedObject,
  type ObjectReadRepositories,
  type ObjectReadRepository,
} from "./object-reads.js";
import type { ObjectWriteRepositories } from "./object-writes.js";
import {
  PostgresPersonReadRepository,
  type PersonPage,
  type PersonReadRepository,
} from "./person-list.js";
import {
  PostgresTaskReadRepository,
  type TaskPage,
  type TaskReadRepository,
} from "./task-list.js";

import { createRequestHash } from "./create-command.js";
import {
  CommandConflictError,
  InvalidObjectStateError,
  ObjectConflictError,
} from "./errors.js";
import { readObjectState } from "./object-state.js";
import { recordObjectRevision } from "./object-revisions.js";
import type {
  CreateEventInput,
  CreateExpenseInput,
  CreateObjectFields,
  CreatePersonInput,
  CreateReminderInput,
  CreateTaskInput,
  DocumentResource,
  EventPlanningResource,
  EventResource,
  ExpenseResource,
  MutationContext,
  ObjectDeletionResource,
  PersonResource,
  ReminderResource,
  TaskResource,
  UpdateEventInput,
  UpdateExpenseInput,
  UpdateObjectFields,
  UpdatePersonInput,
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
  startsOn: string | null,
  endsOn: string | null,
): void {
  if (!eventCalendarDatesSchema.safeParse({ startsOn, endsOn }).success)
    throw new InvalidObjectStateError(
      "Calendar dates must be valid and ordered.",
    );
  if (startsOn !== null && (startsAt !== null || endsAt !== null))
    throw new InvalidObjectStateError(
      "Use calendar dates or timestamps, not both.",
    );
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

/**
 * A Person's linked account is a member of the workspace and belongs to one
 * Person; an email is a trimmed address. Checked inside the write
 * transaction, with the messages the database functions use.
 */
async function assertPersonState(
  transaction: DatabaseTransaction,
  workspaceId: string,
  objectId: string,
  userId: string | null,
  email: string | null,
): Promise<void> {
  if (userId !== null) {
    const [member] = await transaction
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, userId),
        ),
      )
      .limit(1);
    if (member === undefined)
      throw new InvalidObjectStateError(
        "userId must name a member of this workspace.",
      );
    const [linked] = await transaction
      .select({ objectId: persons.objectId })
      .from(persons)
      .where(
        and(
          eq(persons.workspaceId, workspaceId),
          eq(persons.userId, userId),
          ne(persons.objectId, objectId),
        ),
      )
      .limit(1);
    if (linked !== undefined)
      throw new InvalidObjectStateError(
        "userId is already linked to another person.",
      );
  }
  if (
    email !== null &&
    (email !== email.trim() ||
      email.length < 3 ||
      email.length > 254 ||
      email.indexOf("@") < 1)
  )
    throw new InvalidObjectStateError("email must be a valid address.");
}

/** Replaces a task's labels; every id must be a label of the workspace. */
async function setTaskLabels(
  transaction: DatabaseTransaction,
  workspaceId: string,
  taskId: string,
  labelIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(labelIds)];
  if (ids.length > 0) {
    const known = await transaction
      .select({ id: labels.id })
      .from(labels)
      .where(and(eq(labels.workspaceId, workspaceId), inArray(labels.id, ids)));
    if (known.length !== ids.length)
      throw new InvalidObjectStateError(
        "labelIds must name labels of this workspace.",
      );
  }
  await transaction
    .delete(taskLabels)
    .where(
      and(
        eq(taskLabels.workspaceId, workspaceId),
        eq(taskLabels.taskId, taskId),
      ),
    );
  if (ids.length > 0)
    await transaction
      .insert(taskLabels)
      .values(ids.map((labelId) => ({ workspaceId, taskId, labelId })));
}

/** The live subtasks of a task, in id order. */
async function liveSubtaskIds(
  transaction: DatabaseTransaction,
  workspaceId: string,
  parentTaskId: string,
): Promise<string[]> {
  const rows = await transaction
    .select({ id: objects.id })
    .from(tasks)
    .innerJoin(
      objects,
      and(
        eq(objects.workspaceId, tasks.workspaceId),
        eq(objects.id, tasks.objectId),
      ),
    )
    .where(
      and(
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.parentTaskId, parentTaskId),
        isNull(objects.deletedAt),
      ),
    )
    .orderBy(objects.id);
  return rows.map(({ id }) => id);
}

/** A duration is 1 to 1440 minutes and needs a due instant. */
function assertTaskDuration(
  dueAt: Date | null,
  durationMinutes: number | null,
): void {
  if (
    durationMinutes !== null &&
    (durationMinutes < 1 || durationMinutes > 1440)
  )
    throw new InvalidObjectStateError("durationMinutes is 1 to 1440 minutes.");
  if (durationMinutes !== null && dueAt === null)
    throw new InvalidObjectStateError("durationMinutes requires dueAt.");
}

/** The location, when set, is 1 to 240 trimmed characters. */
function assertTaskLocation(location: string | null): void {
  if (
    location !== null &&
    (location !== location.trim() ||
      location.length < 1 ||
      location.length > 240)
  )
    throw new InvalidObjectStateError(
      "location is 1 to 240 characters without surrounding spaces.",
    );
}

/** The assignee, when set, is a live Person of the workspace. */
async function assertTaskAssignee(
  transaction: DatabaseTransaction,
  workspaceId: string,
  assigneeId: string | null,
): Promise<void> {
  if (assigneeId === null) return;
  const [person] = await transaction
    .select({ id: objects.id })
    .from(objects)
    .innerJoin(
      persons,
      and(
        eq(persons.workspaceId, objects.workspaceId),
        eq(persons.objectId, objects.id),
      ),
    )
    .where(
      and(
        eq(objects.workspaceId, workspaceId),
        eq(objects.id, assigneeId),
        isNull(objects.deletedAt),
      ),
    )
    .limit(1);
  if (person === undefined)
    throw new InvalidObjectStateError(
      "assigneeId must name a live person in this workspace.",
    );
}

/**
 * The parent rules, checked inside the write transaction: the parent is a
 * live task of the workspace with no parent of its own, the task has no
 * subtasks itself, and both share one permission scope.
 */
async function assertTaskParent(
  transaction: DatabaseTransaction,
  workspaceId: string,
  objectId: string,
  parentTaskId: string | null,
  scopeId: string,
): Promise<void> {
  if (parentTaskId === null) return;
  if (parentTaskId === objectId)
    throw new InvalidObjectStateError("A task cannot be its own parent.");
  const [parent] = await transaction
    .select({
      permissionScopeId: objects.permissionScopeId,
      parentTaskId: tasks.parentTaskId,
    })
    .from(objects)
    .innerJoin(
      tasks,
      and(
        eq(tasks.workspaceId, objects.workspaceId),
        eq(tasks.objectId, objects.id),
      ),
    )
    .where(
      and(
        eq(objects.workspaceId, workspaceId),
        eq(objects.id, parentTaskId),
        isNull(objects.deletedAt),
      ),
    )
    .limit(1);
  if (parent === undefined)
    throw new InvalidObjectStateError(
      "parentTaskId must name a live task in this workspace.",
    );
  if (parent.parentTaskId !== null)
    throw new InvalidObjectStateError(
      "A subtask cannot have subtasks of its own.",
    );
  const [child] = await transaction
    .select({ objectId: tasks.objectId })
    .from(tasks)
    .where(
      and(eq(tasks.workspaceId, workspaceId), eq(tasks.parentTaskId, objectId)),
    )
    .limit(1);
  if (child !== undefined)
    throw new InvalidObjectStateError(
      "A task with subtasks cannot become a subtask.",
    );
  if (parent.permissionScopeId !== scopeId)
    throw new InvalidObjectStateError(
      "A subtask shares its parent's permission scope.",
    );
}

function assertTaskState(
  status: TaskResource["status"],
  dueOn: string | null,
  dueAt: Date | null,
  completedAt: Date | null,
): void {
  if (dueAt !== null) {
    assertValidDate(dueAt, "dueAt");
  }
  if (dueOn !== null && dueAt !== null) {
    throw new InvalidObjectStateError("dueOn and dueAt cannot both be set.");
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
  readonly #clock: () => Date;
  readonly #database: AuthorizationDatabase;
  readonly #eventReads: EventReadRepository;
  readonly #taskReads: TaskReadRepository;
  readonly #personReads: PersonReadRepository;
  readonly #objectReads: ObjectReadRepository;
  readonly #writes: ObjectWriteRepositories;

  constructor(
    database: AuthorizationDatabase,
    clock: () => Date = () => new Date(),
    reads: ObjectReadRepositories = {},
    writes: ObjectWriteRepositories = {},
  ) {
    this.#database = database;
    this.#clock = clock;
    this.#eventReads =
      reads.events ?? new PostgresEventReadRepository(database);
    this.#taskReads = reads.tasks ?? new PostgresTaskReadRepository(database);
    this.#personReads =
      reads.persons ?? new PostgresPersonReadRepository(database);
    this.#objectReads =
      reads.objects ?? new PostgresObjectReadRepository(database);
    this.#writes = writes;
  }

  async createEvent(
    context: MutationContext,
    input: CreateEventInput,
  ): Promise<EventResource> {
    const startsAt = input.startsAt ?? null;
    const endsAt = input.endsAt ?? null;
    const timezone = input.timezone ?? null;
    const startsOn = input.startsOn ?? null;
    const endsOn = input.endsOn ?? null;
    assertEventState(startsAt, endsAt, timezone, startsOn, endsOn);
    if (this.#writes.event !== undefined)
      return this.#writes.event.create(context, input);

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
          startsOn,
          endsOn,
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
    const dueOn = input.dueOn ?? null;
    const dueAt = input.dueAt ?? null;
    const completedAt = input.completedAt ?? null;
    const durationMinutes = input.durationMinutes ?? null;
    assertTaskState(status, dueOn, dueAt, completedAt);
    assertTaskDuration(dueAt, durationMinutes);
    if (this.#writes.task !== undefined)
      return this.#writes.task.create(context, input);

    const parentTaskId = input.parentTaskId ?? null;
    const assigneeId = input.assigneeId ?? null;
    const location = input.location ?? null;
    assertTaskLocation(location);
    const resource = await this.#createObject(
      context,
      "task",
      input,
      async (transaction, createdObjectId) => {
        await assertTaskParent(
          transaction,
          context.principal.workspaceId,
          createdObjectId,
          parentTaskId,
          input.permissionScopeId ?? createdObjectId,
        );
        await assertTaskAssignee(
          transaction,
          context.principal.workspaceId,
          assigneeId,
        );
        await transaction.insert(tasks).values({
          objectId: createdObjectId,
          workspaceId: context.principal.workspaceId,
          status,
          dueOn,
          dueAt,
          durationMinutes,
          completedAt,
          parentTaskId,
          assigneePersonId: assigneeId,
          location,
        });
        if (input.labelIds !== undefined)
          await setTaskLabels(
            transaction,
            context.principal.workspaceId,
            createdObjectId,
            input.labelIds,
          );
      },
    );
    return this.#requireType(resource, "task");
  }

  async createExpense(
    context: MutationContext,
    input: CreateExpenseInput,
  ): Promise<ExpenseResource> {
    assertExpenseState(input.amount, input.currency, input.occurredAt);
    if (this.#writes.expense !== undefined)
      return this.#writes.expense.create(context, input);

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
    if (this.#writes.reminder !== undefined)
      return this.#writes.reminder.create(context, input);

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

  async createPerson(
    context: MutationContext,
    input: CreatePersonInput,
  ): Promise<PersonResource> {
    if (this.#writes.person !== undefined)
      return this.#writes.person.create(context, input);

    const userId = input.userId ?? null;
    const email = input.email ?? null;
    const resource = await this.#createObject(
      context,
      "person",
      input,
      async (transaction, createdObjectId) => {
        await assertPersonState(
          transaction,
          context.principal.workspaceId,
          createdObjectId,
          userId,
          email,
        );
        await transaction.insert(persons).values({
          objectId: createdObjectId,
          workspaceId: context.principal.workspaceId,
          userId,
          email,
        });
      },
    );
    return this.#requireType(resource, "person");
  }

  getObject(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<EventPlanningResource> {
    return this.#objectReads.getObject(principal, objectId);
  }

  getAllowedActions(principal: UserPrincipal, objectId: string) {
    return this.#objectReads.getAllowedActions(principal, objectId);
  }

  /** Return visible canonical states in input order; unavailable IDs are omitted. */
  listVisibleObjects(
    principal: UserPrincipal,
    objectIds: readonly string[],
  ): Promise<EventPlanningResource[]> {
    return this.#objectReads.listVisibleObjects(principal, objectIds);
  }

  listTasks(
    principal: UserPrincipal,
    input: TaskListQueryInput = {},
  ): Promise<TaskPage> {
    return this.#taskReads.listTasks(principal, input);
  }

  listPersons(
    principal: UserPrincipal,
    input: PersonListQueryInput = {},
  ): Promise<PersonPage> {
    return this.#personReads.listPersons(principal, input);
  }

  listEvents(
    principal: UserPrincipal,
    input: EventListQueryInput = {},
  ): Promise<EventPage> {
    return this.#eventReads.listEvents(principal, input);
  }

  async getEvent(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<EventResource> {
    const resource = await this.#objectReads.getObject(principal, objectId);
    return this.#requireType(resource, "event");
  }

  async getTask(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<TaskResource> {
    const resource = await this.#objectReads.getObject(principal, objectId);
    return this.#requireType(resource, "task");
  }

  async getExpense(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<ExpenseResource> {
    const resource = await this.#objectReads.getObject(principal, objectId);
    return this.#requireType(resource, "expense");
  }

  async getReminder(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<ReminderResource> {
    const resource = await this.#objectReads.getObject(principal, objectId);
    return this.#requireType(resource, "reminder");
  }

  async getPerson(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<PersonResource> {
    const resource = await this.#objectReads.getObject(principal, objectId);
    return this.#requireType(resource, "person");
  }

  async getDocument(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<DocumentResource> {
    const resource = await this.#objectReads.getObject(principal, objectId);
    return this.#requireType(resource, "document");
  }

  async updateEvent(
    context: MutationContext,
    objectId: string,
    input: UpdateEventInput,
  ): Promise<EventResource> {
    // The function validates the merged state itself, so no PostgreSQL read precedes it.
    if (this.#writes.event !== undefined)
      return this.#writes.event.update(context, objectId, input);
    const current = this.#requireType(
      await this.#getEditableObject(context.principal, objectId),
      "event",
    );
    const startsAt =
      input.startsAt === undefined ? current.startsAt : input.startsAt;
    const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt;
    const timezone =
      input.timezone === undefined ? current.timezone : input.timezone;
    const startsOn =
      input.startsOn === undefined ? current.startsOn : input.startsOn;
    const endsOn = input.endsOn === undefined ? current.endsOn : input.endsOn;
    assertEventState(startsAt, endsAt, timezone, startsOn, endsOn);

    const resource = await this.#updateObject(
      context,
      current,
      input,
      async (transaction) => {
        const changes = {
          ...(input.startsOn !== undefined && { startsOn: input.startsOn }),
          ...(input.endsOn !== undefined && { endsOn: input.endsOn }),
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
    if (this.#writes.task !== undefined)
      return this.#writes.task.update(context, objectId, input);
    const current = this.#requireType(
      await this.#getEditableObject(context.principal, objectId),
      "task",
    );
    const status = input.status ?? current.status;
    const dueOn = input.dueOn === undefined ? current.dueOn : input.dueOn;
    const dueAt = input.dueAt === undefined ? current.dueAt : input.dueAt;
    const completedAt =
      input.completedAt === undefined ? current.completedAt : input.completedAt;
    assertTaskState(status, dueOn, dueAt, completedAt);
    assertTaskDuration(
      dueAt,
      input.durationMinutes === undefined
        ? current.durationMinutes
        : input.durationMinutes,
    );
    if (input.location !== undefined) assertTaskLocation(input.location);

    const resource = await this.#updateObject(
      context,
      current,
      input,
      async (transaction) => {
        if (
          input.parentTaskId !== undefined &&
          input.parentTaskId !== current.parentTaskId
        )
          await assertTaskParent(
            transaction,
            context.principal.workspaceId,
            current.id,
            input.parentTaskId,
            current.permissionScopeId,
          );
        if (
          input.assigneeId !== undefined &&
          input.assigneeId !== current.assigneeId
        )
          await assertTaskAssignee(
            transaction,
            context.principal.workspaceId,
            input.assigneeId,
          );
        const changes = {
          ...(input.status !== undefined && { status: input.status }),
          ...(input.parentTaskId !== undefined && {
            parentTaskId: input.parentTaskId,
          }),
          ...(input.assigneeId !== undefined && {
            assigneePersonId: input.assigneeId,
          }),
          ...(input.location !== undefined && { location: input.location }),
          ...(input.dueOn !== undefined && { dueOn: input.dueOn }),
          ...(input.dueAt !== undefined && { dueAt: input.dueAt }),
          ...(input.durationMinutes !== undefined && {
            durationMinutes: input.durationMinutes,
          }),
          ...(input.completedAt !== undefined && {
            completedAt: input.completedAt,
          }),
        };
        if (input.labelIds !== undefined)
          await setTaskLabels(
            transaction,
            context.principal.workspaceId,
            current.id,
            input.labelIds,
          );
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
    if (this.#writes.expense !== undefined)
      return this.#writes.expense.update(context, objectId, input);
    const current = this.#requireType(
      await this.#getEditableObject(context.principal, objectId),
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

  async updatePerson(
    context: MutationContext,
    objectId: string,
    input: UpdatePersonInput,
  ): Promise<PersonResource> {
    if (this.#writes.person !== undefined)
      return this.#writes.person.update(context, objectId, input);
    const current = this.#requireType(
      await this.#getEditableObject(context.principal, objectId),
      "person",
    );
    const userId = input.userId === undefined ? current.userId : input.userId;
    const email = input.email === undefined ? current.email : input.email;

    const resource = await this.#updateObject(
      context,
      current,
      input,
      async (transaction) => {
        await assertPersonState(
          transaction,
          context.principal.workspaceId,
          objectId,
          userId,
          email,
        );
        const changes = {
          ...(input.userId !== undefined && { userId: input.userId }),
          ...(input.email !== undefined && { email: input.email }),
        };
        if (Object.keys(changes).length > 0) {
          await transaction
            .update(persons)
            .set(changes)
            .where(
              and(
                eq(persons.workspaceId, context.principal.workspaceId),
                eq(persons.objectId, objectId),
              ),
            );
        }
      },
    );
    return this.#requireType(resource, "person");
  }

  async updateReminder(
    context: MutationContext,
    objectId: string,
    input: UpdateReminderInput,
  ): Promise<ReminderResource> {
    if (this.#writes.reminder !== undefined)
      return this.#writes.reminder.update(context, objectId, input);
    const current = this.#requireType(
      await this.#getEditableObject(context.principal, objectId),
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
    if (this.#writes.objectLifecycle !== undefined)
      return this.#writes.objectLifecycle.remove(
        context,
        objectId,
        expectedVersion,
        deletedAt,
      );

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
        const actor = {
          actorId: context.principal.userId,
          actorType: "user" as const,
          requestId: context.requestId,
        };
        const deleted = await recordObjectRevision(
          transaction,
          resource,
          actor,
          "deleted",
        );
        // A task takes its live subtasks to Trash with it, at the same
        // instant, each with its own audit event and revision.
        if (resource.objectType === "task") {
          for (const subtaskId of await liveSubtaskIds(
            transaction,
            context.principal.workspaceId,
            objectId,
          )) {
            await transaction
              .update(objects)
              .set({
                deletedAt,
                deletedWith: objectId,
                updatedAt: deletedAt,
                version: sql`${objects.version} + 1`,
              })
              .where(
                and(
                  eq(objects.workspaceId, context.principal.workspaceId),
                  eq(objects.id, subtaskId),
                ),
              );
            await recordObjectRevision(
              transaction,
              await readObjectState(
                transaction,
                context.principal.workspaceId,
                subtaskId,
              ),
              actor,
              "deleted",
              { cascadeFrom: objectId },
            );
          }
        }
        return deleted;
      },
    );

    return { id: objectId, version: resource.version, deletedAt };
  }

  async updatePermissionScope(
    context: MutationContext,
    objectId: string,
    input: UpdatePermissionScopeInput,
  ): Promise<EventPlanningResource> {
    if (this.#writes.permissionScope !== undefined)
      return this.#writes.permissionScope.updatePermissionScope(
        context,
        objectId,
        input.expectedVersion,
        input.permissionScopeId,
        this.#clock(),
      );
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
    const objectId = createId();
    const permissionScopeId = input.permissionScopeId ?? objectId;
    const requestHash =
      input.commandId === undefined
        ? undefined
        : createRequestHash(objectType, input);
    return withStableAuthorization(
      this.#database,
      context.principal.workspaceId,
      async (transaction, authorization) => {
        if (input.permissionScopeId === undefined) {
          await authorization.assertCanCreateInWorkspace(context.principal);
        } else {
          await authorization.assertCan(context.principal, "edit", {
            id: input.permissionScopeId,
            workspaceId: context.principal.workspaceId,
          });
        }
        // A repeated command returns what it created; a different input
        // under the same command id is a conflict.
        if (input.commandId !== undefined && requestHash !== undefined) {
          const [existing] = await transaction
            .select()
            .from(objectCreateCommands)
            .where(
              and(
                eq(
                  objectCreateCommands.workspaceId,
                  context.principal.workspaceId,
                ),
                eq(objectCreateCommands.userId, context.principal.userId),
                eq(objectCreateCommands.commandId, input.commandId),
              ),
            )
            .limit(1);
          if (existing !== undefined) {
            if (existing.requestHash !== requestHash)
              throw new CommandConflictError();
            await authorization.assertCan(context.principal, "view", {
              id: existing.objectId,
              workspaceId: context.principal.workspaceId,
            });
            return readObjectState(
              transaction,
              context.principal.workspaceId,
              existing.objectId,
            );
          }
        }
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
        if (input.commandId !== undefined && requestHash !== undefined)
          await transaction.insert(objectCreateCommands).values({
            workspaceId: context.principal.workspaceId,
            userId: context.principal.userId,
            commandId: input.commandId,
            requestId: context.requestId,
            requestHash,
            objectType,
            objectId,
          });

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
      },
    );
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
    return withStableAuthorization(
      this.#database,
      context.principal.workspaceId,
      async (transaction, authorization) => {
        await authorization.assertCan(context.principal, "edit", {
          id: current.id,
          workspaceId: context.principal.workspaceId,
        });
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
      },
    );
  }

  /** The live state an edit starts from, authorized and read in one snapshot. */
  #getEditableObject(
    principal: UserPrincipal,
    objectId: string,
  ): Promise<EventPlanningResource> {
    return readAuthorizedObject(this.#database, principal, objectId, "edit");
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
