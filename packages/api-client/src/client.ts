import {
  apiErrorResponseSchema,
  developmentSignInResponseSchema,
  eventDetailResponseSchema,
  eventListResponseSchema,
  eventResourceProjectionResponseSchema,
  eventResponseSchema,
  expenseResourceProjectionResponseSchema,
  expenseResponseSchema,
  relationResponseSchema,
  reminderResourceProjectionResponseSchema,
  reminderResponseSchema,
  sessionResponseSchema,
  taskResourceProjectionResponseSchema,
  taskResponseSchema,
  timelineResponseSchema,
  type DevelopmentSignInRequest,
  type DevelopmentSignInResponse,
  type EventCreatePayload,
  type EventDetailResponse,
  type EventListResponse,
  type EventResourceProjectionResponse,
  type EventResponse,
  type EventUpdatePayload,
  type ExpenseCreatePayload,
  type ExpenseResourceProjectionResponse,
  type ExpenseResponse,
  type ExpenseUpdatePayload,
  type RelationCreatePayload,
  type ReminderCreatePayload,
  type ReminderResourceProjectionResponse,
  type ReminderResponse,
  type ReminderUpdatePayload,
  type SessionResponse,
  type TaskCreatePayload,
  type TaskResourceProjectionResponse,
  type TaskResponse,
  type TaskUpdatePayload,
  type TimelineResponse,
} from "@chronelle/schemas";
import type { z } from "zod";

export interface ApiCredential {
  readonly accessToken: string;
  readonly workspaceId: string;
}

export interface ChronelleApiClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly getCredential?: () => ApiCredential | null;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

function jsonRequest(body: unknown, method: string): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  };
}

export class ChronelleApiClient {
  readonly #baseUrl: string;
  readonly #fetch: typeof globalThis.fetch;
  readonly #getCredential: () => ApiCredential | null;

  constructor(options: ChronelleApiClientOptions = {}) {
    this.#baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#getCredential = options.getCredential ?? (() => null);
  }

  signIn(input: DevelopmentSignInRequest): Promise<DevelopmentSignInResponse> {
    return this.#request(
      "/api/auth/development/sign-in",
      developmentSignInResponseSchema,
      jsonRequest(input, "POST"),
      false,
    );
  }

  getSession(): Promise<SessionResponse> {
    return this.#request("/api/auth/session", sessionResponseSchema);
  }

  listEvents(): Promise<EventListResponse> {
    return this.#request("/api/events", eventListResponseSchema);
  }

  createEvent(input: EventCreatePayload): Promise<EventResponse> {
    return this.#request(
      "/api/events",
      eventResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  updateEvent(id: string, input: EventUpdatePayload): Promise<EventResponse> {
    return this.#request(
      `/api/events/${id}`,
      eventResponseSchema,
      jsonRequest(input, "PATCH"),
    );
  }

  createTask(input: TaskCreatePayload): Promise<TaskResponse> {
    return this.#request(
      "/api/tasks",
      taskResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  updateTask(id: string, input: TaskUpdatePayload): Promise<TaskResponse> {
    return this.#request(
      `/api/tasks/${id}`,
      taskResponseSchema,
      jsonRequest(input, "PATCH"),
    );
  }

  createExpense(input: ExpenseCreatePayload): Promise<ExpenseResponse> {
    return this.#request(
      "/api/expenses",
      expenseResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  updateExpense(
    id: string,
    input: ExpenseUpdatePayload,
  ): Promise<ExpenseResponse> {
    return this.#request(
      `/api/expenses/${id}`,
      expenseResponseSchema,
      jsonRequest(input, "PATCH"),
    );
  }

  createReminder(input: ReminderCreatePayload): Promise<ReminderResponse> {
    return this.#request(
      "/api/reminders",
      reminderResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  updateReminder(
    id: string,
    input: ReminderUpdatePayload,
  ): Promise<ReminderResponse> {
    return this.#request(
      `/api/reminders/${id}`,
      reminderResponseSchema,
      jsonRequest(input, "PATCH"),
    );
  }

  createRelation(sourceObjectId: string, input: RelationCreatePayload) {
    return this.#request(
      `/api/objects/${sourceObjectId}/relations`,
      relationResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  getEventDetail(id: string): Promise<EventDetailResponse> {
    return this.#request(`/api/events/${id}/detail`, eventDetailResponseSchema);
  }

  getEventTodos(id: string): Promise<TaskResourceProjectionResponse> {
    return this.#request(
      `/api/events/${id}/todos`,
      taskResourceProjectionResponseSchema,
    );
  }

  getEventCalendar(id: string): Promise<EventResourceProjectionResponse> {
    return this.#request(
      `/api/events/${id}/calendar`,
      eventResourceProjectionResponseSchema,
    );
  }

  getEventTimeline(id: string): Promise<TimelineResponse> {
    return this.#request(`/api/events/${id}/timeline`, timelineResponseSchema);
  }

  getEventItinerary(id: string): Promise<EventResourceProjectionResponse> {
    return this.#request(
      `/api/events/${id}/itinerary`,
      eventResourceProjectionResponseSchema,
    );
  }

  getEventExpenses(id: string): Promise<ExpenseResourceProjectionResponse> {
    return this.#request(
      `/api/events/${id}/expenses`,
      expenseResourceProjectionResponseSchema,
    );
  }

  getEventReminders(id: string): Promise<ReminderResourceProjectionResponse> {
    return this.#request(
      `/api/events/${id}/reminders`,
      reminderResourceProjectionResponseSchema,
    );
  }

  async #request<Result>(
    path: string,
    schema: z.ZodType<Result>,
    request: RequestInit = {},
    authorized = true,
  ): Promise<Result> {
    const headers = new Headers(request.headers);
    if (authorized) {
      const credential = this.#getCredential();
      if (credential === null) {
        throw new ApiClientError(
          401,
          "unauthenticated",
          "A Chronelle session is required.",
        );
      }
      headers.set("authorization", `Bearer ${credential.accessToken}`);
      headers.set("x-workspace-id", credential.workspaceId);
    }

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...request,
        headers,
      });
    } catch {
      throw new ApiClientError(
        0,
        "network_error",
        "The Chronelle API could not be reached.",
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiClientError(
        response.status,
        "invalid_response",
        "The Chronelle API returned an unreadable response.",
      );
    }
    if (!response.ok) {
      const error = apiErrorResponseSchema.safeParse(body);
      throw new ApiClientError(
        response.status,
        error.success ? error.data.error.code : "request_failed",
        error.success
          ? error.data.error.message
          : "The request could not be completed.",
      );
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiClientError(
        response.status,
        "invalid_response",
        "The Chronelle API returned an unexpected response.",
      );
    }
    return parsed.data;
  }
}
