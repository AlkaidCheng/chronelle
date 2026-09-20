import {
  type EventLayoutResponse,
  commandExecuteRequestSchema,
  commandTransitionRequestSchema,
  eventCalendarDatesSchema,
  eventContextCreateRequestSchema,
  eventCreateRequestSchema,
  eventLayoutHistoryQuerySchema,
  eventLayoutResponseSchema,
  eventLayoutRestoreSchema,
  eventLayoutUpdateSchema,
  eventListQuerySchema,
  eventPlanningResourceResponseSchema,
  eventUpdateRequestSchema,
  expenseUpdateRequestSchema,
  type FriendsResponse,
  friendInvitationRequestSchema,
  friendsResponseSchema,
  accountUpdateRequestSchema,
  friendRequestRequestSchema,
  type PendingShare,
  type QueuedRecord,
  pendingShareCreateRequestSchema,
  pendingShareSchema,
  type LabelResponse,
  labelCreateRequestSchema,
  labelDeleteQuerySchema,
  labelResponseSchema,
  labelUpdateRequestSchema,
  sectionCreateRequestSchema,
  sectionListQuerySchema,
  type SectionResponse,
  sectionResponseSchema,
  sectionUpdateRequestSchema,
  nextTaskDueAt,
  nextTaskDueDate,
  objectSearchQuerySchema,
  noteCreateRequestSchema,
  noteListQuerySchema,
  noteUpdateRequestSchema,
  personCreateRequestSchema,
  personListQuerySchema,
  personUpdateRequestSchema,
  preferencesRequestSchema,
  type EventPlanningResourceResponse as Resource,
  rankAfter,
  relationCreateRequestSchema,
  relationListQuerySchema,
  relationResponseSchema,
  reminderUpdateRequestSchema,
  type ShareResponse,
  shareCreateRequestSchema,
  shareResponseSchema,
  type TimelineResponse,
  taskCreateRequestSchema,
  taskDueDate,
  taskListQuerySchema,
  taskUpdateRequestSchema,
  userResponseSchema,
  type WorkspaceMember,
  workspaceMemberAddRequestSchema,
  workspaceMemberSchema,
} from "@chronelle/schemas";
import { byRank, rankBetweenRows } from "../lib/collection-order";
import { eventPeriod } from "../lib/event-collection";
import { mergeEventTabs } from "../lib/event-tabs";
import { mergeWorkspaceRecency } from "../lib/workspace-recency";
import { compareNames } from "../lib/format";
import { sandboxStorageKey } from "./storage-key";

export { sandboxStorageKey };
export const sandboxWorkspaceId = "00000000-0000-4000-8000-000000000001";
const userId = "00000000-0000-4000-8000-000000000002";
const workspace = { id: sandboxWorkspaceId, displayName: "Design playground" };
/** The sample account's own workspace, as the session lists it for the switcher. */
const accessibleWorkspace = {
  ...workspace,
  personal: true,
  ownerDisplayName: "Sample planner",
  role: "owner" as const,
};
const maximumCharacters = 1_000_000;
type StoragePort = Pick<Storage, "getItem" | "setItem">;
type RelationResponse = ReturnType<typeof relationResponseSchema.parse>;
type Preferences = ReturnType<typeof userResponseSchema.parse>;

interface State {
  objects: Resource[];
  relations: RelationResponse[];
  layouts: EventLayoutResponse[];
  labels: LabelResponse[];
  /** The sections of the sample events' To-dos and Expenses. */
  sections: SectionResponse[];
  /** The sample account's name, language, zone, clock, week start, rail, event tabs, and workspace recency, as Settings, the rail, the strips, and the switcher keep them. */
  preferences: Pick<
    Preferences,
    | "displayName"
    | "locale"
    | "timeZone"
    | "hourCycle"
    | "weekStart"
    | "rail"
    | "eventTabs"
    | "workspaceRecency"
    | "username"
    | "findByName"
    | "findByEmail"
    | "onboardedAt"
  >;
  /** The sample account's friends, requests, and sent invitations, as the Friends page keeps them. */
  friends: FriendsResponse;
  /** Grants on the sample objects, and the shares waiting on an invitation. */
  shares: ShareResponse[];
  pendingShares: PendingShare[];
  /** The members of the sample workspace. */
  members: WorkspaceMember[];
}

const friendUserId = "00000000-0000-4000-8000-000000000003";

const defaultFriends: FriendsResponse = {
  friends: [
    {
      id: "00000000-0000-4000-8000-0000000000f1",
      userId: friendUserId,
      displayName: "Mei Lin",
      email: "mei.lin@example.test",
      since: "2026-09-02T09:00:00.000Z",
    },
  ],
  incoming: [
    {
      id: "00000000-0000-4000-8000-0000000000f2",
      requester: {
        userId: "00000000-0000-4000-8000-000000000004",
        displayName: "Tomas Berg",
        email: "tomas.b@example.test",
      },
      message:
        "Tomas from the climbing gym. Daniel said you plan the trips here.",
      createdAt: "2026-09-17T07:00:00.000Z",
    },
  ],
  sent: [
    {
      id: "00000000-0000-4000-8000-0000000000f3",
      kind: "invitation",
      email: "priya@example.test",
      channel: "email",
      inviteUrl: inviteLink("sample-invitation-priya-0001"),
      message: null,
      personId: null,
      workspaceId: null,
      createdAt: "2026-09-15T10:00:00.000Z",
      expiresAt: "2026-09-29T10:00:00.000Z",
    },
  ],
};

/** The claim page's address for a token, on the sandbox origin. */
function inviteLink(token: string): string {
  return `https://sandbox.invalid/invite/${token}`;
}

/** The token an invitation link carries, or null for another address. */
function inviteToken(link: string | null): string | null {
  return link === null ? null : link.slice(link.lastIndexOf("/") + 1);
}

/**
 * Invitation links other accounts sent the sample account, for the claim
 * page: one from an account that is not a friend yet, with a share
 * waiting on it, and one from a friend.
 */
const sampleInvitations: readonly {
  readonly token: string;
  readonly requester: {
    readonly id: string;
    readonly displayName: string;
    readonly username: string;
    readonly email: string;
  };
  readonly message: string | null;
  readonly queued: QueuedRecord[];
  readonly expiresAt: string;
}[] = [
  {
    token: "sample-invitation-chen-li-0001",
    requester: {
      id: "00000000-0000-4000-8000-000000000005",
      displayName: "Chen Li",
      username: "chen-li",
      email: "chen.li@example.test",
    },
    message: "Join us for the Kyoto trip planning.",
    queued: [
      {
        resourceId: "00000000-0000-4000-8000-0000000000e1",
        displayName: "Kyoto in November",
        role: "viewer",
      },
    ],
    expiresAt: "2026-10-02T10:00:00.000Z",
  },
  {
    token: "sample-invitation-mei-lin-0001",
    requester: {
      id: friendUserId,
      displayName: "Mei Lin",
      username: "meilin",
      email: "mei.lin@example.test",
    },
    message: null,
    queued: [],
    expiresAt: "2026-10-02T10:00:00.000Z",
  },
];

const defaultMember: WorkspaceMember = {
  userId,
  displayName: "Sample planner",
  email: "planner@example.test",
  role: "owner",
  personal: true,
  friendId: null,
  joinedAt: "2026-09-01T09:00:00.000Z",
};

const defaultPreferences: State["preferences"] = {
  displayName: "Sample planner",
  locale: null,
  timeZone: null,
  hourCycle: null,
  weekStart: null,
  rail: {},
  eventTabs: {},
  workspaceRecency: {},
  username: "planner",
  findByName: true,
  findByEmail: true,
  onboardedAt: "2026-09-01T09:00:00.000Z",
};

/**
 * The accounts Find people can reach in the sandbox, beside the friends
 * and requesters the Friends page already knows: how they let themselves
 * be found, and their handle.
 */
const sampleAccounts: readonly {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
  readonly email: string;
  readonly findByName: boolean;
  readonly findByEmail: boolean;
}[] = [
  {
    id: friendUserId,
    displayName: "Mei Lin",
    username: "meilin",
    email: "mei.lin@example.test",
    findByName: true,
    findByEmail: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000004",
    displayName: "Tomas Berg",
    username: "tomasb",
    email: "tomas.b@example.test",
    findByName: true,
    findByEmail: false,
  },
  {
    id: "00000000-0000-4000-8000-000000000005",
    displayName: "Chen Li",
    username: "chen-li",
    email: "chen.li@example.test",
    findByName: true,
    findByEmail: true,
  },
  {
    id: "00000000-0000-4000-8000-000000000006",
    displayName: "Chen Shy",
    username: "shychen",
    email: "shy@example.test",
    findByName: false,
    findByEmail: true,
  },
];

class SandboxError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Completing a repeating task, as the API does: a patch that sets status to
 * done on a task that is not done, carrying no due or repeat change, keeps
 * the task open on its next occurrence unless that falls after repeatUntil.
 */
function repeatTaskPatch(
  task: Extract<Resource, { objectType: "task" }>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  if (
    patch.status !== "done" ||
    task.status === "done" ||
    task.repeatRule === null ||
    "dueOn" in patch ||
    "dueAt" in patch ||
    "repeatRule" in patch ||
    "repeatUntil" in patch
  )
    return patch;
  if (task.dueOn !== null) {
    const dueOn = nextTaskDueDate(task.dueOn, task.repeatRule);
    if (task.repeatUntil !== null && dueOn > task.repeatUntil) return patch;
    return { ...patch, status: "todo", completedAt: null, dueOn };
  }
  if (task.dueAt === null) return patch;
  const dueAt = nextTaskDueAt(new Date(task.dueAt), task.repeatRule);
  if (
    task.repeatUntil !== null &&
    dueAt.toISOString().slice(0, 10) > task.repeatUntil
  )
    return patch;
  return {
    ...patch,
    status: "todo",
    completedAt: null,
    dueAt: dueAt.toISOString(),
  };
}

/** The rank after the sample workspace's last task or reminder, as the API assigns one. */
function rankAmong(
  objects: readonly Resource[],
  type: "task" | "reminder",
): string {
  let last: string | null = null;
  for (const object of objects)
    if (object.objectType === type && (last === null || object.rank > last))
      last = object.rank;
  return rankAfter(last);
}

/** The first email contact of a card, the address an invitation from it goes to. */
function personEmail(
  person: Extract<Resource, { objectType: "person" }>,
): string | null {
  return (
    person.contacts.find((contact) => contact.kind === "email")?.value ?? null
  );
}

function canonical(
  objectType: Resource["objectType"],
  input: Record<string, unknown>,
  scope?: string,
): Resource {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const defaults = {
    event: {
      startsAt: null,
      endsAt: null,
      timezone: null,
      isAllDay: false,
      location: null,
      description: null,
    },
    task: {
      dueOn: null,
      dueAt: null,
      durationMinutes: null,
      repeatRule: null,
      repeatUntil: null,
      completedAt: null,
      status: "todo",
      parentTaskId: null,
      assigneeId: null,
      location: null,
      description: null,
      rank: "00000001000",
      labelIds: [],
    },
    expense: {},
    reminder: { status: "pending", rank: "00000001000" },
    document: {},
    person: {
      userId: null,
      nickname: null,
      description: null,
      contacts: [],
      labelIds: [],
    },
    note: { body: "" },
  }[objectType];
  return eventPlanningResourceResponseSchema.parse({
    ...defaults,
    ...input,
    objectType,
    id,
    workspaceId: sandboxWorkspaceId,
    permissionScopeId: scope ?? id,
    createdBy: userId,
    createdAt: timestamp,
    updatedAt: timestamp,
    version: 1,
    archivedAt: null,
    deletedAt: null,
    customProperties: input.customProperties ?? {},
    metadata: input.metadata ?? {},
  });
}

function relation(source: string, target: string): RelationResponse {
  return {
    id: crypto.randomUUID(),
    workspaceId: sandboxWorkspaceId,
    sourceObjectId: source,
    targetObjectId: target,
    relationType: "includes",
    version: 1,
    metadata: {},
    createdBy: userId,
    createdAt: new Date().toISOString(),
    deletedAt: null,
  };
}

function seed(): State {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  date.setHours(10, 0, 0, 0);
  const timestamp = date.toISOString();
  const event = canonical("event", {
    displayName: "Autumn gathering",
    startsAt: timestamp,
  });
  const children = [
    canonical(
      "task",
      { displayName: "Confirm the garden venue", dueAt: timestamp },
      event.id,
    ),
    canonical(
      "task",
      {
        displayName: "Send invitations",
        status: "done",
        completedAt: timestamp,
      },
      event.id,
    ),
    canonical(
      "event",
      { displayName: "Welcome and coffee", startsAt: timestamp },
      event.id,
    ),
    canonical(
      "expense",
      {
        displayName: "Venue deposit",
        amount: "240.0000",
        currency: "USD",
        occurredAt: timestamp,
      },
      event.id,
    ),
    canonical(
      "reminder",
      { displayName: "Check the weather forecast", remindAt: timestamp },
      event.id,
    ),
  ];
  for (const type of ["task", "reminder"] as const)
    children
      .filter((child) => child.objectType === type)
      .forEach((child, index) => {
        (child as { rank: string }).rank = rankAfter(
          index === 0 ? null : `${String(index * 1000).padStart(11, "0")}`,
        );
      });
  return {
    layouts: [],
    labels: [],
    sections: [],
    objects: [
      event,
      canonical("event", { displayName: "A quiet studio weekend" }),
      ...children,
    ],
    relations: children.map((child) => relation(event.id, child.id)),
    preferences: defaultPreferences,
    friends: defaultFriends,
    shares: [],
    pendingShares: [],
    members: [defaultMember],
  };
}

function parseState(raw: string): State {
  if (raw.length > maximumCharacters)
    throw new Error("Snapshot exceeds the sandbox limit.");
  const value: unknown = JSON.parse(raw);
  if (
    typeof value !== "object" ||
    value === null ||
    !("objects" in value) ||
    !("relations" in value)
  )
    throw new Error("Invalid snapshot.");
  const objects = eventPlanningResourceResponseSchema
    .array()
    .max(200)
    .parse(value.objects);
  for (const object of objects)
    if (object.objectType === "event") {
      eventCalendarDatesSchema.parse(object);
      if (
        object.startsOn !== null &&
        (object.startsAt !== null || object.endsAt !== null)
      )
        throw new Error("Calendar dates cannot include timestamps.");
      if (
        object.endsAt !== null &&
        (object.startsAt === null || object.endsAt < object.startsAt)
      )
        throw new Error("Invalid event interval.");
    }
  const relations = relationResponseSchema
    .array()
    .max(400)
    .parse(value.relations);
  const ids = new Set(objects.map((object) => object.id));
  if (
    ids.size !== objects.length ||
    objects.some(
      (object) =>
        object.workspaceId !== sandboxWorkspaceId ||
        !ids.has(object.permissionScopeId),
    ) ||
    new Set(relations.map((link) => link.id)).size !== relations.length ||
    relations.some(
      (link) =>
        link.workspaceId !== sandboxWorkspaceId ||
        link.relationType !== "includes" ||
        !ids.has(link.sourceObjectId) ||
        !ids.has(link.targetObjectId),
    )
  )
    throw new Error("Invalid sandbox references.");
  const layouts = eventLayoutResponseSchema
    .array()
    .max(2000)
    .parse("layouts" in value ? value.layouts : []);
  if (
    new Set(layouts.map((layout) => `${layout.eventId}:${layout.version}`))
      .size !== layouts.length ||
    layouts.some(
      (layout) =>
        !objects.some(
          (object) =>
            object.id === layout.eventId && object.objectType === "event",
        ),
    )
  ) {
    throw new Error("Invalid sandbox page references.");
  }
  const labels = labelResponseSchema
    .array()
    .max(200)
    .parse("labels" in value ? value.labels : []);
  const sections = sectionResponseSchema
    .array()
    .max(500)
    .parse("sections" in value ? value.sections : []);
  const preferences = userResponseSchema
    .pick({
      displayName: true,
      locale: true,
      timeZone: true,
      hourCycle: true,
      weekStart: true,
      rail: true,
      eventTabs: true,
      workspaceRecency: true,
      username: true,
      findByName: true,
      findByEmail: true,
      onboardedAt: true,
    })
    .parse({
      displayName: defaultPreferences.displayName,
      username: defaultPreferences.username,
      onboardedAt: defaultPreferences.onboardedAt,
      ...("preferences" in value && typeof value.preferences === "object"
        ? value.preferences
        : {}),
    });
  const friends = friendsResponseSchema.parse(
    "friends" in value ? value.friends : defaultFriends,
  );
  const shares = shareResponseSchema
    .array()
    .parse("shares" in value ? value.shares : []);
  const pendingShares = pendingShareSchema
    .array()
    .parse("pendingShares" in value ? value.pendingShares : []);
  const members = workspaceMemberSchema
    .array()
    .parse("members" in value ? value.members : [defaultMember]);
  return {
    objects,
    relations,
    layouts: layouts.sort((a, b) => b.version - a.version),
    labels,
    sections,
    preferences,
    friends,
    shares,
    pendingShares,
    members,
  };
}

function browserStorage(): StoragePort | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export class SandboxStore {
  #state: State = seed();
  /** The reversible content commands of this session: they are not persisted, like the layout undo. */
  #commands: {
    version: number;
    stack: SandboxCommand[];
    /** Commands up to this index are applied; the rest can be redone. */
    applied: number;
  } = { version: 0, stack: [], applied: 0 };
  #raw: string | null = null;
  #storage: StoragePort | undefined;
  #invalid = false;
  get notice(): string {
    if (this.#invalid)
      return "Saved sandbox data is unreadable. It is preserved; reset explicitly to edit sample data.";
    return this.#storage
      ? "Sample changes are saved in this browser."
      : "Browser storage unavailable: changes last until reload.";
  }

  constructor(storage = browserStorage()) {
    this.#storage = storage;
    if (storage) {
      try {
        this.#raw = storage.getItem(sandboxStorageKey);
      } catch {
        this.#storage = undefined;
      }
      if (this.#raw !== null) {
        try {
          this.#state = parseState(this.#raw);
        } catch {
          this.#invalid = true;
        }
      }
    }
  }

  reset() {
    const next = seed();
    const raw = JSON.stringify(next);
    this.#storage?.setItem(sandboxStorageKey, raw);
    this.#state = next;
    this.#raw = raw;
    this.#invalid = false;
  }

  #commit(next: State) {
    if (this.#invalid)
      throw new SandboxError(
        409,
        "sandbox_storage",
        "Reset the unreadable sandbox snapshot before editing.",
      );
    const raw = JSON.stringify(next);
    parseState(raw);
    if (this.#storage) {
      if (this.#storage.getItem(sandboxStorageKey) !== this.#raw)
        throw new SandboxError(
          409,
          "version_conflict",
          "Another tab changed this sandbox. Reload before editing.",
        );
      this.#storage.setItem(sandboxStorageKey, raw);
    }
    this.#state = next;
    this.#raw = raw;
  }

  // Friends: an invitation to an address waits under Sent (as a request
  // when the address is one of the sample accounts); a request is accepted
  // into the friends or declined; sent items are withdrawn or sent again;
  // a friend is removed.
  #friendWrite(
    method: string,
    id: string | undefined,
    operation: string | undefined,
    action: string | undefined,
    body: unknown,
  ): unknown {
    const friends = this.#state.friends;
    const timestamp = new Date().toISOString();
    const notFound = (what: string) =>
      new SandboxError(
        404,
        "friend_unavailable",
        `The ${what} does not exist.`,
      );
    if (method === "POST" && id === "requests" && !operation) {
      // A request to a sample account by id, as Find people sends it.
      const input = friendRequestRequestSchema.parse(body);
      const account = sampleAccounts.find((a) => a.id === input.userId);
      if (account === undefined) throw notFound("person");
      const relation = this.#summary(account).relation;
      if (relation !== "none")
        throw new SandboxError(
          409,
          "friend_conflict",
          relation === "friend"
            ? "You are already friends."
            : relation === "requested"
              ? "An invitation is already waiting."
              : "This person has already invited you.",
        );
      const item = {
        id: crypto.randomUUID(),
        kind: "connection" as const,
        email: account.email,
        channel: null,
        inviteUrl: null,
        message: input.message ?? null,
        personId: input.personId ?? null,
        workspaceId: input.personId === undefined ? null : sandboxWorkspaceId,
        createdAt: timestamp,
        expiresAt: null,
      };
      this.#commit({
        ...this.#state,
        friends: { ...friends, sent: [item, ...friends.sent] },
      });
      return item;
    }
    if (method === "POST" && id === "invitations" && !operation) {
      // By email (a request when a sample account has the address, else an
      // emailed link) or as a link to hand on; one pending invitation per
      // address and per card.
      const input = friendInvitationRequestSchema.parse(body);
      const email = input.email ?? null;
      if (email === "planner@example.test")
        throw new SandboxError(
          400,
          "invalid_request",
          "You cannot invite yourself.",
        );
      const account = sampleAccounts.find((a) => a.email === email);
      if (account !== undefined)
        return this.#friendWrite("POST", "requests", undefined, undefined, {
          userId: account.id,
          ...(input.message !== undefined && { message: input.message }),
          ...(input.personId !== undefined && { personId: input.personId }),
        });
      if (
        friends.sent.some(
          (item) =>
            (email !== null && item.email === email) ||
            (input.personId !== undefined && item.personId === input.personId),
        )
      )
        throw new SandboxError(
          409,
          "friend_conflict",
          "An invitation is already waiting.",
        );
      const item = {
        id: crypto.randomUUID(),
        kind: "invitation" as const,
        email,
        channel: input.channel,
        inviteUrl: inviteLink(crypto.randomUUID()),
        message: input.message ?? null,
        personId: input.personId ?? null,
        workspaceId: input.personId === undefined ? null : sandboxWorkspaceId,
        createdAt: timestamp,
        expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      };
      this.#commit({
        ...this.#state,
        friends: { ...friends, sent: [item, ...friends.sent] },
      });
      return item;
    }
    if (
      method === "POST" &&
      id === "invitations" &&
      operation &&
      (action === "resend" || action === "link")
    ) {
      // Sending again needs an address; a new link replaces the token.
      const item = friends.sent.find((sent) => sent.id === operation);
      if (item === undefined) throw notFound("invitation");
      if (action === "resend") {
        if (item.kind === "invitation" && item.email === null)
          throw new SandboxError(
            400,
            "invalid_request",
            "The invitation has no address to send to.",
          );
        return { accepted: true };
      }
      if (item.kind !== "invitation") throw notFound("invitation");
      const renewed = {
        ...item,
        inviteUrl: inviteLink(crypto.randomUUID()),
        expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
      };
      this.#commit({
        ...this.#state,
        friends: {
          ...friends,
          sent: friends.sent.map((sent) =>
            sent.id === operation ? renewed : sent,
          ),
        },
      });
      return renewed;
    }
    if (method === "DELETE" && id === "invitations" && operation) {
      if (!friends.sent.some((item) => item.id === operation))
        throw notFound("invitation");
      this.#commit({
        ...this.#state,
        friends: {
          ...friends,
          sent: friends.sent.filter((item) => item.id !== operation),
        },
      });
      return { id: operation, status: "withdrawn" };
    }
    if (method === "POST" && id === "requests" && operation) {
      const request = friends.incoming.find((item) => item.id === operation);
      if (request === undefined) throw notFound("request");
      const incoming = friends.incoming.filter((item) => item.id !== operation);
      if (action === "decline") {
        this.#commit({ ...this.#state, friends: { ...friends, incoming } });
        return { id: operation, status: "declined" };
      }
      const friend = {
        id: request.id,
        userId: request.requester.userId,
        displayName: request.requester.displayName,
        email: request.requester.email,
        since: timestamp,
      };
      this.#commit({
        ...this.#state,
        friends: {
          ...friends,
          incoming,
          friends: [...friends.friends, friend].sort((a, b) =>
            a.displayName.localeCompare(b.displayName),
          ),
        },
      });
      return friend;
    }
    if (method === "DELETE" && id && !operation) {
      if (!friends.friends.some((friend) => friend.id === id))
        throw notFound("friend");
      this.#commit({
        ...this.#state,
        friends: {
          ...friends,
          friends: friends.friends.filter((friend) => friend.id !== id),
        },
      });
      return { id, status: "removed" };
    }
    throw new SandboxError(404, "sandbox_route", "Unknown sandbox route.");
  }

  /** A live person of the sample workspace by id. */
  #personCard(personId: string) {
    for (const object of this.#state.objects)
      if (object.objectType === "person" && object.id === personId)
        return object;
    return undefined;
  }

  /**
   * The friend a card stands for, as a share resolves it: the linked
   * account first, else the one friend whose email equals any of the
   * card's email contacts and who lets themselves be found by email.
   */
  #personAccount(person: Extract<Resource, { objectType: "person" }>) {
    const friends = this.#state.friends.friends;
    if (person.userId !== null)
      return friends.find((friend) => friend.userId === person.userId);
    const emails = new Set(
      person.contacts
        .filter((contact) => contact.kind === "email")
        .map((contact) => contact.value.toLowerCase()),
    );
    const matches = friends.filter(
      (friend) =>
        friend.email !== null &&
        emails.has(friend.email) &&
        (sampleAccounts.find((account) => account.id === friend.userId)
          ?.findByEmail ??
          true),
    );
    return matches.length === 1 ? matches[0] : undefined;
  }

  // Shares: a grant to a friend (by the connection), to a person with an
  // account (the linked one, else the one found by an email contact), or
  // to an address that is a friend's; a share for a person without an
  // account waits on an invitation to their email, sent when none waits,
  // and is granted when that invitation is accepted here.
  #shareWrite(
    method: string,
    id: string | undefined,
    operation: string | undefined,
    body: unknown,
  ): unknown {
    const timestamp = new Date().toISOString();
    const unavailable = () =>
      new SandboxError(
        404,
        "principal_unavailable",
        "The requested user is unavailable.",
      );
    if (method === "POST" && !id) {
      const input = shareCreateRequestSchema.parse(body);
      const friends = this.#state.friends.friends;
      let principal: ShareResponse["principal"] | undefined;
      if (input.principalId !== undefined) {
        // An account already granted on the record, as the share sheet
        // changes its role.
        const held = this.#state.shares.find(
          (item) =>
            item.resourceId === input.resourceId &&
            item.principal.id === input.principalId,
        );
        if (held === undefined) throw unavailable();
        principal = held.principal;
      } else if (input.friendId !== undefined) {
        const friend = friends.find((item) => item.id === input.friendId);
        if (friend === undefined) throw unavailable();
        principal = {
          id: friend.userId,
          displayName: friend.displayName,
          email: friend.email,
        };
      } else {
        const person =
          input.personId === undefined
            ? undefined
            : this.#personCard(input.personId);
        if (input.personId !== undefined && person === undefined)
          throw unavailable();
        const friend =
          person !== undefined
            ? this.#personAccount(person)
            : friends.find((item) => item.email === input.principalEmail);
        if (friend === undefined) throw unavailable();
        principal = {
          id: friend.userId,
          displayName:
            person === undefined ? friend.displayName : person.displayName,
          email: friend.email,
        };
      }
      const scope = input.scope ?? null;
      const sameScope = (item: ShareResponse) =>
        item.scope?.view === scope?.view &&
        (item.scope?.sectionId ?? null) === (scope?.sectionId ?? null);
      // One grant per scope of a record and person, refreshed in place.
      const grant: ShareResponse = {
        id: crypto.randomUUID(),
        workspaceId: sandboxWorkspaceId,
        resourceId: input.resourceId,
        principal,
        role: input.role,
        grantedBy: userId,
        createdAt: timestamp,
        expiresAt: null,
        scope,
      };
      this.#commit({
        ...this.#state,
        shares: [
          ...this.#state.shares.filter(
            (item) =>
              item.resourceId !== grant.resourceId ||
              item.principal.id !== principal.id ||
              !sameScope(item),
          ),
          grant,
        ],
      });
      return grant;
    }
    if (method === "POST" && id === "pending" && !operation) {
      const input = pendingShareCreateRequestSchema.parse(body);
      const person = this.#personCard(input.personId);
      if (person === undefined) throw unavailable();
      if (person.userId !== null)
        throw new SandboxError(
          400,
          "invalid_request",
          "The person has an account here; share with them directly.",
        );
      let friends = this.#state.friends;
      let item = friends.sent.find((sent) => sent.personId === person.id);
      if (item === undefined) {
        const email = personEmail(person);
        item = {
          id: crypto.randomUUID(),
          kind: "invitation",
          email,
          channel: email === null ? "link" : "email",
          inviteUrl: inviteLink(crypto.randomUUID()),
          message: null,
          personId: person.id,
          workspaceId: sandboxWorkspaceId,
          createdAt: timestamp,
          expiresAt: new Date(Date.now() + 14 * 86_400_000).toISOString(),
        };
        friends = { ...friends, sent: [item, ...friends.sent] };
      }
      const standing = this.#state.pendingShares.find(
        (share) =>
          share.resourceId === input.resourceId && share.itemId === item.id,
      );
      const pending: PendingShare = {
        id: standing?.id ?? crypto.randomUUID(),
        workspaceId: sandboxWorkspaceId,
        resourceId: input.resourceId,
        role: input.role,
        status: "pending",
        kind: item.kind,
        itemId: item.id,
        person: {
          id: person.id,
          displayName: person.nickname ?? person.displayName,
        },
        email: item.email,
        grantedBy: userId,
        createdAt: standing?.createdAt ?? timestamp,
      };
      this.#commit({
        ...this.#state,
        friends,
        pendingShares: [
          ...this.#state.pendingShares.filter(
            (share) => share.id !== pending.id,
          ),
          pending,
        ],
      });
      return pending;
    }
    if (method === "DELETE" && id === "pending" && operation) {
      if (!this.#state.pendingShares.some((share) => share.id === operation))
        throw new SandboxError(
          404,
          "unavailable_resource",
          "The requested resource is unavailable.",
        );
      this.#commit({
        ...this.#state,
        pendingShares: this.#state.pendingShares.filter(
          (share) => share.id !== operation,
        ),
      });
      return { id: operation, revokedAt: timestamp };
    }
    if (method === "DELETE" && id && !operation) {
      if (!this.#state.shares.some((grant) => grant.id === id))
        throw new SandboxError(
          404,
          "unavailable_resource",
          "The requested resource is unavailable.",
        );
      this.#commit({
        ...this.#state,
        shares: this.#state.shares.filter((grant) => grant.id !== id),
      });
      return { id, revokedAt: timestamp };
    }
    throw new SandboxError(404, "sandbox_route", "Unknown sandbox route.");
  }

  // Members: the sample planner owns the workspace; a friend is added as
  // viewer or editor (or has the role changed) and removed again.
  #memberWrite(
    method: string,
    memberId: string | undefined,
    body: unknown,
  ): unknown {
    if (method === "POST" && !memberId) {
      const input = workspaceMemberAddRequestSchema.parse(body);
      const friend = this.#state.friends.friends.find(
        (item) => item.id === input.friendId,
      );
      if (friend === undefined)
        throw new SandboxError(
          404,
          "friend_unavailable",
          "The friend does not exist.",
        );
      const member: WorkspaceMember = {
        userId: friend.userId,
        displayName: friend.displayName,
        email: friend.email,
        role: input.role,
        personal: false,
        friendId: friend.id,
        joinedAt: new Date().toISOString(),
      };
      this.#commit({
        ...this.#state,
        members: [
          ...this.#state.members.filter(
            (item) => item.userId !== member.userId,
          ),
          member,
        ],
      });
      return member;
    }
    if (method === "DELETE" && memberId) {
      const member = this.#state.members.find(
        (item) => item.userId === memberId,
      );
      if (member === undefined)
        throw new SandboxError(
          404,
          "friend_unavailable",
          "The member does not exist.",
        );
      if (member.personal || member.userId === userId)
        throw new SandboxError(
          400,
          "invalid_request",
          "The member cannot be removed.",
        );
      this.#commit({
        ...this.#state,
        members: this.#state.members.filter((item) => item.userId !== memberId),
      });
      return { userId: memberId, removed: true };
    }
    throw new SandboxError(404, "sandbox_route", "Unknown sandbox route.");
  }

  /** The sections of one view of an event in their order. */
  #sectionsOf(eventId: string, view: string): SectionResponse[] {
    return this.#state.sections
      .filter((section) => section.eventId === eventId && section.view === view)
      .sort((a, b) => byRank(a, b));
  }

  // A record carries only a section of the matching view of the event it
  // belongs to; a standalone record takes none.
  #checkSection(record: Resource): Resource {
    if (record.objectType !== "task" && record.objectType !== "expense")
      return record;
    if (record.sectionId === null) return record;
    const view = record.objectType === "task" ? "todos" : "expenses";
    const section = this.#state.sections.find(
      (candidate) => candidate.id === record.sectionId,
    );
    if (
      section === undefined ||
      section.view !== view ||
      section.eventId !== record.permissionScopeId ||
      record.permissionScopeId === record.id
    )
      throw new SandboxError(
        400,
        "invalid_request",
        "sectionId must name a section of this view of the record's Event.",
      );
    return record;
  }

  // Sections: a vocabulary of an event's To-dos or Expenses, placed among
  // their siblings by rank; deleting one leaves its records loose.
  #sectionWrite(
    method: string,
    collection: string | undefined,
    id: string | undefined,
    body: unknown,
  ): SectionResponse {
    const timestamp = new Date().toISOString();
    const rankAt = (
      eventId: string,
      view: string,
      sectionId: string | null,
      after: string | null | undefined,
    ) => {
      const siblings = this.#sectionsOf(eventId, view).filter(
        (section) => section.id !== sectionId,
      );
      if (after === undefined)
        return rankBetweenRows(siblings.at(-1), undefined);
      const at =
        after === null
          ? -1
          : siblings.findIndex((section) => section.id === after);
      if (after !== null && at < 0)
        throw new SandboxError(
          400,
          "invalid_request",
          "afterSectionId must name another section of this view.",
        );
      return rankBetweenRows(siblings[at], siblings[at + 1]);
    };
    if (method === "POST" && collection === "events" && id) {
      const event = this.#object(id);
      if (event.objectType !== "event")
        throw new SandboxError(404, "not_found", "The event is unavailable.");
      const input = sectionCreateRequestSchema.parse(body);
      const section = sectionResponseSchema.parse({
        id: crypto.randomUUID(),
        workspaceId: sandboxWorkspaceId,
        eventId: id,
        view: input.view,
        name: input.name,
        description: input.description ?? null,
        rank: rankAt(id, input.view, null, input.afterSectionId),
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.#commit({
        ...this.#state,
        sections: [...this.#state.sections, section],
      });
      return section;
    }
    const current = this.#state.sections.find((section) => section.id === id);
    if (current === undefined)
      throw new SandboxError(404, "not_found", "The section is unavailable.");
    if (method === "PATCH") {
      const input = sectionUpdateRequestSchema.parse(body);
      const section = {
        ...current,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.afterSectionId === undefined
          ? {}
          : {
              rank: rankAt(
                current.eventId,
                current.view,
                current.id,
                input.afterSectionId,
              ),
            }),
        updatedAt: timestamp,
      };
      this.#commit({
        ...this.#state,
        sections: this.#state.sections.map((item) =>
          item.id === id ? section : item,
        ),
      });
      return section;
    }
    this.#commit({
      ...this.#state,
      sections: this.#state.sections.filter((item) => item.id !== id),
      objects: this.#state.objects.map((object) =>
        (object.objectType === "task" || object.objectType === "expense") &&
        object.sectionId === id
          ? { ...object, sectionId: null }
          : object,
      ),
    });
    return current;
  }

  // Labels: unique names per workspace, versioned renames and deletes, and
  // every task keeps only labels that exist.
  #labelWrite(
    method: string,
    id: string | undefined,
    url: URL,
    body: unknown,
  ): LabelResponse {
    const conflict = (name: string, except?: string) => {
      if (
        this.#state.labels.some(
          (label) =>
            label.id !== except &&
            label.name.toLowerCase() === name.toLowerCase(),
        )
      )
        throw new SandboxError(
          409,
          "label_name_taken",
          "A label with this name already exists.",
        );
    };
    const timestamp = new Date().toISOString();
    if (method === "POST" && !id) {
      const { name } = labelCreateRequestSchema.parse(body);
      conflict(name);
      const label = labelResponseSchema.parse({
        id: crypto.randomUUID(),
        workspaceId: sandboxWorkspaceId,
        name,
        version: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      this.#commit({ ...this.#state, labels: [...this.#state.labels, label] });
      return label;
    }
    const current = this.#state.labels.find((label) => label.id === id);
    if (current === undefined)
      throw new SandboxError(404, "not_found", "The label is unavailable.");
    if (method === "PATCH") {
      const { expectedVersion, name } = labelUpdateRequestSchema.parse(body);
      if (expectedVersion !== current.version)
        throw new SandboxError(
          409,
          "version_conflict",
          "The label changed. Refresh before saving.",
        );
      conflict(name, current.id);
      const label = {
        ...current,
        name,
        version: current.version + 1,
        updatedAt: timestamp,
      };
      this.#commit({
        ...this.#state,
        labels: this.#state.labels.map((item) =>
          item.id === id ? label : item,
        ),
      });
      return label;
    }
    const { expectedVersion } = labelDeleteQuerySchema.parse(
      Object.fromEntries(url.searchParams),
    );
    if (expectedVersion !== current.version)
      throw new SandboxError(
        409,
        "version_conflict",
        "The label changed. Refresh before saving.",
      );
    this.#commit({
      ...this.#state,
      labels: this.#state.labels.filter((item) => item.id !== id),
      objects: this.#state.objects.map((object) =>
        object.objectType === "task"
          ? {
              ...object,
              labelIds: object.labelIds.filter((labelId) => labelId !== id),
            }
          : object,
      ),
    });
    return current;
  }

  // Standalone creations replay by command id within the session: the same
  // input returns the object created, a different input is a conflict.
  readonly #createCommands = new Map<
    string,
    { readonly key: string; readonly objectId: string }
  >();

  #replayCreate(
    commandId: unknown,
    fields: Record<string, unknown>,
  ): Resource | undefined {
    if (typeof commandId !== "string") return undefined;
    const known = this.#createCommands.get(commandId);
    if (known === undefined) return undefined;
    if (known.key !== JSON.stringify(fields))
      throw new SandboxError(
        409,
        "command_conflict",
        "The command ID was already used with different input.",
      );
    return this.#object(known.objectId);
  }

  #rememberCreate(
    commandId: unknown,
    fields: Record<string, unknown>,
    objectId: string,
  ): void {
    if (typeof commandId === "string")
      this.#createCommands.set(commandId, {
        key: JSON.stringify(fields),
        objectId,
      });
  }

  // A person's linked account is the sample planner's and belongs to one
  // person, as the API requires of a workspace member; the labels are the
  // workspace's labels only, in name order.
  #checkPerson(input: Resource): Resource {
    if (input.objectType !== "person") return input;
    const names = new Map(
      this.#state.labels.map((label) => [label.id, label.name.toLowerCase()]),
    );
    if (input.labelIds.some((labelId) => !names.has(labelId)))
      throw new SandboxError(
        400,
        "invalid_request",
        "labelIds must name labels of this workspace.",
      );
    const labelIds = [...new Set(input.labelIds)].sort(
      (first, second) =>
        compareNames(names.get(first) ?? "", names.get(second) ?? "") ||
        first.localeCompare(second),
    );
    const person = labelIds.every(
      (labelId, at) => labelId === input.labelIds[at],
    )
      ? input
      : { ...input, labelIds };
    if (person.userId !== null) {
      if (
        person.userId !== userId &&
        !this.#state.friends.friends.some(
          (friend) => friend.userId === person.userId,
        )
      )
        throw new SandboxError(
          400,
          "invalid_request",
          "userId must name a member of this workspace or a friend of one.",
        );
      if (
        this.#state.objects.some(
          (other) =>
            other.objectType === "person" &&
            other.id !== person.id &&
            other.userId === userId,
        )
      )
        throw new SandboxError(
          400,
          "invalid_request",
          "userId is already linked to another person.",
        );
    }
    return person;
  }

  // A task's assignee is a live person of the workspace and its labels are
  // the workspace's labels only, in name order; a task or an expense sits
  // in a section of its event's view or in none.
  #checkTask(task: Resource): Resource {
    this.#checkSection(task);
    if (task.objectType !== "task") return task;
    // The duration and repeat rules the API enforces; the schema already
    // bounds the values.
    if (task.durationMinutes !== null && task.dueAt === null)
      throw new SandboxError(
        400,
        "invalid_request",
        "durationMinutes requires dueAt.",
      );
    if (task.repeatRule !== null && task.dueOn === null && task.dueAt === null)
      throw new SandboxError(
        400,
        "invalid_request",
        "repeatRule requires dueOn or dueAt.",
      );
    if (task.repeatUntil !== null && task.repeatRule === null)
      throw new SandboxError(
        400,
        "invalid_request",
        "repeatUntil requires repeatRule.",
      );
    const due = taskDueDate(
      task.dueOn,
      task.dueAt === null ? null : new Date(task.dueAt),
    );
    if (task.repeatUntil !== null && due !== null && task.repeatUntil < due)
      throw new SandboxError(
        400,
        "invalid_request",
        "repeatUntil must be on or after the due date.",
      );
    if (
      task.assigneeId !== null &&
      !this.#state.objects.some(
        (object) =>
          object.objectType === "person" &&
          object.id === task.assigneeId &&
          object.deletedAt === null,
      )
    )
      throw new SandboxError(
        400,
        "invalid_request",
        "assigneeId must name a live person in this workspace.",
      );
    const names = new Map(
      this.#state.labels.map((label) => [label.id, label.name.toLowerCase()]),
    );
    if (task.labelIds.some((labelId) => !names.has(labelId)))
      throw new SandboxError(
        400,
        "invalid_request",
        "labelIds must name labels of this workspace.",
      );
    return {
      ...task,
      labelIds: [...new Set(task.labelIds)].sort(
        (a, b) =>
          compareNames(names.get(a) ?? "", names.get(b) ?? "") ||
          a.localeCompare(b),
      ),
    };
  }

  // The parent rules the API enforces: a live task of the same scope with
  // no parent of its own, and no subtasks under the new subtask.
  #assertTaskParent(task: Resource): void {
    if (task.objectType !== "task" || task.parentTaskId === null) return;
    const refuse = (message: string): never => {
      throw new SandboxError(400, "invalid_request", message);
    };
    if (task.parentTaskId === task.id)
      refuse("A task cannot be its own parent.");
    const parent = this.#state.objects.find(
      (object): object is Extract<Resource, { objectType: "task" }> =>
        object.id === task.parentTaskId &&
        object.objectType === "task" &&
        object.deletedAt === null,
    );
    if (parent === undefined)
      throw new SandboxError(
        400,
        "invalid_request",
        "parentTaskId must name a live task in this workspace.",
      );
    if (parent.parentTaskId !== null)
      refuse("A subtask cannot have subtasks of its own.");
    if (
      this.#state.objects.some(
        (object) =>
          object.objectType === "task" && object.parentTaskId === task.id,
      )
    )
      refuse("A task with subtasks cannot become a subtask.");
    if (parent.permissionScopeId !== task.permissionScopeId)
      refuse("A subtask shares its parent's permission scope.");
  }

  #object(id: string): Resource {
    const object = this.#state.objects.find(
      (object) => object.id === id && object.deletedAt === null,
    );
    if (!object)
      throw new SandboxError(
        404,
        "resource_unavailable",
        "This sample object is unavailable.",
      );
    return object;
  }

  async fetch(
    input: Parameters<typeof fetch>[0],
    options: RequestInit = {},
    role: "owner" | "viewer" = "owner",
  ): Promise<Response> {
    options.signal?.throwIfAborted();
    try {
      const url = new URL(String(input), "https://sandbox.invalid");
      if (url.origin !== "https://sandbox.invalid")
        throw new SandboxError(
          403,
          "sandbox_network",
          "External requests are disabled in the design sandbox.",
        );
      const method = options.method ?? "GET";
      if (method !== "GET" && role === "viewer")
        throw new SandboxError(
          403,
          "forbidden",
          "Viewer preview cannot edit sample data.",
        );
      const headers = new Headers(options.headers);
      if (
        headers.has("x-workspace-id") &&
        headers.get("x-workspace-id") !== sandboxWorkspaceId
      )
        throw new SandboxError(
          403,
          "workspace_unavailable",
          "Only the design workspace is available.",
        );
      const body: unknown = options.body
        ? JSON.parse(String(options.body))
        : undefined;
      const result = this.#dispatch(url, method, body, role);
      return Response.json(result);
    } catch (error) {
      if (error instanceof SandboxError)
        return Response.json(
          { error: { code: error.code, message: error.message } },
          { status: error.status },
        );
      return Response.json(
        {
          error: {
            code: "sandbox_operation",
            message:
              "The sample change could not be saved. Check the values and available browser storage.",
          },
        },
        { status: 400 },
      );
    }
  }

  #user(): Preferences {
    return {
      id: userId,
      email: "planner@example.test",
      ...this.#state.preferences,
    };
  }

  /** An account as Find people shows it, with how it stands to the sample account. */
  #summary(account: (typeof sampleAccounts)[number]) {
    const friends = this.#state.friends;
    const relation = friends.friends.some((f) => f.userId === account.id)
      ? "friend"
      : friends.incoming.some((r) => r.requester.userId === account.id)
        ? "incoming"
        : friends.sent.some(
              (item) =>
                item.kind === "connection" && item.email === account.email,
            )
          ? "requested"
          : "none";
    return {
      id: account.id,
      displayName: account.displayName,
      username: account.username,
      relation,
    };
  }

  #read(url: URL, role: "owner" | "viewer"): unknown {
    const [, , collection, id, operation, action] = url.pathname.split("/");
    const all = this.#state.objects.filter(
      (object) => object.deletedAt === null,
    );
    if (collection === "labels" && !id)
      return {
        items: [...this.#state.labels].sort(
          (a, b) => compareNames(a.name, b.name) || a.id.localeCompare(b.id),
        ),
      };
    if (collection === "friends" && !id) return this.#state.friends;
    if (collection === "users" && id === "search") {
      const q = (url.searchParams.get("q") ?? "").trim();
      const found =
        q.length < 2
          ? []
          : q.startsWith("@")
            ? sampleAccounts.filter((account) =>
                account.username
                  .toLowerCase()
                  .startsWith(q.slice(1).toLowerCase()),
              )
            : q.includes("@")
              ? sampleAccounts.filter(
                  (account) =>
                    account.findByEmail && account.email === q.toLowerCase(),
                )
              : sampleAccounts.filter(
                  (account) =>
                    (account.findByName &&
                      account.displayName
                        .toLowerCase()
                        .includes(q.toLowerCase())) ||
                    account.username.toLowerCase().startsWith(q.toLowerCase()),
                );
      return { items: found.slice(0, 10).map((a) => this.#summary(a)) };
    }
    if (collection === "invitations" && id && !operation) {
      // What a link opens: one the sample account sent (its own), or one
      // of the sample links sent to it.
      const own = this.#state.friends.sent.find(
        (item) => inviteToken(item.inviteUrl) === id,
      );
      if (own !== undefined)
        return {
          requester: {
            displayName: this.#state.preferences.displayName,
            username: this.#state.preferences.username,
          },
          message: own.message,
          queued: this.#state.pendingShares
            .filter((share) => share.itemId === own.id)
            .map((share) => ({
              resourceId: share.resourceId,
              displayName: this.#object(share.resourceId).displayName,
              role: share.role,
            })),
          expiresAt: own.expiresAt,
          status: "open",
        };
      const sample = sampleInvitations.find((entry) => entry.token === id);
      if (sample === undefined)
        throw new SandboxError(
          404,
          "friend_unavailable",
          "The invitation does not exist.",
        );
      return {
        requester: {
          displayName: sample.requester.displayName,
          username: sample.requester.username,
        },
        message: sample.message,
        queued: sample.queued,
        expiresAt: sample.expiresAt,
        status: "open",
      };
    }
    if (collection === "users" && id) {
      const account = sampleAccounts.find(
        (candidate) => candidate.username.toLowerCase() === id.toLowerCase(),
      );
      if (account === undefined)
        throw new SandboxError(
          404,
          "user_unavailable",
          "The user is unavailable.",
        );
      return this.#summary(account);
    }
    if (
      collection === "workspaces" &&
      id === "current" &&
      operation === "members"
    )
      return { items: this.#state.members };
    if (collection === "auth" && id === "session")
      return {
        user: this.#user(),
        principal: { type: "user", userId, workspaceId: sandboxWorkspaceId },
        workspace,
        availableWorkspaces: [accessibleWorkspace],
      };
    if (collection === "commands") return this.#commandState();
    if (collection === "trash") return { items: [], nextCursor: null };
    if (collection === "search") {
      const query = objectSearchQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      const matches = all.filter(
        (object) =>
          object.displayName
            .toLowerCase()
            .includes(query.query.toLowerCase()) &&
          (!query.objectType || object.objectType === query.objectType),
      );
      const offset =
        query.cursor === undefined
          ? 0
          : matches.findIndex((object) => object.id === query.cursor) + 1;
      if (query.cursor !== undefined && offset === 0)
        throw new SandboxError(
          400,
          "invalid_cursor",
          "Search position is unavailable.",
        );
      const items = matches.slice(offset, offset + query.limit);
      return {
        items,
        nextCursor:
          offset + items.length < matches.length
            ? (items.at(-1)?.id ?? null)
            : null,
      };
    }
    if (collection === "persons" && !id) {
      // The workspace's people: name order, the first `limit` matching the query.
      const query = personListQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      return {
        items: all
          .filter((object) => object.objectType === "person")
          .filter((person) =>
            person.displayName
              .toLowerCase()
              .includes(query.query.toLowerCase()),
          )
          .sort(
            (a, b) =>
              compareNames(a.displayName, b.displayName) ||
              a.id.localeCompare(b.id),
          )
          .slice(0, query.limit),
      };
    }
    if (collection === "tasks" && !id) {
      // The workspace task list: status filter, due/name/updated order, and
      // a cursor that names the last task of the previous page.
      const query = taskListQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      const duePosition = (task: Resource) =>
        task.objectType === "task"
          ? task.dueOn
            ? `${task.dueOn}T00:00:00.000Z`
            : (task.dueAt ?? "z")
          : "z";
      // The day a task is due in the query's time zone; undated tasks are
      // in no range.
      const dueDay = (task: { dueOn: string | null; dueAt: string | null }) => {
        if (task.dueOn !== null) return task.dueOn;
        if (task.dueAt === null) return null;
        const parts = new Intl.DateTimeFormat("en-US", {
          timeZone: query.timezone,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }).formatToParts(new Date(task.dueAt));
        const part = (type: string) =>
          parts.find((candidate) => candidate.type === type)?.value ?? "";
        return `${part("year")}-${part("month")}-${part("day")}`;
      };
      const inDueRange = (task: {
        dueOn: string | null;
        dueAt: string | null;
      }) => {
        if (query.dueFrom === undefined && query.dueTo === undefined)
          return true;
        const day = dueDay(task);
        return (
          day !== null &&
          (query.dueFrom === undefined || day >= query.dueFrom) &&
          (query.dueTo === undefined || day <= query.dueTo)
        );
      };
      const matches = all
        .filter(
          (object): object is Extract<Resource, { objectType: "task" }> =>
            object.objectType === "task",
        )
        .filter(
          (task) =>
            task.displayName
              .toLowerCase()
              .includes(query.query.toLowerCase()) &&
            (query.filter === "all" ||
              (query.filter === "done"
                ? task.status === "done"
                : task.status === "todo" || task.status === "in_progress")) &&
            (query.label === undefined ||
              task.labelIds.includes(query.label)) &&
            (query.assignee === undefined ||
              task.assigneeId === query.assignee) &&
            inDueRange(task),
        )
        .sort((a, b) =>
          query.sort === "manual"
            ? (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0) ||
              a.id.localeCompare(b.id)
            : query.sort === "name"
              ? compareNames(a.displayName, b.displayName) ||
                a.id.localeCompare(b.id)
              : query.sort === "updated"
                ? b.updatedAt.localeCompare(a.updatedAt) ||
                  a.id.localeCompare(b.id)
                : duePosition(a).localeCompare(duePosition(b)) ||
                  compareNames(a.displayName, b.displayName) ||
                  a.id.localeCompare(b.id),
        );
      const offset =
        query.cursor === undefined
          ? 0
          : matches.findIndex((task) => task.id === query.cursor) + 1;
      if (query.cursor !== undefined && offset === 0)
        throw new SandboxError(
          400,
          "invalid_request",
          "The task cursor is invalid for this query.",
        );
      const items = matches.slice(offset, offset + query.limit);
      const liveTasks = all.filter(
        (object): object is Extract<Resource, { objectType: "task" }> =>
          object.objectType === "task",
      );
      const progress: Record<string, { done: number; total: number }> = {};
      const parents: Record<string, { taskId: string; displayName: string }> =
        {};
      for (const task of items) {
        const subtasks = liveTasks.filter(
          (candidate) => candidate.parentTaskId === task.id,
        );
        if (subtasks.length > 0)
          progress[task.id] = {
            done: subtasks.filter((candidate) => candidate.status === "done")
              .length,
            total: subtasks.length,
          };
        const parent =
          task.parentTaskId === null
            ? undefined
            : liveTasks.find((candidate) => candidate.id === task.parentTaskId);
        if (parent !== undefined)
          parents[task.id] = {
            taskId: parent.id,
            displayName: parent.displayName,
          };
      }
      const contexts: Record<string, { eventId: string; displayName: string }> =
        {};
      for (const task of items) {
        const relation = this.#state.relations.find(
          (candidate) =>
            candidate.targetObjectId === task.id &&
            candidate.relationType === "includes" &&
            candidate.deletedAt === null,
        );
        const event =
          relation === undefined
            ? undefined
            : all.find((object) => object.id === relation.sourceObjectId);
        if (event !== undefined)
          contexts[task.id] = {
            eventId: event.id,
            displayName: event.displayName,
          };
      }
      return {
        items,
        contexts,
        progress,
        parents,
        nextCursor:
          offset + items.length < matches.length
            ? (items.at(-1)?.id ?? null)
            : null,
        asOf: new Date().toISOString(),
      };
    }
    if (collection === "events" && !id) {
      const query = eventListQuerySchema.parse(
        Object.fromEntries(url.searchParams),
      );
      const now = Date.now();
      // The sample account belongs to its one workspace and holds no share
      // from another, so every event is its own; the share line counts
      // the accounts it shared the event with.
      const named = all
        .filter((object) => object.objectType === "event")
        .filter((event) =>
          event.displayName.toLowerCase().includes(query.query.toLowerCase()),
        );
      const items = named
        .filter(
          (event) =>
            query.scope !== "shared" &&
            (query.filter === "all" ||
              eventPeriod(event, now) === query.filter),
        )
        .map((event) => ({
          ...event,
          access: {
            sharedBy: null,
            role: null,
            sharedWith: new Set(
              this.#state.shares
                .filter((grant) => grant.resourceId === event.id)
                .map((grant) => grant.principal.id),
            ).size,
          },
        }));
      items.sort((a, b) =>
        query.sort === "name"
          ? compareNames(a.displayName, b.displayName)
          : query.sort === "updated"
            ? b.updatedAt.localeCompare(a.updatedAt)
            : (a.startsOn ?? a.startsAt ?? "z").localeCompare(
                b.startsOn ?? b.startsAt ?? "z",
              ),
      );
      const counts = {
        all: named.length,
        mine: named.length,
        shared: 0,
        upcoming: named.filter(
          (event) => eventPeriod(event, now) === "upcoming",
        ).length,
        past: named.filter((event) => eventPeriod(event, now) === "past")
          .length,
      };
      return {
        items,
        nextCursor: null,
        asOf: new Date(now).toISOString(),
        counts,
      };
    }
    if (id && collection === "persons" && operation === "shares") {
      // The sample account holds every grant: what the workspace shared
      // with the person's account (the linked one, else the friend found
      // by an email contact, as a share resolves it), and what waits on
      // their invitation.
      const person = this.#personCard(id);
      if (person === undefined)
        throw new SandboxError(404, "not_found", "Record is unavailable.");
      const account =
        person.userId ?? this.#personAccount(person)?.userId ?? null;
      const shared = (resourceId: string) => this.#object(resourceId);
      const items = [
        ...this.#state.shares
          .filter((grant) => account !== null && grant.principal.id === account)
          .map((grant) => ({
            id: grant.id,
            kind: "grant" as const,
            direction: "outgoing" as const,
            resourceId: grant.resourceId,
            objectType: shared(grant.resourceId).objectType,
            displayName: shared(grant.resourceId).displayName,
            role: grant.role,
            createdAt: grant.createdAt,
          })),
        ...this.#state.pendingShares
          .filter((share) => share.person?.id === id)
          .map((share) => ({
            id: share.id,
            kind: "pending" as const,
            direction: "outgoing" as const,
            resourceId: share.resourceId,
            objectType: shared(share.resourceId).objectType,
            displayName: shared(share.resourceId).displayName,
            role: share.role,
            createdAt: share.createdAt,
          })),
      ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      return { items };
    }
    if (
      id &&
      (collection === "tasks" ||
        collection === "expenses" ||
        collection === "reminders" ||
        collection === "persons" ||
        collection === "notes") &&
      !operation
    ) {
      const object = this.#object(id);
      const type = collection.slice(0, -1);
      if (object.objectType !== type)
        throw new SandboxError(404, "not_found", "Record is unavailable.");
      return object;
    }
    if (id && (collection === "objects" || collection === "events")) {
      const object = this.#object(id);
      if (!operation) return object;
      if (
        collection === "events" &&
        operation === "layout" &&
        object.objectType === "event"
      ) {
        if (action === "history") {
          const query = eventLayoutHistoryQuerySchema.parse(
            Object.fromEntries(url.searchParams),
          );
          const revisions = this.#state.layouts.filter(
            (layout) =>
              layout.eventId === id &&
              (query.beforeVersion === undefined ||
                layout.version < query.beforeVersion),
          );
          const items = revisions.slice(0, query.limit);
          return {
            items,
            nextBeforeVersion:
              revisions.length > query.limit ? items.at(-1)?.version : null,
          };
        }
        if (action) return undefined;
        return (
          this.#state.layouts.find((layout) => layout.eventId === id) ?? {
            eventId: id,
            version: 0,
            updatedAt: null,
            pages: [],
          }
        );
      }
      if (operation === "access")
        return {
          resourceId: id,
          actions: role === "owner" ? ["view", "edit"] : ["view"],
          source: { kind: "own" },
          narrowing: null,
        };
      if (operation === "sections") {
        const { view } = sectionListQuerySchema.parse(
          Object.fromEntries(url.searchParams),
        );
        return { items: this.#sectionsOf(id, view) };
      }
      if (operation === "documents")
        return { items: [], lockedAttachmentCount: 0 };
      if (operation === "shares")
        return {
          items: this.#state.shares.filter((grant) => grant.resourceId === id),
          pending: this.#state.pendingShares.filter(
            (share) => share.resourceId === id,
          ),
        };
      if (operation === "revisions")
        return { items: [], nextBeforeVersion: null };
      if (operation === "removed-relations")
        return { items: [], nextCursor: null };
      const links = this.#state.relations.filter(
        (link) => link.sourceObjectId === id && link.deletedAt === null,
      );
      if (operation === "relations") {
        const query = relationListQuerySchema.parse(
          Object.fromEntries(url.searchParams),
        );
        const incoming = this.#state.relations.filter(
          (link) => link.targetObjectId === id && link.deletedAt === null,
        );
        const listed =
          query.direction === "incoming"
            ? incoming
            : query.direction === "outgoing"
              ? links
              : [...links, ...incoming];
        return {
          items: listed
            .filter(
              (link) =>
                (query.relationType === undefined ||
                  link.relationType === query.relationType) &&
                (query.otherObjectId === undefined ||
                  link.sourceObjectId === query.otherObjectId ||
                  link.targetObjectId === query.otherObjectId),
            )
            .slice(0, query.limit),
          nextCursor: null,
        };
      }
      const children = all.filter((child) =>
        links.some((link) => link.targetObjectId === child.id),
      );
      const events = children
        .filter((child) => child.objectType === "event")
        .sort((a, b) =>
          (a.startsOn ?? a.startsAt ?? "z").localeCompare(
            b.startsOn ?? b.startsAt ?? "z",
          ),
        );
      // A date-only due sorts at the start of its day, ahead of timed tasks.
      const tasks = children
        .filter((child) => child.objectType === "task")
        .sort((a, b) =>
          (a.dueOn
            ? `${a.dueOn}T00:00:00.000Z`
            : (a.dueAt ?? "z")
          ).localeCompare(
            b.dueOn ? `${b.dueOn}T00:00:00.000Z` : (b.dueAt ?? "z"),
          ),
        );
      const expenses = children.filter(
        (child) => child.objectType === "expense",
      );
      const reminders = children.filter(
        (child) => child.objectType === "reminder",
      );
      const persons = children
        .filter((child) => child.objectType === "person")
        .sort(
          (a, b) =>
            compareNames(a.displayName, b.displayName) ||
            a.id.localeCompare(b.id),
        );
      if (operation === "detail")
        return {
          event: object,
          events,
          tasks,
          expenses,
          reminders,
          persons,
          documents: [],
          lockedRelationCount: 0,
        };
      if (operation === "attachment-targets") {
        const summary = ({ id, displayName }: Resource) => ({
          id,
          displayName,
        });
        return {
          event: summary(object),
          tasks: tasks.map(summary),
          expenses: expenses.map(summary),
        };
      }
      if (operation === "notes") {
        // The sample planner writes every version here, so each note names
        // them; the newest edit first, or titles without regard to case.
        const query = noteListQuerySchema.parse(
          Object.fromEntries(url.searchParams),
        );
        const notes = children
          .filter((child) => child.objectType === "note")
          .sort((a, b) =>
            query.sort === "title"
              ? a.displayName.toLowerCase() < b.displayName.toLowerCase()
                ? -1
                : a.displayName.toLowerCase() > b.displayName.toLowerCase()
                  ? 1
                  : a.id.localeCompare(b.id)
              : b.updatedAt.localeCompare(a.updatedAt) ||
                a.id.localeCompare(b.id),
          )
          .map((note) => ({
            ...note,
            editedBy: this.#state.preferences.displayName,
          }));
        return { sourceEventId: id, items: notes };
      }
      const projections: Record<string, Resource[]> = {
        todos: tasks,
        calendar: events,
        itinerary: events,
        expenses,
        reminders,
        people: persons,
      };
      const projection = projections[operation];
      if (projection)
        return {
          sourceEventId: id,
          items: projection,
          // To-dos and Expenses carry their sections in order.
          ...(operation === "todos" || operation === "expenses"
            ? { sections: this.#sectionsOf(id, operation) }
            : {}),
        };
      if (operation === "timeline")
        return {
          sourceEventId: id,
          items: children
            .flatMap<TimelineResponse["items"][number]>((child) => {
              if (
                child.objectType === "document" ||
                child.objectType === "person" ||
                child.objectType === "note"
              )
                return [];
              const occursOn =
                child.objectType === "event"
                  ? child.startsOn
                  : child.objectType === "task"
                    ? child.dueOn
                    : null;
              if (occursOn)
                return [
                  {
                    canonicalObjectId: child.id,
                    objectType: child.objectType,
                    displayName: child.displayName,
                    occursAt: null,
                    occursOn,
                    version: child.version,
                  },
                ];
              const occursAt =
                child.objectType === "event"
                  ? child.startsAt
                  : child.objectType === "task"
                    ? child.dueAt
                    : child.objectType === "expense"
                      ? child.occurredAt
                      : child.objectType === "reminder"
                        ? child.remindAt
                        : null;
              return occursAt
                ? [
                    {
                      canonicalObjectId: child.id,
                      objectType: child.objectType,
                      displayName: child.displayName,
                      occursAt,
                      occursOn: null,
                      version: child.version,
                    },
                  ]
                : [];
            })
            .sort((a, b) =>
              (a.occursOn ?? a.occursAt ?? "").localeCompare(
                b.occursOn ?? b.occursAt ?? "",
              ),
            ),
        };
    }
  }

  #dispatch(
    url: URL,
    method: string,
    body: unknown,
    role: "owner" | "viewer",
  ): unknown {
    const [, api, collection, id, operation, action] = url.pathname.split("/");
    if (api !== "api")
      throw new SandboxError(404, "sandbox_route", "Unknown sandbox route.");
    if (method === "GET") {
      const response = this.#read(url, role);
      if (response !== undefined) return response;
    }
    if (
      collection === "labels" &&
      (method === "POST" || method === "PATCH" || method === "DELETE")
    )
      return this.#labelWrite(method, id, url, body);
    if (
      (method === "POST" &&
        collection === "events" &&
        operation === "sections") ||
      ((method === "PATCH" || method === "DELETE") &&
        collection === "sections" &&
        id &&
        !operation)
    )
      return this.#sectionWrite(method, collection, id, body);
    if (collection === "account" && !id && method === "PATCH") {
      // The name, the discovery switches, and the Welcome step's
      // completion; the username was chosen at sign-up.
      const input = accountUpdateRequestSchema.parse(body);
      this.#commit({
        ...this.#state,
        preferences: {
          ...this.#state.preferences,
          ...(input.displayName !== undefined && {
            displayName: input.displayName,
          }),
          ...(input.findByName !== undefined && {
            findByName: input.findByName,
          }),
          ...(input.findByEmail !== undefined && {
            findByEmail: input.findByEmail,
          }),
          ...(input.onboarded === true && {
            onboardedAt:
              this.#state.preferences.onboardedAt ?? new Date().toISOString(),
          }),
        },
      });
      return this.#user();
    }
    if (collection === "auth" && id === "me" && method === "PATCH") {
      // Settings keeps the sample account's preferences; absent keys stay.
      const input = preferencesRequestSchema.parse(body);
      this.#commit({
        ...this.#state,
        preferences: {
          ...this.#state.preferences,
          locale:
            input.locale === undefined
              ? this.#state.preferences.locale
              : input.locale,
          timeZone:
            input.timeZone === undefined
              ? this.#state.preferences.timeZone
              : input.timeZone,
          hourCycle:
            input.hourCycle === undefined
              ? this.#state.preferences.hourCycle
              : input.hourCycle,
          weekStart:
            input.weekStart === undefined
              ? this.#state.preferences.weekStart
              : input.weekStart,
          rail:
            input.rail === undefined
              ? this.#state.preferences.rail
              : (input.rail ?? {}),
          eventTabs: mergeEventTabs(
            this.#state.preferences.eventTabs,
            input.eventTabs,
          ),
          workspaceRecency: mergeWorkspaceRecency(
            this.#state.preferences.workspaceRecency,
            input.workspaceRecency,
          ),
        },
      });
      return this.#user();
    }
    if (collection === "auth" && id === "sessions" && method === "DELETE")
      return { revoked: 1 };
    if (collection === "friends")
      return this.#friendWrite(method, id, operation, action, body);
    if (
      collection === "invitations" &&
      id &&
      operation === "accept" &&
      method === "POST"
    ) {
      if (
        this.#state.friends.sent.some(
          (item) => inviteToken(item.inviteUrl) === id,
        )
      )
        throw new SandboxError(
          400,
          "invalid_request",
          "This is your own invitation link.",
        );
      const sample = sampleInvitations.find((entry) => entry.token === id);
      if (sample === undefined)
        throw new SandboxError(
          404,
          "friend_unavailable",
          "The invitation does not exist.",
        );
      const friends = this.#state.friends;
      const standing = friends.friends.find(
        (friend) => friend.userId === sample.requester.id,
      );
      if (standing === undefined)
        this.#commit({
          ...this.#state,
          friends: {
            ...friends,
            incoming: friends.incoming.filter(
              (request) => request.requester.userId !== sample.requester.id,
            ),
            friends: [
              ...friends.friends,
              {
                id: crypto.randomUUID(),
                userId: sample.requester.id,
                displayName: sample.requester.displayName,
                email: sample.requester.email,
                since: new Date().toISOString(),
              },
            ].sort((a, b) => a.displayName.localeCompare(b.displayName)),
          },
        });
      return {
        friendship: standing === undefined ? "made" : "existing",
        shared: sample.queued,
        alreadyHad: [],
      };
    }
    if (collection === "shares")
      return this.#shareWrite(method, id, operation, body);
    if (
      collection === "workspaces" &&
      id === "current" &&
      operation === "members"
    )
      return this.#memberWrite(method, action, body);
    if (
      method === "POST" &&
      collection === "objects" &&
      id &&
      operation === "relations"
    ) {
      // An Event includes a live person the workspace already knows; the
      // relation is refused for other targets and for a repeat.
      const input = relationCreateRequestSchema.parse(body);
      const source = this.#object(id);
      const target = this.#object(input.targetObjectId);
      if (
        input.relationType !== "includes" ||
        source.objectType !== "event" ||
        target.objectType !== "person"
      )
        throw new SandboxError(
          400,
          "invalid_relation",
          "Only a person can be included in an event here.",
        );
      if (
        this.#state.relations.some(
          (link) =>
            link.sourceObjectId === id &&
            link.targetObjectId === target.id &&
            link.deletedAt === null,
        )
      )
        throw new SandboxError(
          409,
          "relation_exists",
          "The person is already part of this event.",
        );
      const link = relation(id, target.id);
      this.#commit({
        ...this.#state,
        relations: [...this.#state.relations, link],
      });
      return link;
    }
    if (method === "DELETE" && collection === "relations" && id) {
      const link = this.#state.relations.find(
        (candidate) => candidate.id === id && candidate.deletedAt === null,
      );
      if (link === undefined)
        throw new SandboxError(404, "not_found", "The link is unavailable.");
      const removed = {
        ...link,
        version: link.version + 1,
        deletedAt: new Date().toISOString(),
      };
      this.#commit({
        ...this.#state,
        relations: this.#state.relations.map((candidate) =>
          candidate.id === id ? removed : candidate,
        ),
      });
      return { id, version: removed.version, deletedAt: removed.deletedAt };
    }
    if (method === "POST" && collection === "persons" && !id) {
      const input = JSON.parse(
        JSON.stringify(personCreateRequestSchema.parse(body)),
      ) as Record<string, unknown>;
      const { permissionScopeId, commandId, ...fields } = input;
      const replay = this.#replayCreate(commandId, fields);
      if (replay !== undefined) return replay;
      const person = this.#checkPerson(
        canonical(
          "person",
          fields,
          typeof permissionScopeId === "string" ? permissionScopeId : undefined,
        ),
      );
      this.#commit({
        ...this.#state,
        objects: [...this.#state.objects, person],
      });
      this.#rememberCreate(commandId, fields, person.id);
      return person;
    }
    if (method === "POST" && collection === "notes" && !id) {
      const input = JSON.parse(
        JSON.stringify(noteCreateRequestSchema.parse(body)),
      ) as Record<string, unknown>;
      const { permissionScopeId, commandId, ...fields } = input;
      const replay = this.#replayCreate(commandId, fields);
      if (replay !== undefined) return replay;
      const note = canonical(
        "note",
        fields,
        typeof permissionScopeId === "string" ? permissionScopeId : undefined,
      );
      this.#commit({
        ...this.#state,
        objects: [...this.#state.objects, note],
      });
      this.#rememberCreate(commandId, fields, note.id);
      return note;
    }
    if (method === "POST" && collection === "tasks" && !id) {
      const input = JSON.parse(
        JSON.stringify(taskCreateRequestSchema.parse(body)),
      ) as Record<string, unknown>;
      const { permissionScopeId, commandId, ...fields } = input;
      const replay = this.#replayCreate(commandId, fields);
      if (replay !== undefined) return replay;
      const object = canonical(
        "task",
        { rank: rankAmong(this.#state.objects, "task"), ...fields },
        typeof permissionScopeId === "string" ? permissionScopeId : undefined,
      );
      this.#assertTaskParent(object);
      const labelled = this.#checkTask(object);
      this.#commit({
        ...this.#state,
        objects: [...this.#state.objects, labelled],
      });
      this.#rememberCreate(commandId, fields, labelled.id);
      return labelled;
    }
    if (method === "POST" && collection === "events") {
      if (!id) {
        const input = JSON.parse(
          JSON.stringify(eventCreateRequestSchema.parse(body)),
        ) as Record<string, unknown>;
        const object = canonical("event", input);
        this.#commit({
          ...this.#state,
          objects: [...this.#state.objects, object],
        });
        return object;
      }
      if (operation === "resources") {
        const parent = this.#object(id);
        if (parent.objectType !== "event")
          throw new SandboxError(
            400,
            "invalid_request",
            "A planning context must be an Event.",
          );
        const input = eventContextCreateRequestSchema.parse(body);
        const fields = JSON.parse(JSON.stringify(input.resource)) as Record<
          string,
          unknown
        >;
        if (
          (fields.objectType === "task" || fields.objectType === "reminder") &&
          fields.rank === undefined
        )
          fields.rank = rankAmong(this.#state.objects, fields.objectType);
        const resource = canonical(
          input.resource.objectType,
          fields,
          parent.permissionScopeId,
        );
        this.#assertTaskParent(resource);
        const labelled = this.#checkTask(resource);
        const link = relation(id, labelled.id);
        this.#commit({
          ...this.#state,
          objects: [...this.#state.objects, labelled],
          relations: [...this.#state.relations, link],
        });
        return { resource: labelled, relationId: link.id };
      }
    }
    if (
      ((method === "PATCH" && action === undefined) ||
        (method === "POST" && action === "restore")) &&
      collection === "events" &&
      id &&
      operation === "layout"
    ) {
      if (this.#object(id).objectType !== "event")
        throw new SandboxError(
          400,
          "invalid_request",
          "Page layouts belong to Events.",
        );
      const input =
        method === "POST"
          ? eventLayoutRestoreSchema.parse(body)
          : eventLayoutUpdateSchema.parse(body);
      const version =
        this.#state.layouts.find((layout) => layout.eventId === id)?.version ??
        0;
      if (version !== input.expectedVersion)
        throw new SandboxError(
          409,
          "version_conflict",
          "The page layout changed. Refresh before saving.",
        );
      let pages: EventLayoutResponse["pages"];
      if ("pages" in input) pages = input.pages;
      else if (input.targetVersion === 0) pages = [];
      else {
        const revision = this.#state.layouts.find(
          (layout) =>
            layout.eventId === id && layout.version === input.targetVersion,
        );
        if (!revision)
          throw new SandboxError(
            404,
            "resource_unavailable",
            "This layout revision is unavailable.",
          );
        pages = revision.pages;
      }
      const saved = {
        eventId: id,
        version: version + 1,
        updatedAt: new Date().toISOString(),
        pages,
      };
      this.#commit({
        ...this.#state,
        layouts: [saved, ...this.#state.layouts],
      });
      return saved;
    }
    if (collection === "commands" && method === "POST")
      return this.#commandWrite(id, body);
    if (method === "PATCH" && id && !operation) {
      const saved = this.#applyPatch(collection, id, body);
      if (saved !== undefined) return saved;
    }
    throw new SandboxError(
      501,
      "sandbox_unsupported",
      "This operation needs the full application. Real sign-in, sharing, file transfers and recovery are not simulated in this design sandbox.",
    );
  }

  /** The command stack as the API reports it: the heads carry no content. */
  #commandState() {
    const { version, stack, applied } = this.#commands;
    const undo = stack[applied - 1];
    const redo = stack[applied];
    return {
      version,
      undo: undo === undefined ? null : { commandId: undo.id, available: true },
      redo: redo === undefined ? null : { commandId: redo.id, available: true },
    };
  }

  /** Execute, undo, or redo; each is one more version of the objects it touches. */
  #commandWrite(direction: string | undefined, body: unknown) {
    const collections = { event: "events", task: "tasks" } as const;
    if (direction === undefined) {
      const input = commandExecuteRequestSchema.parse(body);
      this.#assertStackVersion(input.expectedStackVersion);
      // The record patch is applied as sent: the envelope's parse has
      // already turned its dates into Date objects.
      const sent = (body as { edits: { patch: Record<string, unknown> }[] })
        .edits;
      const edits = input.edits.map((edit, index) => {
        const before = this.#object(edit.objectId) as unknown as Record<
          string,
          unknown
        >;
        const { expectedVersion: _, ...fields } = edit.patch;
        const saved = this.#applyPatch(
          collections[edit.objectType],
          edit.objectId,
          sent[index]?.patch,
        );
        if (saved === undefined)
          throw new SandboxError(404, "not_found", "Unknown object.");
        const keys = Object.keys(fields);
        return {
          objectType: edit.objectType,
          objectId: edit.objectId,
          before: Object.fromEntries(keys.map((key) => [key, before[key]])),
          after: Object.fromEntries(
            keys.map((key) => [
              key,
              (saved as unknown as Record<string, unknown>)[key],
            ]),
          ),
        };
      });
      const command = { id: crypto.randomUUID(), edits };
      const { stack, applied } = this.#commands;
      this.#commands = {
        version: this.#commands.version + 1,
        stack: [...stack.slice(0, applied), command].slice(-50),
        applied: Math.min(applied + 1, 50),
      };
      return this.#receipt(input.operationId, command, "execute");
    }
    const input = commandTransitionRequestSchema.parse(body);
    this.#assertStackVersion(input.expectedStackVersion);
    const { stack, applied } = this.#commands;
    const index = direction === "undo" ? applied - 1 : applied;
    const command = stack[index];
    if (command === undefined || command.id !== input.commandId)
      throw new SandboxError(
        409,
        "command_stack_conflict",
        "The command stack changed. Refresh before undoing or redoing.",
      );
    for (const edit of command.edits) {
      const current = this.#object(edit.objectId);
      this.#applyPatch(collections[edit.objectType], edit.objectId, {
        expectedVersion: current.version,
        ...(direction === "undo" ? edit.before : edit.after),
      });
    }
    this.#commands = {
      version: this.#commands.version + 1,
      stack,
      applied: direction === "undo" ? applied - 1 : applied + 1,
    };
    return this.#receipt(
      input.operationId,
      command,
      direction === "undo" ? "undo" : "redo",
    );
  }

  #assertStackVersion(expected: number) {
    if (expected !== this.#commands.version)
      throw new SandboxError(
        409,
        "command_stack_conflict",
        "The command stack changed. Refresh before undoing or redoing.",
      );
  }

  #receipt(
    operationId: string,
    command: SandboxCommand,
    direction: "execute" | "undo" | "redo",
  ) {
    return {
      operationId,
      commandId: command.id,
      direction,
      stackVersion: this.#commands.version,
      objects: command.edits.map((edit) => ({
        id: edit.objectId,
        version: this.#object(edit.objectId).version,
      })),
    };
  }

  /** A content patch on one record, or undefined when the route is not one. */
  #applyPatch(
    collection: string | undefined,
    id: string,
    body: unknown,
  ): Resource | undefined {
    {
      const object = this.#object(id);
      const contracts = {
        events: { type: "event", schema: eventUpdateRequestSchema },
        tasks: { type: "task", schema: taskUpdateRequestSchema },
        expenses: { type: "expense", schema: expenseUpdateRequestSchema },
        reminders: { type: "reminder", schema: reminderUpdateRequestSchema },
        persons: { type: "person", schema: personUpdateRequestSchema },
        notes: { type: "note", schema: noteUpdateRequestSchema },
      };
      const contract =
        collection && Object.hasOwn(contracts, collection)
          ? contracts[collection as keyof typeof contracts]
          : undefined;
      if (contract && object.objectType === contract.type) {
        const { expectedVersion, ...requested } = contract.schema.parse(body);
        if (expectedVersion !== object.version)
          throw new SandboxError(
            409,
            "version_conflict",
            "The sample object changed. Refresh before saving.",
          );
        const patch = JSON.parse(JSON.stringify(requested)) as Record<
          string,
          unknown
        >;
        // Clearing a repeat rule clears its end.
        if ("repeatRule" in patch && patch.repeatRule === null)
          patch.repeatUntil = null;
        const saved = this.#checkPerson(
          this.#checkTask(
            eventPlanningResourceResponseSchema.parse({
              ...object,
              ...(object.objectType === "task"
                ? repeatTaskPatch(object, patch)
                : patch),
              version: object.version + 1,
              updatedAt: new Date().toISOString(),
            }),
          ),
        );
        if (
          saved.objectType === "task" &&
          saved.dueOn !== null &&
          saved.dueAt !== null
        )
          throw new SandboxError(
            400,
            "invalid_request",
            "dueOn and dueAt cannot both be set.",
          );
        this.#commit({
          ...this.#state,
          objects: this.#state.objects.map((current) =>
            current.id === id ? saved : current,
          ),
        });
        return saved;
      }
    }
    return undefined;
  }
}

interface SandboxCommand {
  readonly id: string;
  readonly edits: readonly {
    readonly objectType: "event" | "task";
    readonly objectId: string;
    readonly before: Record<string, unknown>;
    readonly after: Record<string, unknown>;
  }[];
}
