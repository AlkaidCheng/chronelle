import {
  storageInventoryResponseSchema,
  type StorageInventoryResponse,
  commandReceiptSchema,
  commandStateResponseSchema,
  type CommandExecutePayload,
  type CommandTransitionRequest,
  type CommandReceipt,
  type CommandStateResponse,
  apiErrorResponseSchema,
  objectDeletionResponseSchema,
  relationListResponseSchema,
  recoveryPreviewSchema,
  trashListResponseSchema,
  removedRelationListResponseSchema,
  type TrashQueryInput,
  type RecoveryRequest,
  type RemovedRelationQueryInput,
  developmentSignInResponseSchema,
  documentAttachmentListResponseSchema,
  documentAttachmentResponseSchema,
  documentDownloadAuthorizationResponseSchema,
  documentUploadAuthorizationResponseSchema,
  maximumDocumentSizeBytes,
  eventDetailResponseSchema,
  eventListResponseSchema,
  eventPlanningResourceResponseSchema,
  eventResourceProjectionResponseSchema,
  eventResponseSchema,
  expenseResourceProjectionResponseSchema,
  expenseResponseSchema,
  objectAccessResponseSchema,
  objectSearchResponseSchema,
  relationDeletionResponseSchema,
  relationResponseSchema,
  reminderResourceProjectionResponseSchema,
  reminderResponseSchema,
  sessionResponseSchema,
  shareListResponseSchema,
  shareResponseSchema,
  shareRevocationResponseSchema,
  taskResourceProjectionResponseSchema,
  taskResponseSchema,
  timelineResponseSchema,
  revisionListResponseSchema,
  revisionResponseSchema,
  revisionComparisonResponseSchema,
  revisionRestorePreviewSchema,
  type RevisionComparisonQuery,
  type RevisionComparisonResponse,
  type RevisionRestorePreview,
  type RevisionRestoreRequest,
  eventContextCreateResponseSchema,
  type EventContextCreatePayload,
  type EventContextCreateResponse,
  type RevisionListResponse,
  type RevisionResponse,
  type DevelopmentSignInRequest,
  type DevelopmentSignInResponse,
  type DocumentAttachmentListResponse,
  type DocumentAttachmentResponse,
  type DocumentDownloadAuthorizationResponse,
  type DocumentUploadAuthorizationPayload,
  type DocumentUploadAuthorizationResponse,
  type EventCreatePayload,
  type EventDetailResponse,
  type EventListResponse,
  type EventPlanningResourceResponse,
  type EventResourceProjectionResponse,
  type EventResponse,
  type EventUpdatePayload,
  type ExpenseCreatePayload,
  type ExpenseResourceProjectionResponse,
  type ExpenseResponse,
  type ExpenseUpdatePayload,
  type ObjectAccessResponse,
  type ObjectSearchQueryInput,
  type ObjectSearchResponse,
  type PermissionScopeUpdatePayload,
  type RelationCreatePayload,
  type ReminderCreatePayload,
  type ReminderResourceProjectionResponse,
  type ReminderResponse,
  type ReminderUpdatePayload,
  type SessionResponse,
  type ShareCreatePayload,
  type ShareListResponse,
  type ShareResponse,
  type ShareRevocationResponse,
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

export interface DocumentFileInput {
  arrayBuffer(): Promise<ArrayBuffer>;
  readonly name: string;
  readonly size: number;
  readonly type: string;
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

function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  return globalThis.crypto.subtle
    .digest("SHA-256", bytes)
    .then((digest) =>
      Array.from(new Uint8Array(digest), (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join(""),
    );
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

  getCommandState(): Promise<CommandStateResponse> {
    return this.#request("/api/commands", commandStateResponseSchema);
  }

  executeCommand(input: CommandExecutePayload): Promise<CommandReceipt> {
    return this.#request(
      "/api/commands",
      commandReceiptSchema,
      jsonRequest(input, "POST"),
    );
  }

  undoCommand(input: CommandTransitionRequest): Promise<CommandReceipt> {
    return this.#request(
      "/api/commands/undo",
      commandReceiptSchema,
      jsonRequest(input, "POST"),
    );
  }

  redoCommand(input: CommandTransitionRequest): Promise<CommandReceipt> {
    return this.#request(
      "/api/commands/redo",
      commandReceiptSchema,
      jsonRequest(input, "POST"),
    );
  }

  getSession(): Promise<SessionResponse> {
    return this.#request("/api/auth/session", sessionResponseSchema);
  }

  getStorageInventory(): Promise<StorageInventoryResponse> {
    return this.#request(
      "/api/workspace/storage-inventory",
      storageInventoryResponseSchema,
    );
  }

  listEvents(): Promise<EventListResponse> {
    return this.#request("/api/events", eventListResponseSchema);
  }

  listObjectRevisions(
    id: string,
    input: { readonly limit?: number; readonly beforeVersion?: number } = {},
  ): Promise<RevisionListResponse> {
    const query = new URLSearchParams();
    if (input.limit !== undefined) query.set("limit", String(input.limit));
    if (input.beforeVersion !== undefined)
      query.set("beforeVersion", String(input.beforeVersion));
    return this.#request(
      `/api/objects/${id}/revisions?${query.toString()}`,
      revisionListResponseSchema,
    );
  }

  getObjectRevision(id: string, version: number): Promise<RevisionResponse> {
    return this.#request(
      `/api/objects/${id}/revisions/${version}`,
      revisionResponseSchema,
    );
  }

  compareObjectRevisions(
    id: string,
    input: RevisionComparisonQuery,
  ): Promise<RevisionComparisonResponse> {
    const query = new URLSearchParams({
      fromVersion: String(input.fromVersion),
      toVersion: String(input.toVersion),
    });
    return this.#request(
      `/api/objects/${id}/revisions/compare?${query}`,
      revisionComparisonResponseSchema,
    );
  }

  previewObjectRestoration(
    id: string,
    version: number,
  ): Promise<RevisionRestorePreview> {
    return this.#request(
      `/api/objects/${id}/revisions/${version}/restore-preview`,
      revisionRestorePreviewSchema,
    );
  }

  restoreObjectRevision(
    id: string,
    version: number,
    input: RevisionRestoreRequest,
  ): Promise<EventPlanningResourceResponse> {
    return this.#request(
      `/api/objects/${id}/revisions/${version}/restore`,
      eventPlanningResourceResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  searchObjects(input: ObjectSearchQueryInput): Promise<ObjectSearchResponse> {
    const parameters = new URLSearchParams({ query: input.query });
    if (input.cursor !== undefined) {
      parameters.set("cursor", input.cursor);
    }
    if (input.limit !== undefined) {
      parameters.set("limit", String(input.limit));
    }
    if (input.objectType !== undefined) {
      parameters.set("objectType", input.objectType);
    }
    return this.#request(
      `/api/search?${parameters.toString()}`,
      objectSearchResponseSchema,
    );
  }

  createEvent(input: EventCreatePayload): Promise<EventResponse> {
    return this.#request(
      "/api/events",
      eventResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  createEventResource(
    eventId: string,
    input: EventContextCreatePayload,
  ): Promise<EventContextCreateResponse> {
    return this.#request(
      `/api/events/${eventId}/resources`,
      eventContextCreateResponseSchema,
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

  listDocumentAttachments(
    parentObjectId: string,
  ): Promise<DocumentAttachmentListResponse> {
    return this.#request(
      `/api/objects/${parentObjectId}/documents`,
      documentAttachmentListResponseSchema,
    );
  }

  authorizeDocumentUpload(
    input: DocumentUploadAuthorizationPayload,
  ): Promise<DocumentUploadAuthorizationResponse> {
    return this.#request(
      "/api/documents/upload-url",
      documentUploadAuthorizationResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  finalizeDocumentUpload(
    uploadAuthorizationId: string,
  ): Promise<DocumentAttachmentResponse> {
    return this.#request(
      "/api/documents",
      documentAttachmentResponseSchema,
      jsonRequest({ uploadAuthorizationId }, "POST"),
    );
  }

  async attachDocument(
    parentObjectId: string,
    file: DocumentFileInput,
  ): Promise<DocumentAttachmentResponse> {
    if (!Number.isSafeInteger(file.size) || file.size < 0) {
      throw new ApiClientError(
        400,
        "invalid_request",
        "The file size is invalid.",
      );
    }
    if (file.size > maximumDocumentSizeBytes) {
      throw new ApiClientError(
        413,
        "payload_too_large",
        "The file exceeds the 25 MiB attachment limit.",
      );
    }
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength !== file.size) {
      throw new ApiClientError(
        400,
        "invalid_request",
        "The file size changed before upload.",
      );
    }
    const authorization = await this.authorizeDocumentUpload({
      checksumSha256: await sha256Hex(bytes),
      mimeType: file.type || "application/octet-stream",
      originalFilename: file.name,
      parentObjectId,
      sizeBytes: file.size,
    });
    await this.#transfer(authorization.upload.url, {
      body: bytes,
      headers: authorization.upload.headers,
      method: authorization.upload.method,
    });
    return this.finalizeDocumentUpload(authorization.id);
  }

  authorizeDocumentDownload(
    documentId: string,
  ): Promise<DocumentDownloadAuthorizationResponse> {
    return this.#request(
      `/api/documents/${documentId}/download-url`,
      documentDownloadAuthorizationResponseSchema,
    );
  }

  async downloadDocument(documentId: string): Promise<Blob> {
    const authorization = await this.authorizeDocumentDownload(documentId);
    const response = await this.#fetch(
      this.#resolveUrl(authorization.download.url),
      {
        headers: authorization.download.headers,
        method: authorization.download.method,
      },
    );
    if (!response.ok) {
      await this.#throwResponseError(response);
    }
    return response.blob();
  }

  deleteObject(id: string, expectedVersion: number) {
    return this.#request(
      `/api/objects/${id}?expectedVersion=${expectedVersion}`,
      objectDeletionResponseSchema,
      { method: "DELETE" },
    );
  }

  listTrash(input: TrashQueryInput = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) query.set(key, String(value));
    }
    return this.#request(`/api/trash?${query}`, trashListResponseSchema);
  }

  previewObjectRecovery(id: string) {
    return this.#request(
      `/api/objects/${id}/recovery-preview`,
      recoveryPreviewSchema,
    );
  }

  recoverObject(id: string, input: RecoveryRequest) {
    return this.#request(
      `/api/objects/${id}/recover`,
      eventPlanningResourceResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  listObjectRelations(id: string) {
    return this.#request(
      `/api/objects/${id}/relations`,
      relationListResponseSchema,
    );
  }

  listRemovedRelations(id: string, input: RemovedRelationQueryInput = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) query.set(key, String(value));
    }
    return this.#request(
      `/api/objects/${id}/removed-relations?${query}`,
      removedRelationListResponseSchema,
    );
  }

  recoverRelation(id: string, input: RecoveryRequest) {
    return this.#request(
      `/api/relations/${id}/recover`,
      relationResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  deleteRelation(id: string, expectedVersion: number): Promise<void> {
    return this.#request(
      `/api/relations/${id}?expectedVersion=${expectedVersion}`,
      relationDeletionResponseSchema,
      { method: "DELETE" },
    ).then(() => undefined);
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

  getObjectAccess(id: string): Promise<ObjectAccessResponse> {
    return this.#request(
      `/api/objects/${id}/access`,
      objectAccessResponseSchema,
    );
  }

  listShares(id: string): Promise<ShareListResponse> {
    return this.#request(`/api/objects/${id}/shares`, shareListResponseSchema);
  }

  shareResource(input: ShareCreatePayload): Promise<ShareResponse> {
    return this.#request(
      "/api/shares",
      shareResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  revokeShare(id: string): Promise<ShareRevocationResponse> {
    return this.#request(`/api/shares/${id}`, shareRevocationResponseSchema, {
      method: "DELETE",
    });
  }

  updatePermissionScope(
    id: string,
    input: PermissionScopeUpdatePayload,
  ): Promise<EventPlanningResourceResponse> {
    return this.#request(
      `/api/objects/${id}/permission-scope`,
      eventPlanningResourceResponseSchema,
      jsonRequest(input, "PATCH"),
    );
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
      this.#throwParsedResponseError(response.status, body);
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

  #resolveUrl(url: string): string {
    return /^https?:\/\//u.test(url) ? url : `${this.#baseUrl}${url}`;
  }

  async #transfer(url: string, request: RequestInit): Promise<void> {
    let response: Response;
    try {
      response = await this.#fetch(this.#resolveUrl(url), request);
    } catch {
      throw new ApiClientError(
        0,
        "network_error",
        "The document transfer could not be completed.",
      );
    }
    if (!response.ok) {
      await this.#throwResponseError(response);
    }
  }

  async #throwResponseError(response: Response): Promise<never> {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ApiClientError(
        response.status,
        "request_failed",
        "The document transfer could not be completed.",
      );
    }
    return this.#throwParsedResponseError(response.status, body);
  }

  #throwParsedResponseError(status: number, body: unknown): never {
    const error = apiErrorResponseSchema.safeParse(body);
    throw new ApiClientError(
      status,
      error.success ? error.data.error.code : "request_failed",
      error.success
        ? error.data.error.message
        : "The request could not be completed.",
    );
  }
}
