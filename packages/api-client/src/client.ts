import {
  type AcceptedResponse,
  type AccountUpdateRequest,
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
  type EventAttachmentTargetsResponse,
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
  eventAttachmentTargetsResponseSchema,
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
  type FriendRequestRequest,
  type FriendsResponse,
  friendItemStateResponseSchema,
  friendSchema,
  friendsResponseSchema,
  type HealthStatus,
  healthStatusSchema,
  type InvitationAcceptResponse,
  type InvitationPeekResponse,
  invitationAcceptResponseSchema,
  invitationPeekResponseSchema,
  type LabelCreateRequest,
  type LabelListResponse,
  type LabelResponse,
  type LabelUpdateRequest,
  labelListResponseSchema,
  labelResponseSchema,
  maximumDocumentSizeBytes,
  type NoteCreatePayload,
  type NoteListQueryInput,
  type NoteListResponse,
  type NoteResponse,
  type NoteUpdatePayload,
  noteListResponseSchema,
  noteResponseSchema,
  type ObjectAccessResponse,
  type ObjectSearchQueryInput,
  type ObjectSearchResponse,
  objectAccessResponseSchema,
  objectDeletionResponseSchema,
  objectSearchResponseSchema,
  type PasswordResetConfirmRequest,
  type PasswordSignInRequest,
  type PendingShare,
  type PendingShareCreateRequest,
  type PendingShareRevocationResponse,
  type PermissionScopeUpdatePayload,
  type PersonCreatePayload,
  type PersonListQueryInput,
  type PersonListResponse,
  type PersonResourceProjectionResponse,
  type PersonResponse,
  type PersonShareListResponse,
  type PersonUpdatePayload,
  type PreferencesRequest,
  pendingShareRevocationResponseSchema,
  pendingShareSchema,
  personListResponseSchema,
  personResourceProjectionResponseSchema,
  personResponseSchema,
  personShareListResponseSchema,
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
  type SectionCreateRequest,
  type SectionListResponse,
  type SectionResponse,
  type SectionUpdateRequest,
  type SectionView,
  type SentInvitation,
  type SessionResponse,
  type SessionRevocationResponse,
  type ShareCreatePayload,
  type ShareLeaveResponse,
  type ShareListResponse,
  type ShareResponse,
  type ShareRevocationResponse,
  type SignInResponse,
  type SignUpRequest,
  type StorageInventoryResponse,
  sectionListResponseSchema,
  sectionResponseSchema,
  sentInvitationSchema,
  sessionResponseSchema,
  sessionRevocationResponseSchema,
  shareLeaveResponseSchema,
  shareListResponseSchema,
  shareResponseSchema,
  shareRevocationResponseSchema,
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
  type UsernameAvailabilityResponse,
  type UserResponse,
  type UserSearchResponse,
  type UserSummary,
  usernameAvailabilityResponseSchema,
  userResponseSchema,
  userSearchResponseSchema,
  userSummarySchema,
  type VerifyEmailRequest,
  type WeChatCredentialRequest,
  type WeChatIdentityLinkResponse,
  type WorkspaceMember,
  type WorkspaceMemberAddRequest,
  type WorkspaceMemberListResponse,
  type WorkspaceMemberRemovalResponse,
  weChatIdentityLinkResponseSchema,
  workspaceMemberListResponseSchema,
  workspaceMemberRemovalResponseSchema,
  workspaceMemberSchema,
} from "@livtales/schemas";
import type { z } from "zod";

import {
  type BinaryTransfer,
  type BinaryTransferResponse,
  createFetchBinaryTransfer,
  createFetchJsonTransport,
  createWebCryptoFileHasher,
  type FileHasher,
  type HttpMethod,
  type JsonTransport,
  type JsonTransportResponse,
  TransportError,
} from "./transport.js";

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

export interface LivTalesApiClientOptions {
  readonly baseUrl?: string | undefined;
  readonly binaryTransfer?: BinaryTransfer | undefined;
  readonly fetch?: typeof globalThis.fetch | undefined;
  readonly fileHasher?: FileHasher | undefined;
  readonly getCredential?: (() => ApiCredential | null) | undefined;
  readonly requestTimeoutMs?: number | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly signals?: readonly AbortSignal[] | undefined;
  readonly transferTimeoutMs?: number | undefined;
  readonly transport?: JsonTransport | undefined;
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

interface JsonRequestOptions {
  readonly body?: string | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly method?: HttpMethod | undefined;
}

interface BinaryRequestOptions {
  readonly body?: ArrayBuffer | undefined;
  readonly headers?: Readonly<Record<string, string>> | undefined;
  readonly method: HttpMethod;
}

function jsonRequest(body: unknown, method: HttpMethod): JsonRequestOptions {
  return {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method,
  };
}

function positiveTimeout(value: number | undefined, fallback: number): number {
  const timeout = value ?? fallback;
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new TypeError("Transport timeouts must be positive integers.");
  }
  return timeout;
}

function abortError(message: string): Error {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

export class LivTalesApiClient {
  readonly #baseUrl: string;
  readonly #binaryTransfer: BinaryTransfer | null;
  readonly #fileHasher: FileHasher | null;
  readonly #getCredential: () => ApiCredential | null;
  readonly #requestTimeoutMs: number;
  readonly #signals: readonly AbortSignal[];
  readonly #transferTimeoutMs: number;
  readonly #transport: JsonTransport;

  constructor(options: LivTalesApiClientOptions = {}) {
    const fetchImplementation =
      options.fetch ??
      (typeof globalThis.fetch === "function"
        ? globalThis.fetch.bind(globalThis)
        : null);
    if (options.transport === undefined && fetchImplementation === null) {
      throw new TypeError("A JSON transport is required in this runtime.");
    }
    this.#baseUrl = options.baseUrl?.replace(/\/$/, "") ?? "";
    this.#transport =
      options.transport ?? createFetchJsonTransport(fetchImplementation!);
    this.#binaryTransfer =
      options.binaryTransfer ??
      (fetchImplementation === null
        ? null
        : createFetchBinaryTransfer(fetchImplementation));
    this.#fileHasher =
      options.fileHasher ??
      (typeof globalThis.crypto === "object" && globalThis.crypto?.subtle
        ? createWebCryptoFileHasher(globalThis.crypto)
        : null);
    this.#getCredential = options.getCredential ?? (() => null);
    this.#requestTimeoutMs = positiveTimeout(options.requestTimeoutMs, 30_000);
    this.#transferTimeoutMs = positiveTimeout(
      options.transferTimeoutMs,
      120_000,
    );
    this.#signals = [
      ...(options.signals ?? []),
      ...(options.signal === undefined ? [] : [options.signal]),
    ];
  }

  /** Bind a request to both its caller's cancellation and the session lifetime. */
  withSignal(signal: AbortSignal): LivTalesApiClient {
    return this.#createScopedClient(signal);
  }

  #captureCredential(): ApiCredential | null {
    if (this.#signals.some((signal) => signal.aborted)) {
      throw abortError("The request was cancelled.");
    }
    const credential = this.#getCredential();
    return credential === null ? null : { ...credential };
  }

  #assertCurrent(credential: ApiCredential | null): void {
    const current = this.#captureCredential();
    if (
      current?.accessToken !== credential?.accessToken ||
      current?.workspaceId !== credential?.workspaceId
    ) {
      throw abortError("The client session changed.");
    }
  }

  #createScopedClient(signal?: AbortSignal): LivTalesApiClient {
    const credential = this.#captureCredential();
    return new LivTalesApiClient({
      baseUrl: this.#baseUrl,
      binaryTransfer: this.#binaryTransfer ?? undefined,
      fileHasher: this.#fileHasher ?? undefined,
      getCredential: () => {
        this.#assertCurrent(credential);
        return credential;
      },
      requestTimeoutMs: this.#requestTimeoutMs,
      signals:
        signal === undefined ? this.#signals : [signal, ...this.#signals],
      transferTimeoutMs: this.#transferTimeoutMs,
      transport: this.#transport,
    });
  }

  getHealth(): Promise<HealthStatus> {
    return this.#request("/api/health", healthStatusSchema, {}, false);
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

  /** Exchanges a verified CloudBase-WeChat credential for a LivTales session. */
  signInWithWeChat(input: WeChatCredentialRequest): Promise<SignInResponse> {
    return this.#request(
      "/api/auth/wechat",
      signInResponseSchema,
      jsonRequest(input, "POST"),
      false,
    );
  }

  /** Links the verified WeChat identity to the signed-in LivTales account. */
  linkWeChatIdentity(
    input: WeChatCredentialRequest,
  ): Promise<WeChatIdentityLinkResponse> {
    return this.#request(
      "/api/auth/wechat/link",
      weChatIdentityLinkResponseSchema,
      jsonRequest(input, "POST"),
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

  /** A request to an account found by search or by its code. */
  requestFriend(input: FriendRequestRequest): Promise<SentInvitation> {
    return this.#request(
      "/api/friends/requests",
      sentInvitationSchema,
      jsonRequest(input, "POST"),
    );
  }

  /** Invites by email (a request to the address's account, else an emailed link) or as a link to hand on. */
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

  /** New link: a fresh token for the invitation; the one handed out before stops working. */
  renewFriendInvitationLink(id: string): Promise<SentInvitation> {
    return this.#request(
      `/api/friends/invitations/${id}/link`,
      sentInvitationSchema,
      { method: "POST" },
    );
  }

  /** What an invitation link opens, without a session. */
  peekInvitation(token: string): Promise<InvitationPeekResponse> {
    return this.#request(
      `/api/invitations/${encodeURIComponent(token)}`,
      invitationPeekResponseSchema,
      {},
      false,
    );
  }

  acceptInvitation(token: string): Promise<InvitationAcceptResponse> {
    return this.#request(
      `/api/invitations/${encodeURIComponent(token)}/accept`,
      invitationAcceptResponseSchema,
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

  listSections(
    eventId: string,
    view: SectionView,
  ): Promise<SectionListResponse> {
    return this.#request(
      `/api/events/${eventId}/sections?view=${view}`,
      sectionListResponseSchema,
    );
  }

  createSection(
    eventId: string,
    input: SectionCreateRequest,
  ): Promise<SectionResponse> {
    return this.#request(
      `/api/events/${eventId}/sections`,
      sectionResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  updateSection(
    id: string,
    input: SectionUpdateRequest,
  ): Promise<SectionResponse> {
    return this.#request(
      `/api/sections/${id}`,
      sectionResponseSchema,
      jsonRequest(input, "PATCH"),
    );
  }

  deleteSection(id: string): Promise<SectionResponse> {
    return this.#request(`/api/sections/${id}`, sectionResponseSchema, {
      method: "DELETE",
    });
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

  createNote(input: NoteCreatePayload): Promise<NoteResponse> {
    return this.#request(
      "/api/notes",
      noteResponseSchema,
      jsonRequest(input, "POST"),
    );
  }

  updateNote(id: string, input: NoteUpdatePayload): Promise<NoteResponse> {
    return this.#request(
      `/api/notes/${id}`,
      noteResponseSchema,
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
    const hasher = client.#fileHasher;
    if (hasher === null || client.#binaryTransfer === null) {
      throw new ApiClientError(
        0,
        "unsupported_runtime",
        "File transfers are unavailable in this runtime.",
      );
    }
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
      checksumSha256: await hasher.sha256Hex(bytes),
      mimeType: file.type || "application/octet-stream",
      originalFilename: file.name,
      parentObjectId,
      sizeBytes: file.size,
    });
    await client.#transfer(
      authorization.upload.url,
      {
        body: bytes,
        headers: authorization.upload.headers,
        method: authorization.upload.method,
      },
      "none",
    );
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

  async downloadDocument(documentId: string): Promise<ArrayBuffer> {
    const client = this.#createScopedClient();
    const authorization = await client.authorizeDocumentDownload(documentId);
    const bytes = await client.#transfer(
      authorization.download.url,
      {
        headers: authorization.download.headers,
        method: authorization.download.method,
      },
      "bytes",
    );
    client.#captureCredential();
    if (bytes === null) {
      throw new ApiClientError(
        0,
        "invalid_response",
        "The document transfer returned no file data.",
      );
    }
    return bytes;
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

  getNote(id: string): Promise<NoteResponse> {
    return this.#request(`/api/notes/${id}`, noteResponseSchema);
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

  /** Gives up every grant the account holds on the object: the grantee's way out of a share. */
  leaveObject(id: string): Promise<ShareLeaveResponse> {
    return this.#request(`/api/objects/${id}/leave`, shareLeaveResponseSchema, {
      method: "POST",
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

  getEventAttachmentTargets(
    id: string,
  ): Promise<EventAttachmentTargetsResponse> {
    return this.#request(
      `/api/events/${id}/attachment-targets`,
      eventAttachmentTargetsResponseSchema,
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

  /** The Event's notes, last edited first unless sorted by title. */
  getEventNotes(
    id: string,
    input: NoteListQueryInput = {},
  ): Promise<NoteListResponse> {
    const query = input.sort === undefined ? "" : `?sort=${input.sort}`;
    return this.#request(
      `/api/events/${id}/notes${query}`,
      noteListResponseSchema,
    );
  }

  async #request<Result>(
    path: string,
    schema: z.ZodType<Result>,
    request: JsonRequestOptions = {},
    authorized = true,
  ): Promise<Result> {
    const credential = this.#captureCredential();
    const headers: Record<string, string> = { ...request.headers };
    if (authorized) {
      if (credential === null) {
        throw new ApiClientError(
          401,
          "unauthenticated",
          "A LivTales session is required.",
        );
      }
      if (credential.accessToken !== undefined) {
        headers.authorization = `Bearer ${credential.accessToken}`;
      }
      headers["x-workspace-id"] = credential.workspaceId;
    }

    let response: JsonTransportResponse;
    try {
      response = await this.#transport.request({
        body: request.body,
        headers,
        method: request.method ?? "GET",
        signals: this.#signals,
        timeoutMs: this.#requestTimeoutMs,
        url: `${this.#baseUrl}${path}`,
      });
    } catch (error) {
      this.#assertCurrent(credential);
      if (error instanceof TransportError && error.kind === "aborted") {
        throw error;
      }
      throw new ApiClientError(
        0,
        error instanceof TransportError && error.kind === "timeout"
          ? "request_timeout"
          : "network_error",
        error instanceof TransportError && error.kind === "timeout"
          ? "The LivTales API request timed out."
          : "The LivTales API could not be reached.",
      );
    }
    this.#assertCurrent(credential);

    if (!response.payload.readable) {
      throw new ApiClientError(
        response.status,
        "invalid_response",
        "The LivTales API returned an unreadable response.",
      );
    }
    const body = response.payload.value;
    if (response.status < 200 || response.status >= 300) {
      this.#throwParsedResponseError(response.status, body);
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiClientError(
        response.status,
        "invalid_response",
        "The LivTales API returned an unexpected response.",
      );
    }
    return parsed.data;
  }

  #resolveUrl(url: string): string {
    return /^https?:\/\//u.test(url) ? url : `${this.#baseUrl}${url}`;
  }

  async #transfer(
    url: string,
    request: BinaryRequestOptions,
    responseBody: "bytes" | "none",
  ): Promise<ArrayBuffer | null> {
    const credential = this.#captureCredential();
    if (this.#binaryTransfer === null) {
      throw new ApiClientError(
        0,
        "unsupported_runtime",
        "File transfers are unavailable in this runtime.",
      );
    }
    let response: BinaryTransferResponse;
    try {
      response = await this.#binaryTransfer.request({
        body: request.body,
        headers: request.headers ?? {},
        method: request.method,
        responseBody,
        signals: this.#signals,
        timeoutMs: this.#transferTimeoutMs,
        url: this.#resolveUrl(url),
      });
    } catch (error) {
      this.#assertCurrent(credential);
      if (error instanceof TransportError && error.kind === "aborted") {
        throw error;
      }
      throw new ApiClientError(
        0,
        error instanceof TransportError && error.kind === "timeout"
          ? "request_timeout"
          : "network_error",
        error instanceof TransportError && error.kind === "timeout"
          ? "The document transfer timed out."
          : "The document transfer could not be completed.",
      );
    }
    this.#assertCurrent(credential);
    if (response.status < 200 || response.status >= 300) {
      if (response.errorPayload?.readable === true) {
        this.#throwParsedResponseError(
          response.status,
          response.errorPayload.value,
        );
      }
      throw new ApiClientError(
        response.status,
        "request_failed",
        "The document transfer could not be completed.",
      );
    }
    return response.bytes;
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
