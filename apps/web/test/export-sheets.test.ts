import type {
  EventResponse,
  ExpenseResponse,
  NoteListItem,
  ReminderResponse,
  TaskResponse,
} from "@chronelle/schemas";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import en from "../messages/en.json";
import { setActiveLocale } from "../i18n/active-locale";
import {
  defaultTimePreferences,
  setActiveTimePreferences,
} from "../i18n/active-preferences";
import { daySheet } from "../lib/day-sheet";
import { eventDays } from "../lib/day-placement";
import {
  expenseSheet,
  isoDate,
  isoTime,
  itinerarySheet,
  noteSheet,
  reminderSheet,
  scheduleSheet,
  shownInPeriod,
  taskSheet,
  timelineSheet,
} from "../lib/export/sheets";

const base = {
  workspaceId: "019d6e7d-0000-7000-8000-000000000001",
  createdBy: "019d6e7d-0000-7000-8000-000000000002",
  permissionScopeId: "019d6e7d-0000-7000-8000-000000000010",
  createdAt: "2026-09-02T20:00:00.000Z",
  updatedAt: "2026-09-02T20:00:00.000Z",
  version: 1,
  archivedAt: null,
  deletedAt: null,
  customProperties: {},
  metadata: {},
} as const;

let counter = 0;
function nextId(): string {
  counter += 1;
  return `019d6e7d-0000-7000-8000-0000000000${String(counter).padStart(2, "0")}`;
}

function item(
  displayName: string,
  fields: Partial<EventResponse> = {},
): EventResponse {
  return {
    ...base,
    id: nextId(),
    objectType: "event",
    displayName,
    description: null,
    startsAt: null,
    endsAt: null,
    startsOn: null,
    endsOn: null,
    timezone: "Asia/Tokyo",
    isAllDay: false,
    location: null,
    ...fields,
  };
}

function task(
  displayName: string,
  fields: Partial<TaskResponse> = {},
): TaskResponse {
  return {
    ...base,
    id: nextId(),
    objectType: "task",
    displayName,
    description: null,
    status: "todo",
    dueOn: null,
    dueAt: null,
    durationMinutes: null,
    repeatRule: null,
    repeatUntil: null,
    completedAt: null,
    parentTaskId: null,
    assigneeId: null,
    location: null,
    rank: "00000001000",
    labelIds: [],
    ...fields,
  };
}

// Kyoto time: 09:30 in Kyoto on Nov 3 is 00:30Z.
const inKyoto = (day: string, time: string) =>
  new Date(`${day}T${time}:00+09:00`).toISOString();

beforeEach(() => {
  setActiveLocale("en", en);
  setActiveTimePreferences({
    timeZone: "Asia/Tokyo",
    hourCycle: "h23",
    weekStart: null,
  });
});

afterEach(() => {
  setActiveTimePreferences(defaultTimePreferences);
});

describe("isoDate and isoTime", () => {
  it("read an instant in the shown zone as a date and a 24-hour time", () => {
    const instant = inKyoto("2030-11-03", "09:30");
    expect(isoDate(instant)).toBe("2030-11-03");
    expect(isoTime(instant)).toBe("09:30");
    expect(isoTime(inKyoto("2030-11-03", "00:05"))).toBe("00:05");
  });
});

describe("taskSheet", () => {
  it("names the assignee and the labels, splits a due time, and carries the event", () => {
    const labels = new Map([["label-1", "Venue"]]);
    const persons = new Map([["person-1", "Mei Lin"]]);
    const sheet = taskSheet(
      [
        task("Confirm the garden venue", {
          dueAt: inKyoto("2030-11-03", "09:30"),
          durationMinutes: 45,
          assigneeId: "person-1",
          labelIds: ["label-1", "label-9"],
          location: "Gion",
        }),
        task("Send invitations", {
          status: "done",
          dueOn: "2030-11-01",
          repeatRule: "weekly",
          repeatUntil: "2030-12-01",
        }),
      ],
      { event: "Autumn gathering", labels, persons },
    );
    expect(sheet.columns).toEqual([
      "name",
      "status",
      "dueDate",
      "dueTime",
      "durationMinutes",
      "repeat",
      "repeatUntil",
      "assignee",
      "labels",
      "location",
      "description",
      "event",
    ]);
    expect(sheet.rows).toEqual([
      [
        "Confirm the garden venue",
        "todo",
        "2030-11-03",
        "09:30",
        "45",
        "",
        "",
        "Mei Lin",
        "Venue; label-9",
        "Gion",
        "",
        "Autumn gathering",
      ],
      [
        "Send invitations",
        "done",
        "2030-11-01",
        "",
        "",
        "weekly",
        "2030-12-01",
        "",
        "",
        "",
        "",
        "Autumn gathering",
      ],
    ]);
  });
});

describe("scheduleSheet", () => {
  it("splits a timed item into dates and times and leaves a date-only item's times blank", () => {
    const sheet = scheduleSheet([
      item("Lunch", {
        startsAt: inKyoto("2030-11-03", "12:00"),
        endsAt: inKyoto("2030-11-03", "13:00"),
        location: "Nishiki market",
      }),
      item("Kyoto, day 2", {
        startsOn: "2030-11-02",
        endsOn: "2030-11-04",
        isAllDay: true,
      }),
    ]);
    expect(sheet.columns).toEqual([
      "name",
      "startDate",
      "startTime",
      "endDate",
      "endTime",
      "allDay",
      "place",
      "description",
    ]);
    expect(sheet.rows).toEqual([
      [
        "Lunch",
        "2030-11-03",
        "12:00",
        "2030-11-03",
        "13:00",
        "no",
        "Nishiki market",
        "",
      ],
      ["Kyoto, day 2", "2030-11-02", "", "2030-11-04", "", "yes", "", ""],
    ]);
  });
});

describe("itinerarySheet", () => {
  it("lists each day as its page reads: running items, timed rows, tasks due, then the untimed", () => {
    const items = [
      item("Kyoto, day 2", { startsOn: "2030-11-02", endsOn: "2030-11-04" }),
      item("Lunch", {
        startsAt: inKyoto("2030-11-03", "12:00"),
        endsAt: inKyoto("2030-11-03", "13:00"),
        location: "Nishiki market",
      }),
      item("Morning walk", { startsAt: inKyoto("2030-11-03", "08:00") }),
      item("Buy tickets", { startsOn: "2030-11-03" }),
    ];
    const tasks = [
      task("Pack", { dueOn: "2030-11-03" }),
      task("Call the ryokan", { dueAt: inKyoto("2030-11-03", "17:00") }),
    ];
    const sheet = itinerarySheet([daySheet("2030-11-03", items, tasks)]);
    expect(sheet.columns).toEqual([
      "day",
      "kind",
      "name",
      "startTime",
      "endTime",
      "place",
    ]);
    expect(sheet.rows).toEqual([
      ["2030-11-03", "event", "Kyoto, day 2", "", "", ""],
      ["2030-11-03", "event", "Morning walk", "08:00", "", ""],
      ["2030-11-03", "event", "Lunch", "12:00", "13:00", "Nishiki market"],
      ["2030-11-03", "task", "Pack", "", "", ""],
      ["2030-11-03", "task", "Call the ryokan", "17:00", "", ""],
      ["2030-11-03", "event", "Buy tickets", "", "", ""],
    ]);
  });
});

describe("timelineSheet, expenseSheet, reminderSheet, noteSheet", () => {
  it("read each record's kind, name, and moment in the shown zone", () => {
    expect(
      timelineSheet([
        {
          canonicalObjectId: nextId(),
          version: 1,
          objectType: "task",
          displayName: "Pack",
          occursOn: "2030-11-03",
          occursAt: null,
        },
        {
          canonicalObjectId: nextId(),
          version: 1,
          objectType: "event",
          displayName: "Lunch",
          occursOn: null,
          occursAt: inKyoto("2030-11-03", "12:00"),
        },
      ]).rows,
    ).toEqual([
      ["task", "Pack", "2030-11-03"],
      ["event", "Lunch", "2030-11-03 12:00"],
    ]);

    const expense: ExpenseResponse = {
      ...base,
      id: nextId(),
      objectType: "expense",
      displayName: "Venue deposit",
      amount: "240.0000",
      currency: "USD",
      occurredAt: inKyoto("2030-11-03", "23:30"),
    };
    expect(expenseSheet([expense])).toEqual({
      columns: ["name", "amount", "currency", "paidOn"],
      rows: [["Venue deposit", "240.0000", "USD", "2030-11-03"]],
    });

    const reminder: ReminderResponse = {
      ...base,
      id: nextId(),
      objectType: "reminder",
      displayName: "Check the forecast",
      remindAt: inKyoto("2030-11-03", "07:00"),
      status: "pending",
      rank: "00000001000",
    };
    expect(reminderSheet([reminder])).toEqual({
      columns: ["name", "remindAt", "status"],
      rows: [["Check the forecast", "2030-11-03 07:00", "pending"]],
    });

    const note: NoteListItem = {
      ...base,
      id: nextId(),
      objectType: "note",
      displayName: "House rules",
      body: "Shoes off.\nQuiet after ten.",
      updatedAt: inKyoto("2030-11-03", "21:15"),
      editedBy: null,
    };
    expect(noteSheet([note])).toEqual({
      columns: ["title", "text", "lastEdited", "editedBy"],
      rows: [
        ["House rules", "Shoes off.\nQuiet after ten.", "2030-11-03 21:15", ""],
      ],
    });
  });
});

describe("shownInPeriod", () => {
  const items = [
    item("Before", { startsOn: "2030-10-30" }),
    item("Runs in", { startsOn: "2030-10-31", endsOn: "2030-11-02" }),
    item("Inside", { startsAt: inKyoto("2030-11-05", "10:00") }),
    item("After", { startsOn: "2030-11-10" }),
    item("Undated"),
  ];

  it("keeps the items with a day in the range, in order, then the undated ones", () => {
    expect(
      shownInPeriod(items, eventDays, {
        from: "2030-11-01",
        to: "2030-11-07",
      }).map((shown) => shown.displayName),
    ).toEqual(["Runs in", "Inside", "Undated"]);
  });

  it("keeps every item when the view has no range", () => {
    expect(
      shownInPeriod(items, eventDays, null).map((shown) => shown.displayName),
    ).toEqual(["Before", "Runs in", "Inside", "After", "Undated"]);
  });
});
