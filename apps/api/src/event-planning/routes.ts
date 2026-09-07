import type { UserPrincipal } from "@chronelle/authorization";
import type {
  CreateEventInput,
  CreateExpenseInput,
  CreateReminderInput,
  CreateTaskInput,
  EventPlanningObjectService,
  EventPlanningProjectionService,
  EventPlanningResource,
  MutationContext,
  ObjectRelationService,
  EventContextService,
  UpdateEventInput,
  UpdateExpenseInput,
  UpdateReminderInput,
  UpdateTaskInput,
} from "@chronelle/object-model";
import {
  eventCreateRequestSchema,
  eventDetailResponseSchema,
  eventListResponseSchema,
  eventListQuerySchema,
  eventPlanningResourceResponseSchema,
  eventResourceProjectionResponseSchema,
  eventResponseSchema,
  eventUpdateRequestSchema,
  expenseCreateRequestSchema,
  expenseResourceProjectionResponseSchema,
  expenseResponseSchema,
  expenseUpdateRequestSchema,
  objectDeletionQuerySchema,
  objectDeletionResponseSchema,
  objectIdParamsSchema,
  relationCreateRequestSchema,
  relationDeletionResponseSchema,
  relationDeletionQuerySchema,
  relationListResponseSchema,
  relationResponseSchema,
  reminderCreateRequestSchema,
  reminderResourceProjectionResponseSchema,
  reminderResponseSchema,
  reminderUpdateRequestSchema,
  taskCreateRequestSchema,
  taskResourceProjectionResponseSchema,
  taskResponseSchema,
  taskUpdateRequestSchema,
  timelineResponseSchema,
  eventContextCreateRequestSchema,
  eventContextCreateResponseSchema,
} from "@chronelle/schemas";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { z } from "zod";

import { requirePrincipal } from "../request-context.js";
import { parseRequest } from "../request-validation.js";
import {
  serializeEventDetail,
  serializeObjectDeletion,
  serializeRelation,
  serializeRelationDeletion,
  serializeResource,
  serializeResourceProjection,
  serializeTimeline,
} from "./serialization.js";

export interface EventPlanningRouteDependencies {
  readonly objects: EventPlanningObjectService;
  readonly projections: EventPlanningProjectionService;
  readonly relations: ObjectRelationService;
  readonly eventContexts: EventContextService;
}

interface TypedObjectRouteDefinition<CreateInput, UpdateInput> {
  readonly collectionPath: string;
  readonly create: (
    context: MutationContext,
    input: CreateInput,
  ) => Promise<EventPlanningResource>;
  readonly createSchema: z.ZodType<CreateInput>;
  readonly get: (
    principal: UserPrincipal,
    objectId: string,
  ) => Promise<EventPlanningResource>;
  readonly responseSchema: z.ZodType;
  readonly update: (
    context: MutationContext,
    objectId: string,
    input: UpdateInput,
  ) => Promise<EventPlanningResource>;
  readonly updateSchema: z.ZodType<UpdateInput>;
}

function mutationContext(request: FastifyRequest): MutationContext {
  return { principal: requirePrincipal(request), requestId: request.id };
}

function registerTypedObjectRoutes<CreateInput, UpdateInput>(
  app: FastifyInstance,
  definition: TypedObjectRouteDefinition<CreateInput, UpdateInput>,
): void {
  const itemPath = `/api/${definition.collectionPath}/:id`;

  app.post(
    `/api/${definition.collectionPath}`,
    { preHandler: app.authenticate },
    async (request, reply) => {
      const input = parseRequest(definition.createSchema, request.body);
      const resource = await definition.create(mutationContext(request), input);
      return reply
        .code(201)
        .send(definition.responseSchema.parse(serializeResource(resource)));
    },
  );

  app.get(itemPath, { preHandler: app.authenticate }, async (request) => {
    const { id } = parseRequest(objectIdParamsSchema, request.params);
    const resource = await definition.get(requirePrincipal(request), id);
    return definition.responseSchema.parse(serializeResource(resource));
  });

  app.patch(itemPath, { preHandler: app.authenticate }, async (request) => {
    const { id } = parseRequest(objectIdParamsSchema, request.params);
    const input = parseRequest(definition.updateSchema, request.body);
    const resource = await definition.update(
      mutationContext(request),
      id,
      input,
    );
    return definition.responseSchema.parse(serializeResource(resource));
  });
}

export function registerEventPlanningRoutes(
  app: FastifyInstance,
  dependencies: EventPlanningRouteDependencies,
): void {
  app.post(
    "/api/events/:id/resources",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(eventContextCreateRequestSchema, request.body);
      const result = await dependencies.eventContexts.create(
        mutationContext(request),
        id,
        input,
      );
      return reply
        .code(201)
        .send(eventContextCreateResponseSchema.parse(result));
    },
  );
  app.get("/api/events", { preHandler: app.authenticate }, async (request) => {
    const events = await dependencies.objects.listEvents(
      requirePrincipal(request),
      parseRequest(eventListQuerySchema, request.query),
    );
    return eventListResponseSchema.parse({
      ...events,
      items: events.items.map(serializeResource),
    });
  });

  registerTypedObjectRoutes<CreateEventInput, UpdateEventInput>(app, {
    collectionPath: "events",
    createSchema: eventCreateRequestSchema,
    updateSchema: eventUpdateRequestSchema,
    responseSchema: eventResponseSchema,
    create: (context, input) =>
      dependencies.objects.createEvent(context, input),
    get: (principal, id) => dependencies.objects.getEvent(principal, id),
    update: (context, id, input) =>
      dependencies.objects.updateEvent(context, id, input),
  });
  registerTypedObjectRoutes<CreateTaskInput, UpdateTaskInput>(app, {
    collectionPath: "tasks",
    createSchema: taskCreateRequestSchema,
    updateSchema: taskUpdateRequestSchema,
    responseSchema: taskResponseSchema,
    create: (context, input) => dependencies.objects.createTask(context, input),
    get: (principal, id) => dependencies.objects.getTask(principal, id),
    update: (context, id, input) =>
      dependencies.objects.updateTask(context, id, input),
  });
  registerTypedObjectRoutes<CreateExpenseInput, UpdateExpenseInput>(app, {
    collectionPath: "expenses",
    createSchema: expenseCreateRequestSchema,
    updateSchema: expenseUpdateRequestSchema,
    responseSchema: expenseResponseSchema,
    create: (context, input) =>
      dependencies.objects.createExpense(context, input),
    get: (principal, id) => dependencies.objects.getExpense(principal, id),
    update: (context, id, input) =>
      dependencies.objects.updateExpense(context, id, input),
  });
  registerTypedObjectRoutes<CreateReminderInput, UpdateReminderInput>(app, {
    collectionPath: "reminders",
    createSchema: reminderCreateRequestSchema,
    updateSchema: reminderUpdateRequestSchema,
    responseSchema: reminderResponseSchema,
    create: (context, input) =>
      dependencies.objects.createReminder(context, input),
    get: (principal, id) => dependencies.objects.getReminder(principal, id),
    update: (context, id, input) =>
      dependencies.objects.updateReminder(context, id, input),
  });

  app.get(
    "/api/objects/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const resource = await dependencies.objects.getObject(
        requirePrincipal(request),
        id,
      );
      return eventPlanningResourceResponseSchema.parse(
        serializeResource(resource),
      );
    },
  );

  app.delete(
    "/api/objects/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const { expectedVersion } = parseRequest(
        objectDeletionQuerySchema,
        request.query,
      );
      const deletion = await dependencies.objects.softDelete(
        mutationContext(request),
        id,
        expectedVersion,
      );
      return objectDeletionResponseSchema.parse(
        serializeObjectDeletion(deletion),
      );
    },
  );

  app.get(
    "/api/objects/:id/relations",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const relations = await dependencies.relations.listForObject(
        requirePrincipal(request),
        id,
      );
      return relationListResponseSchema.parse({
        items: relations.map(serializeRelation),
      });
    },
  );

  app.post(
    "/api/objects/:id/relations",
    { preHandler: app.authenticate },
    async (request, reply) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const input = parseRequest(relationCreateRequestSchema, request.body);
      const relation = await dependencies.relations.create(
        mutationContext(request),
        { ...input, sourceObjectId: id },
      );
      return reply
        .code(201)
        .send(relationResponseSchema.parse(serializeRelation(relation)));
    },
  );

  app.delete(
    "/api/relations/:id",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const { expectedVersion } = parseRequest(
        relationDeletionQuerySchema,
        request.query,
      );
      const deletion = await dependencies.relations.softDelete(
        mutationContext(request),
        id,
        expectedVersion,
      );
      return relationDeletionResponseSchema.parse(
        serializeRelationDeletion(deletion),
      );
    },
  );

  app.get(
    "/api/events/:id/detail",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const projection = await dependencies.projections.getDetail(
        requirePrincipal(request),
        id,
      );
      return eventDetailResponseSchema.parse(serializeEventDetail(projection));
    },
  );

  app.get(
    "/api/events/:id/todos",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const projection = await dependencies.projections.getTodos(
        requirePrincipal(request),
        id,
      );
      return taskResourceProjectionResponseSchema.parse(
        serializeResourceProjection(projection),
      );
    },
  );

  app.get(
    "/api/events/:id/calendar",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const projection = await dependencies.projections.getCalendar(
        requirePrincipal(request),
        id,
      );
      return eventResourceProjectionResponseSchema.parse(
        serializeResourceProjection(projection),
      );
    },
  );

  app.get(
    "/api/events/:id/timeline",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const projection = await dependencies.projections.getTimeline(
        requirePrincipal(request),
        id,
      );
      return timelineResponseSchema.parse(serializeTimeline(projection));
    },
  );

  app.get(
    "/api/events/:id/itinerary",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const projection = await dependencies.projections.getItinerary(
        requirePrincipal(request),
        id,
      );
      return eventResourceProjectionResponseSchema.parse(
        serializeResourceProjection(projection),
      );
    },
  );

  app.get(
    "/api/events/:id/expenses",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const projection = await dependencies.projections.getExpenses(
        requirePrincipal(request),
        id,
      );
      return expenseResourceProjectionResponseSchema.parse(
        serializeResourceProjection(projection),
      );
    },
  );

  app.get(
    "/api/events/:id/reminders",
    { preHandler: app.authenticate },
    async (request) => {
      const { id } = parseRequest(objectIdParamsSchema, request.params);
      const projection = await dependencies.projections.getReminders(
        requirePrincipal(request),
        id,
      );
      return reminderResourceProjectionResponseSchema.parse(
        serializeResourceProjection(projection),
      );
    },
  );
}
