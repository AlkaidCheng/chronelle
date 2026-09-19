import { randomUUID } from "node:crypto";

import type { InjectOptions, LightMyRequestResponse } from "fastify";

import type { RecordingEmailSender } from "./recording-email-sender.js";

/**
 * Test accounts with representative data, created through the API's own
 * HTTP contract (the app injected in-process, so the request validation,
 * authorization, audit, and revisions apply as for any client) and
 * therefore on whichever backend the app is composed for. The set is
 * idempotent by username: an account that exists is signed in and left as
 * it is, and the data is created only when all three accounts are new.
 *
 * Three accounts: Mei plans a trip (Kyoto in November) and an offsite that
 * spans today, with schedule items and their places, tasks with subtasks,
 * expenses, reminders, people, notes, a label vocabulary, a trashed record,
 * a note with two versions, a share, a share waiting on an invitation, an
 * open invitation link, and a pending friend request; Kai is Mei's friend
 * and shares a dinner with her; Ana has asked Mei to be friends.
 */
export interface SeedAccount {
  readonly key: "mei" | "kai" | "ana";
  readonly username: string;
  readonly displayName: string;
  readonly email: string;
  readonly locale: "zh-Hans" | "zh-Hant" | null;
  readonly timeZone: string;
  readonly hourCycle: "h12" | "h23";
}

export const seedAccounts: readonly SeedAccount[] = [
  {
    key: "mei",
    username: "mei-lin",
    displayName: "Mei Lin",
    email: "mei.lin@example.com",
    locale: null,
    timeZone: "Asia/Shanghai",
    hourCycle: "h23",
  },
  {
    key: "kai",
    username: "kai-tanaka",
    displayName: "Kai Tanaka",
    email: "kai.tanaka@example.com",
    locale: "zh-Hans",
    timeZone: "Asia/Tokyo",
    hourCycle: "h23",
  },
  {
    key: "ana",
    username: "ana-souza",
    displayName: "Ana Souza",
    email: "ana.souza@example.com",
    locale: "zh-Hant",
    timeZone: "America/Los_Angeles",
    hourCycle: "h12",
  },
];

export interface SeedOptions {
  /** The password every seeded account gets; at least ten characters. */
  readonly password: string;
  /** The day the offsite is placed around; the current day by default. */
  readonly today?: Date | undefined;
}

export interface SeedAccountReport {
  readonly username: string;
  readonly email: string;
  readonly displayName: string;
  readonly status: "created" | "exists";
}

export interface SeedReport {
  readonly accounts: readonly SeedAccountReport[];
  /** The open invitation link Mei created, for the claim page; null when nothing was seeded. */
  readonly invitationLink: string | null;
  /** How many records each request created, by object type. */
  readonly created: Readonly<Record<string, number>>;
}

/** The part of a Fastify app the seed needs: requests without a network. */
export interface SeedApp {
  inject(options: InjectOptions): Promise<LightMyRequestResponse>;
}

/** A request the API refused, with what it answered. */
export class SeedRequestError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(method: string, url: string, status: number, body: string) {
    super(`${method} ${url} answered ${status}: ${body}`);
    this.name = "SeedRequestError";
    this.status = status;
    this.body = body;
  }
}

interface Session {
  readonly token: string;
  readonly userId: string;
  readonly workspaceId: string;
}

type Json = Record<string, unknown>;

class Api {
  readonly #app: SeedApp;
  readonly created: Record<string, number> = {};

  constructor(app: SeedApp) {
    this.#app = app;
  }

  async call<T = Json>(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    url: string,
    options: { token?: string | undefined; payload?: Json | undefined } = {},
  ): Promise<T> {
    const response = await this.#app.inject({
      method,
      url,
      ...(options.payload !== undefined && { payload: options.payload }),
      headers: {
        ...(options.token !== undefined && {
          authorization: `Bearer ${options.token}`,
        }),
      },
    });
    if (response.statusCode >= 400)
      throw new SeedRequestError(
        method,
        url,
        response.statusCode,
        response.body,
      );
    return response.body === "" ? (undefined as T) : (response.json() as T);
  }

  /** A record of a type the count keeps, created by any of the object routes. */
  async create<T = Json>(
    type: string,
    token: string,
    url: string,
    payload: Json,
  ): Promise<T> {
    const record = await this.call<T>("POST", url, { token, payload });
    this.created[type] = (this.created[type] ?? 0) + 1;
    return record;
  }
}

/** A UTC instant from a local date and time at a fixed offset. */
function instant(date: string, time: string, offset: string): string {
  return new Date(`${date}T${time}:00${offset}`).toISOString();
}

/** The calendar date some days from a moment, in a time zone. */
function dayIn(from: Date, days: number, timeZone: string): string {
  const moment = new Date(from.getTime() + days * 86_400_000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(moment);
}

async function ensureAccount(
  api: Api,
  codes: RecordingEmailSender,
  account: SeedAccount,
  password: string,
): Promise<{ session: Session; created: boolean }> {
  const availability = await api.call<{ available: boolean }>(
    "GET",
    `/api/auth/username-available?username=${account.username}`,
  );
  if (!availability.available) {
    let signIn: Json;
    try {
      signIn = await api.call("POST", "/api/auth/sign-in", {
        payload: { login: account.username, password },
      });
    } catch (error) {
      if (error instanceof SeedRequestError && error.status === 401)
        throw new Error(
          `The account ${account.username} exists with another password; sign in with its password or start from an empty database.`,
        );
      throw error;
    }
    return { session: session(signIn), created: false };
  }
  await api.call("POST", "/api/auth/sign-up", {
    payload: {
      email: account.email,
      password,
      username: account.username,
      displayName: account.displayName,
      ...(account.locale !== null && { locale: account.locale }),
    },
  });
  const verified = await api.call("POST", "/api/auth/verify-email", {
    payload: { email: account.email, code: codes.codeFor(account.email) },
  });
  const current = session(verified);
  // A seeded account is past the Welcome step and can be found by email,
  // so a card that carries its address resolves to it.
  await api.call("PATCH", "/api/account", {
    token: current.token,
    payload: { onboarded: true, findByEmail: true },
  });
  await api.call("PATCH", "/api/auth/me", {
    token: current.token,
    payload: {
      locale: account.locale,
      timeZone: account.timeZone,
      hourCycle: account.hourCycle,
    },
  });
  return { session: current, created: true };
}

function session(response: Json): Session {
  const user = response.user as { id: string };
  const workspace = response.workspace as { id: string };
  return {
    token: response.accessToken as string,
    userId: user.id,
    workspaceId: workspace.id,
  };
}

interface Created {
  readonly id: string;
  readonly version: number;
  readonly permissionScopeId: string;
}

/** Creates a record inside an event, as the event's views do. */
async function inEvent(
  api: Api,
  token: string,
  eventId: string,
  resource: Json & { objectType: string },
): Promise<Created> {
  const result = await api.create<{ resource: Created }>(
    resource.objectType,
    token,
    `/api/events/${eventId}/resources`,
    { commandId: randomUUID(), resource },
  );
  return result.resource;
}

// Kyoto, Japan Standard Time; the trip is fixed in early November 2026.
const jst = "+09:00";
const kyotoDays = [
  "2026-11-02",
  "2026-11-03",
  "2026-11-04",
  "2026-11-05",
  "2026-11-06",
] as const;

/** Mei's workspace; returns the Kyoto event's id for the share that follows. */
async function seedMei(
  api: Api,
  mei: Session,
  kai: Session,
  today: Date,
): Promise<string> {
  const token = mei.token;
  const label = async (name: string) =>
    (await api.create<{ id: string }>("label", token, "/api/labels", { name }))
      .id;
  const trip = await label("Trip");
  const family = await label("Family");
  await label("Urgent");

  // Kyoto in November: five days, the running order with places.
  const kyoto = await api.create<Created>("event", token, "/api/events", {
    displayName: "Kyoto in November",
    startsOn: kyotoDays[0],
    endsOn: kyotoDays[4],
    isAllDay: true,
    timezone: "Asia/Tokyo",
  });
  const timed = (
    day: (typeof kyotoDays)[number],
    start: string,
    end: string,
    displayName: string,
    location?: string,
  ) =>
    inEvent(api, token, kyoto.id, {
      objectType: "event",
      displayName,
      startsAt: instant(day, start, jst),
      endsAt: instant(day, end, jst),
      timezone: "Asia/Tokyo",
      ...(location !== undefined && { location }),
    });
  const dated = (
    startsOn: string,
    displayName: string,
    endsOn = startsOn,
    location?: string,
  ) =>
    inEvent(api, token, kyoto.id, {
      objectType: "event",
      displayName,
      startsOn,
      endsOn,
      isAllDay: true,
      timezone: "Asia/Tokyo",
      ...(location !== undefined && { location }),
    });
  await timed(kyotoDays[0], "09:10", "12:30", "Flight to Osaka", "Pudong T2");
  await timed(
    kyotoDays[0],
    "13:30",
    "14:45",
    "Haruka to Kyoto",
    "Kansai Airport station",
  );
  await timed(
    kyotoDays[0],
    "16:00",
    "16:30",
    "Ryokan check-in",
    "Yoshida-sanso",
  );
  await dated(kyotoDays[1], "Kyoto, day 2");
  await timed(
    kyotoDays[1],
    "08:00",
    "09:00",
    "Breakfast at the ryokan",
    "Yoshida-sanso, dining room",
  );
  await timed(
    kyotoDays[1],
    "09:30",
    "11:30",
    "Fushimi Inari, the lower loop",
    "Fushimi Inari Taisha, main gate",
  );
  await timed(kyotoDays[1], "12:00", "13:00", "Lunch", "Nishiki Market");
  await timed(
    kyotoDays[1],
    "15:00",
    "17:00",
    "Tea ceremony",
    "Camellia Flower, Ninenzaka",
  );
  await timed(
    kyotoDays[1],
    "19:00",
    "21:00",
    "Dinner with the Tanakas",
    "Gion, address in Notes",
  );
  await timed(
    kyotoDays[2],
    "08:30",
    "10:30",
    "Arashiyama bamboo grove",
    "Saga-Arashiyama station",
  );
  await timed(kyotoDays[2], "11:00", "12:30", "Tenryu-ji", "Arashiyama");
  await dated(kyotoDays[2], "Yasaka shrine at dusk");
  await dated(kyotoDays[2], "Buy tea for the office");
  await dated(kyotoDays[3], "Nara day trip");
  await timed(kyotoDays[3], "10:00", "12:00", "Todai-ji", "Nara Park");
  await timed(
    kyotoDays[4],
    "10:00",
    "12:20",
    "Shinkansen to Tokyo",
    "Kyoto station, Hachijo gate",
  );

  // People: a linked friend, a family with an address, a guide with only a
  // phone (the card an invitation link is for).
  const kaiCard = await inEvent(api, token, kyoto.id, {
    objectType: "person",
    displayName: "Kai Tanaka",
    nickname: "Kai",
    contacts: [{ kind: "email", value: seedAccounts[1]?.email ?? "" }],
    labelIds: [family],
  });
  const tanakas = await inEvent(api, token, kyoto.id, {
    objectType: "person",
    displayName: "Hiroshi and Yumi Tanaka",
    nickname: "The Tanakas",
    description: "Kai's parents; dinner on the second evening.",
    contacts: [
      { kind: "email", value: "tanaka.family@example.com" },
      { kind: "phone", value: "+81 75 000 0000" },
    ],
    labelIds: [family],
  });
  await inEvent(api, token, kyoto.id, {
    objectType: "person",
    displayName: "Ito Haruka",
    nickname: "Guide Ito",
    description: "Walking guide for Fushimi Inari.",
    contacts: [{ kind: "phone", value: "+81 90 0000 0000" }],
  });

  // Tasks: one with subtasks, one assigned and due at a time, one done.
  const tickets = await inEvent(api, token, kyoto.id, {
    objectType: "task",
    displayName: "Book the Arashiyama bamboo tickets",
    dueOn: kyotoDays[1],
    labelIds: [trip],
  });
  const subtask = (displayName: string, status: "todo" | "done") =>
    api.create("task", token, "/api/tasks", {
      displayName,
      parentTaskId: tickets.id,
      permissionScopeId: tickets.permissionScopeId,
      status,
      ...(status === "done" && {
        completedAt: instant("2026-09-15", "10:00", "+08:00"),
      }),
    });
  await subtask("Compare the morning slots", "done");
  await subtask("Pay the deposit", "done");
  await subtask("Print the QR codes", "todo");
  await inEvent(api, token, kyoto.id, {
    objectType: "task",
    displayName: "Confirm the dinner headcount",
    dueAt: instant(kyotoDays[1], "18:00", jst),
    assigneeId: kaiCard.id,
    location: "Gion",
  });
  await inEvent(api, token, kyoto.id, {
    objectType: "task",
    displayName: "Exchange yen",
    status: "done",
    completedAt: instant("2026-09-12", "16:30", "+08:00"),
    dueOn: "2026-09-12",
  });
  await inEvent(api, token, kyoto.id, {
    objectType: "task",
    displayName: "Pack the gift from the office",
    dueOn: "2026-11-01",
    labelIds: [trip],
  });

  // Expenses in two currencies; reminders before and during the trip.
  const expense = (
    displayName: string,
    amount: string,
    currency: string,
    occurredAt: string,
  ) =>
    inEvent(api, token, kyoto.id, {
      objectType: "expense",
      displayName,
      amount,
      currency,
      occurredAt,
    });
  await expense(
    "Ryokan deposit",
    "48000",
    "JPY",
    instant("2026-09-10", "21:00", "+08:00"),
  );
  await expense(
    "Flights, two seats",
    "3280.00",
    "CNY",
    instant("2026-09-08", "09:15", "+08:00"),
  );
  await expense(
    "JR Pass, 7 days",
    "50000",
    "JPY",
    instant("2026-09-16", "12:00", "+08:00"),
  );
  await expense(
    "Tea ceremony booking",
    "12000",
    "JPY",
    instant("2026-09-17", "20:40", "+08:00"),
  );
  await inEvent(api, token, kyoto.id, {
    objectType: "reminder",
    displayName: "Check in online",
    remindAt: instant("2026-11-01", "09:00", "+08:00"),
  });
  await inEvent(api, token, kyoto.id, {
    objectType: "reminder",
    displayName: "Ryokan check-out by 11:00",
    remindAt: instant(kyotoDays[2], "10:30", jst),
  });

  // Notes, one with two versions for History.
  await inEvent(api, token, kyoto.id, {
    objectType: "note",
    displayName: "Dinner with the Tanakas",
    body: [
      "Gion, Hanamikoji-dori, second alley on the left after the tea house; the door with the red lantern.",
      "They booked under Tanaka, 19:00, eight people.",
      "Bring the gift from the office. https://maps.example/tanaka-gion",
    ].join("\n"),
  });
  const bring = await inEvent(api, token, kyoto.id, {
    objectType: "note",
    displayName: "What to bring",
    body: "Coins for the shrines, a folding umbrella, the JR pass.",
  });
  await api.call("PATCH", `/api/notes/${bring.id}`, {
    token,
    payload: {
      expectedVersion: bring.version,
      body: "Coins for the shrines, a folding umbrella, the JR pass, the confirmation for the tea ceremony, walking shoes for the Fushimi loop.",
    },
  });
  await inEvent(api, token, kyoto.id, {
    objectType: "note",
    displayName: "Ryokan house rules",
    body: "Shoes off at the entrance. Bath 16:00 to 22:00. Breakfast at 08:00 sharp, in the dining room. Quiet after 22:00.",
  });

  // A record in Trash.
  const dropped = await inEvent(api, token, kyoto.id, {
    objectType: "task",
    displayName: "Karaoke night (dropped)",
  });
  await api.call(
    "DELETE",
    `/api/objects/${dropped.id}?expectedVersion=${dropped.version}`,
    { token },
  );

  // The offsite spans today, so Today, Due today, and the Itinerary's now
  // bar have something to show in Mei's time zone.
  const zone = "Asia/Shanghai";
  const cst = "+08:00";
  const yesterday = dayIn(today, -1, zone);
  const day = dayIn(today, 0, zone);
  const tomorrow = dayIn(today, 1, zone);
  const offsite = await api.create<Created>("event", token, "/api/events", {
    displayName: "Team offsite",
    startsOn: yesterday,
    endsOn: dayIn(today, 2, zone),
    isAllDay: true,
    timezone: zone,
    location: "Sheshan, Songjiang",
  });
  const session = (
    date: string,
    start: string,
    end: string,
    displayName: string,
    location?: string,
  ) =>
    inEvent(api, token, offsite.id, {
      objectType: "event",
      displayName,
      startsAt: instant(date, start, cst),
      endsAt: instant(date, end, cst),
      timezone: zone,
      ...(location !== undefined && { location }),
    });
  await session(yesterday, "14:00", "17:30", "Arrival and check-in", "Lobby");
  await session(day, "09:30", "09:45", "Stand-up", "Room 4B");
  await session(day, "10:00", "12:00", "Workshop: next quarter", "Room 4B");
  await session(day, "12:00", "13:00", "Lunch", "Canteen, ground floor");
  await session(day, "14:00", "15:30", "Design review", "Room 2A");
  await session(day, "16:00", "17:00", "Retrospective", "Room 4B");
  await session(tomorrow, "08:00", "12:00", "Hike", "Sheshan west trail");
  await inEvent(api, token, offsite.id, {
    objectType: "task",
    displayName: "Send the agenda",
    dueAt: instant(day, "11:00", cst),
    durationMinutes: 30,
  });
  await inEvent(api, token, offsite.id, {
    objectType: "task",
    displayName: "Order lunch",
    dueOn: day,
    status: "done",
    completedAt: instant(day, "08:20", cst),
  });
  await inEvent(api, token, offsite.id, {
    objectType: "task",
    displayName: "Collect the retro notes",
    dueOn: tomorrow,
  });
  await inEvent(api, token, offsite.id, {
    objectType: "reminder",
    displayName: "Bring the projector",
    remindAt: instant(day, "09:00", cst),
  });
  await inEvent(api, token, offsite.id, {
    objectType: "expense",
    displayName: "Bus rental",
    amount: "1200.00",
    currency: "CNY",
    occurredAt: instant(day, "08:00", cst),
  });
  await inEvent(api, token, offsite.id, {
    objectType: "note",
    displayName: "Offsite logistics",
    body: "Bus leaves the office at 13:00. Rooms are under the company name. Dinner is at 19:00 in the courtyard.",
  });

  // A plain dated event, and tasks of the workspace outside any event.
  await api.create("event", token, "/api/events", {
    displayName: "Quarterly budget review",
    startsAt: instant("2026-10-08", "14:00", cst),
    endsAt: instant("2026-10-08", "15:30", cst),
    timezone: zone,
    location: "Finance, 12th floor",
  });
  await api.create("task", token, "/api/tasks", {
    displayName: "Renew the domain",
    dueOn: dayIn(today, 3, zone),
  });
  await api.create("task", token, "/api/tasks", {
    displayName: "Weekly review",
    dueOn: dayIn(today, 1, zone),
    repeatRule: "weekly",
  });

  // Kai becomes a friend from his card; the Tanakas' share waits on an
  // emailed invitation; a link is open for anyone to claim.
  await api.call("POST", "/api/friends/invitations", {
    token,
    payload: { email: seedAccounts[1]?.email, personId: kaiCard.id },
  });
  const incoming = await api.call<{ incoming: { id: string }[] }>(
    "GET",
    "/api/friends",
    { token: kai.token },
  );
  const request = incoming.incoming[0];
  if (request === undefined)
    throw new Error("Kai did not receive Mei's friend request.");
  await api.call("POST", `/api/friends/requests/${request.id}/accept`, {
    token: kai.token,
  });
  await api.call("POST", "/api/shares/pending", {
    token,
    payload: { resourceId: kyoto.id, personId: tanakas.id, role: "viewer" },
  });
  return kyoto.id;
}

async function shareWithFriend(
  api: Api,
  owner: Session,
  friendUserId: string,
  resourceId: string,
  role: "viewer" | "editor",
): Promise<void> {
  const list = await api.call<{ friends: { id: string; userId: string }[] }>(
    "GET",
    "/api/friends",
    { token: owner.token },
  );
  const friend = list.friends.find((entry) => entry.userId === friendUserId);
  if (friend === undefined) throw new Error("The friendship was not made.");
  await api.call("POST", "/api/shares", {
    token: owner.token,
    payload: { resourceId, friendId: friend.id, role },
  });
}

/** Kai's workspace; returns the dinner's id for the share that follows. */
async function seedKai(api: Api, kai: Session, today: Date): Promise<string> {
  const token = kai.token;
  const date = dayIn(today, 10, "Asia/Tokyo");
  const dinner = await api.create<Created>("event", token, "/api/events", {
    displayName: "Kai's birthday dinner",
    startsAt: instant(date, "19:00", jst),
    endsAt: instant(date, "22:00", jst),
    timezone: "Asia/Tokyo",
    location: "Ebisu, Yokohama",
  });
  await inEvent(api, token, dinner.id, {
    objectType: "task",
    displayName: "Book the table",
    status: "done",
    completedAt: instant(dayIn(today, -2, "Asia/Tokyo"), "12:00", jst),
  });
  await inEvent(api, token, dinner.id, {
    objectType: "task",
    displayName: "Send the invitations",
    dueOn: dayIn(today, 2, "Asia/Tokyo"),
  });
  await inEvent(api, token, dinner.id, {
    objectType: "note",
    displayName: "Menu ideas",
    body: "Omakase for eight, or the yakitori place by the station.",
  });
  return dinner.id;
}

/** Ana's workspace, and her request to Mei. */
async function seedAna(api: Api, ana: Session, meiUserId: string) {
  const token = ana.token;
  const lisbon = await api.create<Created>("event", token, "/api/events", {
    displayName: "Lisbon in spring",
    startsOn: "2027-04-10",
    endsOn: "2027-04-17",
    isAllDay: true,
    timezone: "Europe/Lisbon",
  });
  await inEvent(api, token, lisbon.id, {
    objectType: "task",
    displayName: "Compare flights",
    dueOn: "2027-01-15",
  });
  await inEvent(api, token, lisbon.id, {
    objectType: "task",
    displayName: "Ask Mei about the tiles museum",
  });
  await api.call("POST", "/api/friends/requests", {
    token,
    payload: {
      userId: meiUserId,
      message: "Ana from the pottery class. Lisbon in April?",
    },
  });
}

export async function seedTestData(
  app: SeedApp,
  codes: RecordingEmailSender,
  options: SeedOptions,
): Promise<SeedReport> {
  const api = new Api(app);
  const today = options.today ?? new Date();
  const accounts = new Map<SeedAccount["key"], Session>();
  const reports: SeedAccountReport[] = [];
  let created = 0;
  for (const account of seedAccounts) {
    const result = await ensureAccount(api, codes, account, options.password);
    accounts.set(account.key, result.session);
    if (result.created) created += 1;
    reports.push({
      username: account.username,
      email: account.email,
      displayName: account.displayName,
      status: result.created ? "created" : "exists",
    });
  }
  const mei = accounts.get("mei");
  const kai = accounts.get("kai");
  const ana = accounts.get("ana");
  if (mei === undefined || kai === undefined || ana === undefined)
    throw new Error("An account was not signed in.");
  // The data is one set across the three workspaces (friendships, shares);
  // it is created when the whole set is new, and an existing set is left as
  // the testers have it.
  if (created < seedAccounts.length)
    return { accounts: reports, invitationLink: null, created: api.created };

  const kyotoId = await seedMei(api, mei, kai, today);
  await shareWithFriend(api, mei, kai.userId, kyotoId, "viewer");
  const dinnerId = await seedKai(api, kai, today);
  await shareWithFriend(api, kai, mei.userId, dinnerId, "editor");
  await seedAna(api, ana, mei.userId);
  const link = await api.call<{ inviteUrl: string | null }>(
    "POST",
    "/api/friends/invitations",
    {
      token: mei.token,
      payload: { channel: "link", message: "Come along to Kyoto." },
    },
  );
  return {
    accounts: reports,
    invitationLink: link.inviteUrl,
    created: api.created,
  };
}
