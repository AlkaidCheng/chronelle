import {
  type AcceptedResponse,
  acceptedResponseSchema,
  apiErrorResponseSchema,
  type CommandExecutePayload,
  type CommandReceipt,
  type CommandStateResponse,
  type CommandTransitionRequest,
  commandReceiptSchema,
  commandStateResponseSchema,
  type DevelopmentSignInRequest,
  type DevelopmentSignInResponse,
  type DocumentAttachmentListResponse,
  type DocumentAttachmentResponse,
  type DocumentDownloadAuthorizationResponse,
  type DocumentUploadAuthorizationPayload,
  type DocumentUploadAuthorizationResponse,
  developmentSignInResponseSchema,
  documentAttachmentListResponseSchema,
  documentAttachmentResponseSchema,
  documentDownloadAuthorizationResponseSchema,
  documentUploadAuthorizationResponseSchema,
  type EmailRequest,
  type EventContextCreatePayload,
  type EventContextCreateResponse,
  type EventCreatePayload,
  type EventDetailResponse,
  type EventLayoutHistoryQueryInput,
  type EventLayoutHistoryResponse,
  type EventLayoutResponse,
  type EventLayoutRestore,
  type EventLayoutUpdate,
  type EventListQueryInput,
  type EventListResponse,
  type EventPlanningResourceResponse,
  type EventResourceProjectionResponse,
  type EventResponse,
  type EventUpdatePayload,
  type ExpenseCreatePayload,
  type ExpenseResourceProjectionResponse,
  type ExpenseResponse,
  type ExpenseUpdatePayload,
  eventContextCreateResponseSchema,
  eventDetailResponseSchema,
  eventLayoutHistoryResponseSchema,
  eventLayoutResponseSchema,
  eventListResponseSchema,
  eventPlanningResourceResponseSchema,
  eventResourceProjectionResponseSchema,
  eventResponseSchema,
  expenseResourceProjectionResponseSchema,
  expenseResponseSchema,
  type Friend,
  type FriendInvitationPayload,
  type FriendItemStateResponse,
  type FriendsResponse,
  friendItemStateResponseSchema,
  friendSchema,
  friendsResponseSchema,
  type AccountUpdateRequest,
  type FriendRequestRequest,
  type UsernameAvailabilityResponse,
  usernameAvailabilityResponseSchema,
  type UserSearchResponse,
  type UserSummary,
  userSearchResponseSchema,
  userSummarySchema,
  type LabelCreateRequest,
  type LabelListResponse,
  type LabelResponse,
  type LabelUpdateRequest,
  labelListResponseSchema,
  labelResponseSchema,
  maximumDocumentSizeBytes,
  type ObjectAccessResponse,
  type ObjectSearchQueryInput,
  type ObjectSearchResponse,
  objectAccessResponseSchema,
  objectDeletionResponseSchema,
  objectSearchResponseSchema,
  type PasswordResetConfirmRequest,
  type PasswordSignInRequest,
  type PermissionScopeUpdatePayload,
  type PersonCreatePayload,
  type PersonListQueryInput,
  type PersonListResponse,
  type PersonShareListResponse,
  type PersonResourceProjectionResponse,
  type PersonResponse,
  type PersonUpdatePayload,
  type PreferencesRequest,
  personListResponseSchema,
  personResourceProjectionResponseSchema,
  personResponseSchema,
  type RecoveryRequest,
  type RelationCreatePayload,
  type RelationListQueryInput,
  type ReminderCreatePayload,
  type ReminderResourceProjectionResponse,
  type ReminderResponse,
  type ReminderUpdatePayload,
  type RemovedRelationQueryInput,
  type RevisionComparisonQuery,
  type RevisionComparisonResponse,
  type RevisionListResponse,
  type RevisionResponse,
  type RevisionRestorePreview,
  type RevisionRestoreRequest,
  recoveryPreviewSchema,
  relationDeletionResponseSchema,
  relationListResponseSchema,
  relationResponseSchema,
  reminderResourceProjectionResponseSchema,
  reminderResponseSchema,
  removedRelationListResponseSchema,
  revisionComparisonResponseSchema,
  revisionListResponseSchema,
  revisionResponseSchema,
  revisionRestorePreviewSchema,
  type SentInvitation,
  type SessionResponse,
  type SessionRevocationResponse,
  type PendingShare,
  type PendingShareCreateRequest,
  type PendingShareRevocationResponse,
  type ShareCreatePayload,
  type ShareListResponse,
  type ShareResponse,
  type ShareRevocationResponse,
  type WorkspaceMember,
  type WorkspaceMemberAddRequest,
  type WorkspaceMemberListResponse,
  type WorkspaceMemberRemovalResponse,
  type SignInResponse,
  type SignUpRequest,
  type StorageInventoryResponse,
  sentInvitationSchema,
  sessionResponseSchema,
  sessionRevocationResponseSchema,
  pendingShareRevocationResponseSchema,
  pendingShareSchema,
  personShareListResponseSchema,
  shareListResponseSchema,
  shareResponseSchema,
  shareRevocationResponseSchema,
  workspaceMemberListResponseSchema,
  workspaceMemberRemovalResponseSchema,
  workspaceMemberSchema,
  signInResponseSchema,
  storageInventoryResponseSchema,
  type TaskCreatePayload,
  type TaskListQueryInput,
  type TaskListResponse,
  type TaskResourceProjectionResponse,
  type TaskResponse,
  type TaskUpdatePayload,
  type TimelineResponse,
  type TrashQueryInput,
  taskListResponseSchema,
  taskResourceProjectionResponseSchema,
  taskResponseSchema,
  timelineResponseSchema,
  trashListResponseSchema,
  type UserResponse,
  userResponseSchema,
  type VerifyEmailRequest,
} from "@chronelle/schemas";
import type { z } from "zod";

/**
 * The active session as the client presents it: the workspace every request
 * acts in, and the bearer token when the caller holds one. A browser client
 * omits the token; its session travels as the origin's httpOnly cookie and
 * the web proxy presents it to the API.
 */
export interface ApiCredential {
  readonly accessToken?: string | undefined;
  readonly workspaceId: string;
}

export interface ChronelleApiClientOptions {
  readonly baseUrl?: string;
  readonly fetch?: typeof globalThis.fetch;
  readonly getCredential?: () => ApiCredential | null;
  readonly signal?: AbortSignal | undefined;
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
  readonly #signal: AbortSignal | undefined;

  constructor(options: ChronelleApiClientOptions = {}) {
    this.#baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";
    this.#fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.#getCredential = options.getCredential ?? (() => null);
    this.#signal = options.signal;
  }

  /** Bind a request to both its caller's cancellation and the session lifetime. */
  withSignal(signal: AbortSignal): ChronelleApiClient {
    return this.#createScopedClient(signal);
  }

  #captureCredential(): ApiCredential | null {
    this.#signal?.throwIfAborted();
    const credential = this.#getCredential();
    return credential === null ? null : { ...credential };
  }

  #assertCurrent(credential: ApiCredential | null): void {
    const current = this.#captureCredential();
    if (
      current?.accessToken !== credential?.accessToken ||
      current?.workspaceId !== credential?.workspaceId
    ) {
      throw new DOMException("The client session changed.", "AbortError");
    }
  }

  #createScopedClient(signal?: AbortSignal): ChronelleApiClient {
    const credential = this.#captureCredential();
    return new ChronelleApiClient({
      baseUrl: this.#baseUrl,
      fetch: this.#fetch,
      getCredential: () => {
        this.#assertCurrent(credential);
        return credential;
      },
      signal:
        signal && this.#signal
          ? AbortSignal.any([signal, this.#signal])
          : (signal ?? this.#signal),
    });
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

  /** Merges the given preferences into the account; null clears a key. */
  updatePreferences(input: PreferencesRequest): Promise<UserResponse> {
    return this.#request(
      "/api/auth/me",
      userResponseSchema,
      jsonRequest(input, "PATCH"),
    );
  }

  /** Who can find the account, by name and by email. */
  updateAccount(input: AccountUpdateRequest): Promise<UserResponse> {
    return this.#request(
      "/api/account",
      userResponseSchema,
      jsonRequest(input, "PATCH"),
    );
  }

  /** Whether a username is free, for the sign-up screen; needs no session. */
  usernameAvailable(username: string): Promise<UsernameAvailabilityResponse> {
    return this.#request(
      `/api/auth/username-available?username=${encodeURIComponent(username)}`,
      usernameAvailabilityResponseSchema,
      {},
      false,
    );
  }

  /** Find people by @username, name, or exact email, as each account allows. */
  searchUsers(query: string): Promise<UserSearchResponse> {
    return this.#request(
      `/api/users/search?q=${encodeURIComponent(query)}`,
      userSearchResponseSchema,
    );
  }

  /** The account behind a code, by username. */
  getUser(username: string): Promise<UserSummary> {
    return this.#request(
      `/api/users/${encodeURIComponent(username)}`,
      userSummarySchema,
    );
  }

  /** Creates an unverified password account; a verification code is emailed. */
  signUp(input: SignUpRequest): Promise<AcceptedResponse> {
    return this.#request(
      "/api/auth/sign-up",
      acceptedResponseSchema,
      jsonRequest(input, "POST"),
      false,
    );
  }

  /** Verifies the emailed code and signs the account in. */
  verifyEmail(input: VerifyEmailRequest): Promise<SignInResponse> {
    return this.#request(
      "/api/auth/verify-email",
      signInResponseSchema,
      jsonRequest(input, "POST"),
      false,
    );
  }

  /** Sends a fresh verification code to an unverified account. */
  resendVerification(input: EmailRequest): Promise<AcceptedResponse> {
    return this.#request(
      "/api/auth/verify-email/resend",
      acceptedResponseSchema,
      jsonRequest(input, "POST"),
      false,
    );
  }

  signInWithPassword(input: PasswordSignInRequest): Promise<SignInResponse> {
    return this.#request(
      "/api/auth/sign-in",
      signInResponseSchema,
      jsonRequest(input, "POST"),
      false,
    );
  }

  /** Emails a reset code when the address has an account; always accepted. */
  requestPasswordReset(input: EmailRequest): Promise<AcceptedResponse> {
    return this.#request(
      "/api/auth/password-reset",
      acceptedResponseSchema,
      jsonRequest(input, "POST"),
      false,
    );
  }

  /** Replaces the password with the emailed code, ends every session, and signs in. */
  confirmPasswordReset(
    input: PasswordResetConfirmRequest,
  ): Promise<SignInResponse> {
    return this.#request(
      "/api/auth/password-reset/confirm",
      signInResponseSchema,
      jsonRequest(input, "POST"),
      false,
    );
  }

  /** Ends the current session on the server. */
  signOut(): Promise<SessionRevocationResponse> {
    return this.#request("/api/auth/session", sessionRevocationResponseSchema, {
      method: "DELETE",
    });
  }

  /** Ends every session of the current user, this one included. */
  signOutEverywhere(): Promise<SessionRevocationResponse> {
    return this.#request(
      "/api/auth/sessions",
      sessionRevocationResponseSchema,
      { method: "DELETE" },
    );
  }

  /** The account's friends, the requests waiting for it, and what it sent. */
  listFriends(): Promise<FriendsResponse> {
    return this.#request("/api/friends", friendsResponseSchema);
  }

  /** Invites an address: a request to its account, or a sign-up link to it. */
  /** A request to an account found by search or by its code. */
  requestFriend(input: FriendRequestRequest): Promise<SentInvitation> {
    return this.#request(
      "/api/friends/requests",
      sentInvitationSchema,
      jsonRequest(input, "POST"),
    );
  }

  inviteFriend(input: FriendInvitationPayload): Promise<SentInvitation> {
    return this.#request(
      "/api/friends/invitations",
      sentInvitationSchema,
      jsonRequest(input, "POST"),
    );
  }

  resendFriendInvitation(id: string): Promise<AcceptedResponse> {
    return this.#request(
      `/api/friends/invitations/${id}/resend`,
      acceptedResponseSchema,
      { method: "POST" },
    );
  }

  withdrawFriendInvitation(id: string): Promise<FriendItemStateResponse> {
    return this.#request(
      `/api/friends/invitations/${id}`,
      friendItemStateResponseSchema,
      { method: "DELETE" },
    );
  }

  acceptFriendRequest(id: string): Promise<Friend> {
    return this.#request(`/api/friends/requests/${id}/accept`, friendSchema, {
      method: "POST",
    });
  }

  declineFriendRequest(id: string): Promise<FriendItemStateResponse> {
    return this.#request(
      `/api/friends/requests/${id}/decline`,
      friendItemStateResponseSchema,
      { method: "POST" },
    );
  }

  removeFriend(id: string): Promise<FriendItemStateResponse> {
    return this.#request(`/api/friends/${id}`, friendItemStateResponseSchema, {
      method: "DELETE",
    });
  }

  getStorageInventory(): Promise<StorageInventoryResponse> {
    return this.#request(
      "/api/workspace/storage-inventory",
      storageInventoryResponseSchema,
    );
  }

  listLabels(): Promise<LabelListResponse> {
    return this.#request("/api/labels", labelListResponseSchema);
  }

  createLabel(input: LabelCreateRequest): Promise<LabelResponse> {
    return this.#request(
      "/api/labels",
      labelResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  updateLabel(id: string, input: LabelUpdateRequest): Promise<LabelResponse> {
    return this.#request(
      `/api/labels/${id}`,
      labelResponseSchema,
      jsonRequest(input, "PATCH"),
    );
  }

  deleteLabel(id: string, expectedVersion: number): Promise<LabelResponse> {
    return this.#request(
      `/api/labels/${id}?expectedVersion=${expectedVersion}`,
      labelResponseSchema,
      { method: "DELETE" },
    );
  }

  listTasks(input: TaskListQueryInput = {}): Promise<TaskListResponse> {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) parameters.set(key, String(value));
    }
    const query = parameters.size === 0 ? "" : `?${parameters.toString()}`;
    return this.#request(`/api/tasks${query}`, taskListResponseSchema);
  }

  listEvents(input: EventListQueryInput = {}): Promise<EventListResponse> {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) parameters.set(key, String(value));
    }
    const query = parameters.size === 0 ? "" : `?${parameters.toString()}`;
    return this.#request(`/api/events${query}`, eventListResponseSchema);
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

  listPersons(input: PersonListQueryInput = {}): Promise<PersonListResponse> {
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) parameters.set(key, String(value));
    }
    const query = parameters.size === 0 ? "" : `?${parameters.toString()}`;
    return this.#request(`/api/persons${query}`, personListResponseSchema);
  }

  createPerson(input: PersonCreatePayload): Promise<PersonResponse> {
    return this.#request(
      "/api/persons",
      personResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  updatePerson(
    id: string,
    input: PersonUpdatePayload,
  ): Promise<PersonResponse> {
    return this.#request(
      `/api/persons/${id}`,
      personResponseSchema,
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
    const client = this.#createScopedClient();
    const bytes = await file.arrayBuffer();
    client.#captureCredential();
    if (bytes.byteLength !== file.size) {
      throw new ApiClientError(
        400,
        "invalid_request",
        "The file size changed before upload.",
      );
    }
    const authorization = await client.authorizeDocumentUpload({
      checksumSha256: await sha256Hex(bytes),
      mimeType: file.type || "application/octet-stream",
      originalFilename: file.name,
      parentObjectId,
      sizeBytes: file.size,
    });
    await client.#transfer(authorization.upload.url, {
      body: bytes,
      headers: authorization.upload.headers,
      method: authorization.upload.method,
    });
    return client.finalizeDocumentUpload(authorization.id);
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
    const client = this.#createScopedClient();
    const authorization = await client.authorizeDocumentDownload(documentId);
    const response = await client.#transfer(authorization.download.url, {
      headers: authorization.download.headers,
      method: authorization.download.method,
    });
    try {
      return await response.blob();
    } finally {
      client.#captureCredential();
    }
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

  listObjectRelations(id: string, input: RelationListQueryInput = {}) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(input)) {
      if (value !== undefined) query.set(key, String(value));
    }
    return this.#request(
      `/api/objects/${id}/relations?${query}`,
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

  deleteRelation(id: string, expectedVersion: number) {
    return this.#request(
      `/api/relations/${id}?expectedVersion=${expectedVersion}`,
      relationDeletionResponseSchema,
      { method: "DELETE" },
    );
  }

  createRelation(sourceObjectId: string, input: RelationCreatePayload) {
    return this.#request(
      `/api/objects/${sourceObjectId}/relations`,
      relationResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  getEvent(id: string): Promise<EventResponse> {
    return this.#request(`/api/events/${id}`, eventResponseSchema);
  }

  getTask(id: string): Promise<TaskResponse> {
    return this.#request(`/api/tasks/${id}`, taskResponseSchema);
  }

  getExpense(id: string): Promise<ExpenseResponse> {
    return this.#request(`/api/expenses/${id}`, expenseResponseSchema);
  }

  getReminder(id: string): Promise<ReminderResponse> {
    return this.#request(`/api/reminders/${id}`, reminderResponseSchema);
  }

  getPerson(id: string): Promise<PersonResponse> {
    return this.#request(`/api/persons/${id}`, personResponseSchema);
  }

  getEventLayout(id: string): Promise<EventLayoutResponse> {
    return this.#request(`/api/events/${id}/layout`, eventLayoutResponseSchema);
  }

  getEventLayoutHistory(
    id: string,
    query: EventLayoutHistoryQueryInput = {},
  ): Promise<EventLayoutHistoryResponse> {
    const params = new URLSearchParams();
    if (query.beforeVersion !== undefined)
      params.set("beforeVersion", String(query.beforeVersion));
    if (query.limit !== undefined) params.set("limit", String(query.limit));
    return this.#request(
      `/api/events/${id}/layout/history?${params}`,
      eventLayoutHistoryResponseSchema,
    );
  }

  restoreEventLayout(
    id: string,
    input: EventLayoutRestore,
  ): Promise<EventLayoutResponse> {
    return this.#request(
      `/api/events/${id}/layout/restore`,
      eventLayoutResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  updateEventLayout(
    id: string,
    input: EventLayoutUpdate,
  ): Promise<EventLayoutResponse> {
    return this.#request(
      `/api/events/${id}/layout`,
      eventLayoutResponseSchema,
      jsonRequest(input, "PATCH"),
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

  /** What is shared each way with a person of the workspace, newest first. */
  listPersonShares(personId: string): Promise<PersonShareListResponse> {
    return this.#request(
      `/api/persons/${personId}/shares`,
      personShareListResponseSchema,
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

  /** Queues a share for a person without an account here; the invitation goes out when none waits. */
  queuePendingShare(input: PendingShareCreateRequest): Promise<PendingShare> {
    return this.#request(
      "/api/shares/pending",
      pendingShareSchema,
      jsonRequest(input, "POST"),
    );
  }

  revokePendingShare(id: string): Promise<PendingShareRevocationResponse> {
    return this.#request(
      `/api/shares/pending/${id}`,
      pendingShareRevocationResponseSchema,
      { method: "DELETE" },
    );
  }

  listWorkspaceMembers(): Promise<WorkspaceMemberListResponse> {
    return this.#request(
      "/api/workspaces/current/members",
      workspaceMemberListResponseSchema,
    );
  }

  /** Adds a friend as a member, or changes the role of one who already is. */
  addWorkspaceMember(
    input: WorkspaceMemberAddRequest,
  ): Promise<WorkspaceMember> {
    return this.#request(
      "/api/workspaces/current/members",
      workspaceMemberSchema,
      jsonRequest(input, "POST"),
    );
  }

  removeWorkspaceMember(
    userId: string,
  ): Promise<WorkspaceMemberRemovalResponse> {
    return this.#request(
      `/api/workspaces/current/members/${userId}`,
      workspaceMemberRemovalResponseSchema,
      { method: "DELETE" },
    );
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

  getEventPeople(id: string): Promise<PersonResourceProjectionResponse> {
    return this.#request(
      `/api/events/${id}/people`,
      personResourceProjectionResponseSchema,
    );
  }

  async #request<Result>(
    path: string,
    schema: z.ZodType<Result>,
    request: RequestInit = {},
    authorized = true,
  ): Promise<Result> {
    const credential = this.#captureCredential();
    const headers = new Headers(request.headers);
    if (authorized) {
      if (credential === null) {
        throw new ApiClientError(
          401,
          "unauthenticated",
          "A Chronelle session is required.",
        );
      }
      if (credential.accessToken !== undefined)
        headers.set("authorization", `Bearer ${credential.accessToken}`);
      headers.set("x-workspace-id", credential.workspaceId);
    }

    let response: Response;
    try {
      response = await this.#fetch(`${this.#baseUrl}${path}`, {
        ...request,
        headers,
        signal: this.#signal ?? null,
      });
    } catch {
      this.#assertCurrent(credential);
      throw new ApiClientError(
        0,
        "network_error",
        "The Chronelle API could not be reached.",
      );
    }
    this.#assertCurrent(credential);

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      this.#assertCurrent(credential);
      throw new ApiClientError(
        response.status,
        "invalid_response",
        "The Chronelle API returned an unreadable response.",
      );
    }
    this.#assertCurrent(credential);
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

  async #transfer(url: string, request: RequestInit): Promise<Response> {
    const credential = this.#captureCredential();
    let response: Response;
    try {
      response = await this.#fetch(this.#resolveUrl(url), {
        ...request,
        signal: this.#signal ?? null,
      });
    } catch {
      this.#assertCurrent(credential);
      throw new ApiClientError(
        0,
        "network_error",
        "The document transfer could not be completed.",
      );
    }
    this.#assertCurrent(credential);
    if (!response.ok) {
      try {
        await this.#throwResponseError(response);
      } finally {
        this.#assertCurrent(credential);
      }
    }
    return response;
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
